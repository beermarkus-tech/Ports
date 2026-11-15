// Phase 3: the dynamic economy. Port prices react to deliveries and events,
// the world oil price moves in trends, and world events come and go.
// Everything is driven by the game's seeded RNG, once per game day.

import { pickWeighted, rand, randInt, randNormal, randRange } from './rng';
import type { GameState, WorldEvent, WorldEventKind } from './types';
import type { Route, World } from './world';

export const ECONOMY = {
  /** A delivery of `ref` tons cuts the price by this much (ref = the good's big-lot size). */
  deliveryImpact: 0.8,
  minPrice: 0.4,
  maxPrice: 1.8,
  /** Share of the gap to the target price closed each day (2% ≈ half-way in 5 weeks). */
  priceRecovery: 0.01,
  oil: { recovery: 0.01, volatility: 0.009, min: 0.55, max: 1.8, historyWeeks: 52 },
  /** Average days between world events, and the most that run at once. */
  eventEveryDays: 40,
  maxActiveEvents: 3,
  /** Keep ended events this long for the news list. */
  newsDays: 60,
  strike: { extraDays: 3, feeMultiplier: 2 },
  harvestBoost: 0.45,
  boomBoost: 0.3,
};

const HARVEST_GOODS = ['grain', 'coffee', 'cocoa', 'fruit'];

function newsLog(g: GameState, text: string): void {
  g.log.unshift({ day: g.day, text: `📰 ${text}` });
  if (g.log.length > 200) g.log.length = 200;
}

// ---------------------------------------------------------------- queries

export function activeEvents(g: GameState): WorldEvent[] {
  return g.events.filter((e) => e.startDay <= g.day && g.day < e.endDay);
}

export function closedCanals(g: GameState): string[] {
  return activeEvents(g).filter((e) => e.kind === 'canal').map((e) => e.canal!);
}

/** Shortest sea route right now, avoiding closed canals. */
export function routeFor(world: World, g: GameState, from: string, to: string): Route | null {
  return world.route(from, to, closedCanals(g));
}

export function strikeAt(g: GameState, portId: string): WorldEvent | undefined {
  return activeEvents(g).find((e) => e.kind === 'strike' && e.port === portId);
}

/** Current price level a port pays for a good (1 = normal). */
export function priceLevel(g: GameState, portId: string, good: string): number {
  return g.ports[portId].prices?.[good] ?? 1;
}

/** Where prices settle while today's events last. */
function targetPrice(g: GameState, portId: string, good: string): number {
  let t = 1;
  for (const e of activeEvents(g)) {
    if (e.kind === 'harvest' && e.good === good) t += ECONOMY.harvestBoost;
    if (e.kind === 'boom' && e.port === portId) t += ECONOMY.boomBoost;
  }
  return t;
}

// ---------------------------------------------------------------- reactions

/** A delivery saturates the buyer's market. Returns the relative price drop (0.15 = −15%). */
export function recordDelivery(world: World, g: GameState, portId: string, good: string, tons: number): number {
  const def = world.goods[good];
  const ref = def.bigLotMax ?? def.lotMax * 2;
  const before = priceLevel(g, portId, good);
  const after = Math.max(ECONOMY.minPrice, before - ECONOMY.deliveryImpact * (tons / ref));
  (g.ports[portId].prices ??= {})[good] = Math.round(after * 1000) / 1000;
  return before > 0 ? (before - after) / before : 0;
}

// ---------------------------------------------------------------- daily tick

function stepPrices(world: World, g: GameState): void {
  for (const port of world.portList) {
    const prices = (g.ports[port.id].prices ??= {});
    for (const d of port.demands) {
      const now = prices[d.good] ?? 1;
      const next = now + (targetPrice(g, port.id, d.good) - now) * ECONOMY.priceRecovery;
      if (Math.abs(next - 1) < 0.005) delete prices[d.good];
      else prices[d.good] = Math.round(next * 1000) / 1000;
    }
  }
}

function stepOil(g: GameState, dayNumber: number): void {
  const O = ECONOMY.oil;
  const shift = activeEvents(g).reduce((s, e) => s + (e.oilShift ?? 0), 0);
  const target = 1 + shift;
  const o = g.oil;
  o.index += (target - o.index) * O.recovery + randNormal(g) * O.volatility * o.index;
  o.index = Math.max(O.min, Math.min(O.max, Math.round(o.index * 10000) / 10000));
  if (dayNumber % 7 === 0) {
    o.history.push(Math.round(o.index * 1000) / 1000);
    if (o.history.length > O.historyWeeks) o.history.shift();
  }
}

