// Game rules: player actions, the world clock and voyages.
// Every action takes a state and returns a *new* state (the input is never
// mutated), so the UI can keep history and tests can replay deterministically.
//
// Time runs on a world clock (`advance`). A ship that casts off gets a voyage
// whose course is worked out up front; the clock plays it out, and when the
// ship's arrival day comes it unloads, gets paid, and an arrival report waits
// in `reports` until the player has seen it.

import { churnBoard, latePayFactor, regenerateBoard } from './contracts';
import { ECONOMY, economyDay, newOilMarket, recordDelivery, routeFor, strikeAt } from './economy';
import { rand, randNormal, randRange } from './rng';
import {
  SHIP_TUNING, breakdownAgeFactor, consumptionFactor, effectiveSpeed, maxLoan, netWorth, quotePurchase,
  regenerateMarket, saleValue, shipName,
} from './ships';
import type { ActiveVoyage, Contract, Delivery, GameState, ShipState, ShipTypeDef, VoyageEvent, VoyageReport } from './types';
import { getWorld, type Route, type World } from './world';

export const RULES = {
  startCash: 150_000,
  startPort: 'rotterdam',
  startFuel: 120,
  startCondition: 72,
  startAge: 24,
  /** Net-worth milestones (cash + fleet value − loan). */
  milestones: [1_000_000, 5_000_000, 25_000_000, 100_000_000],
  /** Days spent in port for cargo handling on each arrival. */
  portDays: 1,
  wearPerDay: 0.3,
  stormChancePerDay: 0.02,
  breakdownBase: 0.001,
  breakdownPerMissingPoint: 0.0003,
  emergencyFuelMarkup: 2.5,
  /** Repairs take one day per this many condition points. */
  repairPointsPerDay: 10,
  fuelDrift: { reversion: 0.97, volatility: 0.012, limit: 0.3 },
  logLimit: 200,
  /** The bank lets you go this far below zero before seizing your fleet. */
  overdraftLimit: 50_000,
  /** Daily interest on a negative balance (about 18% a year). */
  overdraftDailyRate: 0.0005,
  /** Chance per port per day that its ship market turns over. */
  marketTurnover: 1 / 20,
  /** A newly bought ship comes with this share of its bunkers filled. */
  newShipFuel: 0.1,
  maxReports: 20,
};

export class ActionError extends Error {}

const clone = (g: GameState): GameState => structuredClone(g);

// ---------------------------------------------------------------- lookups

export function getShip(g: GameState, shipId: number): ShipState {
  const ship = g.fleet.find((s) => s.id === shipId);
  if (!ship) throw new ActionError('No such ship in your fleet.');
  return ship;
}

export function typeOf(ship: Pick<ShipState, 'typeId'>, world: World = getWorld()): ShipTypeDef {
  return world.shipTypes[ship.typeId];
}

export function atSea(ship: ShipState): boolean {
  return ship.voyage !== undefined;
}

export function inDryDock(g: GameState, ship: ShipState): boolean {
  return ship.busyUntil !== undefined && ship.busyUntil > g.day;
}

/** In port and free to take orders. */
export function isReady(g: GameState, ship: ShipState): boolean {
  return !atSea(ship) && !inDryDock(g, ship);
}

/** Where a ship is right now, for display: 0..1 progress along its route while at sea. */
export function voyageProgress(g: GameState, ship: ShipState): number {
  const v = ship.voyage;
  if (!v) return 1;
  return Math.max(0, Math.min(1, (g.day - v.departDay) / Math.max(0.01, v.seaArrivalDay - v.departDay)));
}

export function fuelPrice(g: GameState, portId: string, world: World = getWorld()): number {
  return Math.round(world.ports[portId].fuelPrice * g.oil.index * (1 + g.ports[portId].fuelDev));
}

export function portFee(g: GameState, ship: Pick<ShipState, 'typeId'>, portId: string, world: World = getWorld()): number {
  const strike = strikeAt(g, portId) ? ECONOMY.strike.feeMultiplier : 1;
  return Math.round(world.ports[portId].portFee * typeOf(ship, world).sizeFactor * strike);
}

