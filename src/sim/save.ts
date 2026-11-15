import { fillCaptainPool } from './captains';
import { regenerateBoard } from './contracts';
import { newOilMarket } from './economy';
import { randRange } from './rng';
import { regenerateMarket } from './ships';
import type { GameState, ShipState } from './types';
import { getWorld } from './world';

// The storage key stays the same across versions; old saves are upgraded on load.
const KEY = 'deadweight.save.v1';

export function saveGame(g: GameState, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(g));
  } catch {
    // Storage full or blocked (private mode): the game still runs, it just won't persist.
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Bring an older save up to the current format. Returns null if it can't be used. */
export function migrate(raw: unknown): GameState | null {
  const g = raw as any;
  if (!g || typeof g !== 'object') return null;
  if (g.version === 1) {
    // Phase 2: loans, ship age, milestones, ship markets.
    g.version = 2;
    g.loan = 0;
    g.ship.age ??= 24;
    g.milestones = g.wonAt !== undefined ? [{ amount: 1_000_000, day: g.wonAt }] : [];
    delete g.wonAt;
    g.stats = { ...g.stats, interestPaid: g.stats.interestPaid ?? 0, shipsOwned: g.stats.shipsOwned ?? 1 };
    for (const p of Object.values(g.ports) as any[]) p.market ??= [];
  }
  if (g.version === 2) {
    // Phase 3: port price levels, the oil market and world events.
    g.version = 3;
    g.oil ??= newOilMarket();
    g.events ??= [];
    for (const p of Object.values(g.ports) as any[]) p.prices ??= {};
  }
  if (g.version === 3) {
    // Fleet and world clock: the single ship becomes ship #1 of a fleet.
    g.version = 4;
    const ship: ShipState = { ...g.ship, id: g.nextId++ };
    g.fleet = [ship];
    delete g.ship;
    delete g.lastVoyage;
    g.reports = [];
    g.stats.upkeepPaid ??= 0;
    const world = getWorld();
    for (const p of world.portList) {
      if (g.ports[p.id] && !g.ports[p.id].market.length) regenerateMarket(world, g, p.id);
    }
  }
  if (g.version !== 4) return null;
  addNewPorts(g as GameState);
  addCaptains(g as GameState);
  return g as GameState;
}

/**
 * Captains arrived: from then on a ship only sails by itself with a hired captain.
 * Routes set up before that end: ships finish their voyage and wait for orders.
 */
function addCaptains(g: GameState): void {
  if (g.captains) return;
  g.captains = [];
  let ended = 0;
  for (const ship of g.fleet) {
    if (ship.orders) { delete ship.orders; ended++; }
  }
  fillCaptainPool(g);
  if (ended) {
    g.log.unshift({ day: g.day, text: `Routes now need a hired captain: ${ended} route${ended > 1 ? 's' : ''} ended. Ships finish their voyage and wait for your orders.` });
  }
}

/** Ports added to the world after this game was started get a market, offers and a fuel price. */
function addNewPorts(g: GameState): void {
  const world = getWorld();
  const added = world.portList.filter((p) => !g.ports[p.id]);
  for (const p of added) g.ports[p.id] = { fuelDev: randRange(g, -0.12, 0.12), board: [], market: [], prices: {} };
  for (const p of added) {
    regenerateBoard(world, g, p.id);
    regenerateMarket(world, g, p.id);
  }
}

export function loadGame(storage: Storage | undefined = globalThis.localStorage): GameState | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSave(storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
