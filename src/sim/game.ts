// Game rules: player actions, the world clock and voyages.
// Every action takes a state and returns a *new* state (the input is never
// mutated), so the UI can keep history and tests can replay deterministically.
//
// Time runs on a world clock (`advance`). A ship that casts off gets a voyage
// whose course is worked out up front; the clock plays it out, and when the
// ship's arrival day comes it unloads, gets paid, and an arrival report waits
// in `reports` until the player has seen it.

import { CAPTAIN_TUNING, captainSlots, churnCaptainPool, fillCaptainPool } from './captains';
import { bookServiceCargo, churnBoard, latePayFactor, regenerateBoard } from './contracts';
import { areaName, areaPorts, region, regionOf } from './regions';
import { routeWind } from './wind';
import { ECONOMY, economyDay, newOilMarket, recordDelivery, routeFor, strikeAt } from './economy';
import { rand, randNormal, randRange } from './rng';
import {
  SHIP_TUNING, breakdownAgeFactor, consumptionFactor, effectiveSpeed, legTrade, maxLoan, netWorth, quotePurchase,
  regenerateMarket, saleValue, shipName,
} from './ships';
import type {
  ActiveVoyage, Captain, Contract, Delivery, GameState, MonthBook, ShipState, ShipTypeDef, StandingOrders, VoyageEvent, VoyageReport,
} from './types';
import { getWorld, type Route, type World } from './world';

/** The money sign of the era being played. */
const cur = (): string => getWorld().era.currency;

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
  /** Pilot and tugs on arrival, as a share of the port fee (saved by docking yourself). */
  harbourServices: 0.6,
};

export class ActionError extends Error {}

const clone = (g: GameState): GameState => structuredClone(g);

// ---------------------------------------------------------------- books

const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2000, 0, 1);

/** Calendar month of a game day: months since January 2000. */
export function monthOf(day: number): number {
  const d = new Date(START_MS + Math.floor(day) * DAY_MS);
  return (d.getUTCFullYear() - 2000) * 12 + d.getUTCMonth();
}

type BookField = 'revenue' | 'fuel' | 'fees' | 'upkeep' | 'interest' | 'repairs' | 'incidents' | 'wages' | 'shipsBought' | 'shipsSold';

/** This month's page in the books (kept for 20 years). */
function bookFor(g: GameState, world: World, day = g.day): MonthBook {
  g.books ??= [];
  const m = monthOf(day);
  let b = g.books[g.books.length - 1];
  if (!b || b.m !== m) {
    b = { m, revenue: 0, fuel: 0, fees: 0, upkeep: 0, interest: 0, repairs: 0, incidents: 0, wages: 0, shipsBought: 0, shipsSold: 0,
      netWorth: Math.round(netWorth(g, world)), cash: Math.round(g.cash), loan: g.loan };
    g.books.push(b);
    if (g.books.length > 240) g.books.shift();
  }
  return b;
}

function book(g: GameState, world: World, field: BookField, amount: number, day = g.day): void {
  if (!amount) return;
  const b = bookFor(g, world, day);
  b[field] = (b[field] ?? 0) + Math.round(amount);
}

/** A ship's own books: what it earned, and what it cost (everything but interest and purchases). */
function shipBook(ship: ShipState, kind: 'revenue' | 'costs', amount: number, day: number): void {
  if (!amount) return;
  ship.books ??= [];
  const m = monthOf(day);
  let b = ship.books[ship.books.length - 1];
  if (!b || b.m !== m) {
    b = { m, revenue: 0, costs: 0 };
    ship.books.push(b);
    if (ship.books.length > 24) ship.books.shift();
  }
  b[kind] += Math.round(amount);
}

/** Note where the company stands (end of day). */
function snapshot(g: GameState, world: World, day = g.day): void {
  const b = bookFor(g, world, day);
  b.netWorth = Math.round(netWorth(g, world));
  b.cash = Math.round(g.cash);
  b.loan = g.loan;
}

/** Operating result of a month: revenue less running costs (ship purchases and sales aside). */
export function monthProfit(b: MonthBook): number {
  return b.revenue - b.fuel - b.fees - b.upkeep - b.interest - b.repairs - b.incidents - (b.wages ?? 0);
}

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

/** Laid up: waiting in port with no end date. */
export const LAID_UP = 1e9;

/** Ordered to wait in port (for a while or laid up). */
export function isWaiting(g: GameState, ship: ShipState): boolean {
  return ship.waitUntil !== undefined && ship.waitUntil > g.day && isReady(g, ship);
}

/**
 * A ship in port with no orders: the world clock stops until the player has
 * decided (cast off, or wait in port).
 */
export function needsDecision(g: GameState, ship: ShipState): boolean {
  return isReady(g, ship) && !isWaiting(g, ship) && !onOrders(ship);
}

/** Sailing a programmed round trip by itself (and not stopped by a problem). */
export function onOrders(ship: ShipState): boolean {
  return ship.orders !== undefined && ship.orders.halted === undefined;
}