export function cargoTons(ship: ShipState): number {
  return ship.cargo.reduce((s, c) => s + c.tons, 0);
}

export function dailyUpkeep(g: GameState, world: World = getWorld()): number {
  return g.fleet.reduce((s, ship) => s + typeOf(ship, world).dailyCost, 0);
}

function log(g: GameState, text: string, amount?: number): void {
  g.log.unshift({ day: g.day, text, amount });
  if (g.log.length > RULES.logLimit) g.log.length = RULES.logLimit;
}

// ---------------------------------------------------------------- money

/** Cash available to spend: cash, unused loan credit, and the overdraft. */
export function spendable(g: GameState, world: World = getWorld()): number {
  return g.cash + Math.max(0, maxLoan(g, world) - g.loan) + RULES.overdraftLimit;
}

/**
 * When cash goes negative, the bank first covers the shortfall from the fleet
 * loan (cheaper than the overdraft), as far as the loan limit allows.
 */
function coverShortfall(g: GameState, world: World): void {
  if (g.cash >= 0) return;
  const room = maxLoan(g, world) - g.loan;
  const draw = Math.min(room, Math.ceil(-g.cash / 1000) * 1000);
  if (draw <= 0) return;
  g.loan += draw;
  g.cash += draw;
  log(g, `The bank covered your shortfall: your loan grew by $${draw.toLocaleString('en-US')}.`);
}

/** True when a ship in port can't reach any other port, even after buying all the fuel it can afford. */
export function isStranded(g: GameState, shipId: number, world: World = getWorld()): boolean {
  const ship = getShip(g, shipId);
  if (!isReady(g, ship)) return false;
  const type = typeOf(ship, world);
  const price = fuelPrice(g, ship.location, world);
  const maxFuel = Math.min(type.bunkerCapacity, ship.fuel + Math.max(0, Math.floor(spendable(g, world) / price)));
  return !world.portList.some((p) => {
    const plan = planVoyage(g, shipId, p.id, world);
    return plan !== null && plan.fuelNeeded <= maxFuel;
  });
}

function checkEnd(g: GameState, world: World): void {
  coverShortfall(g, world);
  if (!g.gameOver && g.cash < -RULES.overdraftLimit) {
    g.gameOver = 'Bankrupt: your loan and overdraft are used up, and the bank has seized your fleet.';
    log(g, g.gameOver);
  } else if (!g.gameOver && g.fleet.every((s) => isReady(g, s) && isStranded(g, s.id, world))) {
    g.gameOver = g.fleet.length > 1
      ? 'Stranded: none of your ships has the fuel or credit to reach another port.'
      : 'Stranded: there is not enough fuel or credit left to reach any port.';
    log(g, g.gameOver);
  }
  const worth = netWorth(g, world);
  for (const m of RULES.milestones) {
    if (worth >= m && !g.milestones.some((x) => x.amount === m)) {
      g.milestones.push({ amount: m, day: g.day });
      log(g, `Milestone: your company is worth $${m.toLocaleString('en-US')}!`);
    }
  }
}

/** The next net-worth milestone not yet reached, if any. */
export function nextMilestone(g: GameState): number | null {
  return RULES.milestones.find((m) => !g.milestones.some((x) => x.amount === m)) ?? null;
}

// ---------------------------------------------------------------- the world clock

/**
 * Move time forward `days` (fractional) without processing arrivals: daily
 * upkeep, interest, fuel drift, the economy, board churn and market turnover
 * at each day boundary, and the fleet ages.
 */
