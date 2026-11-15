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
}

export type VoyageEventKind = 'storm' | 'breakdown' | 'emergencyFuel';

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
}

export interface LogEntry {
  day: number;
  text: string;
  amount?: number;
}

export interface GameState {
  version: 2;
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
}
