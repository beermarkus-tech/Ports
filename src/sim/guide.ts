// The guide: chapters of next steps through the game, so it has a purpose beyond the money.
// Each step is a condition on the game; once met it stays done. A chapter is done when all its
// steps are, and the next one opens. Pure: no DOM (main.ts shows it and announces what's new).

import { BUILDINGS, foodDays, ripeFields } from './settlement';
import { netWorth } from './ships';
import type { GameState } from './types';
import type { World } from './world';

export interface GuideStep {
  id: string;
  title: string;
  /** How to do it, in a line. */
  hint: string;
  /** [now, target] for steps that count something. */
  progress?: [number, number];
  done: boolean;
}

export interface GuideChapter {
  n: number;
  title: string;
  steps: GuideStep[];
  /** Said when the chapter is finished. */
  epilogue: string;
}

interface StepDef {
  id: string;
  /** Only in some games (e.g. own-account trade exists only in 1650). */
  when?: (w: World) => boolean;
  title: (w: World) => string;
  hint: (w: World) => string;
  /** Met now? With a count where it helps. */
  check: (w: World, g: GameState) => { done: boolean; progress?: [number, number] };
}

const sail = (w: World) => !!w.era.wind;
const startType = (w: World) => w.shipTypes[w.era.start.shipType];
const sum = (g: GameState, f: (b: NonNullable<GameState['books']>[number]) => number) => (g.books ?? []).reduce((s, b) => s + f(b), 0);
const count = (now: number, target: number) => ({ done: now >= target, progress: [Math.min(now, target), target] as [number, number] });

/** Ports charted beyond the waters the house knew at the start (found, or from a bought chart). */
function discovered(w: World, g: GameState): number {
  if (!w.era.charts || !g.charted) return 0;
  const inBox = (lon: number, lat: number) => w.era.charts!.known.some(([west, s, e, n]) => lat >= s && lat <= n && lon >= west && lon <= e);
  return g.charted.filter((id) => w.ports[id] && id !== w.era.start.port && !inBox(w.ports[id].lon, w.ports[id].lat)).length;
}

