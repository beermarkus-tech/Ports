// A settlement of your own (Age of Sail): one per game, at one of three sites of your house, founded
// under a charter (the guide's chapter 3). Settlers come by your ships; they eat every day, build
// what you order from the timber and tools you bring, and grow food once fields are in. It grows
// from a camp to an outpost and a village (workshops, the town and the port come later). Hunger,
// fever and storms set it back; it shrinks, but never dies. Pure rules; actions are in game.ts.

import { rand, randInt } from './rng';
import type { GameState, Settlement } from './types';
import type { World } from './world';

export type Stage = Settlement['stage'];
export const STAGES: Stage[] = ['camp', 'outpost', 'village'];
export const STAGE_NAMES: Record<Stage, string> = { camp: 'Camp', outpost: 'Outpost', village: 'Village' };

export interface SiteInfo {
  /** What it's like, in a line, and its good and bad sides. */
  blurb: string;
  plus: string[];
  minus: string[];
  /** Most fields the land allows, and the crop. */
  fields: number;
  crop: 'rice' | 'grain';
  /** Most fishing boats the waters allow (each lands fish for about 22 people a day). */
  fishing: number;
  /** Timber a day from a sawmill (0: no forest worth the name). */
  forest: number;
  /** Chance a month of a fever, and of a storm (in the storm months, 0 = January). */
  fever: number;
  storm: number;
  stormMonths: number[];
  /** What the charter costs, once; a yearly rent to the local ruler is a share of it. */
  charter: number;
}

export const SITES: Record<string, SiteInfo> = {
  tamsui: {
    blurb: 'Two days from Amoy, on the north of Formosa: a fine harbour, camphor and timber in the hills.',
    plus: ['timber', 'good harbour', 'near home'], minus: ['typhoons', 'little rice land'],
    fields: 3, crop: 'rice', fishing: 2, forest: 0.8, fever: 0.04, storm: 0.3, stormMonths: [6, 7, 8, 9], charter: 120_000,
  },
  bintan: {
    blurb: 'On the Riau islands, where every ship between Malacca and China passes. Pepper and gambier; fever.',
    plus: ['every ship passes', 'rich fishing', 'some timber'], minus: ['fever', 'no rice land'],
    fields: 1, crop: 'rice', fishing: 5, forest: 0.3, fever: 0.12, storm: 0.03, stormMonths: [11, 0], charter: 100_000,
  },
  songkhla: {
    blurb: 'A lagoon on the Gulf of Siam: rice land and tin nearby, but off the main routes.',
    plus: ['rice land', 'feeds itself early'], minus: ['off the routes', 'no forest'],
    fields: 8, crop: 'rice', fishing: 1, forest: 0, fever: 0.06, storm: 0.06, stormMonths: [10, 11], charter: 90_000,
  },
  mauritius: {
    blurb: 'An empty island on the way to the Indies: ebony forests, fresh water, and cyclones.',
    plus: ['ebony and timber', 'on the Indies route', 'fishing'], minus: ['cyclones', 'little farmland'],
    fields: 3, crop: 'grain', fishing: 3, forest: 0.7, fever: 0.03, storm: 0.3, stormMonths: [0, 1, 2], charter: 120_000,
  },
  sthelena: {
    blurb: 'A lonely, healthy island in the South Atlantic: water and a stop for every ship sailing home.',
    plus: ['healthy', 'on the way home', 'good fishing'], minus: ['small', 'far from everything'],
    fields: 2, crop: 'grain', fishing: 4, forest: 0.15, fever: 0.01, storm: 0.02, stormMonths: [6, 7], charter: 80_000,
  },
  berbice: {
    blurb: 'A river on the Wild Coast of Guiana: rich soil and forest, and fever.',
    plus: ['rich soil', 'forest'], minus: ['fever', 'far from home'],
    fields: 6, crop: 'grain', fishing: 1, forest: 0.8, fever: 0.13, storm: 0.02, stormMonths: [5, 6], charter: 100_000,
  },
};