function runClock(world: World, g: GameState, days: number): void {
  if (days <= 0) return;
  const end = g.day + days;
  const { reversion, volatility, limit } = RULES.fuelDrift;
  for (let d = Math.floor(g.day) + 1; d <= end; d++) {
    const upkeep = dailyUpkeep(g, world);
    let interest = 0;
    if (g.cash < 0) interest += Math.round(-g.cash * RULES.overdraftDailyRate);
    if (g.loan > 0) interest += Math.round(g.loan * SHIP_TUNING.loanDailyRate);
    g.cash -= upkeep + interest;
    g.stats.interestPaid += interest;
    g.stats.upkeepPaid += upkeep;
    for (const p of world.portList) {
      const ps = g.ports[p.id];
      ps.fuelDev = Math.max(-limit, Math.min(limit, ps.fuelDev * reversion + randNormal(g) * volatility));
      churnBoard(world, g, p.id);
      if (rand(g) < RULES.marketTurnover) regenerateMarket(world, g, p.id);
    }
    economyDay(world, g, d);
    for (const ship of g.fleet) {
      if (ship.busyUntil !== undefined && ship.busyUntil <= d) delete ship.busyUntil;
    }
  }
  g.day = end;
  for (const ship of g.fleet) ship.age += days / 365;
}

/** Ships due to arrive by `until`, earliest first. */
function nextArrival(g: GameState, until: number): ShipState | undefined {
  return g.fleet
    .filter((s) => s.voyage && s.voyage.arriveDay <= until)
    .sort((a, b) => a.voyage!.arriveDay - b.voyage!.arriveDay)[0];
}

/**
 * Advance the world clock by `days`. Ships whose arrival day comes are
 * unloaded and paid, in order, and their reports queued in `reports`.
 */
export function advance(state: GameState, days: number, world: World = getWorld()): GameState {
  if (state.gameOver || days <= 0) return state;
  const g = clone(state);
  const target = g.day + days;
  for (let guard = 0; guard < 1000; guard++) {
    const ship = nextArrival(g, target);
    if (!ship) break;
    runClock(world, g, ship.voyage!.arriveDay - g.day);
    arrive(world, g, ship);
  }
  runClock(world, g, target - g.day);
  checkEnd(g, world);
  return g;
}

/** Days until the next ship is ready (arrival or end of dry dock), or null if none is busy. */
export function daysUntilNextShip(g: GameState): number | null {
  const times = g.fleet.flatMap((s) => [s.voyage?.arriveDay, s.busyUntil]
    .filter((t): t is number => t !== undefined && t > g.day - 1e-9 && (t !== s.busyUntil || t > g.day)));
  return times.length ? Math.max(0, Math.min(...times) - g.day) : null;
}

// ---------------------------------------------------------------- new game

export function newGame(seed: number = Date.now() % 2 ** 31, world: World = getWorld()): GameState {
  const g: GameState = {
    version: 4,
    rng: seed | 0,
    day: 0,
    cash: RULES.startCash,
    loan: 0,
    fleet: [],
    ports: {},
    nextId: 1,
    log: [],
    stats: { voyages: 0, revenue: 0, fuelSpent: 0, delivered: 0, interestPaid: 0, upkeepPaid: 0, shipsOwned: 1 },
    milestones: [],
    oil: newOilMarket(),
    events: [],
    reports: [],
  };
  g.fleet.push({
    id: g.nextId++,
    name: 'Tilly',
    typeId: 'coaster',
    location: RULES.startPort,
    fuel: RULES.startFuel,
    condition: RULES.startCondition,
    age: RULES.startAge,
    cargo: [],
  });
  for (const p of world.portList) {
    g.ports[p.id] = { fuelDev: randRange(g, -0.12, 0.12), board: [], market: [], prices: {} };
  }
  for (const p of world.portList) {
    regenerateBoard(world, g, p.id);
    regenerateMarket(world, g, p.id);
  }
  log(g, `You take command of the ${g.fleet[0].name}, a tired old coaster, in ${world.ports[RULES.startPort].name}.`);
  return g;
}

// ---------------------------------------------------------------- port actions (one ship)

function readyShip(g: GameState, shipId: number): ShipState {
  const ship = getShip(g, shipId);
  if (atSea(ship)) throw new ActionError(`The ${ship.name} is at sea.`);
  if (inDryDock(g, ship)) throw new ActionError(`The ${ship.name} is in dry dock.`);
  return ship;
}

