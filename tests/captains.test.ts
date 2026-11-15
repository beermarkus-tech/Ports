import { describe, expect, it } from 'vitest';
import { CAPTAIN_TUNING, captainSlots } from '../src/sim/captains';
import {
  ActionError, acceptContract, advance, assignCaptain, clearOrders, fireCaptain, hireCaptain, monthProfit, newGame, onOrders,
} from '../src/sim/game';
import { regionOf } from '../src/sim/regions';
import { migrate } from '../src/sim/save';
import type { Contract, GameState } from '../src/sim/types';

const ship = (g: GameState) => g.fleet[0];

function withCaptain(seed = 5): GameState {
  let g = newGame(seed);
  g = { ...g, cash: 5_000_000 };
  return hireCaptain(g, g.captainPool![0].id);
}

/** Day by day, collecting the ports the first ship calls at. */
function run(g: GameState, days: number): { g: GameState; calls: string[] } {
  const calls: string[] = [];
  for (let d = 0; d < days; d++) {
    g = advance(g, 1);
    for (const r of g.reports) if (r.shipId === ship(g).id) calls.push(r.to);
    g = { ...g, reports: [] };
  }
  return { g, calls };
}

describe('captains', () => {
  it('a new game starts with no captains, a pool to hire from and two posts', () => {
    const g = newGame(3);
    expect(g.captains).toEqual([]);
    expect(g.captainPool!.length).toBe(CAPTAIN_TUNING.poolSize);
    expect(captainSlots(g)).toBe(2);
    expect(onOrders(ship(g))).toBe(false);
  });

  it('hires up to the number of posts', () => {
    let g = newGame(3);
    g = hireCaptain(g, g.captainPool![0].id);
    g = hireCaptain(g, g.captainPool![0].id);
    expect(g.captains!.length).toBe(2);
    expect(g.captainPool!.length).toBe(CAPTAIN_TUNING.poolSize);
    expect(() => hireCaptain(g, g.captainPool![0].id)).toThrow(ActionError);
  });

  it('a captain trades within the given region by himself', () => {
    let g = withCaptain();
    const c = g.captains![0];
    g = assignCaptain(g, c.id, ship(g).id, ['europe'], 50);
    expect(onOrders(ship(g))).toBe(true);
    expect(ship(g).captainId).toBe(c.id);
    expect(ship(g).orders!.area).toEqual(['europe']);
    const out = run(g, 150);
    expect(out.calls.length).toBeGreaterThan(3);
    for (const p of out.calls) expect(regionOf(p)).toBe('europe');
  });

  it('on a lane, crosses after at most one leg within a region', () => {
    let g = withCaptain();
    g = { ...g, fleet: [{ ...ship(g), typeId: 'handysize', fuel: 500 }] };
    g = assignCaptain(g, g.captains![0].id, ship(g).id, ['europe', 'naeast'], 50);
    const out = run(g, 300);
    const regions = ['europe', ...out.calls.map((p) => regionOf(p))];
    expect(out.calls.length).toBeGreaterThan(4);
    for (let i = 2; i < regions.length; i++) {
      expect(regions[i] === regions[i - 1] && regions[i - 1] === regions[i - 2]).toBe(false);
    }
  });

  it('wages are paid daily and show in the company and ship books', () => {
    let g = withCaptain();
    const c = g.captains![0];
    g = assignCaptain(g, c.id, ship(g).id, ['europe'], 50);
    g = run(g, 31).g;
    const wages = g.books!.reduce((s, b) => s + (b.wages ?? 0), 0);
    expect(wages).toBeGreaterThan(c.wage * 0.95);
    expect(wages).toBeLessThan(c.wage * 1.1);
    const shipCosts = ship(g).books!.reduce((s, b) => s + b.costs, 0);
    expect(shipCosts).toBeGreaterThan(wages);
    expect(typeof monthProfit(g.books![0])).toBe('number');
  });

  it('premium jobs are only for ships you command yourself', () => {
    let g = withCaptain();
    const premium: Contract = { id: 7777, good: 'machinery', tons: 200, origin: 'rotterdam', dest: 'genoa', pay: 400_000, deadline: 40, postedDay: 0, premium: 'express' };
    g = { ...g, ports: { ...g.ports, rotterdam: { ...g.ports.rotterdam, board: [premium] } } };
    // By hand: fine.
    expect(acceptContract(g, ship(g).id, 7777).fleet[0].cargo.some((x) => x.id === 7777)).toBe(true);
    // With a captain: never loaded, and refused by hand.
    const h = assignCaptain(g, g.captains![0].id, ship(g).id, ['europe'], 50);
    expect(ship(h).cargo.some((x) => x.id === 7777)).toBe(false);
  });

  it('a ship with a captain refuses a premium job by hand', () => {
    let g = withCaptain();
    g = assignCaptain(g, g.captains![0].id, ship(g).id, ['europe'], 50);
    // Back in port with a premium job on the quay
    const s = { ...ship(g), voyage: undefined, location: 'genoa', waitUntil: undefined };
    const premium: Contract = { id: 7778, good: 'machinery', tons: 200, origin: 'genoa', dest: 'rotterdam', pay: 400_000, deadline: 400, postedDay: 0, premium: 'project' };
    g = { ...g, fleet: [s], ports: { ...g.ports, genoa: { ...g.ports.genoa, board: [premium] } } };
    expect(() => acceptContract(g, s.id, 7778)).toThrow(ActionError);
  });

  it('taking command back frees the captain; firing pays severance', () => {
    let g = withCaptain();
    const c = g.captains![0];
    g = assignCaptain(g, c.id, ship(g).id, ['europe'], 50);
    g = clearOrders(g, ship(g).id);
    expect(ship(g).captainId).toBeUndefined();
    expect(g.captains![0].shipId).toBeUndefined();
    const cash = g.cash;
    g = fireCaptain(g, c.id);
    expect(g.captains!.length).toBe(0);
    expect(cash - g.cash).toBe(c.wage * CAPTAIN_TUNING.severanceMonths);
  });

  it('an older save loses its routes when loaded: captains are needed now', () => {
    const fresh = newGame(9);
    const old = JSON.parse(JSON.stringify(fresh));
    delete old.captains;
    delete old.captainPool;
    old.fleet[0].orders = { stops: ['rotterdam', 'genoa'], next: 1, repairBelow: 50, mode: 'best' };
    const m = migrate(old)!;
    expect(m.fleet[0].orders).toBeUndefined();
    expect(m.captains).toEqual([]);
    expect(m.captainPool!.length).toBe(CAPTAIN_TUNING.poolSize);
  });
});
