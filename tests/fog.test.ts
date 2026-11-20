import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chartOffers, isCharted, unchartedShare } from '../src/sim/charts';
import { routeFor } from '../src/sim/economy';
import { advance, buyChart, newGame, planVoyage, sail } from '../src/sim/game';
import { migrate } from '../src/sim/save';
import { setEra, worldFor } from '../src/sim/world';

describe('fog of war in the Age of Sail', () => {
  beforeEach(() => setEra('sail'));
  afterEach(() => setEra('modern'));
  const w = () => worldFor('sail');

  it('the Dutch of 1650 know the Indies route but not East Africa or the South Sea', () => {
    const g = newGame(4);
    for (const known of ['amsterdam', 'batavia', 'dejima', 'cape', 'mocha', 'manila', 'newamsterdam']) expect(isCharted(g, known), known).toBe(true);
    for (const dark of ['zanzibar', 'mozambique', 'acapulco', 'callao']) expect(isCharted(g, dark), dark).toBe(false);
    // The way to Batavia lies wholly in known water.
    expect(unchartedShare(w(), g, routeFor(w(), g, 'amsterdam', 'batavia')!.path)).toBe(0);
  });

  it('nobody charters cargo to places nobody has charted', () => {
    let g = newGame(9);
    g = advance(g, 60);
    const boards = Object.values(g.ports).flatMap((p) => p.board);
    expect(boards.length).toBeGreaterThan(100);
    expect(boards.filter((c) => !isCharted(g, c.dest))).toHaveLength(0);
  });

  it('a voyage of discovery is slower, charts the way and finds the port', () => {
    const g0 = newGame(2);
    const ship = { ...g0.fleet[0], typeId: 'indiaman', fuel: 2500 };
    let g = { ...g0, cash: 5_000_000, fleet: [ship] };
    const plan = planVoyage(g, ship.id, 'callao')!;
    expect(plan.inRange).toBe(true);
    // Uncharted stretches go slower than the wind alone would allow.
    const lit = { ...g, charted: [...g.charted!, ...plan.route.path] };
    expect(plan.seaDays).toBeGreaterThan(planVoyage(lit, ship.id, 'callao')!.seaDays);
    g = sail(g, ship.id, 'callao');
    g = advance(g, Math.ceil(g.fleet[0].voyage!.arriveDay - g.day) + 1);
    expect(g.fleet[0].location).toBe('callao');
    expect(isCharted(g, 'callao')).toBe(true);
    const report = g.reports.find((r) => r.to === 'callao')!;
    expect(report.discovered).toEqual(['callao']);
    // A discovery boom: the newly found port pays more for what it imports.
    expect(g.events.some((e) => e.kind === 'boom' && e.port === 'callao' && (e.boost ?? 0) > 0.3)).toBe(true);
  });

  it('charts can be bought: a Goa pilot shows the way to Zanzibar', () => {
    const g0 = newGame(3);
    const g = { ...g0, cash: 1_000_000, fleet: [{ ...g0.fleet[0], location: 'goa' }] };
    const offers = chartOffers(w(), g, 'goa');
    expect(offers.map((o) => o.id)).toEqual(['swahili']);
    const after = buyChart(g, 'swahili');
    expect(after.cash).toBe(g.cash - offers[0].price);
    expect(isCharted(after, 'zanzibar')).toBe(true);
    expect(isCharted(after, 'mozambique')).toBe(true);
    expect(chartOffers(w(), after, 'goa')).toHaveLength(0);
    expect(() => buyChart(g, 'galleon')).toThrow();
  });

  it('a sail game saved before the fog gets the Dutch charts on loading', () => {
    const g = newGame(6);
    const old = JSON.parse(JSON.stringify({ ...g, charted: undefined }));
    old.ports.amsterdam.board.push({ ...g.ports.amsterdam.board[0], id: 99_999, dest: 'zanzibar' });
    const loaded = migrate(old)!;
    expect(loaded.charted?.length).toBeGreaterThan(100);
    expect(isCharted(loaded, 'zanzibar')).toBe(false);
    expect(loaded.ports.amsterdam.board.some((c) => c.dest === 'zanzibar')).toBe(false);
  });

  it('modern games have no fog', () => {
    setEra('modern');
    const g = newGame(1);
    expect(g.charted).toBeUndefined();
    expect(isCharted(g, 'rotterdam')).toBe(true);
  });
});