export function canCarry(ship: ShipState, c: Contract, world: World = getWorld()): string | null {
  const type = typeOf(ship, world);
  const good = world.goods[c.good];
  if (!type.cargoClasses.includes(good.cargoClass)) return `${type.name} can't carry ${good.cargoClass} cargo`;
  if (c.tons > type.capacity) return `Needs a ship of ${c.tons.toLocaleString('en-US')} t`;
  if (cargoTons(ship) + c.tons > type.capacity) return 'Not enough free hold space';
  return null;
}

export function acceptContract(state: GameState, shipId: number, contractId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const ship = readyShip(g, shipId);
  const board = g.ports[ship.location].board;
  const idx = board.findIndex((c) => c.id === contractId);
  if (idx < 0) throw new ActionError('That contract is no longer available.');
  const why = canCarry(ship, board[idx], world);
  if (why) throw new ActionError(why);
  const [c] = board.splice(idx, 1);
  ship.cargo.push(c);
  log(g, `${ship.name}: loaded ${c.tons.toLocaleString('en-US')} t ${world.goods[c.good].name} for ${world.ports[c.dest].name}.`);
  return g;
}

/** Hand a contract back while still in its port of origin (no penalty). */
export function unloadContract(state: GameState, shipId: number, contractId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const ship = readyShip(g, shipId);
  const idx = ship.cargo.findIndex((c) => c.id === contractId);
  if (idx < 0) throw new ActionError('No such cargo aboard.');
  const c = ship.cargo[idx];
  if (c.origin !== ship.location) throw new ActionError('Cargo can only be handed back in its port of origin.');
  ship.cargo.splice(idx, 1);
  g.ports[ship.location].board.push(c);
  log(g, `${ship.name}: unloaded ${world.goods[c.good].name} back onto the quay.`);
  return g;
}

export function buyFuel(state: GameState, shipId: number, tons: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const ship = readyShip(g, shipId);
  const type = typeOf(ship, world);
  const price = fuelPrice(g, ship.location, world);
  const space = type.bunkerCapacity - ship.fuel;
  const affordable = Math.floor(Math.max(0, spendable(g, world)) / price);
  const amount = Math.floor(Math.min(tons, space, affordable));
  if (amount <= 0) throw new ActionError(space <= 0 ? 'Bunkers are full.' : 'Not enough cash or credit for fuel.');
  const cost = amount * price;
  ship.fuel += amount;
  g.cash -= cost;
  g.stats.fuelSpent += cost;
  log(g, `${ship.name}: bunkered ${amount} t of fuel at $${price}/t${g.cash < 0 ? ' (on credit)' : ''}.`, -cost);
  coverShortfall(g, world);
  return g;
}

export function repairQuote(ship: ShipState, points: number, world: World = getWorld()) {
  const pts = Math.max(0, Math.min(Math.round(points), 100 - Math.floor(ship.condition)));
  return {
    points: pts,
    cost: pts * typeOf(ship, world).repairCostPerPoint,
    days: Math.ceil(pts / RULES.repairPointsPerDay),
  };
}

/** Put a ship in dry dock: paid now, and it can't sail until the work is done. */
export function repair(state: GameState, shipId: number, points: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const ship = readyShip(g, shipId);
  const q = repairQuote(ship, points, world);
  if (q.points <= 0) throw new ActionError('Nothing to repair.');
  if (q.cost > spendable(g, world)) throw new ActionError('Not enough cash or credit for that repair.');
  g.cash -= q.cost;
  ship.condition = Math.min(100, Math.floor(ship.condition) + q.points);
  ship.busyUntil = g.day + q.days;
  log(g, `${ship.name}: into dry dock for +${q.points}% condition, ready in ${q.days} day(s).`, -q.cost);
  checkEnd(g, world);
  return g;
}

// ---------------------------------------------------------------- voyages

