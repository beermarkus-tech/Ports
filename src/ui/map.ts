// World map rendering (SVG via d3-geo). Knows nothing about game rules:
// it is handed positions, routes and highlights by the view.

import { geoEqualEarth, geoGraticule10, geoInterpolate, geoPath, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import type { World } from '../sim/world';

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
  private ships = new Map<number, SVGGElement>();
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
      </filter>`;

    el('path', { d: this.path({ type: 'Sphere' })!, fill: 'url(#ocean)', class: 'sphere' }, this.svg);
    el('path', { d: this.path(geoGraticule10())!, class: 'graticule' }, this.svg);
    const topo = landTopo as unknown as Topology;
    const land = feature(topo, topo.objects.land);
    el('path', { d: this.path(land)!, class: 'land' }, this.svg);

    const lanes = el('g', { class: 'lanes' }, this.svg);
    for (const e of world.edges) {
      el('path', { d: this.path(this.line([e.a, e.b]))!, class: e.canal ? 'lane canal' : 'lane', ...(e.canal ? { 'data-canal': e.canal } : {}) }, lanes);
    }

    this.routeLayer = el('g', { class: 'routes' }, this.svg);
    this.portLayer = el('g', { class: 'ports' }, this.svg);

    for (const p of world.portList) {
      const [x, y] = this.projection([p.lon, p.lat])!;
      const g = el('g', { class: 'port', transform: `translate(${x},${y})`, tabindex: 0, role: 'button', 'aria-label': p.name }, this.portLayer);
      el('circle', { r: 14, class: 'hit' }, g);
      el('circle', { r: 9, class: 'halo' }, g);
      el('circle', { r: 4.5, class: 'dot' }, g);
      const labelLeft = p.lon > 140 || p.id === 'shanghai';
      const label = el('text', { x: labelLeft ? -10 : 10, y: -6, class: 'label', 'text-anchor': labelLeft ? 'end' : 'start' }, g);
      label.textContent = p.name;
      const fuel = el('text', { x: labelLeft ? -10 : 10, y: 8, class: 'fuel', 'text-anchor': labelLeft ? 'end' : 'start' }, g);
      fuel.textContent = '';
      g.addEventListener('click', () => onPortClick(p.id));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') onPortClick(p.id); });
      g.addEventListener('mouseenter', () => onPortHover(p.id));
      g.addEventListener('mouseleave', () => onPortHover(null));
      this.ports[p.id] = g;
    }

    this.shipLayer = el('g', { class: 'ships' }, this.svg);
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
      g.querySelector('.fuel')!.textContent = `⛽ $${m.fuelPrice}${m.strike ? ' · ✊ strike' : ''}${m.boom ? ' · ▲ boom' : ''}`;
    }
  }

  /** Draw highlighted routes. `primary` is the selected leg; `secondary` are faint previews. */
  showRoutes(primary: string[] | null, secondary: string[][] = []): void {
    this.routeLayer.replaceChildren();
    for (const r of secondary) el('path', { d: this.path(this.line(r))!, class: 'route secondary' }, this.routeLayer);
    if (primary) {
      el('path', { d: this.path(this.line(primary))!, class: 'route primary-glow' }, this.routeLayer);
      el('path', { d: this.path(this.line(primary))!, class: 'route primary' }, this.routeLayer);
    }
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
      if (!g) {
        g = el('g', { class: 'ship', tabindex: 0, role: 'button' }, this.shipLayer);
        el('circle', { r: 12, class: 'ship-hit' }, g);
        el('circle', { r: 9, class: 'ship-halo' }, g);
        el('path', { d: 'M 7 0 L -5 -4.5 L -3 0 L -5 4.5 Z', class: 'ship-hull' }, g);
        el('title', {}, g);
        g.addEventListener('click', (ev) => { ev.stopPropagation(); this.onShipClick(m.id); });
        this.ships.set(m.id, g);
      }
      const [x, y] = this.projection(m.at)!;
      const [dx, dy] = m.offset ?? [0, 0];
      g.setAttribute('transform', `translate(${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}) rotate(${m.angle.toFixed(0)})`);
      g.setAttribute('class', `ship ${m.state}${m.selected ? ' selected' : ''}`);
      g.setAttribute('aria-label', m.name);
      g.querySelector('title')!.textContent = m.name;
    }
    for (const [id, g] of this.ships) {
      if (!keep.has(id)) { g.remove(); this.ships.delete(id); }
    }
  }

  /** Brief floating label at a point on the map (events, payments). */
  flashAt(at: LonLat, text: string, kind: 'good' | 'bad' | 'info'): void {
    const [x, y] = this.projection(at)!;
    const t = el('text', { x: x.toFixed(1), y: (y - 16).toFixed(1), class: `flash ${kind}`, 'text-anchor': 'middle' }, this.svg);
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
}
