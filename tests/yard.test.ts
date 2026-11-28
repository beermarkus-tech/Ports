import { afterEach, describe, expect, it } from 'vitest';
import { foundSettlement, newGame, swapAtSettlement } from '../src/sim/game';
import { SETTLEMENT_TUNING, foodStock, sawmillResting, settlementDay, storeRoom, stored, workshopsResting, yardStored } from '../src/sim/settlement';
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

  it('the workshops rest once the store is four-fifths full, keeping room for food', () => {
    setEra('sail', 'chinese');
    const g = foundSettlement(charter(newGame(63)), 'tamsui');
    const s = g.settlement!;
    s.people = 200; s.stage = 'village'; s.buildings = { saltpans: 2, houses: 10 };
    s.stores = { rice: 100, salt: storeRoom(s) * 0.8 - 100 };
    expect(workshopsResting(s)).toBe(true);
    // They eat the rice; the salt pans only make up the room down to four-fifths, never past it.
    for (let d = 0; d < 10; d++) {
      settlementDay(getWorld(), g, d, () => {});
      expect(stored(s)).toBeLessThanOrEqual(storeRoom(s) * 0.8 + 0.01);
    }
  });

  it('a full store: the rice goes ashore, the salt comes aboard ton for ton', () => {
    setEra('sail', 'chinese');
    let g = foundSettlement(charter(newGame(64)), 'tamsui');
    const room = storeRoom(g.settlement!);
    g.settlement!.stores = { rice: 50, salt: room - 50 };            // a camp's store: full
    g.fleet[0].location = 'tamsui';
    g.fleet[0].goods = [{ good: 'rice', tons: 60, cost: 6_000, from: 'amoy' }];
    g = swapAtSettlement(g, g.fleet[0].id, 'rice');
    expect(foodStock(g.settlement!)).toBe(110);
    expect(stored(g.settlement!)).toBe(room);
    expect(g.fleet[0].goods).toEqual([{ good: 'salt', tons: 60, cost: 0, from: 'tamsui' }]);
  });
});