export interface VoyagePlan {
  dest: string;
  route: Route;
  seaDays: number;
  fuelNeeded: number;
  fuelShort: number;
  /** False when the leg needs more fuel than the bunkers can hold. */
  inRange: boolean;
  upkeep: number;
  portFee: number;
  canalFees: number;
  deliveries: { contract: Contract; pay: number; late: boolean }[];
  revenue: number;
  /** Revenue minus upkeep, fees and fuel burned (valued at the current local price). */
  estimatedNet: number;
  /** A dock strike at the destination right now (slow, expensive call). */
  strike: boolean;
  /** Days lost to a strike on arrival. */
  strikeDays: number;
}

export function planVoyage(g: GameState, shipId: number, dest: string, world: World = getWorld()): VoyagePlan | null {
  const ship = getShip(g, shipId);
  if (dest === ship.location) return null;
  const route = routeFor(world, g, ship.location, dest);
  if (!route) return null;
  const type = typeOf(ship, world);
  const strike = strikeAt(g, dest) !== undefined;
  const strikeDays = strike ? ECONOMY.strike.extraDays : 0;
  const seaDays = route.nm / (effectiveSpeed(type, ship) * 24);
  const fuelNeeded = Math.ceil(seaDays * type.fuelPerDay * consumptionFactor(ship));
  const arrive = g.day + seaDays;
  const deliveries = ship.cargo
    .filter((c) => c.dest === dest)
    .map((c) => {
      const f = latePayFactor(arrive - c.deadline);
      return { contract: c, pay: Math.round(c.pay * f), late: f < 1 };
    });
  const revenue = deliveries.reduce((s, d) => s + d.pay, 0);
  const upkeep = Math.round((seaDays + RULES.portDays + strikeDays) * type.dailyCost);
  const fee = portFee(g, ship, dest, world);
  const canalFees = route.canals.reduce((s, c) => s + Math.round(world.canals[c].fee * type.sizeFactor), 0);
  const fuelCost = fuelNeeded * fuelPrice(g, ship.location, world);
  return {
    dest,
    route,
    seaDays,
    fuelNeeded,
    fuelShort: Math.max(0, fuelNeeded - ship.fuel),
    inRange: fuelNeeded <= type.bunkerCapacity,
    upkeep,
    portFee: fee,
    canalFees,
    deliveries,
    revenue,
    estimatedNet: revenue - upkeep - fee - canalFees - fuelCost,
    strike,
    strikeDays,
  };
}

function breakdownChance(ship: Pick<ShipState, 'condition' | 'age'>): number {
  return (RULES.breakdownBase + RULES.breakdownPerMissingPoint * (100 - ship.condition)) * breakdownAgeFactor(ship);
}

