import { afterEach, describe, expect, it } from 'vitest';
import { BUILDING, SITES } from '../src/sim/settlement';
import { getWorld, setEra } from '../src/sim/world';

describe('what the settlement makes', () => {
  afterEach(() => setEra('modern'));

  // A workshop is worth building only if what it makes sells within reach, or at home.
  for (const house of ['chinese', 'dutch'] as const) {
    it(`sells within 4,500 nm, or at home, from every ${house} site`, () => {
      setEra('sail', house);
      const w = getWorld();
      for (const site of w.siteList) {
        for (const id of SITES[site.id].works) {
          const good = BUILDING[id].makes!.good;
          const near = w.portList.filter((p) => p.demands.some((d) => d.good === good) && (w.route(site.id, p.id)?.nm ?? Infinity) <= 4500);
          const home = w.ports[w.era.start.port].demands.some((d) => d.good === good);
          expect(near.length || home, `${good} from ${site.id}`).toBeTruthy();
        }
      }
    });
  }
});
