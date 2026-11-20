// Ships as assets: value, age effects, the ship market and bank loans.

import { pickWeighted, rand, randInt, randRange } from './rng';
import type { GameState, ShipOffer, ShipState, ShipTypeDef } from './types';
import type { World } from './world';

export const SHIP_TUNING = {
  /** Value keeps this share per year of age (0.93 = loses 7% a year). */
  yearlyDepreciation: 0.93,
  /** A ship is never worth less than this share of its new price (scrap value). */
  scrapShare: 0.1,
  /** Brokers take a cut when you sell. */
  saleShare: 0.9,
  /** The bank lends up to this share of the ship's value. */
  loanToValue: 0.6,
  /** Loan interest, per day (8% a year). */
  loanDailyRate: 0.08 / 365,
  usedOffersMin: 3,
  usedOffersMax: 5,
  /** How common each class is on the second-hand market. */
  marketWeights: {
    coaster: 4, largecoaster: 3.5, general: 3, handysize: 2.5, bulker: 2, panamax: 1,
    smallreefer: 2, reefer: 1.5, smalltanker: 2, tanker: 1, feeder: 1.5, container: 1,
  } as Record<string, number>,
};

const NAMES = [
  'Northern Star', 'Marlin', 'Ostrava', 'Kestrel', 'Bonaventure', 'Sea Lark', 'Hollandia', 'Petrel', 'Iron Duke',
  'Cormorant', 'Santa Rita', 'Albatross', 'Freya', 'Morning Tide', 'Calypso', 'Valdivia', 'Tern', 'Halcyon',
  'Cape Clear', 'Meridian', 'Westerly', 'Gannet', 'Orinoco', 'Lindisfarne', 'Pelican', 'Stella Maris', 'Bosun',
  'Quicksilver', 'Heron', 'Atlantis', 'Coral Sea', 'Endeavour', 'Skua', 'Fairwind', 'Magellan', 'Puffin',
];

// ---------------------------------------------------------------- age & wear

/**
 * Ship-type stats describe a typical 15-year-old ship. Younger ships do better
 * than that, older ones worse.
 */
export const REFERENCE_AGE = 15;

/** Speed: ±0.2% per year from the reference age, within −10% … +5%. */
export function effectiveSpeed(type: ShipTypeDef, ship: Pick<ShipState, 'age'>): number {
  const f = 1 - 0.002 * (ship.age - REFERENCE_AGE);
  return type.speedKn * Math.max(0.9, Math.min(1.05, f));
}

/** Fuel burn: worn hulls up to +40%, and ±0.3% per year from the reference age. */
export function consumptionFactor(ship: Pick<ShipState, 'condition' | 'age'>): number {
  return (1 + (100 - ship.condition) / 250) * (1 + 0.003 * (ship.age - REFERENCE_AGE));
}

/** Breakdowns: ±2.5% per year from the reference age (a new ship has 0.625×). */
export function breakdownAgeFactor(ship: Pick<ShipState, 'age'>): number {
  return Math.max(0.5, 1 + (ship.age - REFERENCE_AGE) / 40);
}

// ---------------------------------------------------------------- value

export function shipValue(type: ShipTypeDef, age: number, condition: number): number {
  const T = SHIP_TUNING;
  const ageShare = Math.max(T.scrapShare, T.yearlyDepreciation ** age);
  return Math.round((type.newPrice * ageShare * (0.55 + 0.45 * (condition / 100))) / 1000) * 1000;
}

export function stateValue(ship: Pick<ShipState, 'typeId' | 'age' | 'condition'>, world: World): number {
  return shipValue(world.shipTypes[ship.typeId], ship.age, ship.condition);
}

/** What a broker pays for one of your ships. */
export function saleValue(ship: Pick<ShipState, 'typeId' | 'age' | 'condition'>, world: World): number {
  return Math.round((stateValue(ship, world) * SHIP_TUNING.saleShare) / 1000) * 1000;
}

export function fleetValue(g: GameState, world: World): number {
  return g.fleet.reduce((s, ship) => s + stateValue(ship, world), 0);
}

/** The bank lends up to a share of the whole fleet's value. */
export function maxLoan(g: GameState, world: World): number {
  return Math.round(fleetValue(g, world) * SHIP_TUNING.loanToValue / 1000) * 1000;
}