/** Work out a voyage's course up front: storms, breakdowns, fuel, wear and timing. */
function plotVoyage(world: World, g: GameState, ship: ShipState, dest: string, route: Route, canalFees: number): ActiveVoyage {
  const type = typeOf(ship, world);
  const speed = effectiveSpeed(type, ship);
  const departDay = g.day;
  const events: VoyageEvent[] = [];
  let remaining = route.nm;
  let t = 0;
  let fuel = ship.fuel;
  let condition = ship.condition;
  let fuelUsed = 0;
  let eventCosts = 0;
  const event = (kind: VoyageEvent['kind'], text: string, delayDays: number, cost: number) =>
    events.push({ day: Math.floor(t) + 1, atDay: departDay + t, kind, text, delayDays, cost });

  while (remaining > 0.01) {
    const storm = rand(g) < RULES.stormChancePerDay;
    if (rand(g) < breakdownChance({ condition, age: ship.age })) {
      const delay = Math.round(randRange(g, 0.5, 2) * 10) / 10;
      const cost = Math.round(randRange(g, 4000, 12000) * type.sizeFactor / 100) * 100;
      event('breakdown', `Engine breakdown. Drifted ${delay} days while the crew made repairs.`, delay, cost);
      eventCosts += cost;
      const idleFuel = delay * type.fuelPerDay * 0.25;
      fuel = Math.max(0, fuel - idleFuel);
      fuelUsed += idleFuel;
      condition = Math.max(0, condition - randRange(g, 1, 3));
      t += delay;
    }
    const speedFactor = storm ? randRange(g, 0.45, 0.7) : 1;
    const dayDistance = speed * 24 * speedFactor;
    const frac = Math.min(1, remaining / dayDistance);
    const burn = type.fuelPerDay * (storm ? 1.25 : 1) * consumptionFactor({ condition, age: ship.age }) * frac;
    if (storm) {
      const damage = randRange(g, 1, 3);
      condition = Math.max(0, condition - damage);
      event('storm', `Heavy weather. Slow going, extra fuel burned, ${damage.toFixed(0)}% hull wear.`, 0, 0);
    }
    if (fuel < burn) {
      // Ran dry: call a bunker tender at a steep markup.
      const remainingDays = remaining / (speed * 24);
      const tons = Math.ceil(remainingDays * type.fuelPerDay * consumptionFactor({ condition, age: ship.age }) * 1.15 + burn);
      const price = Math.round(fuelPrice(g, dest, world) * RULES.emergencyFuelMarkup);
      const cost = tons * price;
      const delay = 1.5;
      event('emergencyFuel', `Out of fuel! A bunker tender brought ${tons} t at $${price}/t after ${delay} days adrift.`, delay, cost);
      eventCosts += cost;
      fuel += tons;
      t += delay;
    }
    fuel -= burn;
    fuelUsed += burn;
    remaining -= dayDistance * frac;
    condition = Math.max(0, condition - RULES.wearPerDay * frac);
    t += frac;
  }
  return {
    from: ship.location, to: dest, path: route.path, distance: route.nm,
    departDay, seaArrivalDay: departDay + t, arriveDay: departDay + t + RULES.portDays,
    events, startFuel: ship.fuel, fuelAtArrival: Math.max(0, Math.round(fuel * 10) / 10),
    fuelUsed: Math.round(fuelUsed * 10) / 10, startCondition: ship.condition,
    conditionAtArrival: Math.round(condition * 10) / 10, eventCosts, canalFees,
  };
}

/** Cast off for `dest`. The voyage then plays out as the world clock runs. */
export function sail(state: GameState, shipId: number, dest: string, world: World = getWorld()): GameState {
  if (state.gameOver) throw new ActionError(state.gameOver);
  const plan = planVoyage(state, shipId, dest, world);
  if (!plan) throw new ActionError('No route to that port.');
  const before = getShip(state, shipId);
  if (!isReady(state, before)) throw new ActionError(atSea(before) ? `The ${before.name} is at sea.` : `The ${before.name} is in dry dock.`);
  if (plan.fuelNeeded > typeOf(before, world).bunkerCapacity) {
    throw new ActionError('Beyond this ship\'s range: plan a refuelling stop on the way.');
  }
  if (before.fuel < plan.fuelNeeded) {
    throw new ActionError(`Not enough fuel: this leg needs about ${plan.fuelNeeded} t.`);
  }
  const g = clone(state);
  const ship = getShip(g, shipId);
  ship.voyage = plotVoyage(world, g, ship, dest, plan.route, plan.canalFees);
  log(g, `${ship.name} cast off from ${world.ports[ship.location].name} for ${world.ports[dest].name}.`);
  return g;
}

