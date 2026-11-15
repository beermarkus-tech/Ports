import { describe, expect, it } from 'vitest';
import { botStep } from '../src/sim/bot';
import { latePayFactor } from '../src/sim/contracts';
import {
  ActionError, RULES, acceptContract, advance, buyFuel, canCarry, daysUntilNextShip, isReady, isStranded, newGame,
  planVoyage, repair, sail, takeReport, typeOf, unloadContract, voyageProgress,
} from '../src/sim/game';
import { maxLoan } from '../src/sim/ships';
import type { GameState } from '../src/sim/types';
import { getWorld } from '../src/sim/world';

const world = getWorld();
const first = (g: GameState) => g.fleet[0];

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

describe('port actions', () => {
  it('is deterministic for a seed', () => {
    expect(newGame(42)).toEqual(newGame(42));
  });

  it('starts with one ship and contracts on every board', () => {
    const g = newGame(1);
    expect(g.fleet).toHaveLength(1);
    expect(isReady(g, first(g))).toBe(true);
    for (const p of world.portList) expect(g.ports[p.id].board.length).toBeGreaterThan(0);
  });

  it('never mutates the input state', () => {
    const g = newGame(3);
    const snapshot = structuredClone(g);
    const ship = first(g);
    const c = g.ports[ship.location].board.find((x) => canCarry(ship, x) === null)!;
    acceptContract(g, ship.id, c.id);
    buyFuel(g, ship.id, 10);
    advance(g, 3);
    expect(g).toEqual(snapshot);
  });

  it('loads and unloads cargo, respecting capacity', () => {
    let g = newGame(5);
    const ship = first(g);
    const cap = typeOf(ship).capacity;
    const fit = g.ports[ship.location].board.find((c) => c.tons <= cap)!;
    g = acceptContract(g, ship.id, fit.id);
    expect(first(g).cargo.map((c) => c.id)).toContain(fit.id);
    g = unloadContract(g, ship.id, fit.id);
    expect(first(g).cargo).toHaveLength(0);
    g.ports[ship.location].board.push({ ...fit, id: 9999, tons: cap + 1 });
    expect(() => acceptContract(g, ship.id, 9999)).toThrow(ActionError);
  });

  it('caps fuel purchases at bunker capacity and charges for it', () => {
    const g0 = newGame(7);
    const g = buyFuel(g0, first(g0).id, 10_000);
    expect(first(g).fuel).toBe(typeOf(first(g)).bunkerCapacity);
    expect(g.cash).toBeLessThan(g0.cash);
  });

  it('refuses to sail without enough fuel or beyond range', () => {
    let g = newGame(9);
    const id = first(g).id;
    g = { ...g, fleet: [{ ...first(g), fuel: 0 }] };
    expect(() => sail(g, id, 'genoa')).toThrow(/fuel/);
    g = buyFuel(g, id, 10_000);
    expect(planVoyage(g, id, 'sydney')!.inRange).toBe(false);
    expect(() => sail(g, id, 'sydney')).toThrow(/range/);
  });

  it('puts a ship in dry dock for a few days', () => {
    const g0 = newGame(13);
    const id = first(g0).id;
    const g = repair(g0, id, 20);
    expect(first(g).condition).toBe(Math.floor(first(g0).condition) + 20);
    expect(isReady(g, first(g))).toBe(false);
    expect(g.cash).toBeLessThan(g0.cash);
    expect(() => sail(buyFuel(g0, id, 1e6), id, 'genoa')).not.toThrow();
    const later = advance(g, 2.01);
    expect(isReady(later, first(later))).toBe(true);
  });

  it('penalises late delivery', () => {
    expect(latePayFactor(0)).toBe(1);
    expect(latePayFactor(0.5)).toBeCloseTo(0.85);
    expect(latePayFactor(3)).toBeCloseTo(0.55);
    expect(latePayFactor(20)).toBe(0);
  });
});

