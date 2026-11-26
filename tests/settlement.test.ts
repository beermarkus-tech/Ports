import { afterEach, describe, expect, it } from 'vitest';
import { isCharted } from '../src/sim/charts';
import { advance, foundSettlement, hasCharter, loadFromSettlement, newGame, recruitSettlers, sail, startBuilding, syncSettlementPort, unloadAtSettlement } from '../src/sim/game';
import { regionOf } from '../src/sim/regions';
import { buyPrice, sellPrice } from '../src/sim/trade';
import { BUILDING, SETTLEMENT_TUNING, SITES, cannotBuild, feedsItself, foodDays, housing, staffed } from '../src/sim/settlement';
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

  it('lands what you choose; timber and tools go to the yard, so a full store of food never blocks them', () => {
    setEra('sail', 'chinese');
    let g = foundSettlement(charter(newGame(55)), 'songkhla');
    g.settlement!.stores = { rice: SETTLEMENT_TUNING.store };              // the store is full of rice
    g.fleet[0].location = 'songkhla';
    g.fleet[0].goods = [
      { good: 'rice', tons: 14, cost: 1_400, from: 'ayutthaya' },
      { good: 'tools', tons: 10, cost: 9_000, from: 'ayutthaya' },
      { good: 'timber', tons: 400, cost: 40_000, from: 'ayutthaya' },
    ];
    const id = g.fleet[0].id;
    g = unloadAtSettlement(g, id, 'tools');
    expect(g.settlement!.stores.tools).toBe(10);
    expect(g.fleet[0].goods!.map((l) => l.good)).toEqual(['rice', 'timber']);   // only the tools landed
    g = unloadAtSettlement(g, id);                                             // all that fits
    expect(g.settlement!.stores.timber).toBe(SETTLEMENT_TUNING.yard - 10);     // the yard holds 300 t
    expect(g.settlement!.stores.rice).toBe(SETTLEMENT_TUNING.store);           // no room for more rice
    expect(g.fleet[0].goods!.find((l) => l.good === 'rice')!.tons).toBe(14);
  });
});

describe('the settlement grows up', () => {
  afterEach(() => setEra('modern'));
  it('becomes a village with 120 people, a well, and food from its own fields and boats for everyone', () => {
    setEra('sail', 'chinese');
    let g = foundSettlement(charter(newGame(56)), 'tamsui');
    const s = g.settlement!;
    s.stage = 'outpost';
    s.people = 125;
    s.buildings = { jetty: 1, storehouse: 1, houses: 6, well: 1, fields: 3 };
    s.fields = [g.day - 80, g.day - 80, g.day - 80];      // 4.5 t a day: not enough for 125
    s.stores = { rice: 125 * SETTLEMENT_TUNING.food * 60 };
    g = advance(g, 1);
    expect(g.settlement!.stage).toBe('outpost');
    expect(feedsItself(g.settlement!, g.day)).toBe(false);
    g.settlement!.buildings.fishery = 2;                  // + 2 t of fish: 6.5 t for 5.6 t eaten
    const rice = g.settlement!.stores.rice!;
    g = advance(g, 1);
    expect(g.settlement!.stage).toBe('village');
    expect(g.settlement!.stores.rice!).toBeGreaterThanOrEqual(rice);   // fed from its own fields and boats
  });

  it('every site can feed a village of 120 from its own land and sea', () => {
    for (const site of Object.values(SITES)) {
      expect(site.fields * SETTLEMENT_TUNING.fieldYield + site.fishing * SETTLEMENT_TUNING.fishYield).toBeGreaterThanOrEqual(120 * SETTLEMENT_TUNING.food);
    }
  });
});

describe('the settlement makes goods, becomes a town and opens as a port', () => {
  afterEach(() => { setEra('sail', 'chinese'); syncSettlementPort(getWorld(), newGame(1)); setEra('modern'); });

  const village = (site: string, seed: number): GameState => {
    const g = foundSettlement(charter(newGame(seed)), site);
    const s = g.settlement!;
    s.stage = 'village';
    s.people = 140;
    s.buildings = { jetty: 1, storehouse: 2, houses: 8, well: 1, fields: 6, fishery: 4 };
    s.fields = Array(6).fill(g.day - 100);
    s.stores = { rice: 300, timber: 250, tools: 40 };
    g.cash = 5_000_000;
    return g;
  };

  it('workshops make goods with the hands there are, and your ships load them for nothing', () => {
    setEra('sail', 'chinese');
    let g = village('bintan', 61);
    expect(cannotBuild(g, g.settlement!, 'tinmine')).toBe('Not at this site.');
    g = startBuilding(g, 'pepper');
    g = advance(g, 15);
    expect(g.settlement!.buildings.pepper).toBe(1);
    expect(staffed(g.settlement!)).toBe(1);                       // 60 hands beyond the first 80, 20 needed
    g = advance(g, 20);
    expect(g.settlement!.stores.pepper).toBeGreaterThan(8);
    g.fleet[0].location = 'bintan';
    const tons = Math.floor(g.settlement!.stores.pepper!);
    g = loadFromSettlement(g, g.fleet[0].id, 'pepper');
    expect(g.fleet[0].goods!.find((l) => l.good === 'pepper')).toMatchObject({ tons, cost: 0 });
    expect(g.settlement!.shipped).toBe(tons);
  });

  it('grows into a town, then opens as a port: in the port list, with a board, a market and dues', () => {
    setEra('sail', 'chinese');
    const w = getWorld();
    let g = village('tamsui', 62);
    const s = g.settlement!;
    s.people = 260;
    s.buildings = { ...s.buildings, houses: 14, wharf: 1, market: 1, deerskins: 1, sawmill: 1 };
    g = advance(g, 1);
    expect(g.settlement!.stage).toBe('town');
    expect(w.portList.some((p) => p.id === 'tamsui')).toBe(false);
    g.settlement!.people = 410;
    g.settlement!.buildings.houses = 20;
    g.settlement!.buildings.customs = 1;
    const cash = g.cash;
    g = advance(g, 1);
    expect(g.settlement!.stage).toBe('port');
    expect(w.portList.some((p) => p.id === 'tamsui')).toBe(true);
    expect(regionOf('tamsui')).toBeDefined();
    expect(g.ports.tamsui.board.length).toBeGreaterThan(0);
    expect(sellPrice(w, g, 'tamsui', 'textiles')).toBeGreaterThan(0);
    expect(buyPrice(w, g, 'tamsui', 'furs')).toBeGreaterThan(0);
    expect(w.route('amoy', 'tamsui')).not.toBeNull();
    g = advance(g, 30);
    expect(g.settlement!.dues).toBeGreaterThan(0);
    expect(g.cash).toBeGreaterThan(cash - 50_000);                  // dues more than pay the rent
    // Another game of the same house: the port closes again.
    syncSettlementPort(w, newGame(63));
    expect(w.portList.some((p) => p.id === 'tamsui')).toBe(false);
    expect(w.isSite('tamsui')).toBe(true);
  });

  it('every workshop good and every product sells somewhere', () => {
    for (const house of ['chinese', 'dutch'] as const) {
      setEra('sail', house);
      const w = getWorld();
      for (const site of w.siteList) {
        const info = SITES[site.id];
        for (const id of info.works) {
          const good = BUILDING[id].makes!.good;
          expect(w.portList.some((p) => p.demands.some((d) => d.good === good)), `${site.id} ${good}`).toBe(true);
        }
      }
    }
  });
});
