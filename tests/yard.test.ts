import { afterEach, describe, expect, it } from 'vitest';
import { foundSettlement, newGame, swapAtSettlement } from '../src/sim/game';
import { SETTLEMENT_TUNING, sawmillResting, settlementDay, yardStored } from '../src/sim/settlement';
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
});