export function shipsNeedingDecision(g: GameState): ShipState[] {
  return g.fleet.filter((s) => needsDecision(g, s));
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

/** Pilot and tugs on arrival: a share of the port fee. Dock yourself and you keep it. */
export function harbourServices(g: GameState, ship: Pick<ShipState, 'typeId'>, portId: string, world: World = getWorld()): number {
  if (!world.era.harbourServices) return 0;
  return Math.round(portFee(g, ship, portId, world) * RULES.harbourServices / 100) * 100;
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
  log(g, `The bank covered your shortfall: your loan grew by ${cur()}${draw.toLocaleString('en-US')}.`);
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
      log(g, `Milestone: your company is worth ${cur()}${m.toLocaleString('en-US')}!`);
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
    book(g, world, 'upkeep', upkeep, d);
    book(g, world, 'interest', interest, d);
    for (const ship of g.fleet) shipBook(ship, 'costs', typeOf(ship, world).dailyCost, d);
    // Captains are paid by the day.
    for (const c of g.captains ?? []) {
      const pay = c.wage / 30;
      g.cash -= pay;
      book(g, world, 'wages', pay, d);
      const ship = c.shipId !== undefined ? g.fleet.find((s) => s.id === c.shipId) : undefined;
      if (ship) shipBook(ship, 'costs', pay, d);
    }
    churnCaptainPool(g);
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
    snapshot(g, world, d);
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
  let g = dispatchOrders(clone(state), world);
  const target = g.day + days;
  for (let guard = 0; guard < 1000; guard++) {
    const ship = nextArrival(g, target);
    if (!ship) break;
    runClock(world, g, ship.voyage!.arriveDay - g.day);
    arrive(world, g, ship);
    g = dispatchOrders(g, world);
  }
  runClock(world, g, target - g.day);
  g = dispatchOrders(g, world);
  checkEnd(g, world);
  return g;
}

/** Days until the next ship is ready (arrival or end of dry dock), or null if none is busy. */
export function daysUntilNextShip(g: GameState): number | null {
  const times = g.fleet.flatMap((s) => [s.voyage?.arriveDay, s.busyUntil, s.waitUntil]
    .filter((t): t is number => t !== undefined && t < LAID_UP && t > g.day - 1e-9 && (t === s.voyage?.arriveDay || t > g.day)));
  return times.length ? Math.max(0, Math.min(...times) - g.day) : null;
}

// ---------------------------------------------------------------- new game

export function newGame(seed: number = Date.now() % 2 ** 31, world: World = getWorld()): GameState {
  const g: GameState = {
    version: 4,
    rng: seed | 0,
    day: 0,
    era: world.era.id,
    cash: world.era.start.cash,
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
    name: world.era.start.shipName,
    typeId: world.era.start.shipType,
    location: world.era.start.port,
    fuel: world.era.start.fuel,
    condition: world.era.start.condition,
    age: world.era.start.age,
    cargo: [],
  });
  for (const p of world.portList) {
    g.ports[p.id] = { fuelDev: randRange(g, -0.12, 0.12), board: [], market: [], prices: {} };
  }
  for (const p of world.portList) {
    regenerateBoard(world, g, p.id);
    regenerateMarket(world, g, p.id);
  }
  g.captains = [];
  fillCaptainPool(g);
  log(g, world.era.start.intro);
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
  if (board[idx].premium && ship.captainId !== undefined) throw new ActionError('Premium jobs need you in command: take this ship back from its captain first.');
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
  book(g, world, 'fuel', cost);
  shipBook(ship, 'costs', cost, g.day);
  log(g, `${ship.name}: ${getWorld().era.wind ? `took on ${amount} casks of victuals at` : `bunkered ${amount} t of fuel at`} ${cur()}${price}${getWorld().era.wind ? " each" : "/t"}${g.cash < 0 ? ' (on credit)' : ''}.`, -cost);
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
  book(g, world, 'repairs', q.cost);
  shipBook(ship, 'costs', q.cost, g.day);
  ship.condition = Math.min(100, Math.floor(ship.condition) + q.points);
  ship.busyUntil = g.day + q.days;
  log(g, `${ship.name}: ${getWorld().era.wind ? "careened" : "into dry dock"} for +${q.points}% condition, ready in ${q.days} day(s).`, -q.cost);
  checkEnd(g, world);
  return g;
}

/**
 * Order a ship to wait in port for `days` (Infinity = lay it up until further
 * notice). The clock can run meanwhile; when the wait is over, the ship needs
 * orders again.
 */
export function waitInPort(state: GameState, shipId: number, days: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const ship = readyShip(g, shipId);
  ship.waitUntil = Number.isFinite(days) ? g.day + days : LAID_UP;
  const port = world.ports[ship.location].name;
  log(g, Number.isFinite(days)
    ? `${ship.name} waits in ${port} for ${days} day${days === 1 ? '' : 's'}.`
    : `${ship.name} is laid up in ${port} until further notice.`);
  return g;
}

// ---------------------------------------------------------------- standing orders

