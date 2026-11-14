import type { GameState } from './types';

/** mulberry32 step: advances the seed stored in the game state, returns [0,1). */
export function rand(g: GameState): number {
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(g: GameState, min: number, max: number): number {
  return min + rand(g) * (max - min);
}

export function randInt(g: GameState, min: number, maxInclusive: number): number {
  return Math.floor(randRange(g, min, maxInclusive + 1));
}

/** Approximately normal, mean 0, sd 1. */
export function randNormal(g: GameState): number {
  return rand(g) + rand(g) + rand(g) + rand(g) + rand(g) + rand(g) - 3;
}

export function pickWeighted<T>(g: GameState, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let r = rand(g) * total;
  for (const item of items) {
    r -= weight(item);
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
