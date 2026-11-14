// A simple greedy captain. Used by the balance script and tests to check
// that the economy is playable, and as a baseline for later automation.

import { acceptContract, buyFuel, canCarry, fuelPrice, planVoyage, repair, sail, shipType, waitDay } from './game';
import type { Contract, GameState } from './types';
import { getWorld, type World } from './world';

export interface BotChoice {
  dest: string;
  load: Contract[];
  score: number;
  net: number;
  days: number;
}

/** Evaluate every destination: take the best-paying contracts for it that fit, score by net $/day. */
export function evaluateOptions(g: GameState, world: World = getWorld()): BotChoice[] {
  const type = shipType(g, world);
  const board = g.ports[g.ship.location].board;
  const choices: BotChoice[] = [];
  for (const p of world.portList) {
    if (p.id === g.ship.location) continue;
    let free = type.capacity - g.ship.cargo.reduce((s, c) => s + c.tons, 0);
    const load: Contract[] = [];
    const candidates = board
      .filter((c) => c.dest === p.id && canCarry(g, c, world) === null)
      .sort((a, b) => b.pay / b.tons - a.pay / a.tons);
    for (const c of candidates) {
      if (c.tons <= free) {
        load.push(c);
        free -= c.tons;
      }
    }
    const trial: GameState = { ...g, ship: { ...g.ship, cargo: [...g.ship.cargo, ...load] } };
    const plan = planVoyage(trial, p.id, world);
    // Keep a 15% fuel reserve for weather.
    if (!plan || plan.fuelNeeded * 1.15 > type.bunkerCapacity) continue;
    const days = plan.seaDays + 1;
    choices.push({ dest: p.id, load, net: plan.estimatedNet, days, score: plan.estimatedNet / days });
  }
  return choices.sort((a, b) => b.score - a.score);
}

/** Play one leg with the greedy policy. Returns the new state. */
export function botStep(g: GameState, world: World = getWorld()): GameState {
  const type = shipType(g, world);
  if (g.ship.condition < 50 && g.cash > 60_000) {
    g = repair(g, 80 - g.ship.condition, world);
  }
  let [best] = evaluateOptions(g, world);
  // Nothing worth doing? Wait a few days for better offers, as a person would.
  for (let i = 0; i < 5 && best.score < 0 && g.cash > 20_000; i++) {
    g = waitDay(g, world);
    [best] = evaluateOptions(g, world);
  }
  for (const c of best.load) g = acceptContract(g, c.id, world);
  const plan = planVoyage(g, best.dest, world)!;
  const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * 1.2));
  const cheap = fuelPrice(g, g.ship.location, world) < 380;
  const want = (cheap ? type.bunkerCapacity : target) - g.ship.fuel;
  if (want > 1) {
    try {
      g = buyFuel(g, want, world);
    } catch {
      /* can't afford: sail anyway and risk it */
    }
  }
  if (g.ship.fuel < plan.fuelNeeded) {
    // Can't afford the fuel for the best leg: take the nearest reachable port instead.
    const fallback = evaluateOptions(g, world)
      .map((o) => planVoyage(g, o.dest, world)!)
      .filter((p) => p.fuelNeeded <= g.ship.fuel)
      .sort((a, b) => a.route.nm - b.route.nm)[0];
    if (!fallback) return { ...g, gameOver: 'Stranded without fuel or money.' };
    return sail(g, fallback.dest, world);
  }
  return sail(g, best.dest, world);
}
