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
}

const DRY: CargoClass[] = ['bulk', 'general'];

export function generateContract(
  world: World, g: GameState, originId: string, kind: ContractKind = { classes: DRY },
): Contract | null {
  const origin = world.ports[originId];
  const T = CONTRACT_TUNING;
  const options = origin.produces.filter((p) => {
    const good = world.goods[p.good];
    return kind.classes.includes(good.cargoClass) && (!kind.big || good.bigLotMax !== undefined);
  });
  if (options.length === 0) return null;
  const produced = pickWeighted(g, options, (p) => p.weight);
  const good = world.goods[produced.good];
  const buyers = world.portList.flatMap((p) =>
    p.id === originId ? [] : p.demands.filter((d) => d.good === good.id).map((d) => ({ port: p, strength: d.strength })),
  );
  if (buyers.length === 0) return null;
  const buyer = pickWeighted(g, buyers, (b) => b.strength);
  const nm = world.distance(originId, buyer.port.id);
  if (!isFinite(nm)) return null;

  const raw = kind.big && good.bigLotMax !== undefined
    ? randRange(g, good.lotMax, good.bigLotMax)
    : randRange(g, good.lotMin, good.lotMax);
  const tons = Math.round(raw / 50) * 50;
  const slack = randRange(g, T.slackMin, T.slackMax);
  const refDays = nm / (T.referenceSpeedKn * 24);
  const urgency = 1 + T.urgencyBonus * ((T.slackMax - slack) / (T.slackMax - T.slackMin));
  const noise = randRange(g, 0.88, 1.12);
  const pay = T.payScale * tons * good.freightRate * ((T.handlingNm + nm) / 1000) * buyer.strength * urgency * noise;

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
    const c = generateContract(world, g, portId, kind);
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
  addContracts(world, g, portId, board, randInt(g, T.bigLotsMin, T.bigLotsMax), { classes: DRY, big: true });
  // Liquid cargo comes in volume where it's produced; refrigerated cargo less so.
  for (const [cls, min, max] of [['liquid', 2, 4], ['reefer', T.specialtyMin, T.specialtyMax]] as [CargoClass, number, number][]) {
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
    const c = generateContract(world, g, portId, pickKind(g));
    if (c) port.board.push(c);
  }
}
