import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advance, buyGoods, canCarry, cargoTons, newGame, sail, sellGoods } from '../src/sim/game';
import { netWorth } from '../src/sim/ships';
import { buyPrice, goodsSaleQuote, hasTrade, priceNews, sellPrice } from '../src/sim/trade';
import type { GameState } from '../src/sim/types';
import { setEra, worldFor } from '../src/sim/world';

describe('trade on your own account (Age of Sail)', () => {
  beforeEach(() => setEra('sail'));
  afterEach(() => setEra('modern'));
  const w = () => worldFor('sail');
  const at = (g: GameState, port: string, typeId = 'fluyt'): GameState =>
    ({ ...g, cash: 2_000_000, fleet: [{ ...g.fleet[0], location: port, typeId, fuel: 400 }] });

  it('spices are cheap where they grow and dear far away', () => {
    const g = newGame(1);
    expect(buyPrice(w(), g, 'bantam', 'pepper')! * 4).toBeLessThan(sellPrice(w(), g, 'amsterdam', 'pepper')!);
    expect(buyPrice(w(), g, 'amsterdam', 'pepper')).toBeNull();
    expect(sellPrice(w(), g, 'bantam', 'pepper')).toBeNull();
  });

  it('buying fills the hold and costs cash; selling books the profit', () => {
    let g = at(newGame(2), 'bantam');
    const id = g.fleet[0].id;
    const cash0 = g.cash;
    g = buyGoods(g, id, 'pepper', 100);
    const lot = g.fleet[0].goods![0];
    expect(lot).toMatchObject({ good: 'pepper', tons: 100, from: 'bantam' });
    expect(g.cash).toBe(cash0 - lot.cost);
    expect(cargoTons(g.fleet[0])).toBe(100);
    // Goods count in net worth at cost: buying doesn't make you poorer on paper.
    expect(Math.abs(netWorth(g, w()) - (cash0 + netWorth({ ...g, cash: 0, fleet: [{ ...g.fleet[0], goods: [] }] }, w())))).toBeLessThan(2);
    // Your buying pushes the price up.
    expect(buyPrice(w(), g, 'bantam', 'pepper')!).toBeGreaterThan(buyPrice(w(), at(newGame(2), 'bantam'), 'bantam', 'pepper')!);
    // Carry it to Amsterdam (teleport for the test) and sell.
    g = { ...g, fleet: [{ ...g.fleet[0], location: 'amsterdam' }] };
    const before = g.cash;
    g = sellGoods(g, id, 'pepper');
    expect(g.fleet[0].goods ?? []).toHaveLength(0);
    expect(g.cash - before).toBeGreaterThan(lot.cost * 3);
    expect(g.books!.at(-1)!.trade).toBe(g.cash - before - lot.cost);
  });

  it('a big sale floods the market: the average price falls', () => {
    const g = newGame(3);
    const small = goodsSaleQuote(w(), g, 'amsterdam', 'nutmeg', 10)!;
    const big = goodsSaleQuote(w(), g, 'amsterdam', 'nutmeg', 120)!;
    expect(big.total / 120).toBeLessThan(small.total / 10);
  });

  it('own goods take hold space from charters', () => {
    let g = at(newGame(4), 'bantam', 'jacht');
    g = buyGoods(g, g.fleet[0].id, 'pepper', 1000);
    expect(cargoTons(g.fleet[0])).toBe(80);
    const c = { ...g.ports.bantam.board[0], tons: 10 };
    expect(canCarry(g.fleet[0], c)).toBe('Not enough free hold space');
    expect(() => buyGoods(g, g.fleet[0].id, 'pepper', 10)).toThrow(/full/);
  });

  it('news travels by ship: away from a port you know its prices only as of a letter', () => {
    let g = newGame(5);
    g = advance(g, 120);
    const far = priceNews(w(), g, 'batavia', 'cloth')!;
    expect(far.live).toBe(false);
    // Batavia is months away from Amsterdam by letter.
    expect(g.day - far.asOf).toBeGreaterThan(60);
    const near = priceNews(w(), g, 'london', 'pepper')!;
    expect(g.day - near.asOf).toBeLessThan(g.day - far.asOf);
    // Where your ship lies, you see today's price.
    expect(priceNews(w(), g, 'amsterdam', 'pepper')).toMatchObject({ live: true, asOf: g.day });
    // Uncharted ports send no letters.
    expect(priceNews(w(), g, 'acapulco', 'silk')).toBeNull();
  });

  it('prices wander from day to day', () => {
    const g = advance(newGame(6), 90);
    const drifts = Object.values(g.ports.bantam.drift ?? {});
    expect(drifts.some((d) => Math.abs(d - 1) > 0.02)).toBe(true);
    expect(g.ports.bantam.hist!.length).toBeGreaterThan(10);
  });

  it('a ship at sea keeps its goods', () => {
    let g = at(newGame(7), 'bantam');
    g = buyGoods(g, g.fleet[0].id, 'pepper', 50);
    g = sail(g, g.fleet[0].id, 'batavia');
    expect(() => sellGoods(g, g.fleet[0].id, 'pepper')).toThrow(/at sea/);
    g = advance(g, 10);
    expect(g.fleet[0].goods![0].tons).toBe(50);
  });

  it('modern games have no own-account trade', () => {
    setEra('modern');
    expect(hasTrade(worldFor('modern'))).toBe(false);
    expect(newGame(1).ports.rotterdam.hist).toBeUndefined();
  });
});