const CHAPTERS: { title: (w: World) => string; epilogue: (w: World) => string; when?: (w: World) => boolean; steps: StepDef[] }[] = [
  {
    title: () => 'First voyages',
    epilogue: (w) => `The ${w.era.start.shipName} has paid her way, and the merchants of ${w.ports[w.era.start.port].name} start to know your ${sail(w) ? 'house' : 'company'}.`,
    steps: [
      { id: 'firstCargo', title: () => 'Deliver your first cargo', hint: () => 'Load a cargo in the Orders tab, then pick where to go and cast off.',
        check: (_w, g) => ({ done: g.stats.delivered > 0 }) },
      { id: 'fiveVoyages', title: () => 'Complete five voyages', hint: () => 'Cargo both ways pays best: look for a load at every port you call at.',
        check: (_w, g) => count(g.stats.voyages, 5) },
      { id: 'firstRepair', title: (w) => (sail(w) ? 'Careen a ship' : 'Put a ship in dry dock'),
        hint: (w) => (sail(w) ? 'A worn hull is slow and springs leaks: careen her when her condition drops (Orders tab, under victuals and careening).' : 'A worn hull burns more fuel and breaks down: dry-dock her (Orders tab, under bunkers and dry dock).'),
        check: (_w, g) => ({ done: sum(g, (b) => b.repairs) > 0 }) },
      { id: 'ownTrade', when: (w) => !!w.era.trade, title: () => 'Sell goods of your own at a profit',
        hint: () => 'Buy goods where they are made (Orders tab, best buys) and sell them where they are wanted. Prices of far ports are only as fresh as the last letter.',
        check: (_w, g) => ({ done: sum(g, (b) => b.trade ?? 0) > 0 }) },
    ],
  },
  {
    title: () => 'A small fleet',
    epilogue: (w) => `A small fleet sails under your ${sail(w) ? 'flag' : 'colours'}. Time to let others command some of your ships.`,
    steps: [
      { id: 'secondShip', title: () => 'Own a second ship', hint: () => 'The Fleet tab sells ships in every port; the bank (Company tab) lends against your fleet.',
        check: (_w, g) => count(g.fleet.length, 2) },
      { id: 'biggerShip', title: (w) => `Own a ship that carries ${(startType(w).capacity * 3).toLocaleString('en-US')} t`,
        hint: (w) => (sail(w) ? 'Bigger ships carry the long, rich cargoes; shipyards build new ones.' : 'Bigger ships take the big bulk and container lots.'),
        check: (w, g) => count(Math.max(...g.fleet.map((s) => w.shipTypes[s.typeId].capacity)), startType(w).capacity * 3) },
      { id: 'worth1M', title: (w) => `Be worth ${w.era.currency}1,000,000`, hint: () => 'Net worth is your cash and ships, less what you owe the bank.',
        check: (w, g) => count(Math.round(netWorth(g, w)), 1_000_000) },
      { id: 'discover', when: (w) => !!w.era.charts, title: () => 'Reach a port your house has never seen',
        hint: () => 'Sail into uncharted water (slower and riskier), or buy a chart where one is for sale.',
        check: (w, g) => ({ done: discovered(w, g) > 0 }) },
    ],
  },
  {
    title: (w) => (sail(w) ? 'A charter to settle' : 'A real company'),
    epilogue: (w) => (sail(w)
      ? 'The charter is yours: you may found a settlement of your own. Open the Settlement tab and choose where.'
      : 'A real shipping company. More to do comes in coming builds; the guide will take you on from here.'),
    steps: [
      { id: 'captain', title: () => 'Hire a captain to run a ship', hint: () => 'The Fleet tab: a captain trades in an area you choose, by himself.',
        check: (_w, g) => ({ done: (g.captains ?? []).some((c) => c.shipId !== undefined) }) },
      { id: 'threeShips', title: () => 'A fleet of three ships', hint: () => 'More ships, more cargo: each one pays its upkeep every day, laden or not.',
        check: (_w, g) => count(g.fleet.length, 3) },
      { id: 'worth5M', title: (w) => `Be worth ${w.era.currency}5,000,000`, hint: () => 'Captains keep earning while you sail your own ship.',
        check: (w, g) => count(Math.round(netWorth(g, w)), 5_000_000) },
    ],
  },
  {
    title: () => 'A place of our own',
    when: sail,
    epilogue: (w) => `A camp has become a place: a jetty to land at, a storehouse against the rain, people who mean to stay. ${w.era.house?.id === 'chinese' ? 'The elders in Amoy' : 'The partners in Amsterdam'} begin to speak of it.`,
    steps: [
      { id: 'found', title: () => 'Found your settlement', hint: () => 'The Settlement tab: choose one of three sites and sign the charter.',
        check: (_w, g) => ({ done: !!g.settlement }) },
      { id: 'settlers15', title: () => 'Land 15 settlers', hint: (w) => `Settlers sign on at ${w.ports[w.era.start.port].name} (Settlement tab, with a ship in port there); they go ashore when she arrives.`,
        check: (_w, g) => count(Math.floor(g.settlement?.people ?? 0), 15) },
      { id: 'food30', title: () => 'Food for 30 days in store', hint: () => 'Buy rice or grain on your own account (Orders tab) and sail it there: it goes into the stores on arrival.',
        check: (_w, g) => count(g.settlement && g.settlement.people >= 1 ? Math.min(999, Math.floor(foodDays(g.settlement, g.day))) : 0, 30) },
      { id: 'jetty', title: () => 'Build the jetty', hint: () => 'Buildings need timber and iron and tools in store, and money. The settlers build them.',
        check: (_w, g) => ({ done: !!g.settlement?.buildings.jetty }) },
      { id: 'storehouse', title: () => 'Build a storehouse', hint: () => 'Without one, the store holds only 150 t of food (timber and tools lie in the yard).',
        check: (_w, g) => ({ done: !!g.settlement?.buildings.storehouse }) },
    ],
  },
  {
    title: () => 'It feeds itself',
    when: sail,
    epilogue: () => 'A village now, fed by its own fields and boats, its people healthy. Next it will make something the world wants.',
    steps: [
      { id: 'outpost', title: () => 'Grow into an outpost', hint: () => '40 people, a jetty, a storehouse and food for 60 days.',
        check: (_w, g) => ({ done: !!g.settlement && g.settlement.stage !== 'camp' }) },
      { id: 'harvest', title: () => 'Bring in the first harvest', hint: () => 'Clear fields (an outpost can): the first harvest comes about 2½ months later.',
        check: (_w, g) => ({ done: !!g.settlement && ripeFields(g.settlement, g.day) > 0 }) },
      { id: 'well', title: () => 'Dig a well', hint: () => 'Fever strikes half as often.',
        check: (_w, g) => ({ done: !!g.settlement?.buildings.well }) },
      { id: 'village', title: () => 'Grow into a village', hint: () => '120 people, a well, and enough food from its own fields and fishing boats for everyone.',
        check: (_w, g) => ({ done: !!g.settlement && ['village', 'town', 'port'].includes(g.settlement.stage) }) },
    ],
  },
  {
    title: () => 'Something to sell',
    when: sail,
    epilogue: () => 'A town now: a wharf, a market, workshops at work, and its goods sold in far ports. One thing is missing: the world does not yet call there.',
    steps: [
      { id: 'workshop', title: () => 'Build a workshop', hint: () => 'A village can: what it makes depends on the site (Settlement tab). Workshops need hands beyond the first 80 people.',
        check: (_w, g) => ({ done: !!g.settlement && BUILDINGS.some((b) => b.makes && g.settlement!.buildings[b.id]) }) },
      { id: 'shipGoods', title: () => 'Ship 20 t of your own goods', hint: () => 'With a ship lying at the settlement, load its goods in the Settlement tab (they cost nothing), then sell them where they are wanted.',
        check: (_w, g) => count(Math.floor(g.settlement?.shipped ?? 0), 20) },
      { id: 'wharf', title: () => 'Build a wharf', hint: () => 'Where seagoing ships lie alongside: it needs the jetty first.',
        check: (_w, g) => ({ done: !!g.settlement?.buildings.wharf }) },
      { id: 'town', title: () => 'Grow into a town', hint: () => '250 people, a wharf, a market hall and two workshops (the sawmill counts).',
        check: (_w, g) => ({ done: !!g.settlement && ['town', 'port'].includes(g.settlement.stage) }) },
    ],
  },
  {
    title: () => 'A port of our own',
    when: sail,
    epilogue: (w) => `Ships of every flag drop anchor off your town, and its dues come to your house. ${w.era.house?.id === 'chinese' ? 'In Amoy' : 'In Amsterdam'} they speak of it as a port. More to do comes in coming builds.`,
    steps: [
      { id: 'customs', title: () => 'Build a customs house', hint: () => 'A town can: it opens the port.',
        check: (_w, g) => ({ done: !!g.settlement?.buildings.customs }) },
      { id: 'portOpen', title: () => 'Open the port', hint: () => '400 people and the customs house: then other merchants call, and its market trades with the world.',
        check: (_w, g) => ({ done: g.settlement?.stage === 'port' }) },
      { id: 'dues', title: (w) => `Earn ${w.era.currency}100,000 in harbour dues`, hint: () => 'The bigger the town, the more its trade brings in.',
        check: (_w, g) => count(Math.floor(g.settlement?.dues ?? 0), 100_000) },
    ],
  },
];

