// Trading on your own account (Age of Sail): buy goods where they're produced,
// carry them in your own hold, and sell them where they're wanted. Prices wander
// day by day, your buying and selling moves them, and news travels by ship: away
// from a port you only know its prices as of the last letter from it.

import { activeEvents, ECONOMY, priceLevel, recordDelivery, routeFor } from './economy';
import { isCharted } from './charts';
import { randNormal } from './rng';
import type { GameState, PortState, ShipState } from './types';
import type { World } from './world';

export const TRADE_TUNING = {
  /** A good's base price, ƒ per ton, as a multiple of its freight rate. */
  baseValue: 8,
  /** Producers sell at this share of the base price. */
  producerShare: 0.9,
  /** Buyers pay this much more per 1000 nm to the nearest producer (the cost of bringing it). */
  perThousandNm: 0.6,
  /** Daily price wander: pull back towards normal, and random noise. */
  revert: 0.02,
  noise: 0.03,
  driftMin: 0.55,
  driftMax: 1.7,
  /** Buying this many lots' worth (good's lot size) at once pushes the price up 100%. */
  buyImpactLots: 20,
  /** Selling on your own account moves a market this many times less than a freight delivery of the same tons. */
  saleSoftening: 5,
  /** News: letters travel with other people's ships at this speed (knots). */
  letterKn: 4,
  /** Price news: a sample every day for this many days, and before that one a week, this many. */
  dailyDays: 30,
  sampleEvery: 7,
  samples: 60,
};

/** Whether this world trades on own account at all. */
export function hasTrade(world: World): boolean {
  return !!world.era.trade;
}

const nearestCache = new WeakMap<World, Map<string, number>>();
/** Sailing distance from a port to the nearest port producing a good. */
function nearestProducerNm(world: World, portId: string, good: string): number {
  let cache = nearestCache.get(world);
  if (!cache) { cache = new Map(); nearestCache.set(world, cache); }
  const key = `${world.epoch}>${portId}>${good}`;
  let nm = cache.get(key);
  if (nm === undefined) {
    nm = Math.min(...world.portList.filter((p) => p.produces.some((x) => x.good === good)).map((p) => world.distance(portId, p.id)));
    cache.set(key, nm);
  }
  return nm;
}

const base = (world: World, good: string) => world.goods[good].freightRate * TRADE_TUNING.baseValue;
const drift = (ps: PortState, good: string) => ps.drift?.[good] ?? 1;
const harvest = (g: GameState, good: string) =>
  activeEvents(g).some((e) => e.kind === 'harvest' && e.good === good) ? 1 + ECONOMY.harvestBoost : 1;

/** What a port sells a good for (ƒ/t), or null if it doesn't produce it. */
export function buyPrice(world: World, g: GameState, portId: string, good: string): number | null {
  if (!world.ports[portId].produces.some((x) => x.good === good)) return null;
  return Math.round(base(world, good) * TRADE_TUNING.producerShare * drift(g.ports[portId], good) * harvest(g, good));
}

/** What a port pays for a good (ƒ/t), or null if nobody there wants it. */
export function sellPrice(world: World, g: GameState, portId: string, good: string): number | null {
  const d = world.ports[portId].demands.find((x) => x.good === good);
  if (!d) return null;
  const far = 1 + TRADE_TUNING.perThousandNm * nearestProducerNm(world, portId, good) / 1000;
  return Math.round(base(world, good) * far * (0.85 + 0.15 * d.strength) * drift(g.ports[portId], good) * priceLevel(g, portId, good));
}

/** Goods a port deals in (it produces or wants them). */
function traded(world: World, portId: string): string[] {
  const p = world.ports[portId];
  return [...new Set([...p.produces.map((x) => x.good), ...p.demands.map((x) => x.good)])];
}

function sample(world: World, g: GameState, portId: string, day = g.day): void {
  const ps = g.ports[portId];
  const p: Record<string, number> = {};
  for (const good of traded(world, portId)) p[good] = (buyPrice(world, g, portId, good) ?? sellPrice(world, g, portId, good))!;
  (ps.hist ??= []).push({ day, p });
  // Daily samples for the last month, weekly ones before that.
  const T = TRADE_TUNING;
  ps.hist = ps.hist.filter((h, i) => i === 0 || h.day >= day - T.dailyDays || h.day % T.sampleEvery === 0);
  const weekly = ps.hist.filter((h) => h.day < day - T.dailyDays).length;
  if (weekly > T.samples) ps.hist.splice(0, weekly - T.samples);
}

/** A new game (or an old save): every port's first price sample, the news you start with. */
export function ensureTrade(world: World, g: GameState): void {
  if (!hasTrade(world)) return;
  for (const p of world.portList) {
    if (!g.ports[p.id]?.hist?.length) { sample(world, g, p.id); continue; }
    // Goods a port took up dealing in after this game began: its letters always quoted them.
    for (const good of traded(world, p.id)) {
      const hist = g.ports[p.id].hist!;
      if (hist.every((h) => h.p[good] !== undefined)) continue;
      const price = (buyPrice(world, g, p.id, good) ?? sellPrice(world, g, p.id, good))!;
      for (const h of hist) h.p[good] ??= price;
    }
  }
}