export const ORDERS = {
  /** Fuel bunkered for a leg, as a multiple of what it needs (weather reserve). */
  fuelReserve: 1.15,
  /** Cargo is only taken if it should arrive this many days before its deadline. */
  deadlineMargin: 1,
  /** Results kept per ship for the fleet overview, in days. */
  earningsDays: 90,
  /** With nothing worth carrying, wait up to this many days for offers before sailing anyway. */
  maxIdleDays: 5,
  /**
   * A leg is worth sailing now if what it adds over waiting (revenue less fuel, fees
   * and canal dues, per day) at least pays this share of the ship's daily upkeep.
   * Below that the ship waits for better offers (a soft rule: see maxIdleDays).
   */
  worthUpkeepShare: 1,
  /** Fill spare space with cargo for later ports on the route (best-pay mode). */
  loadLater: true,
  /**
   * A leg that doesn't even pay its fuel and fees is never sailed: the ship keeps
   * waiting, and after this many days reports back that there's nothing to carry.
   */
  hopelessDays: 10,
  /** Extra days of slack required for cargo loaded for a later port. */
  laterMargin: 4,
  /** Fill the tank where fuel is within this margin of the cheapest port on the route. */
  cheapFuelMargin: 0.03,
};

/** Give a ship a round trip to sail by itself, starting now if it is in port. */
export function setOrders(
  state: GameState, shipId: number, stops: string[], repairBelow: number, mode: 'best' | 'loop' = 'best',
  area?: string[], world: World = getWorld(),
): GameState {
  const loop = stops.filter((id, i) => id !== stops[(i + 1) % stops.length]);
  if (new Set(loop).size < 2) throw new ActionError('A route needs at least two different ports.');
  for (let i = 0; i < loop.length; i++) {
    if (!world.route(loop[i], loop[(i + 1) % loop.length])) throw new ActionError('No sea route between two of those ports.');
  }
  const g = clone(state);
  const ship = getShip(g, shipId);
  const at = loop.indexOf(ship.voyage?.to ?? ship.location);
  // Head for the stop after the one it's at (or arriving at); otherwise start at the first.
  const next = at >= 0 ? (at + 1) % loop.length : 0;
  ship.orders = { stops: loop, next, repairBelow, mode, ...(area ? { area } : {}) };
  delete ship.waitUntil;
  const names = loop.map((id) => world.ports[id].name);
  if (area) log(g, `${ship.name} now trades ${area.length > 1 ? 'on the lane ' : 'in '}${areaName(area)}.`);
  else log(g, mode === 'loop'
    ? `${ship.name} takes up a route: ${names.join(' → ')} → and round again.`
    : `${ship.name} trades between ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}, wherever pays best.`);
  return dispatchOrders(g, world);
}

export function clearOrders(state: GameState, shipId: number): GameState {
  const g = clone(state);
  const ship = getShip(g, shipId);
  if (!ship.orders && ship.captainId === undefined) return state;
  delete ship.orders;
  const c = g.captains?.find((x) => x.id === ship.captainId);
  if (c) delete c.shipId;
  delete ship.captainId;
  log(g, c ? `You take command of the ${ship.name}; Captain ${c.name} waits ashore for a new ship.` : `${ship.name} comes off its route and waits for your orders.`);
  return g;
}

// ---------------------------------------------------------------- captains

export function captainOf(g: GameState, ship: ShipState): Captain | undefined {
  return ship.captainId === undefined ? undefined : g.captains?.find((c) => c.id === ship.captainId);
}

export function hireCaptain(state: GameState, candidateId: number): GameState {
  const g = clone(state);
  g.captains ??= [];
  const pool = g.captainPool ?? [];
  const i = pool.findIndex((c) => c.id === candidateId);
  if (i < 0) throw new ActionError('That captain has found other work.');
  const slots = captainSlots(g);
  if (g.captains.length >= slots) throw new ActionError(`You can employ ${slots} captains for now; more come with each net-worth goal.`);
  const [c] = pool.splice(i, 1);
  g.captains.push(c);
  fillCaptainPool(g);
  log(g, `Hired Captain ${c.name} (${'★'.repeat(c.skill)}, from ${region(c.home).name}) at ${cur()}${c.wage.toLocaleString('en-US')} a month.`);
  return g;
}

export function fireCaptain(state: GameState, captainId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const c = g.captains?.find((x) => x.id === captainId);
  if (!c) throw new ActionError('No such captain.');
  const ship = c.shipId !== undefined ? g.fleet.find((s) => s.id === c.shipId) : undefined;
  if (ship) { delete ship.orders; delete ship.captainId; }
  const severance = Math.round(c.wage * CAPTAIN_TUNING.severanceMonths);
  g.cash -= severance;
  book(g, world, 'wages', severance);
  g.captains = g.captains!.filter((x) => x.id !== captainId);
  log(g, `Let Captain ${c.name} go, with ${cur()}${severance.toLocaleString('en-US')} severance.${ship ? ` You take command of the ${ship.name}.` : ''}`, -severance);
  coverShortfall(g, world);
  return g;
}