function startEvent(world: World, g: GameState): void {
  const active = activeEvents(g);
  if (active.length >= ECONOMY.maxActiveEvents) return;
  const taken = (pred: (e: WorldEvent) => boolean) => active.some(pred);
  const kinds: { kind: WorldEventKind; weight: number }[] = [
    { kind: 'strike', weight: 3 }, { kind: 'harvest', weight: 2 }, { kind: 'boom', weight: 2 },
    { kind: 'canal', weight: 1 }, { kind: 'oilShock', weight: 1.5 },
  ];
  const { kind } = pickWeighted(g, kinds, (k) => k.weight);
  const day = Math.floor(g.day);
  const base = { id: g.nextId++, kind, startDay: day };
  let e: WorldEvent | null = null;

  if (kind === 'strike') {
    const port = world.portList[randInt(g, 0, world.portList.length - 1)];
    if (taken((x) => x.port === port.id)) return;
    e = { ...base, port: port.id, endDay: day + randInt(g, 15, 40), headline: `Dock strike in ${port.name}: calls there take ${ECONOMY.strike.extraDays} extra days and fees are doubled.` };
  } else if (kind === 'harvest') {
    const good = HARVEST_GOODS[randInt(g, 0, HARVEST_GOODS.length - 1)];
    if (taken((x) => x.good === good)) return;
    const name = world.goods[good].name.toLowerCase();
    e = { ...base, good, endDay: day + randInt(g, 40, 90), headline: `Harvest failure: ${name} is scarce and buyers everywhere pay much more for it.` };
  } else if (kind === 'boom') {
    const port = world.portList[randInt(g, 0, world.portList.length - 1)];
    if (taken((x) => x.port === port.id)) return;
    e = { ...base, port: port.id, endDay: day + randInt(g, 60, 120), headline: `Economic boom in ${port.name}: it pays more for everything it imports.` };
  } else if (kind === 'canal') {
    const ids = Object.keys(world.canals);
    const canal = ids[randInt(g, 0, ids.length - 1)];
    if (taken((x) => x.canal === canal)) return;
    const via = canal === 'suez' ? 'round the Cape of Good Hope' : 'the long way round';
    e = { ...base, canal, endDay: day + randInt(g, 30, 90), headline: `The ${world.canals[canal].name} is closed. Ships must go ${via}.` };
  } else {
    if (taken((x) => x.kind === 'oilShock')) return;
    const up = rand(g) < 0.6;
    const oilShift = up ? randRange(g, 0.25, 0.45) : -randRange(g, 0.2, 0.3);
    e = { ...base, oilShift: Math.round(oilShift * 100) / 100, endDay: day + randInt(g, 40, 100),
      headline: up ? 'Oil shock: crude prices surge, and bunker fuel follows.' : 'Oil glut: crude prices slump, so bunker fuel is cheap for a while.' };
    // Markets react at once to part of the news.
    g.oil.index = Math.max(ECONOMY.oil.min, Math.min(ECONOMY.oil.max, g.oil.index * (1 + e.oilShift! * 0.5)));
  }
  if (!e) return;
  g.events.push(e);
  // Prices jump part of the way straight away.
  for (const port of world.portList) {
    for (const d of port.demands) {
      const t = targetPrice(g, port.id, d.good);
      if (t > 1) {
        const prices = (g.ports[port.id].prices ??= {});
        const now = prices[d.good] ?? 1;
        prices[d.good] = Math.round((now + (t - now) * 0.5) * 1000) / 1000;
      }
    }
  }
  newsLog(g, e.headline);
}

function endEvents(world: World, g: GameState): void {
  for (const e of g.events) {
    if (Math.floor(g.day) === e.endDay) {
      const what = e.kind === 'canal' ? `The ${world.canals[e.canal!].name} has reopened.`
        : e.kind === 'strike' ? `The strike in ${world.ports[e.port!].name} is over.`
          : e.kind === 'harvest' ? `${world.goods[e.good!].name} supplies are back to normal.`
            : e.kind === 'boom' ? `The boom in ${world.ports[e.port!].name} is cooling off.`
              : 'Oil markets have settled down.';
      newsLog(g, what);
    }
  }
  g.events = g.events.filter((e) => g.day - e.endDay < ECONOMY.newsDays);
}

/** Called once per game day by the clock. */
export function economyDay(world: World, g: GameState, dayNumber: number): void {
  stepPrices(world, g);
  stepOil(g, dayNumber);
  endEvents(world, g);
  if (rand(g) < 1 / ECONOMY.eventEveryDays) startEvent(world, g);
}

export function newOilMarket(): GameState['oil'] {
  return { index: 1, history: [1] };
}