/** A ship's arrival day has come: strike delays, deliveries, pay, market reaction, report. */
function arrive(world: World, g: GameState, ship: ShipState): void {
  const v = ship.voyage!;
  const dest = v.to;
  const portName = world.ports[dest].name;
  if (!v.strikeApplied && strikeAt(g, dest)) {
    const extra = ECONOMY.strike.extraDays;
    v.events.push({ day: Math.floor(g.day - v.departDay) + 1, atDay: g.day, kind: 'strike', delayDays: extra, cost: 0,
      text: `Dock strike in ${portName}: ${extra} extra days to get unloaded, and double port fees.` });
    v.strikeApplied = true;
    v.arriveDay += extra;
    return; // the clock comes back to this ship when the delay is over
  }
  const type = typeOf(ship, world);
  ship.location = dest;
  ship.fuel = v.fuelAtArrival;
  ship.condition = v.conditionAtArrival;

  const deliveries: Delivery[] = [];
  ship.cargo = ship.cargo.filter((c) => {
    if (c.dest !== dest) return true;
    const lateDays = v.seaArrivalDay - c.deadline;
    deliveries.push({ contract: c, paid: Math.round(c.pay * latePayFactor(lateDays)), lateDays: Math.max(0, lateDays) });
    return false;
  });
  const revenue = deliveries.reduce((s, d) => s + d.paid, 0);
  // Each delivery saturates the buyer's market for that good.
  const marketNotes: string[] = [];
  const delivered = new Map<string, number>();
  for (const d of deliveries) delivered.set(d.contract.good, (delivered.get(d.contract.good) ?? 0) + d.contract.tons);
  for (const [good, tons] of delivered) {
    const drop = recordDelivery(world, g, dest, good, tons);
    if (drop >= 0.03) marketNotes.push(`${portName} now pays ${Math.round(drop * 100)}% less for ${world.goods[good].name.toLowerCase()}.`);
  }
  const news = g.events.filter((e) => e.startDay > v.departDay && e.startDay <= g.day).map((e) => e.headline);
  const upkeep = Math.round((v.arriveDay - v.departDay) * type.dailyCost); // already paid day by day
  const fee = portFee(g, ship, dest, world);
  g.cash += revenue - fee - v.canalFees - v.eventCosts;
  g.stats.voyages++;
  g.stats.revenue += revenue;
  g.stats.fuelSpent += v.events.filter((e) => e.kind === 'emergencyFuel').reduce((s, e) => s + e.cost, 0);
  g.stats.delivered += deliveries.reduce((s, d) => s + d.contract.tons, 0);

  const report: VoyageReport = {
    shipId: ship.id, shipName: ship.name,
    from: v.from, to: dest, path: v.path, distance: v.distance,
    departDay: v.departDay, arriveDay: v.arriveDay, fuelUsed: v.fuelUsed,
    conditionLoss: Math.round((v.startCondition - ship.condition) * 10) / 10,
    events: v.events, deliveries, revenue, upkeep, portFee: fee, canalFees: v.canalFees, eventCosts: v.eventCosts,
    net: revenue - upkeep - fee - v.canalFees - v.eventCosts,
    marketNotes, news,
  };
  g.reports.push(report);
  if (g.reports.length > RULES.maxReports) g.reports.shift();
  delete ship.voyage;

  // Fresh offers on the quay, unless another of our ships is already working this port.
  if (!g.fleet.some((s) => s !== ship && s.location === dest && !atSea(s))) regenerateBoard(world, g, dest);

  for (const e of v.events) log(g, `${ship.name}: ${e.text}`, e.cost ? -e.cost : undefined);
  for (const d of deliveries) {
    const late = d.lateDays > 0 ? ` (${Math.ceil(d.lateDays)} day(s) late)` : '';
    log(g, `${ship.name} delivered ${world.goods[d.contract.good].name} to ${portName}${late}.`, d.paid);
  }
  for (const note of marketNotes) log(g, note);
  log(g, `${ship.name} arrived in ${portName} after ${(v.arriveDay - v.departDay).toFixed(1)} days. Result for the leg: ${
    report.net >= 0 ? '+' : '-'}$${Math.abs(report.net).toLocaleString('en-US')}.`);
}

/** Remove and return the oldest unseen arrival report. */
export function takeReport(state: GameState): { state: GameState; report: VoyageReport | null } {
  if (!state.reports.length) return { state, report: null };
  const g = clone(state);
  const report = g.reports.shift()!;
  return { state: g, report };
}

// ---------------------------------------------------------------- bank & shipyard

