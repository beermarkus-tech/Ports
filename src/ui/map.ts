// World map rendering (SVG via d3-geo). Knows nothing about game rules:
// it is handed positions, routes and highlights by the view.

import { geoCircle, geoDistance, geoEqualEarth, geoGraticule10, geoInterpolate, geoPath, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import type { World } from '../sim/world';
import { currency } from './format';

const W = 1000;
const H = 470;
const NS = 'http://www.w3.org/2000/svg';

export type LonLat = [number, number];

export interface PortMarker {
  id: string;
  name: string;
  fuelPrice: number;
  /** Visual role, drives styling. */
  role: 'here' | 'dest' | 'cargo' | 'via' | 'normal';
  /** World events at this port. */
  strike?: boolean;
  boom?: boolean;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

type LabelKey = 'right' | 'left' | 'above' | 'below' | 'ne' | 'se' | 'nw' | 'sw';
interface LabelSpot { x: number; y: number; fy: number; anchor: 'start' | 'end' | 'middle' }
/** Where a port's name (baseline y) and price (baseline fy) can sit round its dot. */
/** How far the map zooms in. */
const MAX_ZOOM = 8;

const LABEL_SPOTS: Record<LabelKey, LabelSpot> = {
  right: { x: 10, y: -6, fy: 8, anchor: 'start' },
  left: { x: -10, y: -6, fy: 8, anchor: 'end' },
  above: { x: 0, y: -21, fy: -9, anchor: 'middle' },
  below: { x: 0, y: 18, fy: 29, anchor: 'middle' },
  ne: { x: 6, y: -16, fy: -4, anchor: 'start' },
  se: { x: 6, y: 15, fy: 27, anchor: 'start' },
  nw: { x: -6, y: -16, fy: -4, anchor: 'end' },
  sw: { x: -6, y: 15, fy: 27, anchor: 'end' },
};

export class MapView {
  readonly svg: SVGSVGElement;
  private projection: GeoProjection;
  private path: ReturnType<typeof geoPath>;
  private portLayer: SVGGElement;
  private routeLayer: SVGGElement;
  private shipLayer: SVGGElement;
  private wakeLayer: SVGGElement;
  private nightLayer: SVGGElement;
  private weatherLayer: SVGGElement;
  private effectLayer: SVGGElement;
  private ships = new Map<number, SVGGElement>();
  private wakes = new Map<number, SVGPathElement>();
  private clouds = new Map<string, SVGGElement>();
  private ports: Record<string, SVGGElement> = {};
  private portXY: Record<string, [number, number]> = {};
  private labelsPlaced = false;
  private notesKey = '';
  private fogLayer: SVGGElement;
  private fogImage: SVGImageElement;
  private fogTexts: { lon: number; lat: number; el: SVGTextElement }[] = [];
  private fogKnownSet: Set<string> | null = null;
  private laneEls: { a: string; b: string; d: string; p: Path2D; canal?: string; uncharted: boolean; closed: boolean }[] = [];
  private canvas!: HTMLCanvasElement;
  private spherePath!: Path2D;
  private sphereBox!: [[number, number], [number, number]];
  private graticulePath!: Path2D;
  private landPath!: Path2D;
  private landBox!: [[number, number], [number, number]];
  private fogKey = '';
  private fogParts = '';
  /** Zoom: everything on the map sits in one layer, scaled by k and moved by (tx, ty). */
  private vp!: SVGGElement;
  private k = 1;
  private tx = 0;
  private ty = 0;
  private zoomTimer = 0;
  private detailedCoast = false;
  private suppressClick = false;

  constructor(
    container: HTMLElement,
    private world: World,
    onPortClick: (id: string) => void,
    onPortHover: (id: string | null) => void,
    private onShipClick: (id: number) => void = () => {},
  ) {
    // Two stacked layers: the still background (sea, coasts, graticule, lanes) is painted onto a
    // canvas, redrawn only when the view or the charts change; everything else (fog, night, weather,
    // routes, ports, ships) is SVG on top. As SVG the background, with its detailed coastline, was
    // re-examined by the browser on every tick, which made the zoomed-in map slow.
    const stack = document.createElement('div');
    stack.className = 'map-stack';
    container.appendChild(stack);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map map-base';
    this.canvas.setAttribute('aria-hidden', 'true');
    stack.appendChild(this.canvas);
    this.svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'map map-top', role: 'img', 'aria-label': 'World map' });
    stack.appendChild(this.svg);
    new ResizeObserver(() => this.drawBase()).observe(stack);

    this.projection = geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], {
      type: 'MultiPoint',
      coordinates: [[-180, -50], [180, 66], [0, -50], [0, 66], [-180, 0], [180, 0]],
    });
    this.path = geoPath(this.projection);

    const defs = el('defs', {}, this.svg);
    defs.innerHTML = `
      <radialGradient id="ocean" cx="50%" cy="45%" r="75%">
        <stop offset="0%" stop-color="var(--ocean-1)"/><stop offset="100%" stop-color="var(--ocean-2)"/>
      </radialGradient>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="shallow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="3.5"/></filter>
      <filter id="cloud" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
      <filter id="night-soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="10"/></filter>
      <clipPath id="sphere-clip"><path d="${this.path({ type: 'Sphere' })}"/></clipPath>`;
    this.vp = el('g', { class: 'viewport' }, this.svg) as SVGGElement;

    // The background's shapes, as canvas paths (drawn in drawBase()).
    this.spherePath = new Path2D(this.path({ type: 'Sphere' })!);
    this.sphereBox = this.path.bounds({ type: 'Sphere' });
    this.graticulePath = new Path2D(this.path(geoGraticule10())!);
    const topo = landTopo as unknown as Topology;
    const land = feature(topo, topo.objects.land);
    this.landPath = new Path2D(this.path(land)!);
    this.landBox = this.path.bounds(land);
    for (const e of world.edges) {
      const d = this.path(this.line([e.a, e.b]))!;
      this.laneEls.push({ a: e.a, b: e.b, d, p: new Path2D(d), canal: e.canal, uncharted: false, closed: false });
    }

    // Fog of war (Age of Sail): unknown water lies under a parchment haze. It is drawn
    // once into a still image (blur and texture are far too costly as live SVG filters
    // on a map that redraws every tick) and redrawn only when the charts change.
    this.fogLayer = el('g', { class: 'fog' }, this.vp);
    this.fogLayer.style.display = 'none';
    this.fogImage = el('image', { x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none' }, this.fogLayer) as SVGImageElement;
    for (const [lon, lat, text, size] of [[-150, 5, 'Mare Incognitum', 22], [-120, -30, 'Mare del Sur', 18], [-140, 40, 'Here be dragons', 15],
      [50, -8, 'Zanguebar', 14], [140, -58, 'Terra Australis Incognita', 16], [175, 20, 'Mare Pacificum', 16]] as const) {
      const [x, y] = this.projection([lon, lat])!;
      const t = el('text', { x, y, class: 'fog-text', 'font-size': size, 'data-size': size, 'text-anchor': 'middle' }, this.fogLayer) as SVGTextElement;
      t.textContent = text;
      this.fogTexts.push({ lon, lat, el: t });
    }
    // The fog's colour follows light and dark mode.
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      this.drawBase();
      this.fogKey = '';
      this.setCharted(this.fogKnownSet);
    });

    this.nightLayer = el('g', { class: 'night', 'clip-path': 'url(#sphere-clip)' }, this.vp);
    this.weatherLayer = el('g', { class: 'weather', 'clip-path': 'url(#sphere-clip)' }, this.vp);
    this.routeLayer = el('g', { class: 'routes' }, this.vp);
    this.wakeLayer = el('g', { class: 'wakes' }, this.vp);
    this.portLayer = el('g', { class: 'ports' }, this.vp);

    // Ports a few miles apart (Canton and Macau, Bantam and Batavia) would sit on one
    // dot: nudge such dots apart on the chart, a few map units at most.
    const at: Record<string, [number, number]> = {};
    for (const p of world.portList) at[p.id] = this.projection([p.lon, p.lat])! as [number, number];
    const MIN_GAP = 12;
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < world.portList.length; i++) for (let j = i + 1; j < world.portList.length; j++) {
        const a = at[world.portList[i].id], b = at[world.portList[j].id];
        let dx = b[0] - a[0], dy = b[1] - a[1];
        let d = Math.hypot(dx, dy);
        if (d >= MIN_GAP) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; }
        const push = (MIN_GAP - d) / 2;
        a[0] -= (dx / d) * push; a[1] -= (dy / d) * push;
        b[0] += (dx / d) * push; b[1] += (dy / d) * push;
      }
    }
    for (const p of world.portList) {
      const [x, y] = at[p.id];
      const g = el('g', { class: 'port', transform: `translate(${x},${y})`, tabindex: 0, role: 'button', 'aria-label': p.name }, this.portLayer);
      el('circle', { r: 14, class: 'hit' }, g);
      el('circle', { r: 9, class: 'halo' }, g);
      el('circle', { r: 7, class: 'lights' }, g);
      el('circle', { r: 4.5, class: 'dot' }, g);
      el('circle', { r: 1.8, class: 'dot-core' }, g);
      // Label placement starts from the port data; placeLabels() moves the ones that collide.
      const place = LABEL_SPOTS[p.label ?? 'right'];
      const label = el('text', { x: place.x, y: place.y, class: 'label', 'text-anchor': place.anchor }, g);
      label.textContent = p.name;
      const fuel = el('text', { x: place.x, y: place.fy, class: 'fuel', 'text-anchor': place.anchor }, g);
      fuel.textContent = '';
      g.addEventListener('click', () => onPortClick(p.id));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') onPortClick(p.id); });
      g.addEventListener('mouseenter', () => onPortHover(p.id));
      g.addEventListener('mouseleave', () => onPortHover(null));
      this.ports[p.id] = g;
      this.portXY[p.id] = [x, y];
    }
    // Once the web fonts are in, names have their final widths: place them again.
    document.fonts?.ready.then(() => this.placeLabels());

    this.shipLayer = el('g', { class: 'ships' }, this.vp);
    this.effectLayer = el('g', { class: 'effects' }, this.vp);
    this.setupZoom(container);
  }

  // ------------------------------------------------------------ zoom

  /** Zoom with the wheel or a pinch, pan by dragging, double-tap to zoom in; ＋ － World buttons. */
  private setupZoom(container: HTMLElement): void {
    const svg = this.svg;
    const toMap = (cx: number, cy: number): [number, number] => {
      const m = svg.getScreenCTM();
      if (!m) return [W / 2, H / 2];
      const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      const r = pt.matrixTransform(m.inverse());
      return [r.x * this.k + this.tx, r.y * this.k + this.ty];
    };
    // Unzoomed map units per screen pixel (the viewBox already includes the zoom).
    const unitsPerPx = () => this.k / (svg.getScreenCTM()?.a || 1);
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const [x, y] = toMap(ev.clientX, ev.clientY);
      this.zoomAt(x, y, Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0018)));
    }, { passive: false });
    // A drag never counts as a tap on a port or a ship.
    svg.addEventListener('click', (ev) => { if (this.suppressClick) { ev.stopPropagation(); ev.preventDefault(); this.suppressClick = false; } }, true);
    svg.addEventListener('gesturestart', (ev) => ev.preventDefault()); // Safari: no page zoom over the map
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch: { d: number; mx: number; my: number } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    svg.addEventListener('pointerdown', (ev) => {
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pts.size === 1) moved = 0;
      if (pts.size === 2) pinch = null;
    });
    window.addEventListener('pointermove', (ev) => {
      const prev = pts.get(ev.pointerId);
      if (!prev) return;
      const now = { x: ev.clientX, y: ev.clientY };
      if (pts.size === 1) {
        moved += Math.hypot(now.x - prev.x, now.y - prev.y);
        if (moved > 6 && this.k > 1) {
          const u = unitsPerPx();
          this.panBy((now.x - prev.x) * u, (now.y - prev.y) * u);
        }
      } else if (pts.size === 2) {
        moved = 99;
        pts.set(ev.pointerId, now);
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinch) {
          const u = unitsPerPx();
          this.panBy((mx - pinch.mx) * u, (my - pinch.my) * u);
          const [x, y] = toMap(mx, my);
          this.zoomAt(x, y, d / pinch.d);
        }
        pinch = { d, mx, my };
        return;
      }
      pts.set(ev.pointerId, now);
    });
    const up = (ev: PointerEvent) => {
      if (!pts.has(ev.pointerId)) return;
      pts.delete(ev.pointerId);
      if (pts.size < 2) pinch = null;
      if (moved > 6) { this.suppressClick = true; setTimeout(() => { this.suppressClick = false; }, 350); }
      else if (ev.pointerType !== 'mouse' && pts.size === 0) {
        // Double-tap on a touch screen: zoom in there.
        if (ev.timeStamp - lastTap.t < 320 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 30) {
          const [x, y] = toMap(ev.clientX, ev.clientY);
          this.zoomAt(x, y, 2);
          lastTap = { t: 0, x: 0, y: 0 };
        } else lastTap = { t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    svg.addEventListener('dblclick', (ev) => {
      const [x, y] = toMap(ev.clientX, ev.clientY);
      this.zoomAt(x, y, 2);
    });
    const tools = document.createElement('div');
    tools.className = 'map-zoom';
    tools.innerHTML = `<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="world" aria-label="Whole world">World</button>`;
    tools.addEventListener('click', (ev) => {
      const z = (ev.target as HTMLElement).closest<HTMLElement>('[data-z]')?.dataset.z;
      // Around the middle of what's on screen.
      if (z === 'in') this.zoomAt(W / 2, H / 2, 2);
      else if (z === 'out') this.zoomAt(W / 2, H / 2, 0.5);
      else if (z === 'world') this.resetZoom();
    });
    container.appendChild(tools);
    this.applyZoom();
  }

  /**
   * Paint the still background onto the canvas, lined up with the SVG on top (same viewBox
   * mapping): the sea with its waves, the graticule, the shallows, the land and the sea lanes.
   * Line widths stay the same on screen at any zoom, as they did when this was SVG.
   */
  private drawBase(): void {
    const cv = this.canvas, svg = this.svg;
    if (!cv || !this.landPath) return;
    const rect = cv.getBoundingClientRect();
    const m = svg.getScreenCTM();
    if (!m || rect.width < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(rect.width * dpr), ph = Math.round(rect.height * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const c = cv.getContext('2d');
    if (!c) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const sail = this.world.era.wind;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, pw, ph);
    // Map units → device pixels, exactly as the browser maps the SVG's viewBox.
    c.setTransform(m.a * dpr, 0, 0, m.d * dpr, (m.e - rect.left) * dpr, (m.f - rect.top) * dpr);
    const px = 1 / m.a; // one screen pixel, in map units
    const s0 = m.a / this.k; // screen pixels per map unit at the whole-world view
    // The sea: a soft radial gradient over the globe.
    const [[sx0, sy0], [sx1, sy1]] = this.sphereBox;
    const sw = sx1 - sx0, sh = sy1 - sy0;
    const g = c.createRadialGradient(sx0 + sw * 0.5, sy0 + sh * 0.45, 0, sx0 + sw * 0.5, sy0 + sh * 0.45, Math.hypot(sw, sh) * 0.75 / Math.SQRT2);
    g.addColorStop(0, v('--ocean-1', '#12304d')); g.addColorStop(1, v('--ocean-2', '#0a1a2c'));
    c.fillStyle = g; c.fill(this.spherePath);
    c.save();
    c.clip(this.spherePath);
    // Wave marks, the same size on screen at any zoom.
    const tile = document.createElement('canvas');
    tile.width = Math.round(46 * s0 * dpr); tile.height = Math.round(22 * s0 * dpr);
    const tc = tile.getContext('2d');
    if (tc && tile.width > 4) {
      tc.scale(s0 * dpr, s0 * dpr);
      tc.strokeStyle = v('--text', '#e3edf7'); tc.globalAlpha = 0.09; tc.lineWidth = 1; tc.lineCap = 'round';
      tc.stroke(new Path2D('M2 8 q5 -4 10 0 t10 0')); tc.stroke(new Path2D('M25 18 q5 -4 10 0 t10 0'));
      const pat = c.createPattern(tile, 'repeat');
      if (pat) {
        pat.setTransform(new DOMMatrix().scale(1 / (m.a * dpr), 1 / (m.d * dpr)));
        c.fillStyle = pat;
        c.fillRect(sx0, sy0, sw, sh);
      }
    }
    c.restore();
    // Graticule.
    c.strokeStyle = v('--text', '#e3edf7'); c.globalAlpha = sail ? 0.12 : 0.05; c.lineWidth = 0.6 * px;
    c.setLineDash(sail ? [1 * px, 2 * px] : []);
    c.stroke(this.graticulePath);
    c.setLineDash([]); c.globalAlpha = 1;
    // Shallows: a soft light halo round every coast.
    c.save();
    c.filter = `blur(${(3.5 * s0 * dpr).toFixed(1)}px)`;
    c.strokeStyle = v('--shallow', '#2a6f97'); c.globalAlpha = 0.55; c.lineWidth = 7 * s0 * px;
    c.stroke(this.landPath);
    c.restore();
    // Land, shaded from top to bottom, with its coastline.
    const [[, ly0], [, ly1]] = this.landBox;
    const lg = c.createLinearGradient(0, ly0, 0, ly1);
    lg.addColorStop(0, v('--land-hi', '#36597a')); lg.addColorStop(1, v('--land', '#2b4a63'));
    c.fillStyle = lg; c.fill(this.landPath);
    c.strokeStyle = v('--land-edge', '#3d6683'); c.lineWidth = (sail ? 0.9 : 0.6) * px; c.lineJoin = 'round';
    c.stroke(this.landPath);
    // Sea lanes (charted ones), canals solid, a closed canal dashed red.
    for (const l of this.laneEls) {
      if (l.uncharted) continue;
      if (l.canal) {
        c.strokeStyle = l.closed ? v('--bad', '#ff6b6b') : v('--accent-2', '#f2b84b');
        c.globalAlpha = l.closed ? 1 : 0.7; c.lineWidth = (l.closed ? 2.2 : 1.6) * px; c.setLineDash(l.closed ? [3 * px, 3 * px] : []);
      } else {
        c.strokeStyle = v('--accent', '#3ec7e0'); c.globalAlpha = sail ? 0.22 : 0.14; c.lineWidth = 0.8 * px; c.setLineDash([2 * px, 3 * px]);
      }
      c.stroke(l.p);
    }
    c.setLineDash([]); c.globalAlpha = 1;
    // The globe's rim.
    c.strokeStyle = v('--line', '#21405f'); c.lineWidth = 1 * px; c.stroke(this.spherePath);
  }

  /** Zoom by `factor` keeping the map point (x, y) (in the map's own units) under the finger. */
  private zoomAt(x: number, y: number, factor: number): void {
    const k = Math.max(1, Math.min(MAX_ZOOM, this.k * factor));
    if (k === this.k) return;
    // (x, y) is in screen units of the unzoomed map; find the map point under it and keep it there.
    const mx = (x - this.tx) / this.k, my = (y - this.ty) / this.k;
    this.tx = x - mx * k;
    this.ty = y - my * k;
    this.k = k;
    this.applyZoom();
  }

  private panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.applyZoom();
  }

  /** Back to the whole world. */
  resetZoom(): void {
    this.k = 1; this.tx = 0; this.ty = 0;
    this.applyZoom();
  }

  private applyZoom(): void {
    const k = this.k;
    this.tx = Math.min(0, Math.max(W * (1 - k), this.tx));
    this.ty = Math.min(0, Math.max(H * (1 - k), this.ty));
    // Zoom by moving the window onto the map (the viewBox), not by scaling the drawing: the browser
    // then knows what's off screen and skips it (a scaled group made it work on the whole enlarged map).
    const vb = `${(-this.tx / k).toFixed(3)} ${(-this.ty / k).toFixed(3)} ${(W / k).toFixed(3)} ${(H / k).toFixed(3)}`;
    this.svg.setAttribute('viewBox', vb);
    this.drawBase();
    this.svg.classList.toggle('zoomed', k > 1.01);

    // Ports, names and ships keep their size on screen: zooming spreads them apart.
    for (const p of this.world.portList) {
      const [x, y] = this.portXY[p.id];
      this.ports[p.id].setAttribute('transform', `translate(${x},${y}) scale(${(1 / k).toFixed(4)})`);
    }
    for (const t of this.fogTexts) t.el.setAttribute('font-size', String(Number(t.el.dataset.size) / k));
    this.svg.style.setProperty('--zoom', String(k));
    this.shipScale = 1 / k;
    for (const g of this.ships.values()) {
      const tr = g.getAttribute('transform') ?? '';
      g.setAttribute('transform', tr.replace(/ scale\([^)]*\)$/, '') + ` scale(${this.shipScale.toFixed(4)})`);
    }
    clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => this.afterZoom(), 180);
  }

  /** When the zoom settles: place the names again, redraw the fog sharp, and use the detailed coastline up close. */
  private afterZoom(): void {
    this.placeLabels();
    this.renderFog();
    if (this.k >= 3 && !this.detailedCoast) {
      this.detailedCoast = true;
      void import('world-atlas/land-50m.json').then((mod) => {
        const topo = (mod.default ?? mod) as unknown as Topology;
        this.landPath = new Path2D(this.path(feature(topo, topo.objects.land)) ?? '');
        this.drawBase();
      });
    }
  }

  private shipScale = 1;


  /**
   * Fog of war: `known` is the set of charted ports and waypoints (null: no fog,
   * everything shows). Uncharted lanes disappear, uncharted ports become rumours.
   */
  setCharted(known: Set<string> | null): void {
    const key = known ? `${known.size}:${[...known].sort().join(',').length}` : '';
    if (key === this.fogKey) return;
    this.fogKey = key;
    this.fogKnownSet = known;
    this.fogLayer.style.display = known ? '' : 'none';
    const lit = (id: string) => !known || known.has(id);
    for (const l of this.laneEls) l.uncharted = !(lit(l.a) && lit(l.b));
    this.drawBase();
    for (const p of this.world.portList) this.ports[p.id].classList.toggle('rumour', !lit(p.id));
    if (!known) return;
    // The known world: the waters the house knew at the start, a soft blob round every charted
    // point, and a broad band along every charted lane (discoveries and bought charts).
    const parts: string[] = [];
    for (const [w, so, e, n] of this.world.era.charts?.known ?? []) {
      const ring: [number, number][] = [];
      for (let lat = so; lat <= n; lat += 2) ring.push([w, lat]);
      for (let lon = w; lon <= e; lon += 2) ring.push([lon, n]);
      for (let lat = n; lat >= so; lat -= 2) ring.push([e, lat]);
      for (let lon = e; lon >= w; lon -= 2) ring.push([lon, so]);
      ring.push(ring[0]);
      parts.push(`<path d="${this.path({ type: 'Polygon', coordinates: [ring] }) ?? ''}" stroke="none"/>`);
    }
    for (const id of known) {
      const pt = this.world.points[id];
      if (!pt) continue;
      parts.push(`<path d="${this.path(geoCircle().center([pt.lon, pt.lat]).radius(5.5).precision(12)()) ?? ''}" stroke="none"/>`);
    }
    for (const l of this.laneEls) {
      if (lit(l.a) && lit(l.b)) parts.push(`<path d="${l.d}" fill="none" stroke-width="34" stroke-linecap="round"/>`);
    }
    // Names on the fog fade once someone has charted water near them.
    for (const t of this.fogTexts) {
      const near = [...known].some((id) => {
        const pt = this.world.points[id];
        return pt && geoDistance([pt.lon, pt.lat], [t.lon, t.lat]) < 0.22;
      });
      t.el.style.display = near ? 'none' : '';
    }
    this.fogParts = parts.join('');
    this.renderFog();
  }

  /** Draw the fog for the part of the map on screen, once, into a bitmap at screen resolution. */
  private renderFog(): void {
    if (!this.fogKnownSet || !this.fogParts) return;
    const k = this.k;
    const x0 = -this.tx / k, y0 = -this.ty / k, w = W / k, h = H / k;
    const css = getComputedStyle(document.documentElement);
    const fog = css.getPropertyValue('--fog').trim() || '#d8d1c0';
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const pxW = Math.max(200, Math.round((this.svg.clientWidth || W) * scale)), pxH = Math.round(pxW * (H / W));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${pxW}" height="${pxH}">
      <defs>
        <filter id="s" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
        <filter id="t" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="3" seed="7"/>
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0.55 0"/>
        </filter>
        <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
          <rect width="${W}" height="${H}" fill="white"/><g fill="black" stroke="black" filter="url(#s)">${this.fogParts}</g>
        </mask>
        <clipPath id="c"><path d="${this.path({ type: 'Sphere' })}"/></clipPath>
      </defs>
      <g mask="url(#m)" clip-path="url(#c)">
        <rect width="${W}" height="${H}" fill="${fog}" opacity="0.88"/>
        <rect width="${W}" height="${H}" filter="url(#t)" opacity="0.5"/>
      </g></svg>`;
    // Rasterise it once to a bitmap: an SVG image with filters gets re-rendered on every frame.
    const img = new Image();
    const stamp = `${this.fogKey}|${k}|${this.tx}|${this.ty}`;
    this.fogStamp = stamp;
    img.onload = () => {
      if (this.fogStamp !== stamp) return;
      const canvas = document.createElement('canvas');
      canvas.width = pxW; canvas.height = pxH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, pxW, pxH);
      this.fogImage.setAttribute('href', canvas.toDataURL('image/png'));
      this.fogImage.setAttribute('x', String(x0)); this.fogImage.setAttribute('y', String(y0));
      this.fogImage.setAttribute('width', String(w)); this.fogImage.setAttribute('height', String(h));
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  private fogStamp = '';

  // ------------------------------------------------------------ scenery

  /**
   * Night side of the world and port lights. `sun` is the point where the sun
   * stands overhead; everything more than 90° from it is in darkness.
   */
  setSun(sun: LonLat): void {
    const anti: LonLat = [((sun[0] + 360) % 360) - 180, -sun[1]];
    const rings = [84, 90, 96];
    if (this.nightLayer.childElementCount !== rings.length) {
      this.nightLayer.replaceChildren(...rings.map(() => el('path', { class: 'night-shade' })));
    }
    rings.forEach((r, i) => {
      const circle = geoCircle().center(anti).radius(r).precision(3)();
      this.nightLayer.children[i].setAttribute('d', this.path(circle) ?? '');
    });
    for (const p of this.world.portList) {
      const dark = geoDistance([p.lon, p.lat], sun) > Math.PI / 2 + 0.05;
      this.ports[p.id].classList.toggle('night', dark);
    }
  }

  /** Kept for callers; the sea's wave marks are part of the still background now. */
  setWaves(_offset: number): void { /* still */ }

  /** Clouds and storm cells. Created, moved and removed to match the list. */
  updateWeather(cells: WeatherCell[]): void {
    const keep = new Set<string>();
    for (const c of cells) {
      keep.add(c.id);
      let g = this.clouds.get(c.id);
      if (!g) {
        g = el('g', { class: `cloud ${c.kind}` }, this.weatherLayer);
        const inner = el('g', { class: 'cloud-inner', filter: 'url(#cloud)' }, g);
        const puffs = c.kind === 'storm' ? 7 : 5;
        for (let i = 0; i < puffs; i++) {
          const a = (i / puffs) * Math.PI * 2 + (c.seed % 1);
          const d = i === 0 ? 0 : 6 + ((c.seed * (i + 3)) % 5);
          el('ellipse', { cx: (Math.cos(a) * d).toFixed(1), cy: (Math.sin(a) * d * 0.6).toFixed(1), rx: 9 + (i % 3) * 3, ry: 6 + (i % 2) * 2 }, inner);
        }
        if (c.kind === 'storm') el('path', { class: 'bolt', d: 'M1 -4 L-3 3 L0 3 L-2 9 L4 0 L1 0 L3 -4 Z' }, g);
        this.clouds.set(c.id, g);
      }
      const xy = this.projection(c.at);
      if (!xy) continue;
      g.setAttribute('transform', `translate(${xy[0].toFixed(1)},${xy[1].toFixed(1)}) scale(${c.scale.toFixed(2)})`);
      g.style.opacity = c.opacity.toFixed(2);
    }
    for (const [id, g] of this.clouds) {
      if (!keep.has(id)) { g.remove(); this.clouds.delete(id); }
    }
  }

  /** A ring that spreads out from a point: payments, purchases. */
  pulseAt(at: LonLat, kind: 'good' | 'info'): void {
    const xy = this.projection(at);
    if (!xy) return;
    const c = el('circle', { cx: xy[0].toFixed(1), cy: xy[1].toFixed(1), r: 6, class: `pulse ${kind}` }, this.effectLayer);
    setTimeout(() => c.remove(), 1600);
  }

  private line(ids: string[]): GeoJSON.LineString {
    return { type: 'LineString', coordinates: ids.map((id) => [this.world.points[id].lon, this.world.points[id].lat]) };
  }

  /** Draw closed canals as blocked. */
  setClosedCanals(closed: string[]): void {
    let changed = false;
    for (const l of this.laneEls) {
      const c = !!l.canal && closed.includes(l.canal);
      if (c !== l.closed) { l.closed = c; changed = true; }
    }
    if (changed) this.drawBase();
  }

  /**
   * Keep port names clear of each other: every name tries eight spots round its
   * dot (the port data's choice first) and takes the one that overlaps least with
   * other names, prices and dots. Crowded ports choose first; three passes.
   */
  placeLabels(): void {
    type Box = [number, number, number, number]; // x0, y0, x1, y1 (map units)
    const ids = this.world.portList.map((p) => p.id);
    // Positions in screen units at the current zoom (names and dots keep their screen size).
    const P = (id: string): [number, number] => [this.portXY[id][0] * this.k, this.portXY[id][1] * this.k];
    const size: Record<string, { lw: number; lh: number; la: number; fw: number; fh: number; fa: number }> = {};
    for (const id of ids) {
      const g = this.ports[id];
      const label = g.querySelector<SVGTextElement>('.label')!, fuel = g.querySelector<SVGTextElement>('.fuel')!;
      let lb: DOMRect, fb: DOMRect;
      try { lb = label.getBBox(); fb = fuel.getBBox(); } catch { return; } // not rendered yet
      if (!lb.width) return;
      // Ascent above the baseline, so a box can be rebuilt for any spot.
      size[id] = { lw: lb.width, lh: lb.height, la: Number(label.getAttribute('y')) - lb.y,
        // Modern prices change width as they move: reserve a little. An empty line takes no room.
        fw: this.world.era.wind ? fb.width : Math.max(fb.width, 24), fh: fb.height || 10, fa: fb.height ? Number(fuel.getAttribute('y')) - fb.y : 8 };
    }
    const boxesFor = (id: string, spot: LabelSpot): Box[] => {
      const [px, py] = P(id);
      const sz = size[id];
      const rect = (w: number, h: number, a: number, base: number): Box => {
        const x0 = spot.anchor === 'start' ? spot.x : spot.anchor === 'end' ? spot.x - w : spot.x - w / 2;
        return [px + x0, py + base - a, px + x0 + w, py + base - a + h];
      };
      return sz.fw ? [rect(sz.lw, sz.lh, sz.la, spot.y), rect(sz.fw, sz.fh, sz.fa, spot.fy)] : [rect(sz.lw, sz.lh, sz.la, spot.y)];
    };
    const overlap = (a: Box, b: Box) =>
      Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    // Other ports' dots, with a margin: a name right beside a foreign dot reads as that port's.
    const dots: Box[] = ids.map((id) => { const [x, y] = P(id); return [x - 13, y - 9, x + 13, y + 9]; });
    const near = (a: string) => ids.filter((b) => b !== a && Math.hypot(P(a)[0] - P(b)[0], P(a)[1] - P(b)[1]) < 90).length;
    const order = [...ids].sort((a, b) => near(b) - near(a) || ids.indexOf(a) - ids.indexOf(b));
    const chosen: Record<string, LabelKey> = {};
    for (const p of this.world.portList) chosen[p.id] = p.label ?? 'right';
    const cost = (id: string, key: LabelKey): number => {
      const mine = boxesFor(id, LABEL_SPOTS[key]);
      let c = key === (this.world.ports[id].label ?? 'right') ? 0 : 4; // a small preference for the data's choice
      for (const other of ids) {
        if (other === id) continue;
        for (const b of boxesFor(other, LABEL_SPOTS[chosen[other]])) for (const m of mine) c += overlap(m, b);
      }
      for (let i = 0; i < ids.length; i++) if (ids[i] !== id) for (const m of mine) c += 2 * overlap(m, dots[i]);
      // A name must sit nearer its own dot than any other, or it reads as the other port's.
      const nb = mine[0];
      const gap = (q: [number, number]) => Math.hypot(Math.max(nb[0] - q[0], 0, q[0] - nb[2]), Math.max(nb[1] - q[1], 0, q[1] - nb[3]));
      const own = gap(P(id));
      for (const other of ids) if (other !== id && gap(P(other)) < own + 4) c += 300;
      // Off the edge of the map counts too.
      // Off the edge of what's on screen counts too.
      const [vx0, vy0] = [-this.tx, -this.ty];
      for (const m of mine) c += Math.max(0, vx0 - m[0]) * 20 + Math.max(0, m[2] - vx0 - W) * 20 + Math.max(0, vy0 - m[1]) * 20 + Math.max(0, m[3] - vy0 - H) * 20;
      return c;
    };
    for (let pass = 0; pass < 3; pass++) {
      for (const id of order) {
        let best = chosen[id], bestCost = cost(id, best);
        if (bestCost < 1) continue;
        for (const key of Object.keys(LABEL_SPOTS) as LabelKey[]) {
          const c = cost(id, key);
          if (c < bestCost - 0.5) { best = key; bestCost = c; }
        }
        chosen[id] = best;
      }
    }
    for (const id of ids) {
      const spot = LABEL_SPOTS[chosen[id]];
      const g = this.ports[id];
      const label = g.querySelector('.label')!, fuel = g.querySelector('.fuel')!;
      label.setAttribute('x', String(spot.x)); label.setAttribute('y', String(spot.y)); label.setAttribute('text-anchor', spot.anchor);
      fuel.setAttribute('x', String(spot.x)); fuel.setAttribute('y', String(spot.fy)); fuel.setAttribute('text-anchor', spot.anchor);
    }
    this.labelsPlaced = true;
  }

  updatePorts(markers: PortMarker[]): void {
    for (const m of markers) {
      const g = this.ports[m.id];
      const rumour = g.classList.contains('rumour');
      g.setAttribute('class', `port ${m.role}${m.strike ? ' strike' : ''}${m.boom ? ' boom' : ''}${rumour ? ' rumour' : ''}`);
      if (rumour) { g.querySelector('.fuel')!.textContent = 'uncharted'; continue; }
      // The 1650 chart is crowded: no victual prices on it, only what's news (they're in the Ship tab).
      g.querySelector('.fuel')!.textContent = this.world.era.wind
        ? [m.strike ? '☠ quarantine' : '', m.boom ? '▲ boom' : ''].filter(Boolean).join(' · ')
        : `⛽ ${currency()}${m.fuelPrice}${m.strike ? ' · ✊ strike' : ''}${m.boom ? ' · ▲ boom' : ''}`;
    }
    // Notes come and go on the 1650 chart: place the names again when they do.
    const notes = markers.map((m) => (this.ports[m.id].querySelector('.fuel')!.textContent ? '1' : '0')).join('');
    if (!this.labelsPlaced || (this.world.era.wind && notes !== this.notesKey)) this.placeLabels();
    this.notesKey = notes;
  }

  /** Draw highlighted routes. `primary` is the selected leg; `secondary` are faint previews. */
  showRoutes(primary: string[] | string[][] | null, secondary: string[][] = []): void {
    this.routeLayer.replaceChildren();
    for (const r of secondary) el('path', { d: this.path(this.line(r))!, class: 'route secondary' }, this.routeLayer);
    const bold = !primary ? [] : typeof primary[0] === 'string' ? [primary as string[]] : (primary as string[][]);
    for (const r of bold) el('path', { d: this.path(this.line(r))!, class: 'route primary-glow' }, this.routeLayer);
    for (const r of bold) el('path', { d: this.path(this.line(r))!, class: 'route primary' }, this.routeLayer);
  }

  /** Where a ship is `t` (0..1) of the way along a route, by distance, and its heading on screen. */
  positionAlong(path: string[], t: number): { at: LonLat; angle: number } {
    const pts = path.map((id) => [this.world.points[id].lon, this.world.points[id].lat] as LonLat);
    if (pts.length < 2) return { at: pts[0], angle: 0 };
    const segs = pts.slice(1).map((b, i) => {
      const a = pts[i];
      const dLon = ((b[0] - a[0] + 540) % 360) - 180;
      const len = Math.hypot(dLon * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), b[1] - a[1]);
      return { interp: geoInterpolate(a, b), len };
    });
    const total = segs.reduce((s, x) => s + x.len, 0) || 1;
    let d = Math.max(0, Math.min(1, t)) * total;
    let seg = segs[segs.length - 1];
    let local = 1;
    for (const x of segs) {
      if (d <= x.len) { seg = x; local = x.len ? d / x.len : 1; break; }
      d -= x.len;
    }
    const here = seg.interp(local);
    const ahead = seg.interp(Math.min(1, local + 0.02));
    const [x0, y0] = this.projection(here)!;
    const [x1, y1] = this.projection(ahead)!;
    const angle = x1 !== x0 || y1 !== y0 ? (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI : 0;
    return { at: here, angle };
  }

  portPosition(portId: string): LonLat {
    const p = this.world.points[portId];
    return [p.lon, p.lat];
  }

  /** Draw the fleet. Markers are created, moved and removed to match `markers`. */
  updateShips(markers: ShipMarker[]): void {
    const keep = new Set<number>();
    for (const m of markers) {
      keep.add(m.id);
      let g = this.ships.get(m.id);
      if (!g || g.dataset.icon !== m.icon.hull) {
        g?.remove();
        g = el('g', { class: 'ship', tabindex: 0, role: 'button' }, this.shipLayer);
        g.dataset.icon = m.icon.hull;
        el('circle', { r: Math.max(12, m.icon.length * 0.7), class: 'ship-hit' }, g);
        el('circle', { r: Math.max(8, m.icon.length * 0.55), class: 'ship-halo' }, g);
        el('path', { d: m.icon.hull, class: 'ship-hull' }, g);
        el('path', { d: m.icon.deck, class: 'ship-deck' }, g);
        el('title', {}, g);
        g.addEventListener('click', (ev) => { ev.stopPropagation(); this.onShipClick(m.id); });
        this.ships.set(m.id, g);
      }
      // Wake: a fading trail behind ships under way.
      let wake = this.wakes.get(m.id);
      if (m.wake && m.wake.length > 1) {
        if (!wake) { wake = el('path', { class: 'wake' }, this.wakeLayer); this.wakes.set(m.id, wake); }
        wake.setAttribute('d', this.path({ type: 'LineString', coordinates: m.wake }) ?? '');
      } else if (wake) {
        wake.remove();
        this.wakes.delete(m.id);
      }
      const [x, y] = this.projection(m.at)!;
      const [dx, dy] = m.offset ?? [0, 0];
      // Offsets fan out ships in one port in screen units, so they shrink with the zoom too.
      g.setAttribute('transform', `translate(${(x + dx * this.shipScale).toFixed(2)},${(y + dy * this.shipScale).toFixed(2)}) rotate(${m.angle.toFixed(0)}) scale(${this.shipScale.toFixed(4)})`);
      g.setAttribute('class', `ship ${m.state} ${m.family}${m.selected ? ' selected' : ''}`);
      g.setAttribute('aria-label', m.name);
      g.querySelector('title')!.textContent = m.name;
    }
    for (const [id, g] of this.ships) {
      if (!keep.has(id)) { g.remove(); this.ships.delete(id); }
    }
    for (const [id, w] of this.wakes) {
      if (!keep.has(id)) { w.remove(); this.wakes.delete(id); }
    }
  }

  /** Brief floating label at a point on the map (events, payments). */
  flashAt(at: LonLat, text: string, kind: 'good' | 'bad' | 'info'): void {
    const [x, y] = this.projection(at)!;
    const t = el('text', { x: 0, y: -16, transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${this.shipScale.toFixed(4)})`, class: `flash ${kind}`, 'text-anchor': 'middle' }, this.effectLayer);
    t.textContent = text;
    setTimeout(() => t.remove(), 2200);
  }
}

export interface ShipMarker {
  id: number;
  name: string;
  at: LonLat;
  angle: number;
  /** Screen offset, to fan out several ships in one port. */
  offset?: [number, number];
  state: 'sea' | 'ready' | 'busy';
  selected: boolean;
  /** Ship family (drives colour) and its top-down icon. */
  family: string;
  icon: { hull: string; deck: string; length: number };
  /** Points behind the ship, for its wake. */
  wake?: LonLat[];
}

export interface WeatherCell {
  id: string;
  kind: 'cloud' | 'storm';
  at: LonLat;
  scale: number;
  opacity: number;
  /** Stable 0..1 number that shapes the puffs. */
  seed: number;
}
