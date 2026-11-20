// Simple captains used by the balance scripts and tests to check that the
// economy is playable, and as a baseline for automation later. Each bot runs
// one ship (the first in the fleet): it gives orders while the ship is in
// port, then lets the world clock run until the ship is ready again.

import {
  acceptContract, advance, buyFuel, buyShip, canCarry, daysUntilNextShip, fuelPrice, getShip, isReady, planVoyage,
  repair, repayLoan, sail, sellShip, spendable, typeOf,
} from './game';
import { pickWeighted, rand } from './rng';
import { SHIP_TUNING, exportsFor, quotePurchase } from './ships';
import type { Contract, GameState, ShipState, ShipTypeDef } from './types';
import { getWorld, type World } from './world';
import { isCharted } from './charts';

export interface BotChoice {
  dest: string;
  load: Contract[];
  score: number;
  net: number;
  days: number;
}

const botShip = (g: GameState): ShipState => g.fleet[0];

/** Evaluate every destination: take the best-paying contracts for it that fit, score by net $/day. */
export function evaluateOptions(g: GameState, shipId: number, world: World = getWorld()): BotChoice[] {
  const ship = getShip(g, shipId);
  const type = typeOf(ship, world);
  const board = g.ports[ship.location].board;
  const choices: BotChoice[] = [];
  for (const p of world.portList) {
    if (p.id === ship.location || !isCharted(g, p.id)) continue;
    let free = type.capacity - ship.cargo.reduce((s, c) => s + c.tons, 0);
    const load: Contract[] = [];
    const candidates = board
      .filter((c) => c.dest === p.id && canCarry(ship, c, world) === null)
      .sort((a, b) => b.pay / b.tons - a.pay / a.tons);
    for (const c of candidates) {
      if (c.tons <= free) {
        load.push(c);
        free -= c.tons;
      }
    }
    const trial: GameState = { ...g, fleet: g.fleet.map((s) => (s.id === shipId ? { ...s, cargo: [...s.cargo, ...load] } : s)) };
    const plan = planVoyage(trial, shipId, p.id, world);
    // Keep a 15% fuel reserve for weather.
    if (!plan || plan.fuelNeeded * 1.15 > type.bunkerCapacity) continue;
    const days = plan.seaDays + 1;
    choices.push({ dest: p.id, load, net: plan.estimatedNet, days, score: plan.estimatedNet / days });
  }
  return choices.sort((a, b) => b.score - a.score);
}

/** Let time pass until the bot's ship is ready for orders (or `maxDays`). */
function untilReady(g: GameState, world: World, maxDays = 400): GameState {
  for (let i = 0; i < 50 && !g.gameOver && !isReady(g, botShip(g)); i++) {
    const wait = daysUntilNextShip(g);
    if (wait === null) break;
    g = advance(g, Math.min(maxDays, wait + 1e-6), world);
  }
  return { ...g, reports: g.reports.slice(-1) };
}

function topUpAndSail(g: GameState, dest: string, reserve: number, world: World): GameState {
  const ship = botShip(g);
  const type = typeOf(ship, world);
  const plan = planVoyage(g, ship.id, dest, world)!;
  const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * reserve));
  const want = target - ship.fuel;
  if (want > 1) {
    try { g = buyFuel(g, ship.id, want, world); } catch { /* can't afford: handled below */ }
  }
  if (botShip(g).fuel < plan.fuelNeeded) return g;
  return sail(g, ship.id, dest, world);
}

/** Play one leg with the greedy policy. Returns the state once the ship is ready again. */
export function botStep(g: GameState, world: World = getWorld()): GameState {
  g = untilReady(g, world);
  if (g.gameOver) return g;
  g = maybeRepay(g, 300_000, world);
  g = maybeUpgrade(g, 100_000, 250, world);
  let ship = botShip(g);
  const type = typeOf(ship, world);
  if (ship.condition < 50 && g.cash > 30 * type.repairCostPerPoint + 30_000) {
    g = untilReady(repair(g, ship.id, 80 - ship.condition, world), world);
    ship = botShip(g);
  }
  let [best] = evaluateOptions(g, ship.id, world);
  // Nothing worth doing? Wait a few days for better offers, as a person would.
  for (let i = 0; i < 5 && best && best.score < 0 && g.cash > 20_000; i++) {
    g = { ...advance(g, 1, world), reports: [] };
    [best] = evaluateOptions(g, ship.id, world);
  }
  if (!best || g.gameOver) return g;
  // Only commit to cargo if we can pay for the fuel to deliver it.
  const trialPlan = planVoyage({ ...g, fleet: g.fleet.map((s) => (s.id === ship.id ? { ...s, cargo: [...s.cargo, ...best.load] } : s)) }, ship.id, best.dest, world)!;
  const fuelCost = Math.max(0, trialPlan.fuelNeeded - ship.fuel) * fuelPrice(g, ship.location, world);
  if (fuelCost <= spendable(g, world)) for (const c of best.load) g = acceptContract(g, ship.id, c.id, world);
  const cheap = fuelPrice(g, ship.location, world) < 380;
  let next = topUpAndSail(g, best.dest, cheap ? 10 : 1.2, world);
  if (isReady(next, botShip(next))) {
    // Couldn't afford the fuel for the best leg: take the nearest reachable port instead.
    const fallback = world.portList.filter((p) => isCharted(next, p.id))
      .map((p) => planVoyage(next, ship.id, p.id, world))
      .filter((p): p is NonNullable<typeof p> => p !== null && p.fuelNeeded <= botShip(next).fuel)
      .sort((a, b) => a.route.nm - b.route.nm)[0];
    if (!fallback) return { ...next, gameOver: 'Stranded without fuel or money.' };
    next = sail(next, ship.id, fallback.dest, world);
  }
  return untilReady(next, world);
}

