import { fillCaptainPool } from './captains';
import { regenerateBoard } from './contracts';
import { newOilMarket } from './economy';
import { randRange } from './rng';
import { netWorth, regenerateMarket } from './ships';
import type { GameState, ShipState } from './types';
import { getWorld, worldFor } from './world';
import { chartKnownWaters, chartNewWaypoints, ensureCharts } from './charts';
import { ensureTrade } from './trade';
import { syncSettlementPort } from './settlement';

// Several games ("slots"), each in its own key, with an index of them for the start
// screen. The single save from before slots (LEGACY_KEY) becomes the first slot.
const LEGACY_KEY = 'deadweight.save.v1';
const INDEX_KEY = 'deadweight.slots';
const ACTIVE_KEY = 'deadweight.active';
/** Games deleted on this device (for cloud sync: a deletion travels to the other devices). */
const DELETED_KEY = 'deadweight.deleted';
const slotKey = (id: string) => `deadweight.save.${id}`;

export type Era = 'modern' | 'sail';
export type { House } from './era';

/** What the start screen shows about a saved game. */
export interface SlotInfo {
  /** This device's key for the game (s1, s2, …). */
  id: string;
  /** The game's identity everywhere (the same on every device it's synced to). */
  uid?: string;
  name: string;
  era: Era;
  /** Age of Sail: the merchant house (missing = Dutch). */
  house?: 'dutch' | 'chinese';
  /** Real-world times (ms) the game was started and last changed. */
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

function newUid(): string {
  const r = globalThis.crypto?.randomUUID?.();
  return r ?? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Give every game a lasting identity (games from before cloud sync have none yet). */
function ensureUids(storage: Store): SlotInfo[] {
  const slots = readIndex(storage);
  if (slots.some((x) => !x.uid)) {
    for (const x of slots) x.uid ??= newUid();
    writeIndex(storage, slots);
  }
  return slots;
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
        slots = [{ id, uid: newUid(), name: g.company ?? 'My shipping company', era: g.era ?? 'modern', created: now, lastPlayed: now, ...summary(g) }];
        writeIndex(storage, slots);
        storage!.setItem(ACTIVE_KEY, id);
        storage!.removeItem(LEGACY_KEY);
      }
    }
  } catch { /* leave the legacy save where it is */ }
  if (slots.some((x) => !x.uid)) slots = ensureUids(storage);
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
  slots.push({ id, uid: newUid(), name, era: g.era ?? 'modern', ...(g.house ? { house: g.house } : {}), created: now, lastPlayed: now, ...summary(g) });
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
  // A rename is a change too: it should reach the other devices.
  writeIndex(storage, readIndex(storage).map((x) => (x.id === id ? { ...x, name, lastPlayed: Date.now() } : x)));
}

export function deleteSlot(id: string, storage: Store = globalThis.localStorage): void {
  const gone = readIndex(storage).find((x) => x.id === id);
  if (gone?.uid) markDeleted(gone.uid, Date.now(), storage);
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
    const json = JSON.stringify(g);
    // Unchanged: leave "last played" alone, so it means "last changed" (cloud sync compares it).
    if (storage?.getItem(slotKey(id)) === json) return;
    storage?.setItem(slotKey(id), json);
    writeIndex(storage, readIndex(storage).map((x) => (x.id === id ? { ...x, lastPlayed: Date.now(), ...summary(g) } : x)));
  } catch {
    // Storage full or blocked (private mode): the game still runs, it just won't persist.
  }
}

// ---------------------------------------------------------------- for cloud sync

export interface Tombstone { uid: string; at: number }

/** Games deleted on this device, and when. */
export function deletedGames(storage: Store = globalThis.localStorage): Tombstone[] {
  try {
    const raw = storage?.getItem(DELETED_KEY);
    return raw ? (JSON.parse(raw) as Tombstone[]) : [];
  } catch {
    return [];
  }
}

/** Remember that a game was deleted (here or on another device). */
export function markDeleted(uid: string, at: number, storage: Store = globalThis.localStorage): void {
  const list = deletedGames(storage).filter((t) => t.uid !== uid);
  list.push({ uid, at });
  try { storage?.setItem(DELETED_KEY, JSON.stringify(list.slice(-200))); } catch { /* ignore */ }
}

/** Every saved game with its stored text, as cloud sync uploads them. */
export function exportSlots(storage: Store = globalThis.localStorage): { info: SlotInfo & { uid: string }; json: string }[] {
  listSlots(storage); // gives older games their uid
  return readIndex(storage).flatMap((info) => {
    const json = storage?.getItem(slotKey(info.id));
    return json && info.uid ? [{ info: info as SlotInfo & { uid: string }, json }] : [];
  });
}

/**
 * Store a game that came from another device, keeping its identity and its "last
 * changed" time. Replaces this device's copy of the same game, or adds it as a new
 * slot. Returns the local slot id.
 */
export function importSlot(info: SlotInfo & { uid: string }, json: string, storage: Store = globalThis.localStorage): string {
  const slots = ensureUids(storage);
  const mine = slots.find((x) => x.uid === info.uid);
  const id = mine?.id ?? newSlotId(slots);
  const entry: SlotInfo = { ...info, id };
  try {
    storage?.setItem(slotKey(id), json);
    writeIndex(storage, mine ? slots.map((x) => (x.id === id ? entry : x)) : [...slots, entry]);
  } catch { /* storage full */ }
  return id;
}

/** Remove a game that was deleted on another device (without recording a new deletion). */
export function removeSlotByUid(uid: string, storage: Store = globalThis.localStorage): void {
  const slot = readIndex(storage).find((x) => x.uid === uid);
  if (!slot) return;
  writeIndex(storage, readIndex(storage).filter((x) => x.uid !== uid));
  try {
    storage?.removeItem(slotKey(slot.id));
    if (storage?.getItem(ACTIVE_KEY) === slot.id) storage.removeItem(ACTIVE_KEY);
  } catch { /* ignore */ }
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
  syncSettlementPort(gw, g as GameState);
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
