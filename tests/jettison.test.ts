import { afterEach, describe, expect, it } from 'vitest';
import { acceptContract, advance, buyGoods, canCarry, jettisonClaim, jettisonContract, jettisonGoods, newGame, sail } from '../src/sim/game';
import { setEra } from '../src/sim/world';

describe('jettisoning cargo', () => {
  afterEach(() => setEra('modern'));

  const loaded = (seed: number) => {
    const g = newGame(seed);
    const ship = g.fleet[0];
    const c = g.ports[ship.location].board.find((x) => canCarry(ship, x) === null)!;
    return { g: acceptContract(g, ship.id, c.id), shipId: ship.id, c };
  };

  it('a charter can be thrown overboard at sea: the shipper claims 30% of the pay', () => {
    const { g: g0, shipId, c } = loaded(1);
    let g = sail({ ...g0, fleet: [{ ...g0.fleet[0], fuel: 2000 }] }, shipId, c.dest);
    g = advance(g, 1);
    expect(g.fleet[0].voyage).toBeDefined();
    const claim = jettisonClaim(c);
    expect(claim).toBeCloseTo(c.pay * 0.3, -2);
    const after = jettisonContract(g, shipId, c.id);
    expect(after.fleet[0].cargo).toHaveLength(0);
    expect(after.cash).toBe(g.cash - claim);
    expect(after.books!.at(-1)!.incidents).toBe((g.books!.at(-1)!.incidents ?? 0) + claim);
    // On arrival nothing is delivered and nothing paid for it.
    const arrived = advance(after, Math.ceil(after.fleet[0].voyage!.arriveDay - after.day) + 1);
    expect(arrived.reports.at(-1)!.deliveries).toHaveLength(0);
  });

  it('works in any port too, and frees the hold', () => {
    const { g, shipId, c } = loaded(2);
    const elsewhere = { ...g, fleet: [{ ...g.fleet[0], location: c.dest === 'hamburg' ? 'antwerp' : 'hamburg' }] };
    const after = jettisonContract(elsewhere, shipId, c.id);
    expect(after.fleet[0].cargo).toHaveLength(0);
    expect(() => jettisonContract(after, shipId, c.id)).toThrow();
  });

  it('goods on your own account can be jettisoned: what they cost is lost', () => {
    setEra('sail');
    const g0 = newGame(3);
    let g = { ...g0, cash: 1_000_000, fleet: [{ ...g0.fleet[0], location: 'bantam' }] };
    g = buyGoods(g, g.fleet[0].id, 'pepper', 40);
    const cost = g.fleet[0].goods![0].cost;
    const after = jettisonGoods(g, g.fleet[0].id, 'pepper');
    expect(after.fleet[0].goods ?? []).toHaveLength(0);
    expect(after.cash).toBe(g.cash);
    expect(after.books!.at(-1)!.trade).toBe(-cost);
  });
});