/** Hand a ship to a captain to trade within a region (or a lane between two) by itself. */
export function assignCaptain(
  state: GameState, captainId: number, shipId: number, regions: string[], repairBelow: number, world: World = getWorld(),
): GameState {
  if (regions.length < 1 || regions.length > 2 || new Set(regions).size !== regions.length) throw new ActionError('Pick one region, or two for a lane.');
  const g = clone(state);
  const c = g.captains?.find((x) => x.id === captainId);
  if (!c) throw new ActionError('Hire that captain first.');
  const ship = getShip(g, shipId);
  if (c.shipId !== undefined && c.shipId !== shipId) {
    const other = g.fleet.find((s) => s.id === c.shipId);
    if (other) { delete other.orders; delete other.captainId; }
  }
  const previous = captainOf(g, ship);
  if (previous && previous.id !== c.id) delete previous.shipId;
  c.shipId = shipId;
  ship.captainId = c.id;
  log(g, `Captain ${c.name} takes command of the ${ship.name}.`);
  return setOrders(g, shipId, areaPorts(regions), repairBelow, 'best', regions, world);
}

/** Carry on with a route that stopped on a problem. */
export function resumeOrders(state: GameState, shipId: number, world: World = getWorld()): GameState {
  const g = clone(state);
  const ship = getShip(g, shipId);
  if (!ship.orders) throw new ActionError(`The ${ship.name} has no route.`);
  delete ship.orders.halted;
  return dispatchOrders(g, world);
}

/** Every ship on standing orders that is ready in port gets on with its route. */
function dispatchOrders(g: GameState, world: World): GameState {
  for (const s of g.fleet) {
    if (onOrders(s) && isReady(g, s) && !isWaiting(g, s) && !g.gameOver) g = runOrders(g, s.id, world);
  }
  return g;
}

/** The next port on a route from where the ship is now (skipping its own port). */
function nextStop(o: StandingOrders, here: string): number {
  const i = o.next % o.stops.length;
  return o.stops[i] === here ? (i + 1) % o.stops.length : i;
}

/** One port call on standing orders: dry dock if worn, else load, bunker and cast off. */
function runOrders(state: GameState, shipId: number, world: World): GameState {
  let g = state;
  /** Nothing worth carrying yet: give the quay a day for new offers rather than sail empty. */
  const idle = (state: GameState): GameState => {
    const w = clone(state);
    const s = getShip(w, shipId);
    s.orders!.idleDays = (s.orders!.idleDays ?? 0) + 1;
    s.waitUntil = w.day + 1;
    return w;
  };
  const halt = (why: string): GameState => {
    const h = clone(g);
    const ship = getShip(h, shipId);
    ship.orders!.halted = why;
    log(h, `${ship.name} stopped its route in ${world.ports[ship.location].name}: ${why}`);
    return h;
  };
  try {
    const start = getShip(g, shipId);
    const o = start.orders!;
    if (start.condition < o.repairBelow) {
      // Back to full condition, or as far as the money goes (at least past the threshold).
      const perPoint = typeOf(start, world).repairCostPerPoint;
      const affordable = Math.floor(Math.max(0, spendable(g, world)) / perPoint);
      const points = Math.min(100 - Math.floor(start.condition), affordable);
      if (start.condition + points < o.repairBelow) return halt(`it needs dry dock below ${o.repairBelow}% condition, and there isn't enough cash or credit for it.`);
      return repair(g, shipId, points, world);
    }
    {
      // The regular service draws bookings for its other ports (each day it waits, too).
      const t = typeOf(start, world);
      const w = clone(g);
      const cap = captainOf(w, start);
      const boost = cap && regionOf(start.location) === cap.home ? CAPTAIN_TUNING.homeBookingBoost : 1;
      bookServiceCargo(world, w, start.location, o.stops, t.cargoClasses, t.capacity, boost);
      g = w;
    }
    let idx: number;
    const t = typeOf(start, world);
    const worthPerDay = ORDERS.worthUpkeepShare * t.dailyCost;
    const skill = captainOf(g, start)?.skill ?? 3;
    const maxIdle = skill === 1 ? 2 : ORDERS.maxIdleDays;
    const canWait = (o.idleDays ?? 0) < maxIdle && cargoKeepsADay(g, shipId, world);
    if (o.mode === 'best') {
      const pick = bestStop(g, shipId, world);
      if (!pick) return halt('none of its ports can be reached from here with a full tank.');
      // Not worth it yet: wait for better offers (a few days at most, and never making cargo late).
      if (pick.score < worthPerDay && canWait) return idle(g);
      if (pick.gain < 0 && !start.cargo.length) {
        // Nothing here pays its fuel and fees. Sail empty only to a port with a deal that pays for the trip;
        // otherwise keep waiting, and after a while report back.
        const move = repositionTo(g, shipId, world);
        if (move === null) {
          if ((o.idleDays ?? 0) < ORDERS.hopelessDays) return idle(g);
          return halt(`nothing worth carrying in ${o.area ? areaName(o.area) : 'its area'} for ${ORDERS.hopelessDays} days. Give it another area, or take command.`);
        }
        idx = move;
      } else {
        idx = pick.idx;
        for (const id of pick.load) g = acceptContract(g, shipId, id, world);
      }
    } else {
      idx = nextStop(o, start.location);
      const reach = legCost(g, start, start.location, o.stops[idx], world);
      // Waiting won't bring a port into range: say so straight away.
      if (reach && !reach.inRange) {
        return halt(`${world.ports[o.stops[idx]].name} is beyond its range (${reach.fuel} t of fuel needed, bunkers hold ${t.bunkerCapacity} t).`);
      }
      g = loadForRoute(g, shipId, world);
      const leg = legValue(g, getShip(g, shipId), start.location, o.stops[idx], getShip(g, shipId).cargo, world);
      if (leg && leg.gain / leg.days < worthPerDay && canWait) {
        // Hand back what was just loaded and wait for more.
        const fresh = getShip(g, shipId).cargo.filter((c) => !start.cargo.some((x) => x.id === c.id));
        for (const c of fresh) g = unloadContract(g, shipId, c.id, world);
        return idle(g);
      }
    }
    const dest = o.stops[idx];
    const plan = planVoyage(g, shipId, dest, world);
    if (!plan) return halt(`no sea route to ${world.ports[dest].name}.`);
    const type = typeOf(start, world);
    if (!plan.inRange) return halt(`${world.ports[dest].name} is beyond its range (${plan.fuelNeeded} t of fuel needed, bunkers hold ${type.bunkerCapacity} t).`);
    const want = fuelToBuy(g, getShip(g, shipId), plan.fuelNeeded, world);
    if (want >= 1) {
      try { g = buyFuel(g, shipId, want, world); } catch { /* checked just below */ }
    }
    if (getShip(g, shipId).fuel < plan.fuelNeeded) return halt('not enough cash or credit for fuel.');
    const fromRegion = regionOf(getShip(g, shipId).location);
    g = sail(g, shipId, dest, world);
    getShip(g, shipId).orders!.next = (idx + 1) % o.stops.length;
    if (o.area && o.area.length > 1) {
      const sailed = getShip(g, shipId).orders!;
      sailed.localLegs = regionOf(dest) === fromRegion ? (sailed.localLegs ?? 0) + 1 : 0;
    }
    // (In 'best' mode `next` only marks where it went, for display.)
    delete getShip(g, shipId).orders!.idleDays;
    return g;
  } catch (e) {
    if (e instanceof ActionError) return halt(e.message);
    throw e;
  }
}

