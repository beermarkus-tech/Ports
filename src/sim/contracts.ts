import { priceLevel, routeFor } from './economy';
import { pickWeighted, rand, randInt, randRange } from './rng';
import type { CargoClass, Contract, GameState } from './types';
import type { World } from './world';

/** Balancing knobs for cargo pay. Kept together so they're easy to tune. */
export const CONTRACT_TUNING = {
  /** Global multiplier on all cargo pay. The main balance dial. */
  payScale: 1.5,
  /** Fixed share of the freight paid regardless of distance (loading/handling). */
  handlingNm: 500,
  /** Reference speed used to set deadlines, knots. */
  referenceSpeedKn: 11,
  /** Deadline slack range as a multiple of reference sailing time. */
  slackMin: 1.25,
  slackMax: 2.3,
  /** How much extra a tight deadline pays (at slackMin). */
  urgencyBonus: 0.3,
  /** Ordinary dry-cargo lots on every board (what a small ship lives on). */
  boardSizeMin: 6,
  boardSizeMax: 8,
  /** Extra big shipments per board, for larger ships. */
  bigLotsMin: 1,
  bigLotsMax: 3,
  /** Extra liquid / refrigerated offers per board, where the port produces them. */
  specialtyMin: 1,
  specialtyMax: 2,
  /**
   * Cargo clusters on busy lanes: a destination already on the board is this many
   * times more likely to be picked again, so ships can fill up for one trip.
   */
  laneBias: 4,
  /**
   * Nearer buyers are likelier (short-sea trade dominates): a buyer this many
   * miles away is half as likely as one next door.
   */
  nearbyNm: 5000,
  /** Contracts sit on a board this many days before being withdrawn. */
  boardLifetime: 12,
};

/** Fraction of pay kept when delivering `lateDays` (fractional) after the deadline. */
export function latePayFactor(lateDays: number): number {
  if (lateDays <= 0) return 1;
  return Math.max(0, 1 - 0.15 * Math.ceil(lateDays));
}

export interface ContractKind {
  /** Only goods of these classes. */
  classes: CargoClass[];
  /** A big shipment (from lotMax up to bigLotMax) instead of an ordinary lot. */
  big?: boolean;
  /** Cap the lot at this many tons (so the smallest ships always find work). */
  maxTons?: number;
}

/** Every board offers at least this many lots that fit the starting coaster. */
const SMALL_LOT_TONS = 3000;
const SMALL_LOTS_MIN = 2;

const DRY: CargoClass[] = ['bulk', 'general'];

export function generateContract(
  world: World, g: GameState, originId: string, kind: ContractKind = { classes: DRY },
  lanes: ReadonlySet<string> = new Set(),
): Contract | null {
  const origin = world.ports[originId];
  const T = CONTRACT_TUNING;
  const options = origin.produces.filter((p) => {
    const good = world.goods[p.good];
    return kind.classes.includes(good.cargoClass) && (!kind.big || good.bigLotMax !== undefined) &&
      (kind.maxTons === undefined || good.lotMin <= kind.maxTons);
  });
  if (options.length === 0) return null;
  const produced = pickWeighted(g, options, (p) => p.weight);
  const good = world.goods[produced.good];
  const buyers = world.portList.flatMap((p) => {
    if (p.id === originId) return [];
    const route = routeFor(world, g, originId, p.id);
    if (!route) return [];
    return p.demands.filter((d) => d.good === good.id).map((d) => ({ port: p, strength: d.strength, nm: route.nm }));
  });
  if (buyers.length === 0) return null;
  const buyer = pickWeighted(g, buyers, (b) =>
    b.strength * (lanes.has(b.port.id) ? T.laneBias : 1) * (T.nearbyNm / (T.nearbyNm + b.nm)));
  const nm = buyer.nm;

  const raw = kind.big && good.bigLotMax !== undefined
    ? randRange(g, good.lotMax, good.bigLotMax)
    : randRange(g, good.lotMin, Math.min(good.lotMax, kind.maxTons ?? Infinity));
  const tons = Math.round(raw / 50) * 50;
  const slack = randRange(g, T.slackMin, T.slackMax);
  const refDays = nm / (T.referenceSpeedKn * 24);
  const urgency = 1 + T.urgencyBonus * ((T.slackMax - slack) / (T.slackMax - T.slackMin));
  const noise = randRange(g, 0.88, 1.12);
  const market = priceLevel(g, buyer.port.id, good.id);
  const pay = T.payScale * tons * good.freightRate * ((T.handlingNm + nm) / 1000) * buyer.strength * market * urgency * noise;

  return {
    id: g.nextId++,
    good: good.id,
    tons,
    origin: originId,
    dest: buyer.port.id,
    pay: Math.round(pay / 100) * 100,
    deadline: Math.ceil(g.day + refDays * slack + 2),
    postedDay: Math.floor(g.day),
  };
}

function addContracts(world: World, g: GameState, portId: string, board: Contract[], n: number, kind: ContractKind): void {
  let added = 0;
  for (let tries = 0; added < n && tries < n * 4; tries++) {
    const lanes = new Set(board.map((c) => c.dest));
    const c = generateContract(world, g, portId, kind, lanes);
    if (c) { board.push(c); added++; }
  }
}

/** The mix of offers on a board: ordinary dry lots, big shipments, and liquid/refrigerated cargo. */
function pickKind(g: GameState): ContractKind {
  const r = rand(g);
  if (r < 0.65) return { classes: DRY };
  if (r < 0.8) return { classes: DRY, big: true };
  if (r < 0.9) return { classes: ['liquid'], big: rand(g) < 0.3 };
  return { classes: ['reefer'], big: rand(g) < 0.3 };
}

/** Replace a port's board with a fresh set of offers. */
export function regenerateBoard(world: World, g: GameState, portId: string): void {
  const T = CONTRACT_TUNING;
  const board: Contract[] = [];
  addContracts(world, g, portId, board, randInt(g, T.boardSizeMin, T.boardSizeMax), { classes: DRY });
  const small = board.filter((c) => c.tons <= SMALL_LOT_TONS).length;
  if (small < SMALL_LOTS_MIN) {
    addContracts(world, g, portId, board, SMALL_LOTS_MIN - small, { classes: DRY, maxTons: SMALL_LOT_TONS });
  }
  addContracts(world, g, portId, board, randInt(g, T.bigLotsMin, T.bigLotsMax), { classes: DRY, big: true });
  // Liquid cargo comes in volume where it's produced; refrigerated cargo less so.
  for (const [cls, min, max] of [['liquid', 3, 5], ['reefer', T.specialtyMin, T.specialtyMax]] as [CargoClass, number, number][]) {
    const n = randInt(g, min, max);
    for (let i = 0; i < n; i++) addContracts(world, g, portId, board, 1, { classes: [cls], big: rand(g) < 0.3 });
  }
  g.ports[portId].board = board;
}

/** Daily churn while the player waits: old offers go, a few new ones appear. */
export function churnBoard(world: World, g: GameState, portId: string): void {
  const T = CONTRACT_TUNING;
  const port = g.ports[portId];
  port.board = port.board.filter((c) => g.day - c.postedDay < T.boardLifetime && c.deadline > g.day + 2);
  const add = rand(g) < 0.6 ? randInt(g, 1, 2) : 0;
  for (let i = 0; i < add && port.board.length < T.boardSizeMax + T.bigLotsMax + 4; i++) {
    const c = generateContract(world, g, portId, pickKind(g), new Set(port.board.map((b) => b.dest)));
    if (c) port.board.push(c);
  }
}
