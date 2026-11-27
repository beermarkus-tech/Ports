import { afterEach, describe, expect, it } from 'vitest';
import { currentChapter, guideChapters, updateGuide } from '../src/sim/guide';
import { newGame } from '../src/sim/game';
import { getWorld, setEra } from '../src/sim/world';

describe('the guide', () => {
  afterEach(() => setEra('modern'));

  it('starts at chapter 1, quietly takes what an existing game has done, then reports what is new', () => {
    setEra('sail', 'chinese');
    const w = getWorld();
    const g = newGame(41);
    expect(currentChapter(w, g)!.n).toBe(1);
    // A game that had already delivered cargo meets the guide: no news, the step is simply done.
    g.stats.delivered = 120; g.stats.voyages = 2;
    expect(updateGuide(w, g)).toEqual({ steps: [], chapters: [] });
    expect(g.guide!.done).toContain('firstCargo');
    // Now three more voyages: one step done, reported once.
    g.stats.voyages = 5;
    expect(updateGuide(w, g).steps.map((s) => s.id)).toEqual(['fiveVoyages']);
    expect(updateGuide(w, g).steps).toEqual([]);
    // A step stays done even if the condition lapses.
    g.stats.voyages = 0;
    expect(guideChapters(w, g)[0].steps.find((s) => s.id === 'fiveVoyages')!.done).toBe(true);
  });

  it('finishes a chapter and opens the next; steps follow the era', () => {
    setEra('sail', 'dutch');
    const w = getWorld();
    const g = newGame(42);
    updateGuide(w, g);
    g.stats.delivered = 50; g.stats.voyages = 5;
    g.books = [{ m: 0, revenue: 0, fuel: 0, fees: 0, upkeep: 0, interest: 0, repairs: 1000, incidents: 0, trade: 500, shipsBought: 0, shipsSold: 0, netWorth: 0, cash: 0, loan: 0 }];
    const news = updateGuide(w, g);
    expect(news.chapters.map((c) => c.n)).toEqual([1]);
    expect(g.guide!.when!.fiveVoyages).toBe(g.day);        // the day each step was done, for the journal
    expect(g.guide!.when!.firstCargo).toBe(g.day);
    expect(news.chapters[0].epilogue).toContain('Duifje');
    expect(currentChapter(w, g)!.title).toBe('A small fleet');
    expect(guideChapters(w, g)[2].title).toBe('A charter to settle');
    setEra('modern');
    const m = newGame(43);
    const ch = guideChapters(getWorld(), m);
    expect(ch[0].steps.map((s) => s.id)).not.toContain('ownTrade');
    expect(ch[1].steps.map((s) => s.id)).not.toContain('discover');
    expect(ch[2].title).toBe('A real company');
  });
});