/** Rough cost of a leg for this ship from one port to another (it need not be there yet). */
function legCost(g: GameState, ship: ShipState, from: string, to: string, world: World) {
  const route = routeFor(world, g, from, to);
  if (!route) return null;
  const type = typeOf(ship, world);
  const days = route.nm / (effectiveSpeed(type, ship) * routeWind(world, route.path, g.day) * 24);
  const fuel = Math.ceil(days * type.fuelPerDay * consumptionFactor(ship));
  const canal = route.canals.reduce((s, c) => s + Math.round(world.canals[c].fee * type.sizeFactor), 0);
  const strikeDays = strikeAt(g, to) ? ECONOMY.strike.extraDays : 0;
  return {
    days: days + RULES.portDays + strikeDays,
    seaDays: days,
    fuel,
    inRange: fuel <= type.bunkerCapacity,
    /** Fuel valued at the price where the leg starts. */
    costs: fuel * fuelPrice(g, from, world) + portFee(g, ship, to, world) + harbourServices(g, ship, to, world) + canal,
  };
}

/** What a leg adds over waiting: revenue for `cargo` delivered at `to`, less fuel, fees and dues. */
function legValue(g: GameState, ship: ShipState, from: string, to: string, cargo: Contract[], world: World) {
  const leg = legCost(g, ship, from, to, world);
  if (!leg) return null;
  const arrive = g.day + leg.seaDays;
  const revenue = cargo.filter((c) => c.dest === to).reduce((s, c) => s + c.pay * latePayFactor(arrive - c.deadline), 0);
  return { ...leg, gain: revenue - leg.costs };
}

/** Pick lots from a board for `dest` that fit and arrive in time, best pay per ton first. */
function pickLots(board: Contract[], dest: string, free: number, arriveDay: number, type: ShipTypeDef, world: World, taken = new Set<number>()) {
  const lots: Contract[] = [];
  for (const c of board
    .filter((c) => c.dest === dest && !c.premium && !taken.has(c.id) && type.cargoClasses.includes(world.goods[c.good].cargoClass)
      && arriveDay + ORDERS.deadlineMargin <= c.deadline)
    .sort((a, b) => b.pay / b.tons - a.pay / a.tons)) {
    if (c.tons <= free) { lots.push(c); free -= c.tons; }
  }
  return lots;
}

