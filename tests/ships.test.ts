import { describe, expect, it } from 'vitest';
import {
  RULES, acceptContract, advance, borrow, buyShip, canCarry, newGame, repayLoan, saleQuote, sellShip, typeOf,
} from '../src/sim/game';
import { migrate } from '../src/sim/save';
import {
  SHIP_TUNING, breakdownAgeFactor, consumptionFactor, effectiveSpeed, fleetValue, maxLoan, netWorth, quotePurchase,
  saleValue, shipValue,
} from '../src/sim/ships';
import type { GameState, ShipOffer } from '../src/sim/types';
import { getWorld } from '../src/sim/world';

const world = getWorld();
const T = world.shipTypes;

function withOffer(g: GameState, port: string, offer: Omit<ShipOffer, 'id'>): { g: GameState; id: number } {
  const id = 99_999;
  const copy = structuredClone(g);
  copy.ports[port].market.push({ ...offer, id });
  return { g: copy, id };
}

describe('ship value and age', () => {
  it('loses value with age and wear, down to scrap', () => {
    expect(shipValue(T.general, 0, 100)).toBe(T.general.newPrice);
    expect(shipValue(T.general, 10, 80)).toBeLessThan(shipValue(T.general, 5, 80));
    expect(shipValue(T.general, 10, 50)).toBeLessThan(shipValue(T.general, 10, 90));
    expect(shipValue(T.general, 80, 100)).toBeCloseTo(T.general.newPrice * SHIP_TUNING.scrapShare, -3);
  });

  it('makes new ships faster, more frugal and more reliable than old ones', () => {
    const young = { age: 0, condition: 100 };
    const old = { age: 30, condition: 100 };
    expect(effectiveSpeed(T.coaster, young)).toBeGreaterThan(effectiveSpeed(T.coaster, old));
    expect(consumptionFactor(young)).toBeLessThan(consumptionFactor(old));
    expect(breakdownAgeFactor(young)).toBeLessThan(breakdownAgeFactor(old));
  });

  it('ages the fleet as time passes', () => {
    const g0 = newGame(1);
    const g = advance(g0, 1);
    expect(g.fleet[0].age).toBeCloseTo(g0.fleet[0].age + 1 / 365, 6);
  });
});

describe('ship market and fleet', () => {
  it('offers used ships everywhere and new ones at shipyards', () => {
    const g = newGame(2);
    for (const p of world.portList) {
      const market = g.ports[p.id].market;
      expect(market.filter((o) => o.age > 0).length).toBeGreaterThanOrEqual(SHIP_TUNING.usedOffersMin);
      expect(market.filter((o) => o.age === 0).length).toBe(p.shipyard ? Object.keys(T).length : 0);
    }
  });

  it('adds a bought ship to the fleet, in the port where it was bought', () => {
    const base = { ...newGame(3), cash: 2_000_000 };
    const { g, id } = withOffer(base, 'singapore', { typeId: 'general', name: 'Test', age: 10, condition: 80, price: 1_500_000 });
    const after = buyShip(g, 'singapore', id);
    expect(after.fleet).toHaveLength(2);
    const bought = after.fleet[1];
    expect(bought).toMatchObject({ typeId: 'general', name: 'Test', age: 10, location: 'singapore' });
    expect(bought.fuel).toBe(Math.round(T.general.bunkerCapacity * RULES.newShipFuel));
    expect(after.fleet[0]).toEqual(g.fleet[0]); // the old ship is untouched
    expect(after.cash).toBe(g.cash - 1_500_000);
    expect(after.ports.singapore.market.some((o) => o.id === id)).toBe(false);
    expect(after.stats.shipsOwned).toBe(2);
  });

  it('borrows the shortfall, within the bank limit for the whole fleet', () => {
    const base = { ...newGame(4), cash: 500_000 };
    const ok = withOffer(base, 'rotterdam', { typeId: 'general', name: 'Lent', age: 12, condition: 75, price: 1_000_000 });
    const q = quotePurchase(ok.g, ok.g.ports.rotterdam.market.find((o) => o.id === ok.id)!, world);
    expect(q.blocked).toBeNull();
    expect(q.borrow).toBe(500_000);
    const after = buyShip(ok.g, 'rotterdam', ok.id);
    expect(after.loan).toBe(500_000);
    expect(after.cash).toBe(0);
    const tooDear = withOffer({ ...base, cash: 0 }, 'rotterdam', { typeId: 'container', name: 'Dear', age: 0, condition: 100, price: 15_000_000 });
    expect(() => buyShip(tooDear.g, 'rotterdam', tooDear.id)).toThrow(/bank lends at most/);
  });

  it('sells a ship, repaying any loan the smaller fleet can no longer secure', () => {
    const base = { ...newGame(5), cash: 3_000_000 };
    const { g, id } = withOffer(base, 'rotterdam', { typeId: 'general', name: 'Spare', age: 5, condition: 90, price: 2_000_000 });
    let fleet = buyShip(g, 'rotterdam', id);
    fleet = borrow(fleet, 1e9); // max out the loan
    const spare = fleet.fleet[1];
    const q = saleQuote(fleet, spare.id);
    expect(q.blocked).toBeNull();
    expect(q.repay).toBeGreaterThan(0);
    const sold = sellShip(fleet, spare.id);
    expect(sold.fleet).toHaveLength(1);
    expect(sold.loan).toBeLessThanOrEqual(maxLoan(sold, world));
    expect(sold.cash).toBe(fleet.cash + q.price + q.fuelRefund - q.repay);
    expect(() => sellShip(sold, sold.fleet[0].id)).toThrow(/last ship/);
  });

  it("won't sell a ship with cargo aboard", () => {
    const base = { ...newGame(6), cash: 3_000_000 };
    const { g, id } = withOffer(base, 'rotterdam', { typeId: 'coaster', name: 'Busy', age: 5, condition: 90, price: 900_000 });
    let fleet = buyShip(g, 'rotterdam', id);
    const ship = fleet.fleet[1];
    const c = fleet.ports.rotterdam.board.find((x) => canCarry(ship, x) === null)!;
    fleet = acceptContract(fleet, ship.id, c.id);
    expect(() => sellShip(fleet, ship.id)).toThrow(/cargo/);
  });
});

