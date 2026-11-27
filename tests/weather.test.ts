import { describe, expect, it } from 'vitest';
import { weatherAt, type WeatherKind } from '../src/sim/weather';
import { worldFor } from '../src/sim/world';

/** Share of days of a kind in a month, over 40 years. */
function share(id: string, month: number, kinds: WeatherKind[], storms = true): number {
  const w = worldFor('sail', id === 'mauritius' || id === 'sthelena' ? 'dutch' : 'chinese');
  const p = w.ports[id];
  let n = 0, hit = 0;
  for (let y = 0; y < 40; y++) for (let d = 0; d < 30; d++) {
    const day = y * 365 + month * 30.4 + d;
    n++;
    if (kinds.includes(weatherAt(p, Math.floor(day), month, storms).kind)) hit++;
  }
  return hit / n;
}

describe('the weather is true to the climate', () => {
  it('monsoon rains: Batavia is wet in January, Ayutthaya in August', () => {
    expect(share('batavia', 0, ['rain'])).toBeGreaterThan(share('batavia', 7, ['rain']) * 2);
    expect(share('ayutthaya', 7, ['rain'])).toBeGreaterThan(share('ayutthaya', 1, ['rain']) * 2);
  });
  it('typhoons off China in late summer only; cyclones at Mauritius early in the year', () => {
    expect(share('amoy', 7, ['storm'])).toBeGreaterThan(0.02);
    expect(share('amoy', 1, ['storm'])).toBe(0);
    expect(share('mauritius', 1, ['storm'])).toBeGreaterThan(0.02);
    expect(share('mauritius', 7, ['storm'])).toBe(0);
    expect(weatherAt(worldFor('sail', 'chinese').ports.amoy, 0, 7).storm).toBe('typhoon');
    expect(share('dejima', 8, ['storm'])).toBeGreaterThan(0.01);      // Nagasaki has its typhoons
    expect(share('dejima', 0, ['snow'])).toBeGreaterThan(0);
  });
  it('snow and fog in an Amsterdam winter, never snow in summer; almost no rain at Mocha', () => {
    expect(share('amsterdam', 0, ['snow'])).toBeGreaterThan(0.05);
    expect(share('amsterdam', 6, ['snow'])).toBe(0);
    expect(share('amsterdam', 11, ['fog'])).toBeGreaterThan(0.04);
    expect(share('mocha', 5, ['rain', 'storm'])).toBeLessThan(0.05);
    expect(share('batavia', 0, ['snow'])).toBe(0);
  });
  it('the same port and day always has the same weather, and it holds for a few days', () => {
    const p = worldFor('sail', 'dutch').ports.amsterdam;
    expect(weatherAt(p, 400, 1)).toEqual(weatherAt(p, 400, 1));
    let changes = 0;
    for (let d = 0; d < 300; d++) if (weatherAt(p, d, 3, false).kind !== weatherAt(p, d + 1, 3, false).kind) changes++;
    expect(changes).toBeLessThan(150);
  });
});
