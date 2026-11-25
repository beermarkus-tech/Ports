// Static world: ports, goods, ship types and the sea-lane graph.
// Distances are shortest paths over the graph, so closing a canal later
// is just a matter of excluding its edge.

import goodsData from '../data/goods.json';
import portsData from '../data/ports.json';
import regionsData from '../data/regions.json';
import shipsData from '../data/ships.json';
import lanesData from '../data/sealanes.json';
import sailGoods from '../data/sail/goods.json';
import sailPorts from '../data/sail/ports.json';
import sailRegions from '../data/sail/regions.json';
import sailShips from '../data/sail/ships.json';
import sailLanes from '../data/sail/sealanes.json';
import { ERAS, eraConfig, type EraConfig, type EraId, type House } from './era';
import type { Region } from './regions';
import type { GoodDef, PortDef, ShipTypeDef } from './types';

export interface GeoPoint { id: string; lat: number; lon: number }
interface Edge { a: string; b: string; canal?: string; nm: number }

export interface CanalDef { name: string; fee: number }

export interface Route { path: string[]; nm: number; canals: string[] }

const EARTH_RADIUS_NM = 3440.065;
/** Real routes wiggle around headlands; straight graph legs are a bit short. */
const ROUTE_FACTOR = 1.0;

export function haversineNm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

export class World {
  readonly goods: Record<string, GoodDef> = {};
  readonly ports: Record<string, PortDef> = {};
  readonly portList: PortDef[];
  /** Settlement sites of this world's house (in `ports` by id, but not in `portList`). */
  readonly siteList: PortDef[];
  /** Every house's settlement sites: routes may end at one, but never pass through. */
  private siteIds = new Set<string>();
  readonly shipTypes: Record<string, ShipTypeDef> = {};
  readonly points: Record<string, GeoPoint> = {};
  readonly edges: Edge[] = [];
  readonly canals: Record<string, CanalDef>;
  readonly era: EraConfig;
  readonly regions: Region[];
  private adjacency: Record<string, Edge[]> = {};
  private routeCache = new Map<string, Route | null>();

  constructor(
    goods: GoodDef[] = goodsData as GoodDef[],
    ports: PortDef[] = portsData as PortDef[],
    ships: ShipTypeDef[] = shipsData as ShipTypeDef[],
    lanes: {
      canals: Record<string, CanalDef>;
      nodes: GeoPoint[];
      edges: (string[] | { a: string; b: string; canal?: string })[];
    } = lanesData,
    era: EraConfig = ERAS.modern,
    regions: Region[] = regionsData as Region[],
  ) {
    this.era = era;
    this.regions = regions;
    this.canals = lanes.canals;
    for (const g of goods) this.goods[g.id] = g;
    // A house's settlement sites are known by id (routes, names, ships lying there) but stay out of
    // the port list, so boards, markets and prices pass them by. Other houses' sites are just points.
    const house = era.house?.id ?? 'dutch';
    for (const p of ports) {
      if (!p.site || p.site === house) this.ports[p.id] = p;
      this.points[p.id] = { id: p.id, lat: p.lat, lon: p.lon };
    }
    this.portList = ports.filter((p) => !p.site);
    this.siteList = ports.filter((p) => p.site === house);
    for (const p of ports) if (p.site) this.siteIds.add(p.id);
    for (const s of ships) this.shipTypes[s.id] = s;
    for (const n of lanes.nodes) this.points[n.id] = n;

    for (const raw of lanes.edges) {
      const e = Array.isArray(raw) ? { a: raw[0], b: raw[1] } : raw;
      const pa = this.points[e.a];
      const pb = this.points[e.b];
      if (!pa || !pb) throw new Error(`Sea lane references unknown node: ${e.a} - ${e.b}`);
      const edge: Edge = { ...e, nm: haversineNm(pa, pb) * ROUTE_FACTOR };
      this.edges.push(edge);
      (this.adjacency[e.a] ??= []).push(edge);
      (this.adjacency[e.b] ??= []).push(edge);
    }
  }

  /** Is this point a settlement site (of any house)? */
  isSite(id: string): boolean {
    return this.siteIds.has(id);
  }