export interface BuildingDef {
  id: string;
  name: string;
  /** What it does, in a line. */
  blurb: string;
  cost: number;
  timber: number;
  tools: number;
  /** Person-days of work (half the settlers work on it). */
  work: number;
  /** The stage that allows it. */
  stage: Stage;
  /** Most of it (a function of the site for fields and boats). */
  max: (site: SiteInfo) => number;
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'jetty', name: 'Jetty', blurb: 'A place to land people and cargo: the beginning of a port.', cost: 20_000, timber: 20, tools: 4, work: 240, stage: 'camp', max: () => 1 },
  { id: 'storehouse', name: 'Storehouse', blurb: 'Room for 500 t more in store, out of the rain.', cost: 15_000, timber: 30, tools: 4, work: 300, stage: 'camp', max: () => 3 },
  { id: 'houses', name: 'Houses', blurb: 'Room for 20 more people.', cost: 8_000, timber: 15, tools: 2, work: 150, stage: 'camp', max: () => 30 },
  { id: 'fields', name: 'Fields', blurb: 'Food from the land: 1.5 t a day (enough for 33 people), from the first harvest about 2½ months after they are cleared.', cost: 6_000, timber: 4, tools: 6, work: 300, stage: 'outpost', max: (s) => s.fields },
  { id: 'fishery', name: 'Fishing boats', blurb: 'Fresh fish, eaten the day it is landed: 1 t a day (enough for 22 people), from the day they are built.', cost: 8_000, timber: 12, tools: 3, work: 150, stage: 'outpost', max: (s) => s.fishing },
  { id: 'well', name: 'Well', blurb: 'Clean water: fever strikes half as often.', cost: 10_000, timber: 6, tools: 4, work: 160, stage: 'outpost', max: () => 1 },
  { id: 'sawmill', name: 'Sawmill', blurb: 'Timber from the forest, every day.', cost: 25_000, timber: 20, tools: 10, work: 400, stage: 'outpost', max: (s) => (s.forest > 0 ? 1 : 0) },
  { id: 'stockade', name: 'Stockade', blurb: 'A palisade and shelter: storms do half the damage.', cost: 18_000, timber: 40, tools: 6, work: 400, stage: 'outpost', max: () => 1 },
];
export const BUILDING = Object.fromEntries(BUILDINGS.map((b) => [b.id, b])) as Record<string, BuildingDef>;

export const SETTLEMENT_TUNING = {
  /** Food a person eats in a day (tons: with spoilage and waste, rice or grain alike). */
  food: 0.045,
  /** Goods the settlement takes from your ships. */
  supplies: ['rice', 'grain', 'timber', 'tools'],
  /** Tents for the first comers, then houses. */
  tents: 15,
  perHouse: 20,
  /** Store room without a storehouse, and per storehouse. */
  store: 150,
  perStorehouse: 500,
  /** Building materials lie in a yard on the beach with its own room, so food never blocks a building. */
  yardGoods: ['timber', 'tools'],
  yard: 300,
  /** What a settler costs to recruit at home (passage, wages, tools), and the hold room one takes. */
  settlerCost: 300,
  settlerTons: 1,
  /** Willing settlers are scarce: this many at the start, this many more a day, at most this many waiting. */
  willingStart: 30,
  willingPerDay: 0.5,
  willingMax: 40,
  /** Share of the people who build (the rest farm, fish, cook). */
  workShare: 0.5,
  /** A field's harvest a day, and how long from clearing to the first one. */
  fieldYield: 1.5,
  /** Fish a boat lands a day (eaten fresh, never stored). */
  fishYield: 1,
  fieldDays: 75,
  /** Growth when well fed and housed, a day; people leaving when hungry, a day. */
  growth: 0.0012,
  hungerLoss: 0.015,
  /** Never fewer than this, once people have landed: a caretaker crew stays. */
  floor: 5,
  /** Yearly rent to the local ruler, as a share of the charter. */
  rent: 0.12,
  /** What a stage needs. */
  outpost: { people: 40, foodDays: 60 },
  village: { people: 120 },
};

const T = SETTLEMENT_TUNING;

