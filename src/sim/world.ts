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
import { ERAS, type EraConfig, type EraId } from './era';
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
    for (const p of ports) {
      this.ports[p.id] = p;
      this.points[p.id] = { id: p.id, lat: p.lat, lon: p.lon };
    }
    this.portList = ports;
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

  /** Shortest sea route between two ports (Dijkstra). Null if unreachable. */
  route(from: string, to: string, closedCanals: string[] = []): Route | null {
    const key = `${from}>${to}>${closedCanals.slice().sort().join(',')}`;
    if (this.routeCache.has(key)) return this.routeCache.get(key)!;

    const dist: Record<string, number> = { [from]: 0 };
    const prev: Record<string, { node: string; edge: Edge }> = {};
    const done = new Set<string>();

    for (;;) {
      let current: string | null = null;
      for (const [node, d] of Object.entries(dist)) {
        if (!done.has(node) && (current === null || d < dist[current])) current = node;
      }
      if (current === null || current === to) break;
      done.add(current);
      for (const edge of this.adjacency[current] ?? []) {
        if (edge.canal && closedCanals.includes(edge.canal)) continue;
        const next = edge.a === current ? edge.b : edge.a;
        const nd = dist[current] + edge.nm;
        if (dist[next] === undefined || nd < dist[next]) {
          dist[next] = nd;
          prev[next] = { node: current, edge };
        }
      }
    }

    let result: Route | null = null;
    if (dist[to] !== undefined) {
      const path = [to];
      const canals: string[] = [];
      let n = to;
      while (n !== from) {
        const p = prev[n];
        if (p.edge.canal) canals.unshift(p.edge.canal);
        n = p.node;
        path.unshift(n);
      }
      result = { path, nm: Math.round(dist[to]), canals };
    }
    this.routeCache.set(key, result);
    return result;
  }

  distance(from: string, to: string): number {
    return this.route(from, to)?.nm ?? Infinity;
  }
}

const worlds: Partial<Record<EraId, World>> = {};

/** The world of an era (built once). */
export function worldFor(era: EraId): World {
  return (worlds[era] ??= era === 'sail'
    ? new World(sailGoods as GoodDef[], sailPorts as PortDef[], sailShips as ShipTypeDef[], sailLanes as never, ERAS.sail, sailRegions as Region[])
    : new World());
}

let current: EraId = 'modern';

/** Make an era's world the current one (the game being played decides it). */
export function setEra(era: EraId): void {
  current = era;
}

export function currentEra(): EraId {
  return current;
}

/** The current world: the one of the game being played. */
export function getWorld(): World {
  return worldFor(current);
}
