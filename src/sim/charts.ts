// Fog of war for the Age of Sail: the waters a merchant house has charted.
// A sea-lane node (port or waypoint) is charted or not; a lane is charted when
// both its ends are. Ships may sail into uncharted water (a voyage of discovery):
// it is slower and riskier, and every node on the way gets charted. Charts of
// other nations can be bought in some ports. Modern games have no fog
// (g.charted stays undefined).

import { rand } from './rng';
import type { GameState } from './types';
import type { World } from './world';

/** A rough lon/lat box: west, south, east, north. */
export type Box = [number, number, number, number];

export interface ChartOffer {
  id: string;
  /** Where it's sold. */
  port: string;
  name: string;
  /** Who sells it and what it shows. */
  blurb: string;
  price: number;
  boxes: Box[];
}

export const CHART_TUNING = {
  /** Route choice: an uncharted lane counts this much longer (pilots prefer known water). */
  unchartedPenalty: 1.6,
  /** Speed in uncharted water, as a share of normal (sounding the way, feeling for shoals). */
  unchartedSpeed: 0.85,
  /** Storm and accident odds in uncharted water, times normal. */
  unchartedRisk: 1.8,
  /** A newly found port pays this much more for what it imports, for a while. */
  discoveryBoost: 0.45,
  discoveryDays: [150, 240] as [number, number],
};

function inBox(lon: number, lat: number, [w, s, e, n]: Box): boolean {
  return lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e);
}

/** Whether this world has a fog of war at all. */
export function hasFog(world: World): boolean {
  return !!world.era.charts;
}

/** Nodes inside any of the boxes. */
function nodesIn(world: World, boxes: Box[]): string[] {
  return Object.values(world.points).filter((p) => boxes.some((b) => inBox(p.lon, p.lat, b))).map((p) => p.id);
}

/** Give a game in a foggy world its starting charts (no-op if it has them, or the world has no fog). */
export function ensureCharts(g: GameState, world: World): void {
  if (!world.era.charts || g.charted) return;
  g.charted = nodesIn(world, world.era.charts.known);
  // Your home port and wherever your ships are is known, whatever the boxes say.
  for (const id of [world.era.start.port, ...g.fleet.map((s) => s.location)]) if (!g.charted.includes(id)) g.charted.push(id);
  // Boards of an old save can't offer charters to places nobody has charted.
  // (And the empty lots an early build put up.)
  for (const p of Object.values(g.ports)) p.board = p.board.filter((c) => g.charted!.includes(c.dest) && c.tons > 0);
}

/** Is this port or waypoint charted? Everything is, in a world without fog. */
export function isCharted(g: GameState, id: string): boolean {
  return !g.charted || g.charted.includes(id);
}

const fogCache = new WeakMap<string[], { key: string; known: Set<string> }>();
/** What routing needs to prefer charted water (undefined: no fog). */
export function fogFor(g: GameState): { key: string; known: Set<string> } | undefined {
  if (!g.charted) return undefined;
  let f = fogCache.get(g.charted);
  if (!f) {
    const sorted = [...g.charted].sort();
    let h = 0;
    for (const id of sorted) for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    f = { key: `${sorted.length}:${h}`, known: new Set(g.charted) };
    fogCache.set(g.charted, f);
  }
  return f;
}

/** Share of a route's distance (0..1) through uncharted water. */
export function unchartedShare(world: World, g: GameState, path: string[]): number {
  if (!g.charted || path.length < 2) return 0;
  let all = 0, dark = 0;
  for (let i = 1; i < path.length; i++) {
    const nm = world.legNm(path[i - 1], path[i]);
    all += nm;
    if (!isCharted(g, path[i - 1]) || !isCharted(g, path[i])) dark += nm;
  }
  return all > 0 ? dark / all : 0;
}

/**
 * Chart every node on a sailed path. Returns the ports found for the first
 * time (they get a discovery boom: they pay well for what they import).
 */
export function chartPath(world: World, g: GameState, path: string[]): string[] {
  if (!g.charted) return [];
  const found: string[] = [];
  for (const id of path) {
    if (g.charted.includes(id)) continue;
    g.charted = [...g.charted, id];
    if (world.ports[id]) found.push(id);
  }
  for (const id of found) discoveryBoom(world, g, id);
  return found;
}

function discoveryBoom(world: World, g: GameState, portId: string): void {
  const [a, b] = CHART_TUNING.discoveryDays;
  const days = a + Math.floor(rand(g) * (b - a));
  g.events.push({
    id: g.nextId++, kind: 'boom', port: portId, startDay: g.day, endDay: g.day + days, boost: CHART_TUNING.discoveryBoost,
    headline: `First of our ships in ${world.ports[portId].name}: its merchants pay handsomely for anything from home.`,
  });
}

/** Charts on sale in this port that would still show you something new. */
export function chartOffers(world: World, g: GameState, portId: string): ChartOffer[] {
  if (!world.era.charts || !g.charted) return [];
  return world.era.charts.offers.filter((o) => o.port === portId && nodesIn(world, o.boxes).some((id) => !g.charted!.includes(id)));
}

/** Buy a chart: everything in its boxes becomes charted. Returns the ports it reveals. */
export function applyChart(world: World, g: GameState, offer: ChartOffer): string[] {
  const ids = nodesIn(world, offer.boxes).filter((id) => !g.charted!.includes(id));
  g.charted = [...g.charted!, ...ids];
  return ids.filter((id) => world.ports[id]);
}
