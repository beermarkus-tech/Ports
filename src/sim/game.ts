// Game rules: player actions and voyage resolution.
// Every action takes a state and returns a *new* state (the input is never
// mutated), so the UI can keep history, and tests can replay deterministically.

import { churnBoard, latePayFactor, regenerateBoard } from './contracts';
import { rand, randNormal, randRange } from './rng';
import {
  SHIP_TUNING, breakdownAgeFactor, consumptionFactor, effectiveSpeed, maxLoan, netWorth, quotePurchase,
  regenerateMarket, saleValue,
} from './ships';
import type { Contract, Delivery, GameState, ShipTypeDef, VoyageEvent, VoyageReport } from './types';
import { getWorld, type Route, type World } from './world';

export const RULES = {
  startCash: 150_000,
  startPort: 'rotterdam',
  startFuel: 120,
  startCondition: 72,
  startAge: 24,
  /** Net-worth milestones (cash + ship value − loan). */
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
  /** The bank lets you go this far below zero before seizing the ship. */
  overdraftLimit: 50_000,
  /** Daily interest on a negative balance (about 18% a year). */
  overdraftDailyRate: 0.0005,
};

export class ActionError extends Error {}

const clone = (g: GameState): GameState => structuredClone(g);

export function shipType(g: GameState, world: World = getWorld()): ShipTypeDef {
  return world.shipTypes[g.ship.typeId];
}

export function fuelPrice(g: GameState, portId: string, world: World = getWorld()): number {
  return Math.round(world.ports[portId].fuelPrice * (1 + g.ports[portId].fuelDev));
}

export function portFee(g: GameState, portId: string, world: World = getWorld()): number {
  return Math.round(world.ports[portId].portFee * shipType(g, world).sizeFactor);
}

export function cargoTons(g: GameState): number {
  return g.ship.cargo.reduce((s, c) => s + c.tons, 0);
}

function log(g: GameState, text: string, amount?: number): void {
  g.log.unshift({ day: g.day, text, amount });
  if (g.log.length > RULES.logLimit) g.log.length = RULES.logLimit;
}

/** Cash available to spend, including the bank overdraft. */
export function spendable(g: GameState): number {
  return g.cash + RULES.overdraftLimit;
}

/** True when the ship can't reach any port, even after buying all the fuel it can afford. */
export function isStranded(g: GameState, world: World = getWorld()): boolean {
  const type = shipType(g, world);
  const price = fuelPrice(g, g.ship.location, world);
  const maxFuel = Math.min(type.bunkerCapacity, g.ship.fuel + Math.max(0, Math.floor(spendable(g) / price)));
  return !world.portList.some((p) => {
    const plan = planVoyage(g, p.id, world);
    return plan !== null && plan.fuelNeeded <= maxFuel;
  });
}

