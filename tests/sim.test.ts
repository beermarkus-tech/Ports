import { describe, expect, it } from 'vitest';
import { botStep } from '../src/sim/bot';
import { latePayFactor } from '../src/sim/contracts';
import {
  ActionError, acceptContract, buyFuel, canCarry, newGame, planVoyage, repair, sail, shipType, unloadContract, waitDay,
} from '../src/sim/game';
import { getWorld } from '../src/sim/world';

const world = getWorld();

describe('world', () => {
  it('connects every pair of ports', () => {
    for (const a of world.portList)
      for (const b of world.portList)
        if (a.id !== b.id) expect(world.route(a.id, b.id), `${a.id}->${b.id}`).not.toBeNull();
  });

  it('gives roughly real-world sea distances', () => {
    const ref: [string, string, number][] = [
      ['rotterdam', 'newyork', 3450], ['rotterdam', 'singapore', 8300], ['rotterdam', 'shanghai', 10500],
      ['singapore', 'shanghai', 2200], ['capetown', 'mumbai', 4600], ['newyork', 'santos', 5000],
    ];
    for (const [a, b, nm] of ref) {
      const d = world.distance(a, b);
      expect(d / nm, `${a}->${b} = ${d}`).toBeGreaterThan(0.9);
      expect(d / nm, `${a}->${b} = ${d}`).toBeLessThan(1.15);
    }
  });

  it('routes Europe–Asia through Suez and reroutes around Africa when it closes', () => {
    expect(world.route('rotterdam', 'singapore')!.canals).toEqual(['suez']);
    const cape = world.route('rotterdam', 'singapore', ['suez'])!;
    expect(cape.canals).toEqual([]);
    expect(cape.path).toContain('agulhas');
    expect(cape.nm).toBeGreaterThan(world.distance('rotterdam', 'singapore'));
  });

  it('references only known goods in port data', () => {
    for (const p of world.portList)
      for (const x of [...p.produces, ...p.demands]) expect(world.goods[x.good], `${p.id}: ${x.good}`).toBeDefined();
  });
});

describe('game', () => {
  it('is deterministic for a seed', () => {
    expect(newGame(42)).toEqual(newGame(42));
  });

  it('starts with contracts on every board', () => {
    const g = newGame(1);
    for (const p of world.portList) expect(g.ports[p.id].board.length).toBeGreaterThan(0);
  });

  it('never mutates the input state', () => {
    const g = newGame(3);
    const snapshot = structuredClone(g);
    const c = g.ports[g.ship.location].board.find((x) => canCarry(g, x) === null)!;
    acceptContract(g, c.id);
    buyFuel(g, 10);
    waitDay(g);
    expect(g).toEqual(snapshot);
  });

  it('loads and unloads cargo, respecting capacity', () => {
    let g = newGame(5);
    const cap = shipType(g).capacity;
    const board = g.ports[g.ship.location].board;
    const fit = board.find((c) => c.tons <= cap)!;
    g = acceptContract(g, fit.id);
    expect(g.ship.cargo.map((c) => c.id)).toContain(fit.id);
    g = unloadContract(g, fit.id);
    expect(g.ship.cargo).toHaveLength(0);
    const tooBig = { ...fit, id: 9999, tons: cap + 1 };
    g.ports[g.ship.location].board.push(tooBig);
    expect(() => acceptContract(g, 9999)).toThrow(ActionError);
  });

  it('caps fuel purchases at bunker capacity and charges for it', () => {
    const g0 = newGame(7);
    const g = buyFuel(g0, 10_000);
    expect(g.ship.fuel).toBe(shipType(g).bunkerCapacity);
    expect(g.cash).toBeLessThan(g0.cash);
  });

  it('refuses to sail without enough fuel or beyond range', () => {
    let g = newGame(9);
    g = { ...g, ship: { ...g.ship, fuel: 0 } };
    expect(() => sail(g, 'genoa')).toThrow(/fuel/);
    g = buyFuel(g, 10_000);
    expect(planVoyage(g, 'sydney')!.inRange).toBe(false);
    expect(() => sail(g, 'sydney')).toThrow(/range/);
  });

  it('delivers cargo and pays on arrival', () => {
    let g = newGame(11);
    const c = g.ports.rotterdam.board.find((x) => canCarry(g, x) === null && planVoyage(g, x.dest)!.inRange)!;
    g = acceptContract(g, c.id);
    g = buyFuel(g, 10_000);
    const before = g.cash;
    g = sail(g, c.dest);
    const r = g.lastVoyage!;
    expect(g.ship.location).toBe(c.dest);
    expect(g.ship.cargo).toHaveLength(0);
    expect(r.deliveries).toHaveLength(1);
    expect(r.deliveries[0].paid).toBe(Math.round(c.pay * latePayFactor(r.deliveries[0].lateDays)));
    expect(g.cash).toBe(before + r.net);
    expect(g.day).toBeGreaterThan(0);
    expect(r.fuelUsed).toBeGreaterThan(0);
  });

  it('penalises late delivery', () => {
    expect(latePayFactor(0)).toBe(1);
    expect(latePayFactor(0.5)).toBeCloseTo(0.85);
    expect(latePayFactor(3)).toBeCloseTo(0.55);
    expect(latePayFactor(20)).toBe(0);
  });

  it('repairs cost money and time', () => {
    const g0 = newGame(13);
    const g = repair(g0, 20);
    expect(g.ship.condition).toBe(Math.floor(g0.ship.condition) + 20);
    expect(g.day).toBe(2);
    expect(g.cash).toBeLessThan(g0.cash);
  });

  it('survives a long bot playthrough with consistent books', () => {
    let g = newGame(2024);
    for (let i = 0; i < 25 && !g.gameOver; i++) {
      const cash = g.cash;
      g = botStep(g);
      expect(Number.isFinite(g.cash)).toBe(true);
      expect(g.ship.fuel).toBeGreaterThanOrEqual(0);
      expect(g.ship.condition).toBeGreaterThanOrEqual(0);
      expect(g.ship.condition).toBeLessThanOrEqual(100);
      expect(cash).not.toBeNaN();
    }
    expect(g.stats.voyages).toBeGreaterThan(10);
  });
});