  /** Straight-line length of a leg between two nodes, nautical miles. */
  legNm(a: string, b: string): number {
    return haversineNm(this.points[a], this.points[b]) * ROUTE_FACTOR;
  }

  /**
   * Shortest sea route between two ports (Dijkstra). Null if unreachable. With
   * `fog`, lanes not wholly in known water count `penalty` times longer, so the
   * route keeps to charted water where it reasonably can (nm is the real length).
   */
  route(from: string, to: string, closedCanals: string[] = [], fog?: { key: string; known: Set<string> }, penalty = 1.6): Route | null {
    const suffix = `>${closedCanals.slice().sort().join(',')}${fog ? `>${fog.key}` : ''}`;
    const key = `${from}>${to}${suffix}`;
    const hit = this.routeCache.get(key);
    if (hit !== undefined) return hit;

    // One search from `from` answers every destination: run it to the end and cache
    // the routes to all ports at once (the same paths an early-stopping search finds).
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, { node: string; edge: Edge }>();
    const done = new Set<string>();
    for (;;) {
      let current: string | null = null;
      let best = Infinity;
      for (const [node, d] of dist) {
        if (d < best && !done.has(node)) { current = node; best = d; }
      }
      if (current === null) break;
      done.add(current);
      if (current !== from && this.siteIds.has(current)) continue;
      for (const edge of this.adjacency[current] ?? []) {
        if (edge.canal && closedCanals.includes(edge.canal)) continue;
        const next = edge.a === current ? edge.b : edge.a;
        const dark = fog && (!fog.known.has(edge.a) || !fog.known.has(edge.b));
        const nd = best + (dark ? edge.nm * penalty : edge.nm);
        const old = dist.get(next);
        if (old === undefined || nd < old) {
          dist.set(next, nd);
          prev.set(next, { node: current, edge });
        }
      }
    }

    const build = (target: string): Route | null => {
      if (!dist.has(target)) return null;
      const path = [target];
      const canals: string[] = [];
      let n = target;
      let nm = 0;
      while (n !== from) {
        const p = prev.get(n)!;
        if (p.edge.canal) canals.unshift(p.edge.canal);
        nm += p.edge.nm;
        n = p.node;
        path.unshift(n);
      }
      return { path, nm: Math.round(nm), canals };
    };
    for (const p of this.portList) {
      const k = `${from}>${p.id}${suffix}`;
      if (!this.routeCache.has(k)) this.routeCache.set(k, build(p.id));
    }
    if (!this.routeCache.has(key)) this.routeCache.set(key, build(to));
    return this.routeCache.get(key)!;
  }

  distance(from: string, to: string): number {
    return this.route(from, to)?.nm ?? Infinity;
  }
}

const worlds: Record<string, World> = {};

/**
 * The world of an era (built once), and in the Age of Sail of a merchant house: the same seas
 * and ports for every house, but its own shipyards and names for some ports.
 */
export function worldFor(era: EraId, house?: House): World {
  const key = era === 'sail' ? `sail:${house ?? 'dutch'}` : era;
  if (worlds[key]) return worlds[key];
  if (era !== 'sail') return (worlds[key] = new World());
  const cfg = eraConfig('sail', house);
  const h = cfg.house;
  const ports = (sailPorts as PortDef[]).map((p) => ({
    ...p,
    name: h?.portNames?.[p.id] ?? p.name,
    shipyard: h?.shipyards ? h.shipyards.includes(p.id) : p.shipyard,
  }));
  return (worlds[key] = new World(sailGoods as GoodDef[], ports, sailShips as ShipTypeDef[], sailLanes as never, cfg, sailRegions as Region[]));
}

let current: EraId = 'modern';
let currentH: House | undefined;

/** Make an era's (and house's) world the current one (the game being played decides it). */
export function setEra(era: EraId, house?: House): void {
  current = era;
  currentH = era === 'sail' ? house ?? 'dutch' : undefined;
}

export function currentEra(): EraId {
  return current;
}

/** The merchant house of the game being played (Age of Sail only). */
export function currentHouse(): House | undefined {
  return currentH;
}

/** The current world: the one of the game being played. */
export function getWorld(): World {
  return worldFor(current, currentH);
}
