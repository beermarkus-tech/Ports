import { regenerateMarket } from './ships';
import type { GameState } from './types';
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

/** Bring an older save up to the current format. Returns null if it can't be used. */
export function migrate(raw: unknown): GameState | null {
  const g = raw as Record<string, unknown> & GameState;
  if (!g || typeof g !== 'object') return null;
  if ((g.version as number) === 1) {
    const world = getWorld();
    const old = g as unknown as { wonAt?: number; stats: Record<string, number> };
    g.version = 2;
    g.loan = 0;
    g.ship.age ??= 24;
    g.milestones = old.wonAt !== undefined ? [{ amount: 1_000_000, day: old.wonAt }] : [];
    delete old.wonAt;
    g.stats = { ...g.stats, interestPaid: old.stats.interestPaid ?? 0, shipsOwned: old.stats.shipsOwned ?? 1 };
    for (const p of world.portList) {
      if (!g.ports[p.id]) continue;
      g.ports[p.id].market ??= [];
      regenerateMarket(world, g, p.id);
    }
  }
  return g.version === 2 ? g : null;
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
