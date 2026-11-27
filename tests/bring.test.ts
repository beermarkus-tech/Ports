import { afterEach, describe, expect, it } from 'vitest';
import { bringList, stageGoals } from '../src/sim/settlement';
import type { Settlement } from '../src/sim/types';
import { setEra } from '../src/sim/world';

const base = (over: Partial<Settlement>): Settlement => ({ site: 'tamsui', founded: 0, stage: 'camp', people: 30, stores: {}, buildings: {}, news: [], ...over });

describe('what to bring next', () => {
  afterEach(() => setEra('modern'));

  it('a camp: food, timber and tools for the jetty and storehouse, and settlers for the room', () => {
    setEra('sail', 'chinese');
    const s = base({ willing: 20 });
    expect(stageGoals(s, 0)).toEqual(expect.arrayContaining(['jetty', 'storehouse']));
    const list = bringList(s, 0);
    const of = (g: string) => list.find((x) => x.good === g)?.tons ?? 0;
    expect(of('food')).toBeGreaterThan(0);
    expect(of('timber')).toBeGreaterThanOrEqual(50);        // jetty 20 + storehouse 30
    expect(of('tools')).toBeGreaterThanOrEqual(8);
  });

  it('nothing for what is in store already, under way or built', () => {
    setEra('sail', 'chinese');
    const s = base({ stores: { rice: 5000, timber: 500, tools: 100 }, buildings: { jetty: 1, houses: 5 }, project: { id: 'storehouse', done: 0 }, willing: 0 });
    expect(stageGoals(s, 0)).not.toContain('jetty');
    expect(stageGoals(s, 0)).not.toContain('storehouse');
    expect(bringList(s, 0).map((x) => x.good)).toEqual([]);
  });
});