/**
 * For 'best' mode: where to go next, and what to load. Each stop is scored by what
 * it adds over waiting, per day: cargo aboard and on the quay for it, less fuel,
 * fees and dues, less the late pay that going there first would cost the rest of
 * the cargo aboard. Upkeep is the same whatever it does, so it doesn't count.
 * Spare space then takes cargo for the route's other ports that can make it in time.
 * (Tested: weighing that later cargo, or looking one leg ahead at the destination's
 * offers, made routes earn less: offers change before the ship gets there.)
 */
function bestStop(g: GameState, shipId: number, world: World): { idx: number; load: number[]; score: number; gain: number } | null {
  const ship = getShip(g, shipId);
  const o = ship.orders!;
  const type = typeOf(ship, world);
  const here = ship.location;
  const board = g.ports[here].board;
  const skill = captainOf(g, ship)?.skill ?? 3;
  // On a lane, at most one leg in a row stays within a region: then it crosses.
  const lane = o.area && o.area.length > 1;
  const hereRegion = regionOf(here);
  const mustCross = lane && (o.localLegs ?? 0) >= 1 && o.area!.includes(hereRegion ?? '');
  let best: { idx: number; load: number[]; score: number; gain: number } | null = null;
  o.stops.forEach((dest, idx) => {
    if (dest === here) return;
    if (mustCross && regionOf(dest) === hereRegion) return;
    const leg = legCost(g, ship, here, dest, world);
    if (!leg || !leg.inRange) return;
    let free = type.capacity - cargoTons(ship);
    const arrive = g.day + leg.seaDays;
    // Cargo for this stop
    const now = pickLots(board, dest, free, arrive, type, world);
    free -= now.reduce((s, c) => s + c.tons, 0);
    const aboard = ship.cargo.filter((c) => c.dest === dest).reduce((s, c) => s + c.pay * latePayFactor(arrive - c.deadline), 0);
    // Going here first delays the rest of the cargo aboard: count what that would cost in late pay.
    let delay = 0;
    for (const c of ship.cargo) {
      if (c.dest === dest) continue;
      const onward = legCost(g, ship, dest, c.dest, world);
      if (onward) delay += c.pay * (1 - latePayFactor(arrive + RULES.portDays + onward.seaDays - c.deadline));
    }
    const gain = aboard + now.reduce((s, c) => s + c.pay, 0) - leg.costs - delay;
    // Fill up with cargo for the other stops that can still make it via this one.
    const taken = new Set(now.map((c) => c.id));
    const later: Contract[] = [];
    for (const next of ORDERS.loadLater && skill >= 2 ? o.stops : []) {
      if (next === here || next === dest || free <= 0) continue;
      const onward = legCost(g, ship, dest, next, world);
      if (!onward || !onward.inRange) continue;
      const lots = pickLots(board, next, free, arrive + RULES.portDays + onward.seaDays + ORDERS.laterMargin, type, world, taken);
      for (const c of lots) { later.push(c); taken.add(c.id); free -= c.tons; }
    }
    // Less experienced captains misjudge: their sense of each option is off by up to 10% (★★) or 25% (★).
    const noise = skill === 3 ? 1 : 1 + (rand(g) * 2 - 1) * (skill === 2 ? 0.1 : 0.25);
    const score = (gain / leg.days) * noise;
    const total = gain + later.reduce((s, c) => s + c.pay, 0);
    if (!best || score > best.score) best = { idx, load: [...now, ...later].map((c) => c.id), score, gain: total };
  });
  return best;
}

/**
 * Where an empty ship should sail to find work: a port in its area whose cargo for
 * another of its ports pays for the empty run and the leg after; failing that, the
 * nearest port with regular trade for this kind of ship to another of its ports
 * (most of a route's cargo is booked when the ship calls). Null if neither exists.
 */
function repositionTo(g: GameState, shipId: number, world: World): number | null {
  const ship = getShip(g, shipId);
  const o = ship.orders!;
  const type = typeOf(ship, world);
  const here = ship.location;
  const hereRegion = regionOf(here);
  const mustCross = o.area && o.area.length > 1 && (o.localLegs ?? 0) >= 1;
  let deal: { idx: number; perDay: number } | null = null;
  let trade: { idx: number; days: number } | null = null;
  o.stops.forEach((d, idx) => {
    if (d === here || (mustCross && regionOf(d) === hereRegion)) return;
    const empty = legCost(g, ship, here, d, world);
    if (!empty || !empty.inRange) return;
    for (const e of o.stops) {
      if (e === d) continue;
      const onward = legCost(g, ship, d, e, world);
      if (!onward || !onward.inRange) continue;
      const lots = pickLots(g.ports[d].board, e, type.capacity, g.day + empty.days + onward.seaDays, type, world);
      const value = lots.reduce((s, c) => s + c.pay, 0) - onward.costs - empty.costs;
      const perDay = value / (empty.days + onward.days);
      if (value > 0 && (!deal || perDay > deal.perDay)) deal = { idx, perDay };
      if (legTrade(world, type, d, e).length && (!trade || empty.days < trade.days)) trade = { idx, days: empty.days };
    }
  });
  const pick = (deal ?? trade) as { idx: number } | null;
  return pick ? pick.idx : null;
}