describe('bank', () => {
  it('lends against the fleet and charges interest daily', () => {
    let g = newGame(7);
    const limit = maxLoan(g, world);
    g = borrow(g, 10_000_000);
    expect(g.loan).toBe(limit);
    const cash = g.cash;
    g = advance(g, 1);
    const interest = Math.round(limit * SHIP_TUNING.loanDailyRate);
    expect(g.cash).toBe(cash - typeOf(g.fleet[0]).dailyCost - interest);
    expect(() => borrow(g, 1000)).toThrow();
    g = repayLoan(g, Infinity);
    expect(g.loan).toBe(0);
  });

  it('counts every ship and the loan in net worth', () => {
    const g = newGame(8);
    const ship = g.fleet[0];
    expect(fleetValue(g, world)).toBe(shipValue(T.coaster, ship.age, ship.condition));
    expect(netWorth(g, world)).toBe(g.cash + fleetValue(g, world));
    expect(saleValue(ship, world)).toBeLessThan(fleetValue(g, world));
    expect(netWorth(borrow(g, 100_000), world)).toBe(netWorth(g, world));
  });
});

describe('boards and saves', () => {
  it('always gives a small ship something to carry', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = newGame(seed);
      for (const p of world.portList) {
        const here = { ...g.fleet[0], location: p.id };
        expect(g.ports[p.id].board.some((c) => canCarry(here, c) === null), `${p.id} seed ${seed}`).toBe(true);
      }
    }
  });

  it('upgrades a version-1 save all the way to the fleet format', () => {
    const fresh = newGame(9);
    const g = JSON.parse(JSON.stringify(fresh));
    // Rebuild what a version-1 save looked like.
    g.version = 1;
    g.ship = { ...g.fleet[0] };
    delete g.ship.id;
    delete g.ship.age;
    delete g.fleet;
    delete g.reports;
    delete g.loan;
    delete g.milestones;
    delete g.oil;
    delete g.events;
    g.wonAt = 42;
    for (const p of Object.values(g.ports) as Record<string, unknown>[]) { delete p.market; delete p.prices; }
    const m = migrate(g)!;
    expect(m.version).toBe(4);
    expect(m.fleet).toHaveLength(1);
    expect(m.fleet[0]).toMatchObject({ name: 'Tilly', age: 24 });
    expect(typeof m.fleet[0].id).toBe('number');
    expect(m.reports).toEqual([]);
    expect(m.loan).toBe(0);
    expect(m.oil.index).toBe(1);
    expect(m.milestones).toEqual([{ amount: 1_000_000, day: 42 }]);
    expect(m.ports.rotterdam.market.length).toBeGreaterThan(0);
    expect(m.ports.rotterdam.prices).toEqual({});
  });
});