export function netWorth(g: GameState, world: World): number {
  // Goods aboard count at what they cost.
  const goods = g.fleet.reduce((s, ship) => s + (ship.goods ?? []).reduce((t, x) => t + x.cost, 0), 0);
  return g.cash + fleetValue(g, world) + goods - g.loan;
}

// ---------------------------------------------------------------- market

export function shipName(g: GameState, avoid: string[] = []): string {
  const free = NAMES.filter((n) => !avoid.includes(n));
  return free[Math.floor(rand(g) * free.length)] ?? `Ship ${g.nextId}`;
}

/** Fill a port's market: a few used ships of mixed age, plus every new class at shipyards. */
export function regenerateMarket(world: World, g: GameState, portId: string): void {
  const T = SHIP_TUNING;
  const offers: ShipOffer[] = [];
  const types = Object.values(world.shipTypes);
  const n = randInt(g, T.usedOffersMin, T.usedOffersMax);
  const taken = g.fleet.map((s) => s.name);
  for (let i = 0; i < n; i++) {
    const type = pickWeighted(g, types, (t) => T.marketWeights[t.id] ?? 1);
    const age = Math.round(3 + 27 * rand(g) ** 0.8);
    const condition = Math.round(Math.max(30, Math.min(97, 100 - age * 1.6 + randRange(g, -10, 10))));
    const price = Math.round((shipValue(type, age, condition) * randRange(g, 0.95, 1.12)) / 1000) * 1000;
    const name = shipName(g, taken);
    taken.push(name);
    offers.push({ id: g.nextId++, typeId: type.id, name, age, condition, price });
  }
  if (world.ports[portId].shipyard) {
    for (const type of types) {
      const name = shipName(g, taken);
      taken.push(name);
      offers.push({ id: g.nextId++, typeId: type.id, name, age: 0, condition: 100, price: type.newPrice });
    }
  }
  offers.sort((a, b) => a.price - b.price);
  g.ports[portId].market = offers;
}

export interface PurchaseQuote {
  offer: ShipOffer;
  type: ShipTypeDef;
  price: number;
  /** Cash that leaves. */
  fromCash: number;
  /** New borrowing needed to complete the deal. */
  borrow: number;
  /** Loan balance after the deal. */
  loanAfter: number;
  loanLimit: number;
  /** Reason the deal can't go ahead, or null. */
  blocked: string | null;
}

/**
 * Quote for adding `offer` to the fleet: cash pays what it can, and the bank
 * lends the rest, up to its share of the fleet's value including the new ship.
 */
export function quotePurchase(g: GameState, offer: ShipOffer, world: World): PurchaseQuote {
  const type = world.shipTypes[offer.typeId];
  const newValue = shipValue(type, offer.age, offer.condition);
  const loanLimit = Math.round((fleetValue(g, world) + newValue) * SHIP_TUNING.loanToValue / 1000) * 1000;
  const available = Math.max(0, g.cash);
  const borrow = Math.max(0, offer.price - available);
  const fromCash = offer.price - borrow;
  const loanAfter = g.loan + borrow;
  let blocked: string | null = null;
  if (loanAfter > loanLimit) {
    blocked = `The bank lends at most ${Math.round(SHIP_TUNING.loanToValue * 100)}% of your fleet's value. You're ${
      '$' + (loanAfter - loanLimit).toLocaleString('en-US')} short.`;
  }
  return { offer, type, price: offer.price, fromCash, borrow, loanAfter, loanLimit, blocked };
}

/** The goods a port exports that this ship type can carry. */
/** Goods this kind of ship can carry that `from` ships and `to` buys (what usually moves on that leg). */
export function legTrade(world: World, type: ShipTypeDef, from: string, to: string): string[] {
  const wanted = new Set(world.ports[to].demands.map((d) => d.good));
  return exportsFor(world, type, from).filter((g) => wanted.has(g));
}

export function exportsFor(world: World, type: ShipTypeDef, portId: string): string[] {
  return world.ports[portId].produces
    .map((p) => world.goods[p.good])
    .filter((good) => type.cargoClasses.includes(good.cargoClass))
    .map((good) => good.id);
}
