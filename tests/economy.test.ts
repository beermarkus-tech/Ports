import { describe, expect, it } from 'vitest';
import { generateContract } from '../src/sim/contracts';
import { ECONOMY, activeEvents, closedCanals, priceLevel, recordDelivery } from '../src/sim/economy';
import { buyFuel, fuelPrice, newGame, planVoyage, portFee, waitDay } from '../src/sim/game';
import type { GameState, WorldEvent } from '../src/sim/types';
import { getWorld } from '../src/sim/world';

const world = getWorld();

function withEvent(g: GameState, e: Omit<WorldEvent, 'id' | 'startDay' | 'endDay' | 'headline'>): GameState {
  const copy = structuredClone(g);
  copy.events.push({ id: 9_999, startDay: copy.day, endDay: copy.day + 30, headline: 'test', ...e });
  return copy;
}

describe('market prices', () => {
  it('drop when you deliver and recover over time', () => {
    const g = newGame(1);
    expect(priceLevel(g, 'rotterdam', 'cocoa')).toBe(1);
    const drop = recordDelivery(world, g, 'rotterdam', 'cocoa', 2000);
    expect(drop).toBeGreaterThan(0.1);
    const low = priceLevel(g, 'rotterdam', 'cocoa');
    expect(low).toBeLessThan(0.9);
    let later = g;
    for (let i = 0; i < 60; i++) later = waitDay(later);
    const recovered = priceLevel(later, 'rotterdam', 'cocoa');
    expect(recovered).toBeGreaterThan(low);
    expect(recovered).toBeLessThan(1);
  });

  it('never fall below the floor', () => {
    const g = newGame(2);
    for (let i = 0; i < 10; i++) recordDelivery(world, g, 'shanghai', 'ironore', 45_000);
    expect(priceLevel(g, 'shanghai', 'ironore')).toBe(ECONOMY.minPrice);
  });

  it('make new contracts to a saturated port pay less', () => {
    const avgPayPerTon = (g: GameState) => {
      let pay = 0;
      let tons = 0;
      for (let i = 0; i < 400; i++) {
        const c = generateContract(world, g, 'lagos', { classes: ['general'] });
        if (c && c.dest === 'rotterdam' && c.good === 'cocoa') { pay += c.pay; tons += c.tons; }
      }
      return pay / tons;
    };
    const normal = newGame(3);
    const flooded = newGame(3);
    recordDelivery(world, flooded, 'rotterdam', 'cocoa', 5000);
    expect(avgPayPerTon(flooded)).toBeLessThan(avgPayPerTon(normal) * 0.8);
  });
});

describe('world events', () => {
  it('happen regularly, and the oil index stays in bounds', () => {
    let g = newGame(4);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      g = waitDay({ ...g, cash: 1e9 });
      for (const e of g.events) seen.add(e.id);
      expect(g.oil.index).toBeGreaterThanOrEqual(ECONOMY.oil.min);
      expect(g.oil.index).toBeLessThanOrEqual(ECONOMY.oil.max);
      expect(activeEvents(g).length).toBeLessThanOrEqual(ECONOMY.maxActiveEvents);
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(g.oil.history.length).toBe(ECONOMY.oil.historyWeeks);
  });

  it('reroute ships when a canal closes', () => {
    let g = newGame(5);
    g = buyFuel({ ...g, cash: 1e7, ship: { ...g.ship, typeId: 'general' } }, 1e6);
    const open = planVoyage(g, 'singapore')!;
    expect(open.route.canals).toContain('suez');
    const closed = withEvent(g, { kind: 'canal', canal: 'suez' });
    expect(closedCanals(closed)).toEqual(['suez']);
    const detour = planVoyage(closed, 'singapore')!;
    expect(detour.route.canals).not.toContain('suez');
    expect(detour.route.nm).toBeGreaterThan(open.route.nm + 2000);
  });

  it('make a strike port slow and expensive', () => {
    const g = newGame(6);
    const struck = withEvent(g, { kind: 'strike', port: 'genoa' });
    expect(portFee(struck, 'genoa')).toBe(portFee(g, 'genoa') * ECONOMY.strike.feeMultiplier);
    const plan = planVoyage(struck, 'genoa')!;
    expect(plan.strike).toBe(true);
    expect(plan.strikeDays).toBe(ECONOMY.strike.extraDays);
    expect(plan.upkeep).toBeGreaterThan(planVoyage(g, 'genoa')!.upkeep);
  });

  it('move bunker prices with the oil index', () => {
    const g = newGame(7);
    const pricier = structuredClone(g);
    pricier.oil.index = 1.5;
    expect(fuelPrice(pricier, 'rotterdam')).toBeCloseTo(fuelPrice(g, 'rotterdam') * 1.5, -1);
  });
});