export function borrow(state: GameState, amount: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const room = maxLoan(g, world) - g.loan;
  const amt = Math.floor(Math.min(amount, room) / 1000) * 1000;
  if (amt <= 0) throw new ActionError('The bank won\'t lend more against your fleet.');
  g.loan += amt;
  g.cash += amt;
  log(g, `Borrowed $${amt.toLocaleString('en-US')} from the bank.`, amt);
  return g;
}

export function repayLoan(state: GameState, amount: number): GameState {
  const g = clone(state);
  const amt = Math.floor(Math.min(amount, g.loan, Math.max(0, g.cash)));
  if (amt <= 0) throw new ActionError(g.loan <= 0 ? 'You have no loan.' : 'Not enough cash to repay.');
  g.loan -= amt;
  g.cash -= amt;
  log(g, `Repaid $${amt.toLocaleString('en-US')} of the loan.`, -amt);
  return g;
}

/** Buy a ship from any port's market. It joins the fleet in that port. */
export function buyShip(state: GameState, portId: string, offerId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const market = g.ports[portId].market;
  const idx = market.findIndex((o) => o.id === offerId);
  if (idx < 0) throw new ActionError('That ship has already been sold.');
  const q = quotePurchase(g, market[idx], world);
  if (q.blocked) throw new ActionError(q.blocked);
  const [offer] = market.splice(idx, 1);
  g.cash -= q.fromCash;
  g.loan = q.loanAfter;
  const taken = g.fleet.map((s) => s.name);
  const name = taken.includes(offer.name) ? shipName(g, taken) : offer.name;
  g.fleet.push({
    id: g.nextId++, name, typeId: offer.typeId, location: portId,
    fuel: Math.round(q.type.bunkerCapacity * RULES.newShipFuel), condition: offer.condition, age: offer.age, cargo: [],
  });
  g.stats.shipsOwned++;
  log(g, `Bought the ${q.type.name} ${name} (${offer.age === 0 ? 'new' : `${offer.age} years old`}) in ${world.ports[portId].name} for $${
    offer.price.toLocaleString('en-US')}${q.borrow > 0 ? `, borrowing $${q.borrow.toLocaleString('en-US')}` : ''}.`, -offer.price);
  checkEnd(g, world);
  return g;
}

export function saleQuote(g: GameState, shipId: number, world: World = getWorld()) {
  const ship = getShip(g, shipId);
  const price = saleValue(ship, world);
  const fuelRefund = Math.round(ship.fuel * fuelPrice(g, ship.location, world) * 0.8);
  const others = g.fleet.filter((s) => s.id !== shipId);
  const limitAfter = Math.round(others.reduce((s, x) => s + saleValue(x, world) / SHIP_TUNING.saleShare, 0) * SHIP_TUNING.loanToValue / 1000) * 1000;
  const repay = Math.max(0, g.loan - limitAfter);
  let blocked: string | null = null;
  if (g.fleet.length <= 1) blocked = 'You can\'t sell your last ship.';
  else if (!isReady(g, ship)) blocked = atSea(ship) ? 'The ship is at sea.' : 'The ship is in dry dock.';
  else if (ship.cargo.length) blocked = 'Deliver or unload its cargo first.';
  return { price, fuelRefund, repay, blocked };
}

/** Sell a ship to a broker. If the loan is then bigger than the bank allows, the excess is repaid from the proceeds. */
export function sellShip(state: GameState, shipId: number, world: World = getWorld()): GameState {
  const q = saleQuote(state, shipId, world);
  if (q.blocked) throw new ActionError(q.blocked);
  const g = clone(state);
  const ship = getShip(g, shipId);
  g.fleet = g.fleet.filter((s) => s.id !== shipId);
  g.cash += q.price + q.fuelRefund - q.repay;
  g.loan -= q.repay;
  log(g, `Sold the ${typeOf(ship, world).name} ${ship.name} for $${q.price.toLocaleString('en-US')}${
    q.repay ? `, repaying $${q.repay.toLocaleString('en-US')} of the loan` : ''}.`, q.price);
  checkEnd(g, world);
  return g;
}
