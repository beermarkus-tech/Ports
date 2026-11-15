// Captains for hire: a small pool that turns over, each with a skill, a wage and
// a home region. Hiring, firing and assigning them are actions in game.ts.

import { REGIONS } from './regions';
import { pickWeighted, rand, randInt, randRange } from './rng';
import type { Captain, GameState } from './types';

export const CAPTAIN_TUNING = {
  /** Captains you can employ at the start; one more per net-worth milestone reached. */
  baseSlots: 2,
  /** Monthly wage by skill (randomised ±15%). */
  wage: { 1: 18_000, 2: 32_000, 3: 55_000 } as Record<1 | 2 | 3, number>,
  /** How often each skill turns up in the pool. */
  skillWeights: { 1: 4, 2: 4, 3: 2 } as Record<1 | 2 | 3, number>,
  /** Candidates looking for work at any time. */
  poolSize: 5,
  /** Chance a day that one candidate leaves and another turns up. */
  turnoverPerDay: 0.08,
  /** Severance on firing, in months of wage. */
  severanceMonths: 1,
  /** Service bookings come through this much more often in a captain's home region. */
  homeBookingBoost: 1.5,
};

const FIRST = ['Anna', 'Bjorn', 'Carlos', 'Dana', 'Elif', 'Femi', 'Grace', 'Hiro', 'Ines', 'Jonas', 'Kofi', 'Lena', 'Marco', 'Nadia',
  'Omar', 'Priya', 'Quentin', 'Rosa', 'Sven', 'Tariq', 'Uma', 'Viktor', 'Wen', 'Yusuf', 'Zara', 'Mateo', 'Sofia', 'Arjun', 'Mei', 'Lars'];
const LAST = ['Andersen', 'Barros', 'Chen', 'Dubois', 'Eze', 'Fischer', 'Garcia', 'Haddad', 'Ivanova', 'Jensen', 'Kim', 'Lindqvist',
  'Moreau', 'Nakamura', 'Okafor', 'Petrov', 'Quinn', 'Rossi', 'Santos', 'Tanaka', 'Uddin', 'Varga', 'Walsh', 'Yilmaz', 'Zhou', 'Mensah',
  'Kowalski', 'Ferreira', 'Singh', 'Olsen'];

export function newCaptain(g: GameState, avoid: string[] = []): Captain {
  let name = '';
  for (let i = 0; i < 20; i++) {
    name = `${FIRST[randInt(g, 0, FIRST.length - 1)]} ${LAST[randInt(g, 0, LAST.length - 1)]}`;
    if (!avoid.includes(name)) break;
  }
  const skill = pickWeighted(g, [1, 2, 3] as const, (k) => CAPTAIN_TUNING.skillWeights[k]);
  const wage = Math.round((CAPTAIN_TUNING.wage[skill] * randRange(g, 0.85, 1.15)) / 1000) * 1000;
  return { id: g.nextId++, name, skill, wage, home: REGIONS[randInt(g, 0, REGIONS.length - 1)].id };
}

/** Fill the pool of candidates up to its size. */
export function fillCaptainPool(g: GameState): void {
  g.captainPool ??= [];
  g.captains ??= [];
  const names = () => [...g.captains!, ...g.captainPool!].map((c) => c.name);
  while (g.captainPool.length < CAPTAIN_TUNING.poolSize) g.captainPool.push(newCaptain(g, names()));
}

/** A day passes: now and then a candidate finds other work and someone new turns up. */
export function churnCaptainPool(g: GameState): void {
  fillCaptainPool(g);
  if (rand(g) < CAPTAIN_TUNING.turnoverPerDay && g.captainPool!.length) {
    g.captainPool!.splice(randInt(g, 0, g.captainPool!.length - 1), 1);
    fillCaptainPool(g);
  }
}

export function captainSlots(g: GameState): number {
  return CAPTAIN_TUNING.baseSlots + g.milestones.length;
}