export const siteOf = (s: Settlement): SiteInfo => SITES[s.site];
export const count = (s: Settlement, id: string): number => s.buildings[id] ?? 0;
export const housing = (s: Settlement): number => T.tents + count(s, 'houses') * T.perHouse;
export const storeRoom = (s: Settlement): number => T.store + count(s, 'storehouse') * T.perStorehouse;
export const inYard = (good: string): boolean => T.yardGoods.includes(good);
/** Tons in the store (food and the like; the yard's timber and tools not counted). */
export const stored = (s: Settlement): number => Object.entries(s.stores).reduce((a, [g, t]) => a + (inYard(g) ? 0 : t), 0);
/** Tons in the yard (timber, iron and tools). */
export const yardStored = (s: Settlement): number => Object.entries(s.stores).reduce((a, [g, t]) => a + (inYard(g) ? t : 0), 0);
/** Room left for a good: in the yard for building materials, in the store for the rest. */
export const roomFor = (s: Settlement, good: string): number => Math.max(0, inYard(good) ? T.yard - yardStored(s) : storeRoom(s) - stored(s));
export const foodStock = (s: Settlement): number => (s.stores.rice ?? 0) + (s.stores.grain ?? 0);
export const eats = (s: Settlement): number => s.people * T.food;
/** Fields with a harvest in. */
export const ripeFields = (s: Settlement, day: number): number => (s.fields ?? []).filter((d) => day - d >= T.fieldDays).length;
export const grows = (s: Settlement, day: number): number => ripeFields(s, day) * T.fieldYield;
/** Fish landed a day (eaten fresh). */
export const fish = (s: Settlement): number => count(s, 'fishery') * T.fishYield;
/** Food from the land and the sea a day. */
export const localFood = (s: Settlement, day: number): number => grows(s, day) + fish(s);
/** Does it feed itself (with people there)? */
export const feedsItself = (s: Settlement, day: number): boolean => s.people >= 1 && localFood(s, day) >= eats(s);
/** Days the food in store lasts, counting what the fields and boats bring in. */
export function foodDays(s: Settlement, day: number): number {
  const net = eats(s) - localFood(s, day);
  if (net <= 0) return Infinity;
  return foodStock(s) / net;
}
export const stageIndex = (s: Settlement): number => STAGES.indexOf(s.stage);
/** Settlers willing to sign on at home now. */
export const willing = (s: Settlement): number => Math.floor(s.willing ?? T.willingStart);

/** Can this building be started now? Null, or why not. */
export function cannotBuild(g: GameState, s: Settlement, id: string): string | null {
  const b = BUILDING[id];
  if (!b) return 'Unknown building.';
  if (s.project) return `The settlers are busy with the ${BUILDING[s.project.id].name.toLowerCase()}.`;
  if (STAGES.indexOf(b.stage) > stageIndex(s)) return `Needs the ${STAGE_NAMES[b.stage].toLowerCase()} stage.`;
  if (count(s, id) >= b.max(siteOf(s))) return b.max(siteOf(s)) ? 'There is no room for more.' : 'Not at this site.';
  if (s.people < 1) return 'Nobody there to build it yet.';
  if ((s.stores.timber ?? 0) < b.timber) return `Needs ${b.timber} t of timber in store.`;
  if ((s.stores.tools ?? 0) < b.tools) return `Needs ${b.tools} t of tools in store.`;
  if (g.cash < b.cost) return 'Not enough money.';
  return null;
}

/** Days a building takes with the people there now. */
export function buildDays(s: Settlement, id: string): number {
  return BUILDING[id].work / Math.max(1, s.people * T.workShare);
}

/** Has it reached the next stage? Returns the new stage, if so. */
function nextStage(s: Settlement, day: number): Stage | null {
  if (s.stage === 'camp' && s.people >= T.outpost.people && count(s, 'jetty') && count(s, 'storehouse') && foodDays(s, day) >= T.outpost.foodDays) return 'outpost';
  if (s.stage === 'outpost' && s.people >= T.village.people && count(s, 'well') && feedsItself(s, day)) return 'village';
  return null;
}