/** The chapters as they stand for this game (steps that don't apply to its era are left out). */
export function guideChapters(w: World, g: GameState): GuideChapter[] {
  const done = new Set(g.guide?.done ?? []);
  return CHAPTERS.filter((c) => !c.when || c.when(w)).map((c, i) => ({
    n: i + 1,
    title: c.title(w),
    epilogue: c.epilogue(w),
    steps: c.steps.filter((s) => !s.when || s.when(w)).map((s) => {
      const r = s.check(w, g);
      return { id: s.id, title: s.title(w), hint: s.hint(w), progress: r.progress, done: done.has(s.id) || r.done };
    }),
  }));
}

/** The chapter being played: the first not finished (null once all are). */
export function currentChapter(w: World, g: GameState): GuideChapter | null {
  return guideChapters(w, g).find((c) => c.steps.some((s) => !s.done)) ?? null;
}

export interface GuideNews { steps: GuideStep[]; chapters: GuideChapter[] }

/**
 * Mark the steps met since last time, and report them (and any chapters they finish). A game that
 * meets the guide for the first time takes everything it has already done quietly.
 */
export function updateGuide(w: World, g: GameState): GuideNews {
  const first = !g.guide;
  g.guide ??= { done: [] };
  const news: GuideNews = { steps: [], chapters: [] };
  for (const c of guideChapters(w, g)) {
    const before = c.steps.every((s) => g.guide!.done.includes(s.id));
    for (const s of c.steps) {
      if (s.done && !g.guide.done.includes(s.id)) {
        g.guide.done.push(s.id);
        if (!first) (g.guide.when ??= {})[s.id] = g.day;
        news.steps.push(s);
      }
    }
    if (!before && c.steps.every((s) => g.guide!.done.includes(s.id))) news.chapters.push(c);
  }
  return first ? { steps: [], chapters: [] } : news;
}
