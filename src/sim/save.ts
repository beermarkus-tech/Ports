import { fillCaptainPool } from './captains';
import { regenerateBoard } from './contracts';
import { newOilMarket } from './economy';
import { randRange } from './rng';
import { netWorth, regenerateMarket } from './ships';
import type { GameState, ShipState } from './types';
import { getWorld, worldFor } from './world';
import { chartKnownWaters, chartNewWaypoints, ensureCharts } from './charts';
import { ensureTrade } from './trade';

// Several games ("slots"), each in its own key, with an index of them for the start
// screen. The single save from before slots (LEGACY_KEY) becomes the first slot.
const LEGACY_KEY = 'deadweight.save.v1';
const INDEX_KEY = 'deadweight.slots';
const ACTIVE_KEY = 'deadweight.active';
const slotKey = (id: string) => `deadweight.save.${id}`;

export type Era = 'modern' | 'sail';
export type { House } from './era';

/** What the start screen shows about a saved game. */
export interface SlotInfo {
  id: string;
  name: string;
  era: Era;
  /** Age of Sail: the merchant house (missing = Dutch). */
  house?: 'dutch' | 'chinese';
  /** Real-world times (ms) the game was started and last played. */
  created: number;
  lastPlayed: number;
  /** Game day, number of ships and net worth when last saved. */
  day: number;
  ships: number;
  worth: number;
}

type Store = Storage | undefined;

function readIndex(storage: Store): SlotInfo[] {
  try {
    const raw = storage?.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as SlotInfo[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(storage: Store, slots: SlotInfo[]): void {
  try { storage?.setItem(INDEX_KEY, JSON.stringify(slots)); } catch { /* storage full or blocked */ }
}

function summary(g: GameState): Pick<SlotInfo, 'day' | 'ships' | 'worth'> {
  return { day: g.day, ships: g.fleet.length, worth: Math.round(netWorth(g, getWorld())) };
}

function newSlotId(slots: SlotInfo[]): string {
  let n = slots.length + 1;
  while (slots.some((x) => x.id === `s${n}`)) n++;
  return `s${n}`;
}

/** The saved games, most recently played first (moving a save from before slots into the first one). */
export function listSlots(storage: Store = globalThis.localStorage): SlotInfo[] {
  let slots = readIndex(storage);
  try {
    const legacy = storage?.getItem(LEGACY_KEY);
    if (legacy && !slots.length) {
      const g = migrate(JSON.parse(legacy));
      if (g) {
        const now = Date.now();
        const id = 's1';
        storage!.setItem(slotKey(id), JSON.stringify(g));
        slots = [{ id, name: g.company ?? 'My shipping company', era: g.era ?? 'modern', created: now, lastPlayed: now, ...summary(g) }];
        writeIndex(storage, slots);
        storage!.setItem(ACTIVE_KEY, id);
        storage!.removeItem(LEGACY_KEY);
      }
    }
  } catch { /* leave the legacy save where it is */ }
  return [...slots].sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export function activeSlot(storage: Store = globalThis.localStorage): string | null {
  try {
    const id = storage?.getItem(ACTIVE_KEY) ?? null;
    return id && readIndex(storage).some((x) => x.id === id) ? id : null;
  } catch {
    return null;
  }
}

export function setActiveSlot(id: string, storage: Store = globalThis.localStorage): void {
  try { storage?.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
}

/** Store a new game in a slot of its own and make it the active one. */
export function createSlot(g: GameState, name: string, storage: Store = globalThis.localStorage): string {
  const slots = readIndex(storage);
  const id = newSlotId(slots);
  const now = Date.now();
  slots.push({ id, name, era: g.era ?? 'modern', ...(g.house ? { house: g.house } : {}), created: now, lastPlayed: now, ...summary(g) });
  writeIndex(storage, slots);
  setActiveSlot(id, storage);
  try { storage?.setItem(slotKey(id), JSON.stringify(g)); } catch { /* storage full */ }
  return id;
}

export function loadSlot(id: string, storage: Store = globalThis.localStorage): GameState | null {
  try {
    const raw = storage?.getItem(slotKey(id));
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function renameSlot(id: string, name: string, storage: Store = globalThis.localStorage): void {
  writeIndex(storage, readIndex(storage).map((x) => (x.id === id ? { ...x, name } : x)));
}

export function deleteSlot(id: string, storage: Store = globalThis.localStorage): void {
  writeIndex(storage, readIndex(storage).filter((x) => x.id !== id));
  try {
    storage?.removeItem(slotKey(id));
    if (storage?.getItem(ACTIVE_KEY) === id) storage.removeItem(ACTIVE_KEY);
  } catch { /* ignore */ }
}

/** Save the game into the active slot (creating one if there is none). */
export function saveGame(g: GameState, storage: Store = globalThis.localStorage): void {
  try {
    const id = activeSlot(storage);
    if (!id) { createSlot(g, g.company ?? 'My shipping company', storage); return; }
    storage?.setItem(slotKey(id), JSON.stringify(g));
    writeIndex(storage, readIndex(storage).map((x) => (x.id === id ? { ...x, lastPlayed: Date.now(), ...summary(g) } : x)));
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
  // The Age of Sail's fog arrived after its first games: they start with the Dutch charts of 1650.
  const gw = worldFor((g as GameState).era ?? 'modern', (g as GameState).house);
  ensureCharts(g as GameState, gw);
  chartNewWaypoints(gw, g as GameState);
  // New ports first: the trade news samples every port's prices.
  addNewPorts(g as GameState);
  ensureTrade(gw, g as GameState);
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
  const world = worldFor(g.era ?? 'modern', g.house);
  const added = world.portList.filter((p) => !g.ports[p.id]);
  for (const p of added) g.ports[p.id] = { fuelDev: randRange(g, -0.12, 0.12), board: [], market: [], prices: {} };
  // A new port in waters the house knew from the start is charted too.
  chartKnownWaters(world, g, added.map((p) => p.id));
  for (const p of added) {
    regenerateBoard(world, g, p.id);
    regenerateMarket(world, g, p.id);
  }
}

/** The active slot's game (after moving a save from before slots into a slot). */
export function loadGame(storage: Store = globalThis.localStorage): GameState | null {
  const slots = listSlots(storage);
  const id = activeSlot(storage) ?? slots[0]?.id;
  if (!id) return null;
  setActiveSlot(id, storage);
  return loadSlot(id, storage);
}

/** Forget the active slot's game (its slot stays, and the next save fills it). */
export function clearSave(storage: Store = globalThis.localStorage): void {
  try {
    const id = activeSlot(storage);
    if (id) storage?.removeItem(slotKey(id));
  } catch {
    /* ignore */
  }
}
