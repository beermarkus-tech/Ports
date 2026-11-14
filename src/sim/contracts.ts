import { pickWeighted, rand, randInt, randRange } from './rng';
import type { Contract, GameState } from './types';
import type { World } from './world';

/** Balancing knobs for cargo pay. Kept together so they're easy to tune. */
export const CONTRACT_TUNING = {
  /** Global multiplier on all cargo pay. The main balance dial. */
  payScale: 1.3,
  /** Fixed share of the freight paid regardless of distance (loading/handling). */
  handlingNm: 500,
  /** Reference speed used to set deadlines, knots. */
  referenceSpeedKn: 11,
  /** Deadline slack range as a multiple of reference sailing time. */
  slackMin: 1.25,
  slackMax: 2.3,
  /** How much extra a tight deadline pays (at slackMin). */
  urgencyBonus: 0.3,
  boardSizeMin: 6,
  boardSizeMax: 8,
  /** Contracts sit on a board this many days before being withdrawn. */
  boardLifetime: 12,
};

/** Fraction of pay kept when delivering `lateDays` (fractional) after the deadline. */
export function latePayFactor(lateDays: number): number {
  if (lateDays <= 0) return 1;
  return Math.max(0, 1 - 0.15 * Math.ceil(lateDays));
}

export function generateContract(world: World, g: GameState, originId: string): Contract | null {
  const origin = world.ports[originId];
  const T = CONTRACT_TUNING;
  const produced = pickWeighted(g, origin.produces, (p) => p.weight);
  const good = world.goods[produced.good];
  const buyers = world.portList.flatMap((p) =>
    p.id === originId ? [] : p.demands.filter((d) => d.good === good.id).map((d) => ({ port: p, strength: d.strength })),
  );
  if (buyers.length === 0) return null;
  const buyer = pickWeighted(g, buyers, (b) => b.strength);
  const nm = world.distance(originId, buyer.port.id);
  if (!isFinite(nm)) return null;

  const tons = Math.round(randRange(g, good.lotMin, good.lotMax) / 50) * 50;
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

/** Replace a port's board with a fresh set of offers. */
export function regenerateBoard(world: World, g: GameState, portId: string): void {
  const T = CONTRACT_TUNING;
  const n = randInt(g, T.boardSizeMin, T.boardSizeMax);
  const board: Contract[] = [];
  for (let tries = 0; board.length < n && tries < n * 4; tries++) {
    const c = generateContract(world, g, portId);
    if (c) board.push(c);
  }
  g.ports[portId].board = board;
}

/** Daily churn while the player waits: old offers go, a few new ones appear. */
export function churnBoard(world: World, g: GameState, portId: string): void {
  const T = CONTRACT_TUNING;
  const port = g.ports[portId];
  port.board = port.board.filter((c) => g.day - c.postedDay < T.boardLifetime && c.deadline > g.day + 2);
  const add = rand(g) < 0.6 ? randInt(g, 1, 2) : 0;
  for (let i = 0; i < add && port.board.length < T.boardSizeMax + 2; i++) {
    const c = generateContract(world, g, portId);
    if (c) port.board.push(c);
  }
}
