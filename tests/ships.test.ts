import { describe, expect, it } from 'vitest';
import { RULES, acceptContract, borrow, buyShip, canCarry, newGame, repayLoan, shipType, waitDay } from '../src/sim/game';
import { migrate } from '../src/sim/save';
import {
  SHIP_TUNING, breakdownAgeFactor, consumptionFactor, effectiveSpeed, maxLoan, netWorth, quotePurchase, saleValue,
  shipValue,
} from '../src/sim/ships';
import type { GameState, ShipOffer } from '../src/sim/types';
import { getWorld } from '../src/sim/world';

const world = getWorld();
const T = world.shipTypes;

function withOffer(g: GameState, offer: Omit<ShipOffer, 'id'>): { g: GameState; id: number } {
  const id = 99_999;
  const copy = structuredClone(g);
  copy.ports[copy.ship.location].market.push({ ...offer, id });
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

  it('ages the ship as time passes', () => {
    const g0 = newGame(1);
    const g = waitDay(g0);
    expect(g.ship.age).toBeCloseTo(g0.ship.age + 1 / 365, 6);
  });
});

describe('ship market', () => {
  it('offers used ships everywhere and new ones at shipyards', () => {
    const g = newGame(2);
    for (const p of world.portList) {
      const market = g.ports[p.id].market;
      expect(market.filter((o) => o.age > 0).length).toBeGreaterThanOrEqual(SHIP_TUNING.usedOffersMin);
      const fresh = market.filter((o) => o.age === 0).length;
      expect(fresh).toBe(p.shipyard ? Object.keys(T).length : 0);
    }
  });

  it('swaps ships with the trade-in paying part of the price', () => {
    const base = { ...newGame(3), cash: 2_000_000 };
    const { g, id } = withOffer(base, { typeId: 'general', name: 'Test', age: 10, condition: 80, price: 1_500_000 });
    const tradeIn = saleValue(g, world);
    const after = buyShip(g, id);
    expect(after.ship.typeId).toBe('general');
    expect(after.ship.name).toBe('Test');
    expect(after.ship.age).toBe(10);
    // The coaster's fuel fits the bigger bunkers, so there's no fuel refund.
    expect(after.ship.fuel).toBe(g.ship.fuel);
    expect(after.cash).toBe(g.cash - (1_500_000 - tradeIn));
    expect(after.loan).toBe(0);
    expect(after.ports[after.ship.location].market.some((o) => o.id === id)).toBe(false);
    expect(after.stats.shipsOwned).toBe(2);
  });

  it('borrows the shortfall, within the bank limit', () => {
    const base = { ...newGame(4), cash: 500_000 };
    const ok = withOffer(base, { typeId: 'general', name: 'Lent', age: 12, condition: 75, price: 1_000_000 });
    const q = quotePurchase(ok.g, ok.g.ports[ok.g.ship.location].market.find((o) => o.id === ok.id)!, world);
    expect(q.blocked).toBeNull();
    expect(q.borrow).toBeGreaterThan(0);
    const after = buyShip(ok.g, ok.id);
    expect(after.loan).toBe(q.borrow);
    expect(after.cash).toBe(0);

    const tooDear = withOffer({ ...base, cash: 0 }, { typeId: 'container', name: 'Dear', age: 0, condition: 100, price: 15_000_000 });
    expect(() => buyShip(tooDear.g, tooDear.id)).toThrow(/bank lends at most/);
  });

  it('refuses to swap ships with cargo aboard', () => {
    let g = { ...newGame(5), cash: 5_000_000 };
    const c = g.ports[g.ship.location].board.find((x) => canCarry(g, x) === null)!;
    g = acceptContract(g, c.id);
    const o = withOffer(g, { typeId: 'general', name: 'Busy', age: 5, condition: 90, price: 1_000_000 });
    expect(() => buyShip(o.g, o.id)).toThrow(/cargo/);
  });
});

describe('bank', () => {
  it('lends against the ship and charges interest daily', () => {
    let g = newGame(6);
    const limit = maxLoan(g, world);
    g = borrow(g, 10_000_000);
    expect(g.loan).toBe(limit);
    const cash = g.cash;
    g = waitDay(g);
    const interest = Math.round(limit * SHIP_TUNING.loanDailyRate);
    expect(g.cash).toBe(cash - shipType(g).dailyCost - interest);
    expect(() => borrow(g, 1000)).toThrow();
    g = repayLoan(g, Infinity);
    expect(g.loan).toBe(0);
  });

  it('counts the ship and the loan in net worth', () => {
    const g = newGame(7);
    expect(netWorth(g, world)).toBe(g.cash + shipValue(T.coaster, g.ship.age, g.ship.condition));
    const indebted = borrow(g, 100_000);
    expect(netWorth(indebted, world)).toBe(netWorth(g, world));
  });
});

describe('boards and saves', () => {
  it('always gives a small ship something to carry', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = newGame(seed);
      for (const p of world.portList) {
        const here = { ...g, ship: { ...g.ship, location: p.id } };
        expect(g.ports[p.id].board.some((c) => canCarry(here, c) === null), `${p.id} seed ${seed}`).toBe(true);
      }
    }
  });

  it('upgrades a version-1 save', () => {
    const g = newGame(8) as unknown as Record<string, unknown> & { ship: Record<string, unknown>; ports: Record<string, Record<string, unknown>> };
    g.version = 1;
    delete g.loan;
    delete g.milestones;
    g.wonAt = 42;
    delete g.ship.age;
    for (const p of Object.values(g.ports)) delete p.market;
    const m = migrate(JSON.parse(JSON.stringify(g)))!;
    expect(m.version).toBe(3);
    expect(m.oil.index).toBe(1);
    expect(m.events).toEqual([]);
    expect(m.loan).toBe(0);
    expect(m.ship.age).toBe(24);
    expect(m.milestones).toEqual([{ amount: 1_000_000, day: 42 }]);
    expect(m.ports.rotterdam.market.length).toBeGreaterThan(0);
    expect(RULES.milestones[0]).toBe(1_000_000);
  });
});
