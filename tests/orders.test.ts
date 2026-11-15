import { describe, expect, it } from 'vitest';
import {
  ActionError, advance, clearOrders, isReady, needsDecision, newGame, resumeOrders, setOrders, shipsNeedingDecision,
} from '../src/sim/game';
import type { GameState } from '../src/sim/types';

const ship = (g: GameState) => g.fleet[0];

/** Run the clock in day steps, as the app does, collecting where the ship calls. */
function run(g: GameState, days: number): { g: GameState; calls: string[] } {
  const calls: string[] = [];
  for (let d = 0; d < days; d++) {
    g = advance(g, 1);
    for (const r of g.reports) if (r.shipId === ship(g).id) calls.push(r.to);
    g = { ...g, reports: [] };
  }
  return { g, calls };
}

describe('standing orders', () => {
  it('in loop mode, visits its ports strictly in order without asking for orders', () => {
    let g = newGame(5);
    g = setOrders(g, ship(g).id, ['rotterdam', 'lagos', 'newyork'], 50, 'loop');
    expect(shipsNeedingDecision(g)).toHaveLength(0);
    const out = run(g, 200);
    expect(out.calls.slice(0, 4)).toEqual(['lagos', 'newyork', 'rotterdam', 'lagos']);
    expect(ship(out.g).earnings?.length).toBeGreaterThan(3);
  });

  it('in best-pay mode, trades among its ports and makes money', () => {
    let g = newGame(5);
    const worth = g.cash - g.loan;
    const ports = ['rotterdam', 'newyork', 'lagos', 'santos', 'genoa'];
    g = setOrders(g, ship(g).id, ports, 50);
    const out = run(g, 200);
    expect(out.calls.length).toBeGreaterThan(5);
    for (const c of out.calls) expect(ports).toContain(c);
    expect(ship(out.g).orders?.halted).toBeUndefined();
    expect(out.g.cash - out.g.loan).toBeGreaterThan(worth);
  });

  it('books cargo for the other ports on its route when it calls', () => {
    let g = newGame(5);
    g = { ...g, ports: { ...g.ports, rotterdam: { ...g.ports.rotterdam, board: [] } } };
    g = setOrders(g, ship(g).id, ['rotterdam', 'lagos'], 50);
    // Rotterdam ships machinery and cars to Lagos, so bookings come in within a few days.
    for (let d = 0; d < 4 && !ship(g).voyage; d++) g = advance(g, 1);
    expect(ship(g).voyage?.to).toBe('lagos');
    expect(ship(g).cargo.every((c) => c.dest === 'lagos')).toBe(true);
    expect(ship(g).cargo.length).toBeGreaterThan(0);
  });

  it('waits a few days for cargo rather than sail empty', () => {
    let g = newGame(5);
    g = { ...g, ports: { ...g.ports, rotterdam: { ...g.ports.rotterdam, board: [] } } };
    // Rotterdam ships nothing a coaster can take that Istanbul buys: no bookings, so it waits.
    g = setOrders(g, ship(g).id, ['rotterdam', 'istanbul'], 50);
    expect(ship(g).voyage).toBeUndefined();
    expect(ship(g).waitUntil).toBe(g.day + 1);
    expect(shipsNeedingDecision(g)).toHaveLength(0);
    for (let d = 0; d < 5 && !ship(g).voyage; d++) g = advance(g, 1);
    expect(ship(g).voyage?.to).toBe('istanbul');
  });

  it('marks its arrival reports as automatic', () => {
    let g = newGame(5);
    g = setOrders(g, ship(g).id, ['rotterdam', 'genoa'], 50);
    for (let d = 0; d < 40 && !g.reports.length; d++) g = advance(g, 1);
    expect(g.reports[0]?.auto).toBe(true);
  });

  it('only takes cargo for ports on its route, in time', () => {
    let g = newGame(8);
    g = setOrders(g, ship(g).id, ['rotterdam', 'santos', 'newyork'], 50);
    for (const c of ship(g).cargo) {
      expect(['santos', 'newyork']).toContain(c.dest);
      expect(c.deadline).toBeGreaterThan(g.day);
    }
  });

  it('goes into dry dock when worn, then carries on', () => {
    let g = newGame(5);
    g = { ...g, fleet: [{ ...ship(g), condition: 40 }] };
    g = setOrders(g, ship(g).id, ['rotterdam', 'genoa'], 60);
    expect(ship(g).voyage).toBeUndefined();
    expect(ship(g).busyUntil).toBeGreaterThan(g.day);
    expect(ship(g).condition).toBe(100);
    g = run(g, 20).g;
    expect(ship(g).voyage !== undefined || ship(g).location === 'genoa').toBe(true);
  });

  it('stops and asks when it cannot pay for fuel, and can resume', () => {
    let g = newGame(5);
    const lot = { id: 9999, good: 'machinery', tons: 100, origin: 'rotterdam', dest: 'genoa', pay: 20_000, deadline: 200, postedDay: 0 };
    g = { ...g, cash: -10_000_000, fleet: [{ ...ship(g), fuel: 0, cargo: [lot] }] };
    g = setOrders(g, ship(g).id, ['rotterdam', 'genoa'], 50);
    expect(ship(g).orders?.halted).toMatch(/fuel/);
    expect(needsDecision(g, ship(g))).toBe(true);
    g = { ...g, cash: 1_000_000 };
    g = resumeOrders(g, ship(g).id);
    expect(ship(g).orders?.halted).toBeUndefined();
    expect(ship(g).voyage?.to).toBe('genoa');
  });

  it('stops when the next port is out of range', () => {
    let g = newGame(5);
    g = setOrders(g, ship(g).id, ['rotterdam', 'auckland'], 50, 'loop');
    expect(ship(g).orders?.halted).toMatch(/range/);
    g = setOrders(g, ship(g).id, ['rotterdam', 'auckland'], 50);
    expect(ship(g).orders?.halted).toMatch(/reached/);
  });

  it('refuses a route without two different ports', () => {
    const g = newGame(5);
    expect(() => setOrders(g, ship(g).id, ['genoa', 'genoa'], 50)).toThrow(ActionError);
  });

  it('can be taken off its route', () => {
    let g = newGame(5);
    g = setOrders(g, ship(g).id, ['rotterdam', 'genoa'], 50);
    g = clearOrders(g, ship(g).id);
    expect(ship(g).orders).toBeUndefined();
    g = run(g, 30).g;
    expect(isReady(g, ship(g))).toBe(true);
    expect(needsDecision(g, ship(g))).toBe(true);
  });
});