/** A day passes: prices wander, and every week the news gets a sample. */
export function tradeDay(world: World, g: GameState, day = g.day): void {
  if (!hasTrade(world)) return;
  const T = TRADE_TUNING;
  for (const port of world.portList) {
    const ps = g.ports[port.id];
    ps.drift ??= {};
    for (const good of traded(world, port.id)) {
      const now = ps.drift[good] ?? 1;
      const next = now + (1 - now) * T.revert + randNormal(g) * T.noise * now;
      ps.drift[good] = Math.round(Math.max(T.driftMin, Math.min(T.driftMax, next)) * 1000) / 1000;
    }
  }
  for (const p of world.portList) sample(world, g, p.id, day);
}

/** Tons of own-account goods aboard. */
export function goodsTons(ship: ShipState): number {
  return (ship.goods ?? []).reduce((s, x) => s + x.tons, 0);
}

/** Buying moves the seller's price up. */
export function recordPurchase(world: World, g: GameState, portId: string, good: string, tons: number): void {
  const ps = g.ports[portId];
  const lots = tons / (world.goods[good].lotMax * TRADE_TUNING.buyImpactLots);
  (ps.drift ??= {})[good] = Math.round(Math.min(TRADE_TUNING.driftMax, drift(ps, good) * (1 + lots)) * 1000) / 1000;
}

/**
 * What buying `tons` here would cost: the price climbs as you buy, so you pay
 * the average of the price before and after.
 */
export function goodsBuyQuote(world: World, g: GameState, portId: string, good: string, tons: number): { price: number; total: number } | null {
  const p = buyPrice(world, g, portId, good);
  if (p === null) return null;
  const rise = tons / (world.goods[good].lotMax * TRADE_TUNING.buyImpactLots);
  return { price: p, total: Math.round(tons * p * (1 + rise / 2)) };
}

/**
 * The share of the first ton's price that selling `tons` fetches on average, with the market at
 * `level`: the price falls steadily as you sell, down to the floor, and stays there.
 */
export function saleFactor(world: World, good: string, tons: number, level = 1): number {
  if (tons <= 0 || level <= 0) return 1;
  const def = world.goods[good];
  const slope = ECONOMY.deliveryImpact / ((def.bigLotMax ?? def.lotMax * 2) * TRADE_TUNING.saleSoftening);
  const floor = Math.min(level, ECONOMY.minPrice);
  const toFloor = (level - floor) / slope;            // tons until the price reaches the floor
  const t1 = Math.min(tons, toFloor);
  const area = t1 * level - (slope * t1 * t1) / 2 + Math.max(0, tons - t1) * floor;
  return area / (tons * level);
}

/** What selling `tons` here would fetch: the price falls as you sell. */
export function goodsSaleQuote(world: World, g: GameState, portId: string, good: string, tons: number): { price: number; total: number } | null {
  const p = sellPrice(world, g, portId, good);
  if (p === null) return null;
  return { price: p, total: Math.round(tons * p * saleFactor(world, good, tons, priceLevel(g, portId, good))) };
}

/** Selling saturates the buyer's market, as a delivery does (more gently: see saleSoftening). */
export function recordSale(world: World, g: GameState, portId: string, good: string, tons: number): void {
  recordDelivery(world, g, portId, good, tons / TRADE_TUNING.saleSoftening);
}

export interface PriceNews {
  price: number;
  /** The day the price was true. */
  asOf: number;
  /** True when one of your ships is there: today's price. */
  live: boolean;
}

/**
 * What you know of a port's price for a good: live where one of your ships lies,
 * otherwise as of the last letter to reach you (from wherever your ships are, or
 * from home). Null for uncharted ports or goods the port doesn't deal in.
 */
export function priceNews(world: World, g: GameState, portId: string, good: string): PriceNews | null {
  if (!isCharted(g, portId)) return null;
  const here = g.fleet.some((s) => !s.voyage && s.location === portId);
  if (here) {
    const price = buyPrice(world, g, portId, good) ?? sellPrice(world, g, portId, good);
    return price === null ? null : { price, asOf: g.day, live: true };
  }
  const sources = new Set([world.era.start.port, ...g.fleet.filter((s) => !s.voyage).map((s) => s.location)]);
  const lag = Math.min(...[...sources].map((src) => (routeFor(world, g, src, portId)?.nm ?? Infinity) / (TRADE_TUNING.letterKn * 24)));
  const hist = g.ports[portId].hist ?? [];
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].day <= g.day - lag && hist[i].p[good] !== undefined) return { price: hist[i].p[good], asOf: hist[i].day, live: false };
  }
  const first = hist[0];
  return first?.p[good] !== undefined ? { price: first.p[good], asOf: first.day, live: false } : null;
}

/** Where a good sells best, by what you know (highest first). */
export function bestKnownMarkets(world: World, g: GameState, good: string, except?: string): ({ port: string } & PriceNews)[] {
  return world.portList
    .filter((p) => p.id !== except && p.demands.some((d) => d.good === good))
    .map((p) => ({ port: p.id, n: priceNews(world, g, p.id, good) }))
    .filter((x): x is { port: string; n: PriceNews } => x.n !== null)
    .map((x) => ({ port: x.port, ...x.n }))
    .sort((a, b) => b.price - a.price);
}
