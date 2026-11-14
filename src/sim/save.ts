import type { GameState } from './types';

const KEY = 'deadweight.save.v1';

export function saveGame(g: GameState, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(g));
  } catch {
    // Storage full or blocked (private mode): the game still runs, it just won't persist.
  }
}

export function loadGame(storage: Storage | undefined = globalThis.localStorage): GameState | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as GameState;
    return g.version === 1 ? g : null;
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