/** What the next stage needs, as lines with done flags (for the settlement panel and the guide). */
export function nextStageNeeds(s: Settlement, day: number): { stage: Stage; needs: { text: string; done: boolean }[] } | null {
  if (s.stage === 'camp') return { stage: 'outpost', needs: [
    { text: `${T.outpost.people} people (now ${Math.floor(s.people)})`, done: s.people >= T.outpost.people },
    { text: 'A jetty', done: !!count(s, 'jetty') },
    { text: 'A storehouse', done: !!count(s, 'storehouse') },
    { text: `Food for ${T.outpost.foodDays} days in store`, done: foodDays(s, day) >= T.outpost.foodDays },
  ] };
  if (s.stage === 'outpost') return { stage: 'village', needs: [
    { text: `${T.village.people} people (now ${Math.floor(s.people)})`, done: s.people >= T.village.people },
    { text: 'A well', done: !!count(s, 'well') },
    { text: `Food from its own fields and boats for everyone (${fmt(localFood(s, day))} of ${fmt(eats(s))} t a day)`, done: feedsItself(s, day) },
  ] };
  return null;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US');

type Note = (text: string, kind: 'good' | 'bad' | 'info') => void;

/** Take from the food in store (rice first), returning what couldn't be had. */
function eat(s: Settlement, tons: number): number {
  for (const good of ['rice', 'grain']) {
    const take = Math.min(s.stores[good] ?? 0, tons);
    if (take > 0) { s.stores[good] = +(s.stores[good]! - take).toFixed(3); tons -= take; }
  }
  return tons;
}

/** Add to the stores, up to the room there is. Returns what fitted. */
export function store(s: Settlement, good: string, tons: number): number {
  const fit = Math.min(tons, roomFor(s, good));
  if (fit > 0) s.stores[good] = +((s.stores[good] ?? 0) + fit).toFixed(3);
  return fit;
}

/**
 * A day at the settlement: the harvest and the sawmill, eating, hunger or growth, building work,
 * and once a month the chance of fever and of a storm. Returns the rent for the day.
 */
export function settlementDay(world: World, g: GameState, day: number, note: Note): number {
  const s = g.settlement;
  if (!s) return 0;
  const site = siteOf(s);
  const name = world.ports[s.site].name;
  // More people at home make up their minds to go.
  s.willing = Math.min(T.willingMax, (s.willing ?? T.willingStart) + T.willingPerDay);
  // What the land gives.
  if (grows(s, day)) store(s, site.crop, grows(s, day));
  if (count(s, 'sawmill')) store(s, 'timber', site.forest);
  if (s.people > 0) {
    const short = eat(s, Math.max(0, eats(s) - fish(s)));
    if (short > 0.001) {
      // Hungry: people leave on the next boat, down to a caretaker crew.
      s.hungry = (s.hungry ?? 0) + 1;
      const leave = Math.max(1, Math.round(s.people * T.hungerLoss));
      const before = s.people;
      s.people = Math.max(T.floor, s.people - leave);
      if (s.hungry === 1) note(`${name} has run out of food: people are leaving.`, 'bad');
      if (before > T.floor && s.people === T.floor) note(`${name}: only a caretaker crew of ${T.floor} is left. Bring food and settlers.`, 'bad');
    } else {
      if (s.hungry) note(`${name} has food again.`, 'good');
      s.hungry = 0;
      if (foodDays(s, day) > 30 && s.people < housing(s)) s.people = Math.min(housing(s), s.people * (1 + T.growth));
    }
    // Building.
    if (s.project) {
      s.project.done += s.people * T.workShare;
      const b = BUILDING[s.project.id];
      if (s.project.done >= b.work) {
        s.buildings[b.id] = count(s, b.id) + 1;
        if (b.id === 'fields') (s.fields ??= []).push(day);
        delete s.project;
        note(`${name}: the ${b.name.toLowerCase()} ${['houses', 'fields', 'fishery'].includes(b.id) ? 'are' : 'is'} ${b.id === 'fishery' ? 'out' : 'finished'}.`, 'good');
      }
    }
  }
  // Once a month: fever and storms.
  const date = new Date(Date.UTC(world.era.startYear, 0, 1) + day * 86_400_000);
  if (date.getUTCDate() === 1 && s.people > T.floor) {
    if (rand(g) < site.fever * (count(s, 'well') ? 0.5 : 1)) {
      const lost = Math.max(1, Math.round(s.people * (0.04 + rand(g) * 0.06)));
      s.people = Math.max(T.floor, s.people - lost);
      note(`Fever at ${name}: ${lost} ${lost === 1 ? 'settler' : 'settlers'} died.${count(s, 'well') ? '' : ' A well would help.'}`, 'bad');
    }
    if (site.stormMonths.includes(date.getUTCMonth()) && rand(g) < site.storm) {
      const harm = (0.1 + rand(g) * 0.15) * (count(s, 'stockade') ? 0.5 : 1);
      for (const good of ['rice', 'grain', 'timber']) if (s.stores[good]) s.stores[good] = +(s.stores[good]! * (1 - harm)).toFixed(3);
      if (s.project) s.project.done = Math.max(0, s.project.done - randInt(g, 8, 15) * s.people * T.workShare);
      note(`A storm struck ${name}: ${Math.round(harm * 100)}% of the stores spoiled${s.project ? ' and the building work was set back' : ''}.`, 'bad');
    }
  }
  const up = nextStage(s, day);
  if (up) {
    s.stage = up;
    note(up === 'outpost'
      ? `${name} is an outpost now: fields, a well, a sawmill and a stockade can be built.`
      : `${name} is a village now: it feeds itself from its fields and boats, and its people mean to stay. Workshops come with a coming build.`, 'good');
  }
  return Math.round((site.charter * T.rent) / 365);
}

/** The settlement's site point, in a world (for maps: its lon/lat). */
export function settlementPort(world: World, g: GameState): string | null {
  return g.settlement && world.ports[g.settlement.site] ? g.settlement.site : null;
}
