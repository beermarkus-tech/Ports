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
  name: string;
  typeId: string;
  location: string;
  fuel: number;
  /** 0..100 */
  condition: number;
  /** Years. Older ships are slower, thirstier and break down more. */
  age: number;
  cargo: Contract[];
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
  day: number;
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
  /** Loan and overdraft interest charged during the voyage (already taken from cash). */
  interest: number;
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
  version: 3;
  rng: number;
  day: number;
  cash: number;
  /** Outstanding bank loan, secured on the ship. */
  loan: number;
  ship: ShipState;
  ports: Record<string, PortState>;
  nextId: number;
  log: LogEntry[];
  stats: { voyages: number; revenue: number; fuelSpent: number; delivered: number; interestPaid: number; shipsOwned: number };
  lastVoyage?: VoyageReport;
  gameOver?: string;
  /** Net-worth milestones reached, with the day each was reached. */
  milestones: { amount: number; day: number }[];
  oil: OilMarket;
  /** World events: active and recently ended (kept for the news list). */
  events: WorldEvent[];
}