/** Would every lot aboard still arrive in time if the ship waited one more day? */
function cargoKeepsADay(g: GameState, shipId: number, world: World): boolean {
  const ship = getShip(g, shipId);
  return ship.cargo.every((c) => {
    const leg = legCost(g, ship, ship.location, c.dest, world);
    return !leg || g.day + 1 + leg.seaDays + ORDERS.deadlineMargin <= c.deadline;
  });
}

/** Fuel to buy for the next leg: just enough plus reserve, or a full tank where fuel is cheapest on the route. */
function fuelToBuy(g: GameState, ship: ShipState, need: number, world: World): number {
  const type = typeOf(ship, world);
  const basic = Math.min(type.bunkerCapacity, Math.ceil(need * ORDERS.fuelReserve)) - ship.fuel;
  const o = ship.orders;
  if (!o || (captainOf(g, ship)?.skill ?? 3) < 3) return basic;
  const price = fuelPrice(g, ship.location, world);
  const cheapest = Math.min(...o.stops.map((id) => fuelPrice(g, id, world)));
  if (price > cheapest * (1 + ORDERS.cheapFuelMargin)) return basic;
  // Cheapest on the route: fill up, from cash in hand (not on credit).
  const affordable = Math.floor(Math.max(0, g.cash) / price);
  return Math.max(basic, Math.min(type.bunkerCapacity - ship.fuel, affordable));
}

/**
 * Load the best-paying cargo for ports on the route ahead that can be delivered
 * in time (allowing for the stops in between).
 */
