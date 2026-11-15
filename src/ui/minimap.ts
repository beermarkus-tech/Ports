// A small inset map for the port view: the ship's port, and the route to the
// destination being looked at, zoomed to fit. Tapping it opens the world map.

import { geoCircle, geoEqualEarth, geoInterpolate, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import type { World } from '../sim/world';

const W = 320;
const H = 200;
const NS = 'http://www.w3.org/2000/svg';

const topo = landTopo as unknown as Topology;
const LAND = feature(topo, topo.objects.land);

export interface MiniRoutes {
  here: string;
  /** The selected destination's route, or a whole route being planned (node ids), drawn bold. */
  primary: string[][];
  /** Ports to label (a route's stops); otherwise the ends of the routes shown. */
  stops?: string[];
  /** Previews (hovered contract or port), drawn faint. */
  secondary: string[][];
}

export class MiniMap {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private key = '';

  constructor(container: HTMLElement, private world: World, onClick: () => void) {
    this.el = document.createElement('button');
    this.el.className = 'ps-mini';
    this.el.title = 'Open the world map';
    this.el.setAttribute('aria-label', 'Route map: open the world map');
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    this.el.appendChild(this.svg);
    this.el.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
    container.appendChild(this.el);
  }

  show(r: MiniRoutes): void {
    const key = JSON.stringify(r);
    if (key === this.key) return;
    this.key = key;
    const pt = (id: string): [number, number] => [this.world.points[id].lon, this.world.points[id].lat];
    const here = pt(r.here);
    const lines = [...r.primary, ...r.secondary].filter((x) => x.length > 1);

    // Centre on the middle of what's shown, so routes across the date line don't split.
    const all = lines.flat().map(pt);
    const ends = [...new Set([...(r.stops ?? []), ...lines.map((l) => l[l.length - 1])])].filter((id) => id !== r.here).map(pt);
    const centre = ends.length ? geoInterpolate(here, ends[0])(0.5) : here;
    const fit: GeoJSON.Feature[] = [
      { type: 'Feature', properties: {}, geometry: geoCircle().center(here).radius(ends.length ? 5 : 22)() },
      ...ends.map((e): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: geoCircle().center(e).radius(5)() })),
      ...(all.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: all } } as GeoJSON.Feature] : []),
    ];
    const projection = geoEqualEarth().rotate([-centre[0], 0]).fitExtent([[14, 14], [W - 14, H - 14]], { type: 'FeatureCollection', features: fit });
    const path = geoPath(projection);
    const line = (ids: string[]) => path({ type: 'LineString', coordinates: ids.map(pt) }) ?? '';

    const parts: string[] = [
      `<rect class="mm-sea" x="0" y="0" width="${W}" height="${H}"/>`,
      `<path class="mm-land" d="${path(LAND) ?? ''}"/>`,
    ];
    for (const s of r.secondary) parts.push(`<path class="mm-route secondary" d="${line(s)}"/>`);
    for (const p of r.primary) parts.push(`<path class="mm-route primary" d="${line(p)}"/>`);
    const dot = (id: string, cls: string, label: boolean) => {
      const p = projection(pt(id));
      if (!p) return;
      parts.push(`<circle class="mm-port ${cls}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${cls === 'small' ? 1.8 : 4}"/>`);
      if (label) {
        const name = this.world.ports[id].name;
        const right = p[0] < W - 90;
        parts.push(`<text class="mm-label" x="${(p[0] + (right ? 7 : -7)).toFixed(1)}" y="${(p[1] + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${name}</text>`);
      }
    };
    for (const p of this.world.portList) if (p.id !== r.here) dot(p.id, 'small', false);
    const destIds = new Set([...(r.stops ?? []), ...lines.map((l) => l[l.length - 1])].filter((id) => id !== r.here));
    for (const id of destIds) dot(id, 'dest', true);
    dot(r.here, 'here', true);
    if (!lines.length) parts.push(`<text class="mm-hint" x="${W / 2}" y="${H - 10}" text-anchor="middle">Pick a destination to see its route</text>`);
    this.svg.innerHTML = parts.join('');
  }
}
