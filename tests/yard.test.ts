import { afterEach, describe, expect, it } from 'vitest';
import { foundSettlement, newGame, swapAtSettlement, unloadAtSettlement } from '../src/sim/game';
import { SETTLEMENT_TUNING, foodStock, sawmillResting, settlementDay, stored, warehouseRoom, warehoused, workshopsResting, yardStored } from '../src/sim/settlement';
import type { GameState } from '../src/sim/types';
import { getWorld, setEra } from '../src/sim/world';

const charter = (g: GameState): GameState => ({ ...g, cash: 2_000_000, guide: { done: ['captain', 'threeShips', 'worth5M'] } });

describe('the yard', () => {
  afterEach(() => setEra('modern'));

  it('a full yard of timber: the tools go ashore, the timber comes aboard ton for ton', () => {
    setEra('sail', 'chinese');
    let g = foundSettlement(charter(newGame(61)), 'tamsui');
    g.settlement!.stores = { timber: SETTLEMENT_TUNING.yard };
    g.fleet[0].location = 'tamsui';
    g.fleet[0].goods = [{ good: 'tools', tons: 40, cost: 36_000, from: 'amoy' }];
    const id = g.fleet[0].id;
    g = swapAtSettlement(g, id, 'tools');
    expect(g.settlement!.stores.tools).toBe(40);
    expect(g.settlement!.stores.timber).toBe(SETTLEMENT_TUNING.yard - 40);
    expect(yardStored(g.settlement!)).toBe(SETTLEMENT_TUNING.yard);
    expect(g.fleet[0].goods).toEqual([{ good: 'timber', tons: 40, cost: 0, from: 'tamsui' }]);
  });

  it('the sawmill rests once the yard is four-fifths full, keeping room for tools', () => {
    setEra('sail', 'chinese');
    const g = foundSettlement(charter(newGame(62)), 'tamsui');
    const s = g.settlement!;
    s.people = 100; s.buildings = { sawmill: 1, houses: 5 }; s.stores = { rice: 500, timber: 230 };
    for (let d = 0; d < 20; d++) settlementDay(getWorld(), g, d, () => {});
    expect(yardStored(s)).toBeCloseTo(SETTLEMENT_TUNING.yard * (1 - SETTLEMENT_TUNING.sawmillReserve), 3);
    expect(sawmillResting(s)).toBe(true);
  });

  it('the workshops fill their own warehouse and rest when it is full; the granary is apart', () => {
    setEra('sail', 'chinese');
    const g = foundSettlement(charter(newGame(63)), 'tamsui');
    const s = g.settlement!;
    s.people = 200; s.stage = 'village'; s.buildings = { saltpans: 1, houses: 10, storehouse: 1 };
    expect(warehouseRoom(s)).toBe(SETTLEMENT_TUNING.perWorkshop);
    s.stores = { rice: 300, salt: warehouseRoom(s) - 4 };
    for (let d = 0; d < 5; d++) settlementDay(getWorld(), g, d, () => {});
    expect(warehoused(s)).toBeCloseTo(warehouseRoom(s), 3);
    expect(workshopsResting(s)).toBe(true);
    expect(stored(s)).toBe(foodStock(s));                     // the granary holds only food
  });

  it('a full warehouse never keeps the rice out of the granary', () => {
    setEra('sail', 'chinese');
    let g = foundSettlement(charter(newGame(64)), 'tamsui');
    g.settlement!.buildings = { saltpans: 1 };
    g.settlement!.stores = { rice: 50, salt: warehouseRoom(g.settlement!) };
    g.fleet[0].location = 'tamsui';
    g.fleet[0].goods = [{ good: 'rice', tons: 60, cost: 6_000, from: 'amoy' }];
    g = unloadAtSettlement(g, g.fleet[0].id, 'rice');
    expect(foodStock(g.settlement!)).toBe(110);
    expect(g.fleet[0].goods).toBeUndefined();
  });
});