function loadForRoute(state: GameState, shipId: number, world: World): GameState {
  let g = state;
  const ship = getShip(g, shipId);
  const o = ship.orders!;
  const type = typeOf(ship, world);
  const speed = effectiveSpeed(type, ship) * 24;
  // Expected arrival at each port ahead, once round the loop.
  const eta = new Map<string, number>();
  let t = g.day;
  let from = ship.location;
  const first = nextStop(o, ship.location);
  for (let k = 0; k < o.stops.length; k++) {
    const stop = o.stops[(first + k) % o.stops.length];
    if (stop === ship.location) break;
    const route = routeFor(world, g, from, stop);
    if (!route) break;
    t += route.nm / (speed * routeWind(world, route.path, t));
    if (!eta.has(stop)) eta.set(stop, t);
    t += RULES.portDays;
    from = stop;
  }
  const offers = g.ports[ship.location].board
    .filter((c) => !c.premium && eta.has(c.dest) && eta.get(c.dest)! + ORDERS.deadlineMargin <= c.deadline)
    .sort((a, b) => b.pay / b.tons - a.pay / a.tons);
  for (const c of offers) {
    if (canCarry(getShip(g, shipId), c, world) === null) g = acceptContract(g, shipId, c.id, world);
  }
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
  /** Pilot and tugs on arrival. */
  services: number;
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
  // Sailing ships go as fast as the season's winds along the route allow.
  const seaDays = route.nm / (effectiveSpeed(type, ship) * routeWind(world, route.path, g.day) * 24);
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
  const services = harbourServices(g, ship, dest, world);
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
    services,
    canalFees,
    deliveries,
    revenue,
    estimatedNet: revenue - upkeep - fee - services - canalFees - fuelCost,
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
  const speed = effectiveSpeed(type, ship) * routeWind(world, route.path, g.day);
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
      event('breakdown', world.era.wind ? `Sprung a leak. Hove to for ${delay} days while the carpenter worked the pumps and patched her.` : `Engine breakdown. Drifted ${delay} days while the crew made repairs.`, delay, cost);
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
      event('storm', world.era.wind ? `A gale. Reefed down and ran before it, ${damage.toFixed(0)}% damage to hull and rigging.` : `Heavy weather. Slow going, extra fuel burned, ${damage.toFixed(0)}% hull wear.`, 0, 0);
    }
    if (fuel < burn) {
      // Ran dry: call a bunker tender at a steep markup.
      const remainingDays = remaining / (speed * 24);
      const tons = Math.ceil(remainingDays * type.fuelPerDay * consumptionFactor({ condition, age: ship.age }) * 1.15 + burn);
      const price = Math.round(fuelPrice(g, dest, world) * RULES.emergencyFuelMarkup);
      const cost = tons * price;
      const delay = 1.5;
      event('emergencyFuel', `${getWorld().era.wind ? `Out of victuals! A passing ship sold ${tons} casks at` : `Out of fuel! A bunker tender brought ${tons} t at`} ${cur()}${price}${getWorld().era.wind ? " each" : "/t"} after ${delay} days adrift.`, delay, cost);
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
  delete ship.waitUntil;
  delete ship.docking;
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
  const services = harbourServices(g, ship, dest, world);
  g.cash += revenue - fee - services - v.canalFees - v.eventCosts;
  book(g, world, 'revenue', revenue);
  book(g, world, 'fees', fee + services + v.canalFees);
  book(g, world, 'incidents', v.eventCosts);
  shipBook(ship, 'revenue', revenue, g.day);
  shipBook(ship, 'costs', fee + services + v.canalFees + v.eventCosts, g.day);
  g.stats.voyages++;
  g.stats.revenue += revenue;
  g.stats.fuelSpent += v.events.filter((e) => e.kind === 'emergencyFuel').reduce((s, e) => s + e.cost, 0);
  g.stats.delivered += deliveries.reduce((s, d) => s + d.contract.tons, 0);

  const report: VoyageReport = {
    shipId: ship.id, shipName: ship.name,
    from: v.from, to: dest, path: v.path, distance: v.distance,
    departDay: v.departDay, arriveDay: v.arriveDay, fuelUsed: v.fuelUsed,
    conditionLoss: Math.round((v.startCondition - ship.condition) * 10) / 10,
    events: v.events, deliveries, revenue, upkeep, portFee: fee, services, canalFees: v.canalFees, eventCosts: v.eventCosts,
    net: revenue - upkeep - fee - services - v.canalFees - v.eventCosts,
    marketNotes, news,
  };
  if (onOrders(ship)) report.auto = true;
  // Under your command: you may take her in yourself instead of the pilot (until she sails).
  if (ship.captainId === undefined && services > 0) ship.docking = { port: dest, services, portFee: fee };
  else delete ship.docking;
  // For the fleet overview: the leg's result including the fuel it burned (at the price where it bunkered).
  const fuelCost = Math.round(v.fuelUsed * fuelPrice(g, v.from, world));
  ship.earnings = [...(ship.earnings ?? []).filter((e) => e.day > g.day - ORDERS.earningsDays), { day: g.day, net: report.net - fuelCost }];
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
    report.net >= 0 ? '+' : '-'}${cur()}${Math.abs(report.net).toLocaleString('en-US')}.`);
}

/**
 * You took her in yourself: the pilot and tugs are refunded (and the port fee too
 * for a perfect docking); bumps cost condition. Once per arrival.
 */
export function dockByHand(state: GameState, shipId: number, result: { perfect: boolean; damage: number; score: number }, world: World = getWorld()): GameState {
  const before = getShip(state, shipId);
  const d = before.docking;
  if (!d || d.port !== before.location || before.voyage) throw new ActionError('The pilot has already brought her in.');
  const g = clone(state);
  const ship = getShip(g, shipId);
  const refund = d.services + (result.perfect ? d.portFee : 0);
  g.cash += refund;
  book(g, world, 'fees', -refund);
  shipBook(ship, 'costs', -refund, g.day);
  ship.condition = Math.max(0, ship.condition - result.damage);
  delete ship.docking;
  const port = world.ports[ship.location].name;
  log(g, result.perfect
    ? `You took the ${ship.name} into ${port} yourself, perfectly (score ${result.score}): no pilot, and the harbour master waived the port fee.`
    : `You took the ${ship.name} into ${port} yourself (score ${result.score}): no pilot needed.${result.damage ? ` Bumps cost ${result.damage}% condition.` : ''}`, refund);
  return g;
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
  log(g, `Borrowed ${cur()}${amt.toLocaleString('en-US')} from the bank.`, amt);
  return g;
}

export function repayLoan(state: GameState, amount: number): GameState {
  const g = clone(state);
  const amt = Math.floor(Math.min(amount, g.loan, Math.max(0, g.cash)));
  if (amt <= 0) throw new ActionError(g.loan <= 0 ? 'You have no loan.' : 'Not enough cash to repay.');
  g.loan -= amt;
  g.cash -= amt;
  log(g, `Repaid ${cur()}${amt.toLocaleString('en-US')} of the loan.`, -amt);
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
  book(g, world, 'shipsBought', offer.price);
  const taken = g.fleet.map((s) => s.name);
  const name = taken.includes(offer.name) ? shipName(g, taken) : offer.name;
  g.fleet.push({
    id: g.nextId++, name, typeId: offer.typeId, location: portId,
    fuel: Math.round(q.type.bunkerCapacity * RULES.newShipFuel), condition: offer.condition, age: offer.age, cargo: [],
  });
  g.stats.shipsOwned++;
  log(g, `Bought the ${q.type.name} ${name} (${offer.age === 0 ? 'new' : `${offer.age} years old`}) in ${world.ports[portId].name} for ${cur()}${
    offer.price.toLocaleString('en-US')}${q.borrow > 0 ? `, borrowing ${cur()}${q.borrow.toLocaleString('en-US')}` : ''}.`, -offer.price);
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
  for (const c of g.captains ?? []) if (c.shipId === shipId) delete c.shipId;
  g.cash += q.price + q.fuelRefund - q.repay;
  g.loan -= q.repay;
  book(g, world, 'shipsSold', q.price);
  log(g, `Sold the ${typeOf(ship, world).name} ${ship.name} for ${cur()}${q.price.toLocaleString('en-US')}${
    q.repay ? `, repaying ${cur()}${q.repay.toLocaleString('en-US')} of the loan` : ''}.`, q.price);
  checkEnd(g, world);
  return g;
}
