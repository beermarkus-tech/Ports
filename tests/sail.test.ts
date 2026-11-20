import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canCarry, newGame, planVoyage } from '../src/sim/game';
import { regions } from '../src/sim/regions';
import { currentEra, getWorld, setEra, worldFor } from '../src/sim/world';
import { routeWind, windAt, windFactor } from '../src/sim/wind';

describe('the Age of Sail world', () => {
  beforeEach(() => setEra('sail'));
  afterEach(() => setEra('modern'));

  it('has its own ports, ships and regions, no canals, and every port reaches every other', () => {
    const w = worldFor('sail');
    expect(w.era.id).toBe('sail');
    expect(Object.keys(w.canals)).toHaveLength(0);
    expect(w.portList.length).toBeGreaterThanOrEqual(38);
    expect(regions().flatMap((r) => r.ports).sort()).toEqual(w.portList.map((p) => p.id).sort());
    for (const a of w.portList) for (const b of w.portList) {
      if (a !== b) expect(w.route(a.id, b.id), `${a.id} → ${b.id}`).not.toBeNull();
    }
    // The long way to the Indies: round the Cape (no Suez in 1650).
    const toBatavia = w.route('amsterdam', 'batavia')!;
    expect(toBatavia.nm).toBeGreaterThan(10_000);
    expect(toBatavia.nm).toBeLessThan(14_500);
  });

  it('the modern world stays as it was', () => {
    setEra('modern');
    expect(currentEra()).toBe('modern');
    expect(getWorld().ports.rotterdam).toBeDefined();
    expect(getWorld().ports.amsterdam).toBeUndefined();
  });

  it('a new game starts at Amsterdam with a jacht, and finds cargo it can carry', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const g = newGame(seed);
      expect(g.era).toBe('sail');
      expect(g.fleet[0].typeId).toBe('jacht');
      expect(g.fleet[0].location).toBe('amsterdam');
      expect(g.ports.amsterdam.board.some((c) => canCarry(g.fleet[0], c) === null), `seed ${seed}`).toBe(true);
      expect(g.oil.index).toBe(1);
    }
  });

  it('the monsoon decides how fast you cross the Indian Ocean', () => {
    // Eastbound across the Bay of Bengal: with the south-west monsoon in July, against the north-east one in January.
    const w = worldFor('sail');
    const path = w.route('madras', 'malacca')!.path;
    const july = routeWind(w, path, 181);
    const january = routeWind(w, path, 10);
    expect(july).toBeGreaterThan(january);
    expect(windFactor(0, windAt(60, 10, 6))).toBeGreaterThan(windFactor(Math.PI, windAt(60, 10, 6)));
  });

  it('voyages take months, as they did', () => {
    const g = newGame(3);
    const p = planVoyage({ ...g, fleet: [{ ...g.fleet[0], typeId: 'fluyt' }] }, g.fleet[0].id, 'batavia')!;
    expect(p.seaDays).toBeGreaterThan(80);
    expect(p.seaDays).toBeLessThan(240);
  });
});
