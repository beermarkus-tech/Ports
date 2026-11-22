import { afterEach, describe, expect, it } from 'vitest';
import { isCharted } from '../src/sim/charts';
import { newGame } from '../src/sim/game';
import { migrate } from '../src/sim/save';
import { routeWind, windAt, windFactor } from '../src/sim/wind';
import { getWorld, setEra, worldFor } from '../src/sim/world';

describe('merchant houses of the Age of Sail', () => {
  afterEach(() => setEra('modern'));

  it('the Chinese house starts at Amoy with a junk, in taels, and its yards build junks', () => {
    setEra('sail', 'chinese');
    const g = newGame(11);
    const w = getWorld();
    expect(g.era).toBe('sail');
    expect(g.house).toBe('chinese');
    expect(g.fleet[0].location).toBe('amoy');
    expect(w.shipTypes[g.fleet[0].typeId].rig).toBe('junk');
    expect(w.era.currency).toBe('Tls ');
    expect(w.ports.amoy.shipyard).toBe(true);
    expect(w.ports.amsterdam.shipyard).toBeFalsy();
    expect(w.ports.dejima.name).toBe('Nagasaki');
    for (const p of Object.values(g.ports)) for (const o of p.market) expect(w.shipTypes[o.typeId].rig).toBe('junk');
    expect(g.ports.amoy.market.filter((o) => o.age === 0).map((o) => o.typeId).sort())
      .toEqual(['greatjunk', 'nanyangjunk', 'oceanjunk', 'smalljunk']);
    expect(w.era.house!.captainNames!.family).toContain(g.captainPool![0].name.split(' ')[0]);
  });

  it('the Chinese house knows the China seas and the Nanyang, not India or Europe', () => {
    setEra('sail', 'chinese');
    const g = newGame(12);
    for (const id of ['amoy', 'canton', 'macau', 'manila', 'dejima', 'hoian', 'ayutthaya', 'patani', 'malacca', 'batavia', 'banda', 'macassar']) {
      expect(isCharted(g, id), id).toBe(true);
    }
    for (const id of ['galle', 'surat', 'cape', 'amsterdam', 'lisbon', 'havana']) expect(isCharted(g, id), id).toBe(false);
  });

  it('the Dutch house is the 1650 game as before, and old saves stay Dutch', () => {
    setEra('sail', 'dutch');
    const g = newGame(13);
    const w = getWorld();
    expect(g.house).toBe('dutch');
    expect(g.fleet[0].typeId).toBe('jacht');
    expect(w.era.currency).toBe('ƒ');
    expect(w.ports.dejima.name).toBe('Dejima');
    for (const p of Object.values(g.ports)) for (const o of p.market) expect(w.shipTypes[o.typeId].rig).toBeUndefined();
    // A save from before the houses has no house: it loads into the Dutch world and gains the new ports.
    const old = JSON.parse(JSON.stringify(g));
    delete old.house;
    delete old.ports.patani;
    delete old.ports.macassar;
    old.charted = old.charted.filter((id: string) => id !== 'patani' && id !== 'macassar');
    const back = migrate(old)!;
    expect(back.house).toBeUndefined();
    expect(back.ports.patani.board.length).toBeGreaterThan(0);
    expect(isCharted(back, 'patani') && isCharted(back, 'macassar')).toBe(true);
    expect(worldFor('sail').era.house!.id).toBe('dutch');
  });

  it('junks point higher into the wind than square-rigged ships', () => {
    const w = windAt(60, 10, 6);
    expect(windFactor(Math.PI + 0.785, w, 'junk')).toBeGreaterThan(windFactor(Math.PI + 0.785, w));
    expect(windFactor(0.785, w, 'junk')).toBeCloseTo(windFactor(0.785, w));
    setEra('sail', 'chinese');
    const path = getWorld().route('amoy', 'batavia')!.path;
    expect(routeWind(getWorld(), path, 181, 'junk')).toBeGreaterThanOrEqual(routeWind(getWorld(), path, 181));
  });
});

describe('every good has a market', () => {
  afterEach(() => setEra('modern'));

  it('in 1650 every good is bought somewhere, and an old save learns the new buyers at once', async () => {
    const { bestKnownMarkets, sellPrice } = await import('../src/sim/trade');
    for (const house of ['dutch', 'chinese'] as const) {
      setEra('sail', house);
      const w = getWorld();
      for (const good of Object.keys(w.goods)) expect(w.portList.some((p) => p.demands.some((d) => d.good === good)), good).toBe(true);
    }
    setEra('sail', 'chinese');
    const g = newGame(21);
    const w = getWorld();
    for (const good of ['tin', 'ivory', 'saltpetre', 'nutmeg']) expect(sellPrice(w, g, 'amoy', good), good).toBeGreaterThan(0);
    // A save from before: Amoy's letters never mentioned tin.
    const old = JSON.parse(JSON.stringify(g));
    for (const h of old.ports.amoy.hist) delete h.p.tin;
    const back = migrate(old)!;
    expect(bestKnownMarkets(w, back, 'tin').some((b) => b.port === 'amoy')).toBe(true);
  });
});

describe('sea lanes', () => {
  afterEach(() => setEra('modern'));

  it('routes in the China seas go the short way, and old saves learn the new waypoints', () => {
    setEra('sail', 'chinese');
    const w = getWorld();
    expect(w.route('amoy', 'zeelandia')!.nm).toBeLessThan(250);
    expect(w.route('amoy', 'dejima')!.path).toContain('goto');
    expect(w.route('amoy', 'manila')!.nm).toBeLessThan(900);
    const g = newGame(31);
    const old = JSON.parse(JSON.stringify(g));
    old.charted = old.charted.filter((id: string) => !['amoy_off', 'pescadores', 'goto', 'pearl_mouth'].includes(id));
    const back = migrate(old)!;
    for (const id of ['amoy_off', 'pescadores', 'goto', 'pearl_mouth']) expect(isCharted(back, id), id).toBe(true);
  });
});
