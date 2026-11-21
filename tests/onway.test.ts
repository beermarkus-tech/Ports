import { afterEach, describe, expect, it } from 'vitest';
import { advance, callsOnTheWay, detour, newGame, ONWAY, onTheWay, sail, setPlannedDest } from '../src/sim/game';
import { setEra } from '../src/sim/world';

describe('calls on the way', () => {
  afterEach(() => setEra('modern'));

  it('measures how much longer a call makes the voyage', () => {
    setEra('sail');
    const g = newGame(1);
    // Lisbon lies almost exactly on the way from Amsterdam to Batavia; Danzig doesn't.
    expect(detour(g, 'amsterdam', 'lisbon', 'batavia')!.share).toBeLessThan(0.01);
    expect(detour(g, 'amsterdam', 'danzig', 'batavia')!.share).toBeGreaterThan(ONWAY.maxDetour);
    // 15%, but never more than 500 nm: Bergen (+978 nm, 8.5%) is off course on the long Batavia run.
    const bergen = detour(g, 'amsterdam', 'bergen', 'batavia')!;
    expect(bergen.share).toBeLessThan(ONWAY.maxDetour);
    expect(onTheWay(bergen)).toBe(false);
    expect(onTheWay(detour(g, 'amsterdam', 'cadiz', 'batavia')!)).toBe(true);
  });

  it('suggests only calls within 15% that pay, at most three, best first', () => {
    setEra('sail');
    const g0 = newGame(2);
    const g = { ...g0, fleet: [{ ...g0.fleet[0], typeId: 'fluyt', fuel: 420 }] };
    const calls = callsOnTheWay(g, g.fleet[0].id, 'batavia');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(ONWAY.maxCalls);
    for (const c of calls) {
      expect(onTheWay(detour(g, 'amsterdam', c.port, 'batavia')!)).toBe(true);
      expect(c.extraNm).toBeLessThanOrEqual(ONWAY.maxDetourNm);
      expect(c.net).toBeGreaterThan(0);
      expect(c.estimated).toBe(true); // 1650: judged by regular trade, not the quay itself
    }
    expect([...calls].sort((a, b) => b.net - a.net)).toEqual(calls);
    // Uncharted ports are never suggested.
    expect(calls.some((c) => ['zanzibar', 'mozambique'].includes(c.port))).toBe(false);
  });

  it('nothing qualifies where no port lies on the way', () => {
    const g = newGame(3);
    expect(callsOnTheWay({ ...g, fleet: [{ ...g.fleet[0], fuel: 2000 }] }, g.fleet[0].id, 'newyork')).toEqual([]);
  });

  it('a remembered destination stays through the stop and clears on arrival there', () => {
    setEra('sail');
    const g0 = newGame(4);
    let g = { ...g0, fleet: [{ ...g0.fleet[0], typeId: 'fluyt', fuel: 420 }] };
    const id = g.fleet[0].id;
    g = sail(setPlannedDest(g, id, 'lisbon'), id, 'london');
    expect(g.fleet[0].plannedDest).toBe('lisbon');
    g = advance(g, Math.ceil(g.fleet[0].voyage!.arriveDay - g.day) + 1);
    expect(g.fleet[0].location).toBe('london');
    expect(g.fleet[0].plannedDest).toBe('lisbon');
    g = sail(g, id, 'lisbon');
    g = advance(g, Math.ceil(g.fleet[0].voyage!.arriveDay - g.day) + 1);
    expect(g.fleet[0].location).toBe('lisbon');
    expect(g.fleet[0].plannedDest).toBeUndefined();
    expect(setPlannedDest(setPlannedDest(g, id, 'cadiz'), id, null).fleet[0].plannedDest).toBeUndefined();
  });
});
