// Pure data types shared by the simulation. No DOM, no rendering.

export type CargoClass = 'bulk' | 'general' | 'liquid' | 'reefer';

export interface GoodDef {
  id: string;
  name: string;
  cargoClass: CargoClass;
  /** $ per ton per 1000 nm (plus a fixed handling share, see contracts.ts). */
  freightRate: number;
  lotMin: number;
  lotMax: number;
  /** Occasionally a much bigger shipment (for bulkers, tankers, big ships) up to this size. */
  bigLotMax?: number;
}

export interface PortDef {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** Base bunker price, $ per ton. */
  fuelPrice: number;
  /** Base port fee for a ship of sizeFactor 1. */
  portFee: number;
  /** Ports with a shipyard sell new ships. */
  shipyard?: boolean;
  produces: { good: string; weight: number }[];
  demands: { good: string; strength: number }[];
}

export interface ShipTypeDef {
  id: string;
  name: string;
  description: string;
  /** Price of a brand-new ship at a shipyard. */
  newPrice: number;
  capacity: number;
  speedKn: number;
  fuelPerDay: number;
  bunkerCapacity: number;
  dailyCost: number;
  sizeFactor: number;
  repairCostPerPoint: number;
  cargoClasses: CargoClass[];
}

export interface Contract {
  id: number;
  good: string;
  tons: number;
  origin: string;
  dest: string;
  pay: number;
  /** Absolute game day by which the cargo must be delivered for full pay. */
  deadline: number;
  postedDay: number;
}

export interface ShipState {
  id: number;
  name: string;
  typeId: string;
  /** The port the ship is in, or the port it last left while at sea. */
  location: string;
  /** Fuel aboard (at sea: what it left with; see voyage for the arrival figure). */
  fuel: number;
  /** 0..100 */
  condition: number;
  /** Years. Older ships are slower, thirstier and break down more. */
  age: number;
  cargo: Contract[];
  /** Set while the ship is at sea. */
  voyage?: ActiveVoyage;
  /** In dry dock until this day. */
  busyUntil?: number;
  /** Ordered to wait in port until this day (a very large number = laid up until further notice). */
  waitUntil?: number;
}

/**
 * A voyage in progress. Its course (storms, breakdowns, fuel burned) is worked
 * out when the ship casts off; the world clock then plays it out.
 */
export interface ActiveVoyage {
  from: string;
  to: string;
  path: string[];
  distance: number;
  departDay: number;
  /** When the ship reaches the destination (after any delays at sea). */
  seaArrivalDay: number;
  /** When it has finished unloading and is ready for orders. */
  arriveDay: number;
  events: VoyageEvent[];
  startFuel: number;
  fuelAtArrival: number;
  fuelUsed: number;
  startCondition: number;
  conditionAtArrival: number;
  /** Breakdown repairs and emergency fuel, paid on arrival. */
  eventCosts: number;
  canalFees: number;
  /** A strike delay has already been added on arrival. */
  strikeApplied?: boolean;
}

/** A ship offered for sale in a port's market (new at shipyards, used anywhere). */
export interface ShipOffer {
  id: number;
  typeId: string;
  name: string;
  age: number;
  condition: number;
  price: number;
}

export interface PortState {
  /** Deviation from base fuel price, e.g. 0.1 = +10%. */
  fuelDev: number;
  board: Contract[];
  market: ShipOffer[];
  /**
   * Price level per good this port buys (1 = normal). Deliveries push it down,
   * events push it up, and it drifts back to normal over time.
   */
  prices: Record<string, number>;
}

export type WorldEventKind = 'strike' | 'harvest' | 'boom' | 'canal' | 'oilShock';

export interface WorldEvent {
  id: number;
  kind: WorldEventKind;
  startDay: number;
  endDay: number;
  /** Affected port (strike, boom). */
  port?: string;
  /** Affected good (harvest failure). */
  good?: string;
  /** Closed canal id (canal). */
  canal?: string;
  /** Oil price shift while active, e.g. 0.35 or -0.25 (oil shock). */
  oilShift?: number;
  headline: string;
}

export interface OilMarket {
  /** World oil price index (1 = normal); all bunker prices follow it. */
  index: number;
  /** Weekly samples of the index, oldest first (at most a year). */
  history: number[];
}

export type VoyageEventKind = 'storm' | 'breakdown' | 'emergencyFuel' | 'strike';

export interface VoyageEvent {
  /** Day of the voyage (1 = first day). */
  day: number;
  /** Absolute game day the event happens. */
  atDay: number;
  kind: VoyageEventKind;
  text: string;
  delayDays: number;
  cost: number;
}

export interface Delivery {
  contract: Contract;
  paid: number;
  lateDays: number;
}

export interface VoyageReport {
  shipId: number;
  shipName: string;
  from: string;
  to: string;
  path: string[];
  distance: number;
  departDay: number;
  arriveDay: number;
  fuelUsed: number;
  conditionLoss: number;
  events: VoyageEvent[];
  deliveries: Delivery[];
  revenue: number;
  upkeep: number;
  portFee: number;
  canalFees: number;
  eventCosts: number;
  /** Result of the leg: revenue minus upkeep, fees and event costs (fuel was paid when bunkering). */
  net: number;
  /** How the buyers' prices reacted to this delivery. */
  marketNotes: string[];
  /** World news that broke while at sea. */
  news: string[];
}

export interface LogEntry {
  day: number;
  text: string;
  amount?: number;
}

export interface GameState {
  version: 4;
  rng: number;
  day: number;
  cash: number;
  /** Outstanding bank loan, secured on the fleet. */
  loan: number;
  fleet: ShipState[];
  ports: Record<string, PortState>;
  nextId: number;
  log: LogEntry[];
  stats: { voyages: number; revenue: number; fuelSpent: number; delivered: number; interestPaid: number; upkeepPaid: number; shipsOwned: number };
  /** Arrival reports not yet shown to the player, oldest first. */
  reports: VoyageReport[];
  gameOver?: string;
  /** Net-worth milestones reached, with the day each was reached. */
  milestones: { amount: number; day: number }[];
  oil: OilMarket;
  /** World events: active and recently ended (kept for the news list). */
  events: WorldEvent[];
}