/**
 * A "casual" captain, closer to a person playing for the first time: picks an
 * attractive-looking contract (big pay, not best $/day), adds anything else
 * going the same way, tops up fuel wherever it is, never waits for offers.
 */
export function casualStep(g: GameState, world: World = getWorld()): GameState {
  g = untilReady(g, world);
  if (g.gameOver) return g;
  g = maybeRepay(g, 200_000, world);
  // A first-timer upgrades less shrewdly: accepts a much longer payback.
  g = maybeUpgrade(g, 30_000, 500, world);
  let ship = botShip(g);
  const type = typeOf(ship, world);
  if (ship.condition < 50 && g.cash > 30 * type.repairCostPerPoint + 30_000) {
    g = untilReady(repair(g, ship.id, 80 - ship.condition, world), world);
    ship = botShip(g);
  }
  const here = ship.location;
  const options = g.ports[here].board.filter((c) => {
    const plan = planVoyage(g, ship.id, c.dest, world);
    return canCarry(ship, c, world) === null && plan !== null && plan.fuelNeeded * 1.1 <= type.bunkerCapacity;
  });
  let dest: string;
  if (ship.cargo.length > 0 && rand(g) < 0.5) {
    dest = ship.cargo[0].dest; // deliver what's aboard
  } else if (options.length > 0) {
    dest = pickWeighted(g, options, (c) => c.pay).dest;
  } else {
    // Nothing loadable: head in ballast for the nearest port that exports cargo this ship can carry.
    const reachable = world.portList.filter((p) => p.id !== here && isCharted(g, p.id))
      .map((p) => planVoyage(g, ship.id, p.id, world)!)
      .filter((pl) => pl.fuelNeeded * 1.1 <= type.bunkerCapacity)
      .sort((a, b) => a.route.nm - b.route.nm);
    const useful = reachable.filter((pl) => exportsFor(world, type, pl.dest).length > 0);
    dest = (useful[0] ?? reachable[0]).dest;
  }
  for (const c of options.filter((c) => c.dest === dest)) {
    if (canCarry(botShip(g), c, world) === null) g = acceptContract(g, ship.id, c.id, world);
  }
  const next = topUpAndSail(g, dest, 1.15, world);
  if (isReady(next, botShip(next))) return { ...next, gameOver: 'Stranded without fuel or money.' };
  return untilReady(next, world);
}

// ---------------------------------------------------------------- ship buying

export const BOT_OPTIONS = { upgrade: true };

/** Cash a ship needs on hand to operate: a full tank plus a month of upkeep. */
export function runningCash(type: ShipTypeDef): number {
  return type.bunkerCapacity * 420 + type.dailyCost * 30;
}

/** Rough earning power of a ship: average best net $/day across every port's current offers. */
export function earningPower(g: GameState, ship: Pick<ShipState, 'typeId' | 'age' | 'condition'>, world: World = getWorld()): number {
  const probe = -1;
  let total = 0;
  for (const p of world.portList) {
    const trialShip: ShipState = { id: probe, name: 'probe', location: p.id, cargo: [], fuel: 0, typeId: ship.typeId, age: ship.age, condition: ship.condition };
    const trial: GameState = { ...g, fleet: [trialShip] };
    const [best] = evaluateOptions(trial, probe, world);
    total += Math.max(0, best?.score ?? 0);
  }
  return total / world.portList.length;
}

/**
 * Consider trading up: buy a better ship here, then sell the old one.
 * `reserve` is the cash the bot insists on keeping; `maxPayback` is how many
 * days of extra earnings the price difference may take to recover.
 */
export function maybeUpgrade(g: GameState, reserve: number, maxPayback: number, world: World = getWorld()): GameState {
  const ship = botShip(g);
  if (!BOT_OPTIONS.upgrade || ship.cargo.length > 0 || !isReady(g, ship)) return g;
  const current = earningPower(g, ship, world);
  const tradeIn = Math.round(sellValue(ship, world));
  let best: { id: number; gain: number } | null = null;
  for (const offer of g.ports[ship.location].market) {
    const q = quotePurchase(g, offer, world);
    // Judge the deal as a swap: the old ship's sale pays part of the price.
    const netCost = offer.price - tradeIn;
    const borrow = Math.max(0, netCost - Math.max(0, g.cash));
    const cashAfter = g.cash - (netCost - borrow);
    if (q.blocked || cashAfter < reserve + runningCash(q.type)) continue;
    const gain = earningPower(g, offer, world) - current - (g.loan + borrow) * SHIP_TUNING.loanDailyRate;
    if (gain <= 0 || netCost / gain > maxPayback) continue;
    if (!best || gain > best.gain) best = { id: offer.id, gain };
  }
  if (!best) return g;
  const oldId = ship.id;
  let next = buyShip(g, ship.location, best.id, world);
  // The new ship is last in the fleet: move it to the front so the bot keeps running one ship.
  next = { ...next, fleet: [next.fleet[next.fleet.length - 1], ...next.fleet.slice(0, -1)] };
  next = sellShip(next, oldId, world);
  return next;
}

function sellValue(ship: ShipState, world: World): number {
  const type = typeOf(ship, world);
  const ageShare = Math.max(SHIP_TUNING.scrapShare, SHIP_TUNING.yearlyDepreciation ** ship.age);
  return type.newPrice * ageShare * (0.55 + 0.45 * (ship.condition / 100)) * SHIP_TUNING.saleShare;
}

/** Pay the loan down when there's comfortable cash. */
export function maybeRepay(g: GameState, keep: number, world: World = getWorld()): GameState {
  void world;
  if (g.loan > 0 && g.cash > keep + 50_000) return repayLoan(g, g.cash - keep);
  return g;
}
