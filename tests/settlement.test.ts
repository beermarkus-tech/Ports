import { afterEach, describe, expect, it } from 'vitest';
import { isCharted } from '../src/sim/charts';
import { advance, foundSettlement, hasCharter, newGame, recruitSettlers, sail, startBuilding, unloadAtSettlement } from '../src/sim/game';
import { BUILDING, SETTLEMENT_TUNING, foodDays, housing } from '../src/sim/settlement';
import type { GameState } from '../src/sim/types';
import { getWorld, setEra } from '../src/sim/world';

const charter = (g: GameState): GameState => ({ ...g, cash: 2_000_000, guide: { done: ['captain', 'threeShips', 'worth5M'] } });

describe('the settlement', () => {
  afterEach(() => setEra('modern'));

  it('its sites are hidden until founded: not ports, not charted, never passed through', () => {
    setEra('sail', 'chinese');
    const w = getWorld();
    expect(w.siteList.map((p) => p.id).sort()).toEqual(['bintan', 'songkhla', 'tamsui']);
    expect(w.portList.some((p) => p.site)).toBe(false);
    expect(w.ports.mauritius).toBeUndefined();          // another house's site
    const g = newGame(51);
    expect(isCharted(g, 'tamsui')).toBe(false);
    for (const a of w.portList) for (const b of w.portList) {
      if (a !== b) for (const id of w.route(a.id, b.id)!.path) expect(w.isSite(id), `${a.id}→${b.id} via ${id}`).toBe(false);
    }
    expect(w.route('amoy', 'tamsui')!.nm).toBeLessThan(400);
  });

  it('opens with the charter, is founded, peopled and supplied by ship', () => {
    setEra('sail', 'chinese');
    const w = getWorld();
    let g = newGame(52);
    expect(hasCharter(g)).toBe(false);
    expect(() => foundSettlement(g, 'tamsui')).toThrow();
    g = foundSettlement(charter(g), 'tamsui');
    expect(g.settlement!.stage).toBe('camp');
    expect(isCharted(g, 'tamsui')).toBe(true);
    const ship = g.fleet[0];
    g = recruitSettlers(g, ship.id, 20);
    expect(() => recruitSettlers(g, ship.id, 20)).toThrow(/willing/);
    expect(g.fleet[0].settlers).toBe(20);
    // Rice and tools on board, bought on own account.
    g.fleet[0].goods = [{ good: 'rice', tons: 40, cost: 10_000, from: 'amoy' }, { good: 'tools', tons: 10, cost: 9_000, from: 'amoy' }, { good: 'silk', tons: 10, cost: 20_000, from: 'amoy' }];
    g = sail(g, ship.id, 'tamsui');
    g = advance(g, 30);
    const s = g.settlement!;
    expect(g.fleet[0].location).toBe('tamsui');
    expect(Math.floor(s.people)).toBeGreaterThanOrEqual(19);
    expect(s.stores.tools).toBe(10);
    expect(s.stores.rice).toBeGreaterThan(0);
    expect(g.fleet[0].goods!.map((l) => l.good)).toEqual(['silk']);  // not a supply: stays aboard
    expect(g.fleet[0].settlers).toBeUndefined();
    expect(g.settlement!.news.length).toBeGreaterThan(0);
    void w;
  });

  it('eats, builds, goes hungry and shrinks to a caretaker crew, but never dies', () => {
    setEra('sail', 'dutch');
    let g = foundSettlement(charter(newGame(53)), 'sthelena');
    const s = g.settlement!;
    s.people = 40;
    s.stores = { grain: 40 * SETTLEMENT_TUNING.food * 20, timber: 100, tools: 20 };
    expect(Math.round(foodDays(s, g.day))).toBe(20);
    g = startBuilding(g, 'jetty');
    expect(g.settlement!.project!.id).toBe('jetty');
    expect(() => startBuilding(g, 'houses')).toThrow(/busy/);
    g = advance(g, 15);
    expect(g.settlement!.buildings.jetty).toBe(1);           // 240 person-days at 20 a day
    expect(g.settlement!.stores.timber).toBe(100 - BUILDING.jetty.timber);
    g = advance(g, 200);                                      // the food is long gone
    expect(g.settlement!.people).toBe(SETTLEMENT_TUNING.floor);
    expect(g.settlement!.news.some((n) => /run out of food/.test(n.text))).toBe(true);
  });

  it('grows from camp to outpost when it has the people, the buildings and the food', () => {
    setEra('sail', 'dutch');
    let g = foundSettlement(charter(newGame(54)), 'mauritius');
    const s = g.settlement!;
    s.people = 45;
    s.buildings = { jetty: 1, storehouse: 1, houses: 2 };
    s.stores = { grain: 45 * SETTLEMENT_TUNING.food * 90 };
    expect(housing(s)).toBe(55);
    g = advance(g, 2);
    expect(g.settlement!.stage).toBe('outpost');
    expect(g.settlement!.news[0].text).toMatch(/outpost/);
  });

  it('unloads supplies on demand once there is room', () => {
    setEra('sail', 'chinese');
    let g = foundSettlement(charter(newGame(55)), 'songkhla');
    g.fleet[0].location = 'songkhla';
    g.fleet[0].goods = [{ good: 'timber', tons: 300, cost: 30_000, from: 'ayutthaya' }];
    g = unloadAtSettlement(g, g.fleet[0].id);
    expect(g.settlement!.stores.timber).toBe(SETTLEMENT_TUNING.store);   // no storehouse: 150 t
    expect(g.fleet[0].goods![0].tons).toBe(150);
  });
});

describe('the settlement grows up', () => {
  afterEach(() => setEra('modern'));
  it('becomes a village with 120 people, a well and every field the land allows', () => {
    setEra('sail', 'chinese');
    let g = foundSettlement(charter(newGame(56)), 'bintan');
    const s = g.settlement!;
    s.stage = 'outpost';
    s.people = 125;
    s.buildings = { jetty: 1, storehouse: 1, houses: 6, well: 1, fields: 1 };
    s.fields = [g.day - 80];                       // Bintan allows one field: harvesting
    s.stores = { rice: 125 * SETTLEMENT_TUNING.food * 60 };
    g = advance(g, 1);
    expect(g.settlement!.stage).toBe('village');
  });
});
