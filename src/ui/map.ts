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
  role: 'here' | 'dest' | 'cargo' | 'normal';
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
  private wavePattern: SVGPatternElement;
  private ships = new Map<number, SVGGElement>();
  private wakes = new Map<number, SVGPathElement>();
  private clouds = new Map<string, SVGGElement>();
  private ports: Record<string, SVGGElement> = {};

  constructor(
    container: HTMLElement,
    private world: World,
    onPortClick: (id: string) => void,
    onPortHover: (id: string | null) => void,
    private onShipClick: (id: number) => void = () => {},
  ) {
    this.svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'map', role: 'img', 'aria-label': 'World map' });
    container.appendChild(this.svg);

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
      <linearGradient id="land-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--land-hi)"/><stop offset="100%" stop-color="var(--land)"/>
      </linearGradient>
      <clipPath id="sphere-clip"><path d="${this.path({ type: 'Sphere' })}"/></clipPath>
      <pattern id="waves" width="46" height="22" patternUnits="userSpaceOnUse">
        <path d="M2 8 q5 -4 10 0 t10 0" class="wave"/><path d="M25 18 q5 -4 10 0 t10 0" class="wave"/>
      </pattern>`;
    this.wavePattern = defs.querySelector('#waves')!;

    el('path', { d: this.path({ type: 'Sphere' })!, fill: 'url(#ocean)', class: 'sphere' }, this.svg);
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#waves)', class: 'waves', 'clip-path': 'url(#sphere-clip)' }, this.svg);
    el('path', { d: this.path(geoGraticule10())!, class: 'graticule' }, this.svg);
    const topo = landTopo as unknown as Topology;
    const land = feature(topo, topo.objects.land);
    const landD = this.path(land)!;
    // Shallow water: a soft light halo around every coast.
    el('path', { d: landD, class: 'shallow', filter: 'url(#shallow)' }, this.svg);
    el('path', { d: landD, class: 'land', fill: 'url(#land-shade)' }, this.svg);

    const lanes = el('g', { class: 'lanes' }, this.svg);
    for (const e of world.edges) {
      el('path', { d: this.path(this.line([e.a, e.b]))!, class: e.canal ? 'lane canal' : 'lane', ...(e.canal ? { 'data-canal': e.canal } : {}) }, lanes);
    }

    this.nightLayer = el('g', { class: 'night', 'clip-path': 'url(#sphere-clip)' }, this.svg);
    this.weatherLayer = el('g', { class: 'weather', 'clip-path': 'url(#sphere-clip)' }, this.svg);
    this.routeLayer = el('g', { class: 'routes' }, this.svg);
    this.wakeLayer = el('g', { class: 'wakes' }, this.svg);
    this.portLayer = el('g', { class: 'ports' }, this.svg);

    for (const p of world.portList) {
      const [x, y] = this.projection([p.lon, p.lat])!;
      const g = el('g', { class: 'port', transform: `translate(${x},${y})`, tabindex: 0, role: 'button', 'aria-label': p.name }, this.portLayer);
      el('circle', { r: 14, class: 'hit' }, g);
      el('circle', { r: 9, class: 'halo' }, g);
      el('circle', { r: 7, class: 'lights' }, g);
      el('circle', { r: 4.5, class: 'dot' }, g);
      el('circle', { r: 1.8, class: 'dot-core' }, g);
      // Label placement comes from the port data, so crowded regions can be tuned there.
      const place = {
        right: { x: 10, y: -6, fy: 8, anchor: 'start' },
        left: { x: -10, y: -6, fy: 8, anchor: 'end' },
        above: { x: 0, y: -21, fy: -9, anchor: 'middle' },
        below: { x: 0, y: 18, fy: 29, anchor: 'middle' },
      }[p.label ?? 'right'];
      const label = el('text', { x: place.x, y: place.y, class: 'label', 'text-anchor': place.anchor }, g);
      label.textContent = p.name;
      const fuel = el('text', { x: place.x, y: place.fy, class: 'fuel', 'text-anchor': place.anchor }, g);
      fuel.textContent = '';
      g.addEventListener('click', () => onPortClick(p.id));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') onPortClick(p.id); });
      g.addEventListener('mouseenter', () => onPortHover(p.id));
      g.addEventListener('mouseleave', () => onPortHover(null));
      this.ports[p.id] = g;
    }

    this.shipLayer = el('g', { class: 'ships' }, this.svg);
    this.effectLayer = el('g', { class: 'effects' }, this.svg);
  }

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

  /** Slide the wave texture (call with a slowly growing number). */
  setWaves(offset: number): void {
    this.wavePattern.setAttribute('patternTransform', `translate(${(offset * 9) % 46} ${(offset * 2) % 22})`);
  }

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
    this.svg.querySelectorAll<SVGPathElement>('.lane.canal').forEach((p) => {
      p.classList.toggle('closed', closed.includes(p.dataset.canal ?? ''));
    });
  }

  updatePorts(markers: PortMarker[]): void {
    for (const m of markers) {
      const g = this.ports[m.id];
      g.setAttribute('class', `port ${m.role}${m.strike ? ' strike' : ''}${m.boom ? ' boom' : ''}`);
      g.querySelector('.fuel')!.textContent = `${this.world.era.wind ? '' : '⛽ '}${currency()}${m.fuelPrice}${m.strike ? (this.world.era.wind ? ' · ☠ quarantine' : ' · ✊ strike') : ''}${m.boom ? ' · ▲ boom' : ''}`;
    }
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
      g.setAttribute('transform', `translate(${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}) rotate(${m.angle.toFixed(0)})`);
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
    const t = el('text', { x: x.toFixed(1), y: (y - 16).toFixed(1), class: `flash ${kind}`, 'text-anchor': 'middle' }, this.effectLayer);
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