describe('the world clock', () => {
  function departed(seed: number) {
    let g = newGame(seed);
    const ship = first(g);
    const c = g.ports.rotterdam.board.find((x) => canCarry(ship, x) === null && planVoyage(g, ship.id, x.dest)!.inRange)!;
    g = acceptContract(g, ship.id, c.id);
    g = buyFuel(g, ship.id, 10_000);
    return { g: sail(g, ship.id, c.dest), c, id: ship.id };
  }

  it('sends a ship to sea and plays the voyage out over time', () => {
    const { g, c, id } = departed(11);
    const ship = first(g);
    expect(ship.voyage!.to).toBe(c.dest);
    expect(isReady(g, ship)).toBe(false);
    expect(g.day).toBe(0);
    const halfway = advance(g, ship.voyage!.seaArrivalDay / 2);
    expect(voyageProgress(halfway, first(halfway))).toBeCloseTo(0.5, 1);
    expect(first(halfway).voyage).toBeDefined();
    expect(() => sail(halfway, id, 'genoa')).toThrow(/at sea/);
  });

  it('delivers and pays when the arrival day comes, with a report', () => {
    const { g, c, id } = departed(11);
    const wait = daysUntilNextShip(g)!;
    const cashBefore = g.cash;
    const arrived = advance(g, wait + 0.001);
    const ship = first(arrived);
    expect(ship.voyage).toBeUndefined();
    expect(ship.location).toBe(c.dest);
    expect(ship.cargo).toHaveLength(0);
    const { report, state } = takeReport(arrived);
    expect(report!.shipId).toBe(id);
    expect(report!.deliveries[0].paid).toBe(Math.round(c.pay * latePayFactor(report!.deliveries[0].lateDays)));
    expect(state.reports).toHaveLength(0);
    // Cash = before − daily upkeep and interest + revenue − fees − event costs.
    const expected = cashBefore - arrived.stats.upkeepPaid - arrived.stats.interestPaid
      + report!.revenue - report!.portFee - report!.canalFees - report!.eventCosts;
    expect(arrived.cash).toBe(expected);
  });

  it('charges upkeep every day, at sea or in port', () => {
    const g = newGame(12);
    const later = advance(g, 10);
    expect(later.cash).toBe(g.cash - 10 * typeOf(first(g)).dailyCost);
    expect(later.day).toBe(10);
  });

  it('keeps the books consistent over a long bot playthrough', () => {
    let g = newGame(2024);
    for (let i = 0; i < 25 && !g.gameOver; i++) {
      g = botStep(g);
      expect(Number.isFinite(g.cash)).toBe(true);
      expect(first(g).fuel).toBeGreaterThanOrEqual(0);
      expect(first(g).condition).toBeGreaterThanOrEqual(0);
      expect(first(g).condition).toBeLessThanOrEqual(100);
    }
    expect(g.stats.voyages).toBeGreaterThan(10);
  });
});

describe('bank and bankruptcy', () => {
  it('covers a shortfall from the loan before using the overdraft', () => {
    let g = newGame(17);
    const id = first(g).id;
    g = { ...g, cash: 1000, fleet: [{ ...first(g), fuel: 0 }] };
    g = buyFuel(g, id, 50);
    expect(first(g).fuel).toBe(50);
    expect(g.cash).toBeGreaterThanOrEqual(0);
    expect(g.loan).toBeGreaterThan(0);
    expect(g.log[0].text).toMatch(/covered your shortfall/);
  });

  it('uses the overdraft once the loan is maxed, and charges interest on it', () => {
    let g = newGame(17);
    const id = first(g).id;
    g = { ...g, cash: 1000, loan: maxLoan(g, world), fleet: [{ ...first(g), fuel: 0 }] };
    g = buyFuel(g, id, 50);
    expect(g.cash).toBeLessThan(0);
    expect(g.cash).toBeGreaterThanOrEqual(-RULES.overdraftLimit);
    const before = g.cash;
    g = advance(g, 1);
    expect(g.cash).toBeLessThan(before - typeOf(first(g)).dailyCost); // upkeep plus interest
    expect(g.gameOver).toBeUndefined();
  });

  it('goes bankrupt only when loan and overdraft are used up', () => {
    const base = newGame(19);
    expect(advance({ ...base, cash: -RULES.overdraftLimit + 500 }, 1).gameOver).toBeUndefined();
    const broke = advance({ ...base, cash: -RULES.overdraftLimit + 500, loan: maxLoan(base, world) }, 1);
    expect(broke.gameOver).toMatch(/Bankrupt/);
  });

  it('ends the game when every ship is stranded', () => {
    const base = newGame(23);
    const g = { ...base, cash: -RULES.overdraftLimit + 1000, loan: maxLoan(base, world), fleet: [{ ...first(base), fuel: 0 }] };
    expect(isStranded(g, first(g).id)).toBe(true);
    expect(isStranded(base, first(base).id)).toBe(false);
  });
});