function checkEnd(g: GameState, world: World): void {
  if (!g.gameOver && g.cash < -RULES.overdraftLimit) {
    g.gameOver = 'Bankrupt: you went past your overdraft and the bank has seized your ship.';
    log(g, g.gameOver);
  } else if (!g.gameOver && isStranded(g, world)) {
    g.gameOver = 'Stranded: there is not enough fuel or credit left to reach any port.';
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

/**
 * Advance the world clock by `days`, applying daily price drift, loan and
 * overdraft interest at each day boundary, and ageing the ship. Returns the
 * interest charged.
 */
function advanceClock(world: World, g: GameState, days: number): number {
  const end = g.day + days;
  const { reversion, volatility, limit } = RULES.fuelDrift;
  let interest = 0;
  for (let d = Math.floor(g.day) + 1; d <= end; d++) {
    let i = 0;
    if (g.cash < 0) i += Math.round(-g.cash * RULES.overdraftDailyRate);
    if (g.loan > 0) i += Math.round(g.loan * SHIP_TUNING.loanDailyRate);
    g.cash -= i;
    interest += i;
    for (const p of world.portList) {
      const ps = g.ports[p.id];
      ps.fuelDev = Math.max(-limit, Math.min(limit, ps.fuelDev * reversion + randNormal(g) * volatility));
    }
  }
  g.day = end;
  g.ship.age += days / 365;
  g.stats.interestPaid += interest;
  return interest;
}

export function newGame(seed: number = Date.now() % 2 ** 31, world: World = getWorld()): GameState {
  const g: GameState = {
    version: 2,
    rng: seed | 0,
    day: 0,
    cash: RULES.startCash,
    loan: 0,
    ship: {
      name: 'Tilly',
      typeId: 'coaster',
      location: RULES.startPort,
      fuel: RULES.startFuel,
      condition: RULES.startCondition,
      age: RULES.startAge,
      cargo: [],
    },
    ports: {},
    nextId: 1,
    log: [],
    stats: { voyages: 0, revenue: 0, fuelSpent: 0, delivered: 0, interestPaid: 0, shipsOwned: 1 },
    milestones: [],
  };
  for (const p of world.portList) {
    g.ports[p.id] = { fuelDev: randRange(g, -0.12, 0.12), board: [], market: [] };
  }
  for (const p of world.portList) {
    regenerateBoard(world, g, p.id);
    regenerateMarket(world, g, p.id);
  }
  log(g, `You take command of the ${g.ship.name}, a tired old coaster, in ${world.ports[RULES.startPort].name}.`);
  return g;
}

// ---------------------------------------------------------------- port actions

export function canCarry(g: GameState, c: Contract, world: World = getWorld()): string | null {
  const type = shipType(g, world);
  const good = world.goods[c.good];
  if (!type.cargoClasses.includes(good.cargoClass)) return `${type.name} can't carry ${good.cargoClass} cargo`;
  if (c.tons > type.capacity) return `Needs a ship of ${c.tons.toLocaleString('en-US')} t`;
  if (cargoTons(g) + c.tons > type.capacity) return 'Not enough free hold space';
  return null;
}

export function acceptContract(state: GameState, contractId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const board = g.ports[g.ship.location].board;
  const idx = board.findIndex((c) => c.id === contractId);
  if (idx < 0) throw new ActionError('That contract is no longer available.');
  const why = canCarry(g, board[idx], world);
  if (why) throw new ActionError(why);
  const [c] = board.splice(idx, 1);
  g.ship.cargo.push(c);
  log(g, `Loaded ${c.tons.toLocaleString('en-US')} t ${world.goods[c.good].name} for ${world.ports[c.dest].name}.`);
  return g;
}

/** Hand a contract back while still in its port of origin (no penalty). */
export function unloadContract(state: GameState, contractId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const idx = g.ship.cargo.findIndex((c) => c.id === contractId);
  if (idx < 0) throw new ActionError('No such cargo aboard.');
  const c = g.ship.cargo[idx];
  if (c.origin !== g.ship.location) throw new ActionError('Cargo can only be handed back in its port of origin.');
  g.ship.cargo.splice(idx, 1);
  g.ports[g.ship.location].board.push(c);
  log(g, `Unloaded ${world.goods[c.good].name} back onto the quay.`);
  return g;
}

export function buyFuel(state: GameState, tons: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const type = shipType(g, world);
  const price = fuelPrice(g, g.ship.location, world);
  const space = type.bunkerCapacity - g.ship.fuel;
  const affordable = Math.floor(Math.max(0, spendable(g)) / price);
  const amount = Math.floor(Math.min(tons, space, affordable));
  if (amount <= 0) throw new ActionError(space <= 0 ? 'Bunkers are full.' : 'Not enough cash or credit for fuel.');
  const cost = amount * price;
  g.ship.fuel += amount;
  g.cash -= cost;
  g.stats.fuelSpent += cost;
  log(g, `Bunkered ${amount} t of fuel at $${price}/t${g.cash < 0 ? ' (on overdraft)' : ''}.`, -cost);
  return g;
}

export function repairQuote(g: GameState, points: number, world: World = getWorld()) {
  const pts = Math.max(0, Math.min(Math.round(points), 100 - Math.floor(g.ship.condition)));
  return {
    points: pts,
    cost: pts * shipType(g, world).repairCostPerPoint,
    days: Math.ceil(pts / RULES.repairPointsPerDay),
  };
}

export function repair(state: GameState, points: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const q = repairQuote(g, points, world);
  if (q.points <= 0) throw new ActionError('Nothing to repair.');
  const upkeep = q.days * shipType(g, world).dailyCost;
  if (q.cost + upkeep > spendable(g)) throw new ActionError('Not enough cash or credit for that repair.');
  g.cash -= q.cost + upkeep;
  g.ship.condition = Math.min(100, Math.floor(g.ship.condition) + q.points);
  const interest = advanceClock(world, g, q.days);
  churnBoard(world, g, g.ship.location);
  log(g, `Dry dock: +${q.points}% condition in ${q.days} day(s).`, -(q.cost + upkeep + interest));
  checkEnd(g, world);
  return g;
}

export function waitDay(state: GameState, world: World = getWorld()): GameState {
  const g = clone(state);
  const cost = shipType(g, world).dailyCost;
  g.cash -= cost;
  const interest = advanceClock(world, g, 1);
  churnBoard(world, g, g.ship.location);
  log(g, 'Waited a day in port for new offers.', -(cost + interest));
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
}

export function planVoyage(g: GameState, dest: string, world: World = getWorld()): VoyagePlan | null {
  if (dest === g.ship.location) return null;
  const route = world.route(g.ship.location, dest);
  if (!route) return null;
  const type = shipType(g, world);
  const seaDays = route.nm / (effectiveSpeed(type, g.ship) * 24);
  const fuelNeeded = Math.ceil(seaDays * type.fuelPerDay * consumptionFactor(g.ship));
  const arrive = g.day + seaDays + RULES.portDays;
  const deliveries = g.ship.cargo
    .filter((c) => c.dest === dest)
    .map((c) => {
      const f = latePayFactor(arrive - RULES.portDays - c.deadline);
      return { contract: c, pay: Math.round(c.pay * f), late: f < 1 };
    });
  const revenue = deliveries.reduce((s, d) => s + d.pay, 0);
  const upkeep = Math.round((seaDays + RULES.portDays) * type.dailyCost);
  const fee = portFee(g, dest, world);
  const canalFees = route.canals.reduce((s, c) => s + Math.round(world.canals[c].fee * type.sizeFactor), 0);
  const fuelCost = fuelNeeded * fuelPrice(g, g.ship.location, world);
  return {
    dest,
    route,
    seaDays,
    fuelNeeded,
    fuelShort: Math.max(0, fuelNeeded - g.ship.fuel),
    inRange: fuelNeeded <= type.bunkerCapacity,
    upkeep,
    portFee: fee,
    canalFees,
    deliveries,
    revenue,
    estimatedNet: revenue - upkeep - fee - canalFees - fuelCost,
  };
}

function breakdownChance(g: GameState): number {
  return (RULES.breakdownBase + RULES.breakdownPerMissingPoint * (100 - g.ship.condition)) * breakdownAgeFactor(g.ship);
}

/**
 * Sail to `dest`. The whole voyage is simulated day by day in one go (the UI
 * animates the result afterwards). Returns the new state; the report is in
 * `lastVoyage`.
 */
export function sail(state: GameState, dest: string, world: World = getWorld()): GameState {
  if (state.gameOver) throw new ActionError(state.gameOver);
  const plan = planVoyage(state, dest, world);
  if (!plan) throw new ActionError('No route to that port.');
  if (plan.fuelNeeded > shipType(state, world).bunkerCapacity) {
    throw new ActionError('Beyond this ship\'s range: plan a refuelling stop on the way.');
  }
  if (state.ship.fuel < plan.fuelNeeded) {
    throw new ActionError(`Not enough fuel: this leg needs about ${plan.fuelNeeded} t.`);
  }
  const g = clone(state);
  const type = shipType(g, world);
  const from = g.ship.location;
  const departDay = g.day;
  const events: VoyageEvent[] = [];
  let remaining = plan.route.nm;
  let fuelUsed = 0;
  let eventCosts = 0;
  let interest = 0;
  const startCondition = g.ship.condition;
  const dayLabel = () => Math.floor(g.day - departDay) + 1;
  const speed = effectiveSpeed(type, g.ship);

  while (remaining > 0.01) {
    const storm = rand(g) < RULES.stormChancePerDay;
    const breakdown = rand(g) < breakdownChance(g);

    if (breakdown) {
      const delay = Math.round(randRange(g, 0.5, 2) * 10) / 10;
      const cost = Math.round(randRange(g, 4000, 12000) * type.sizeFactor / 100) * 100;
      events.push({ day: dayLabel(), kind: 'breakdown', delayDays: delay, cost,
        text: `Engine breakdown. Drifted ${delay} days while the crew made repairs.` });
      eventCosts += cost;
      const idleFuel = delay * type.fuelPerDay * 0.25;
      g.ship.fuel = Math.max(0, g.ship.fuel - idleFuel);
      fuelUsed += idleFuel;
      g.ship.condition = Math.max(0, g.ship.condition - randRange(g, 1, 3));
      interest += advanceClock(world, g, delay);
    }

    const speedFactor = storm ? randRange(g, 0.45, 0.7) : 1;
    const dayDistance = speed * 24 * speedFactor;
    const frac = Math.min(1, remaining / dayDistance);
    const burn = type.fuelPerDay * (storm ? 1.25 : 1) * consumptionFactor(g.ship) * frac;

    if (storm) {
      const damage = randRange(g, 1, 3);
      g.ship.condition = Math.max(0, g.ship.condition - damage);
      events.push({ day: dayLabel(), kind: 'storm', delayDays: 0, cost: 0,
        text: `Heavy weather. Slow going, extra fuel burned, ${damage.toFixed(0)}% hull wear.` });
    }

    if (g.ship.fuel < burn) {
      // Ran dry: call a bunker tender at a steep markup.
      const remainingDays = remaining / (speed * 24);
      const tons = Math.ceil(remainingDays * type.fuelPerDay * consumptionFactor(g.ship) * 1.15 + burn);
      const price = Math.round(fuelPrice(g, dest, world) * RULES.emergencyFuelMarkup);
      const cost = tons * price;
      const delay = 1.5;
      events.push({ day: dayLabel(), kind: 'emergencyFuel', delayDays: delay, cost,
        text: `Out of fuel! A bunker tender brought ${tons} t at $${price}/t after ${delay} days adrift.` });
      eventCosts += cost;
      g.stats.fuelSpent += cost;
      g.ship.fuel += tons;
      interest += advanceClock(world, g, delay);
    }

    g.ship.fuel -= burn;
    fuelUsed += burn;
    remaining -= dayDistance * frac;
    g.ship.condition = Math.max(0, g.ship.condition - RULES.wearPerDay * frac);
    interest += advanceClock(world, g, frac);
  }

  const seaArrival = g.day;
  interest += advanceClock(world, g, RULES.portDays);
  g.ship.fuel = Math.max(0, Math.round(g.ship.fuel * 10) / 10);
  g.ship.condition = Math.round(g.ship.condition * 10) / 10;
  g.ship.location = dest;

  const deliveries: Delivery[] = [];
  g.ship.cargo = g.ship.cargo.filter((c) => {
    if (c.dest !== dest) return true;
    const lateDays = seaArrival - c.deadline;
    deliveries.push({ contract: c, paid: Math.round(c.pay * latePayFactor(lateDays)), lateDays: Math.max(0, lateDays) });
    return false;
  });
  const revenue = deliveries.reduce((s, d) => s + d.paid, 0);
  const upkeep = Math.round((g.day - departDay) * type.dailyCost);
  const fee = portFee(g, dest, world);
  const net = revenue - upkeep - fee - plan.canalFees - eventCosts;
  g.cash += net;

  g.stats.voyages++;
  g.stats.revenue += revenue;
  g.stats.delivered += deliveries.reduce((s, d) => s + d.contract.tons, 0);

  const report: VoyageReport = {
    from, to: dest, path: plan.route.path, distance: plan.route.nm,
    departDay, arriveDay: g.day, fuelUsed: Math.round(fuelUsed * 10) / 10,
    conditionLoss: Math.round((startCondition - g.ship.condition) * 10) / 10,
    events, deliveries, revenue, upkeep, portFee: fee, canalFees: plan.canalFees, eventCosts, interest, net: net - interest,
  };
  g.lastVoyage = report;

  // Every port's board and ship market has moved on while we were at sea.
  for (const p of world.portList) {
    regenerateBoard(world, g, p.id);
    regenerateMarket(world, g, p.id);
  }

  const portName = world.ports[dest].name;
  for (const e of events) log(g, e.text, e.cost ? -e.cost : undefined);
  for (const d of deliveries) {
    const late = d.lateDays > 0 ? ` (${Math.ceil(d.lateDays)} day(s) late)` : '';
    log(g, `Delivered ${world.goods[d.contract.good].name} to ${portName}${late}.`, d.paid);
  }
  log(g, `Arrived in ${portName} after ${(g.day - departDay).toFixed(1)} days. Net for the leg: ${report.net >= 0 ? '+' : '-'}$${Math.abs(report.net).toLocaleString('en-US')}.`);
  checkEnd(g, world);
  return g;
}

// ---------------------------------------------------------------- bank & shipyard

export function borrow(state: GameState, amount: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const room = maxLoan(g, world) - g.loan;
  const amt = Math.floor(Math.min(amount, room) / 1000) * 1000;
  if (amt <= 0) throw new ActionError('The bank won\'t lend more against this ship.');
  g.loan += amt;
  g.cash += amt;
  log(g, `Borrowed $${amt.toLocaleString('en-US')} from the bank.`, amt);
  return g;
}

export function repayLoan(state: GameState, amount: number, world: World = getWorld()): GameState {
  void world;
  const g = clone(state);
  const amt = Math.floor(Math.min(amount, g.loan, Math.max(0, g.cash)));
  if (amt <= 0) throw new ActionError(g.loan <= 0 ? 'You have no loan.' : 'Not enough cash to repay.');
  g.loan -= amt;
  g.cash -= amt;
  log(g, `Repaid $${amt.toLocaleString('en-US')} of the loan.`, -amt);
  return g;
}

/** Swap the current ship for one from this port's market (the old ship is sold to a broker). */
export function buyShip(state: GameState, offerId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const market = g.ports[g.ship.location].market;
  const idx = market.findIndex((o) => o.id === offerId);
  if (idx < 0) throw new ActionError('That ship has already been sold.');
  const q = quotePurchase(g, market[idx], world);
  if (q.blocked) throw new ActionError(q.blocked);
  const oldName = g.ship.name;
  const oldType = shipType(g, world).name;
  const [offer] = market.splice(idx, 1);
  g.cash -= q.fromCash;
  g.loan = q.loanAfter;
  // Bunkers go with the ship; any fuel that doesn't fit is sold back at 80% of the local price.
  const fuel = Math.min(g.ship.fuel, q.type.bunkerCapacity);
  const refund = Math.round((g.ship.fuel - fuel) * fuelPrice(g, g.ship.location, world) * 0.8);
  g.cash += refund;
  g.ship = {
    name: offer.name, typeId: offer.typeId, location: g.ship.location, fuel,
    condition: offer.condition, age: offer.age, cargo: [],
  };
  g.stats.shipsOwned++;
  log(g, `Sold the ${oldType} ${oldName} for $${q.tradeIn.toLocaleString('en-US')}.`, q.tradeIn);
  log(g, `Bought the ${q.type.name} ${offer.name} (${offer.age === 0 ? 'new' : `${offer.age} years old`}) for $${offer.price.toLocaleString('en-US')}${
    q.borrow > 0 ? `, borrowing $${q.borrow.toLocaleString('en-US')}` : ''}.`, -offer.price);
  checkEnd(g, world);
  return g;
}

export { saleValue };
