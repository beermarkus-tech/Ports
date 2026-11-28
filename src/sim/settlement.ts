// A settlement of your own (Age of Sail): one per game, at one of three sites of your house, founded
// under a charter (the guide's chapter 3). Settlers come by your ships; they eat every day, build
// what you order from the timber and tools you bring, and grow food once fields are in. It grows
// from a camp to an outpost and a village, then with workshops to a town, and at last opens as a
// port that the world trades with. Hunger, fever and storms set it back; it shrinks, but never
// dies. Pure rules; actions are in game.ts, the opened port in world.ts (openSettlementPort).

import { regenerateBoard } from './contracts';
import { rand, randInt } from './rng';
import { ensureTrade } from './trade';
import type { GameState, Settlement } from './types';
import type { World } from './world';

export type Stage = Settlement['stage'];
export const STAGES: Stage[] = ['camp', 'outpost', 'village', 'town', 'port'];
export const STAGE_NAMES: Record<Stage, string> = { camp: 'Camp', outpost: 'Outpost', village: 'Village', town: 'Town', port: 'Port' };

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
  /** The workshops the place allows (BUILDING ids), and what the opened port buys. */
  works: string[];
  buys: string[];
}

export const SITES: Record<string, SiteInfo> = {
  tamsui: {
    blurb: 'Two days from Amoy, on the north of Formosa: a fine harbour, camphor and timber in the hills.',
    plus: ['timber', 'good harbour', 'near home'], minus: ['typhoons', 'little rice land'],
    fields: 3, crop: 'rice', fishing: 2, forest: 0.8, fever: 0.04, storm: 0.3, stormMonths: [6, 7, 8, 9], charter: 120_000,
    works: ['deerskins', 'saltpans'], buys: ['textiles', 'tools', 'tea', 'porcelain'],
  },
  bintan: {
    blurb: 'On the Riau islands, where every ship between Malacca and China passes. Pepper and gambier; fever.',
    plus: ['every ship passes', 'rich fishing', 'some timber'], minus: ['fever', 'no rice land'],
    fields: 1, crop: 'rice', fishing: 5, forest: 0.3, fever: 0.12, storm: 0.03, stormMonths: [11, 0], charter: 100_000,
    works: ['pepper'], buys: ['textiles', 'tools', 'rice', 'porcelain'],
  },
  songkhla: {
    blurb: 'A lagoon on the Gulf of Siam: rice land and tin nearby, but off the main routes.',
    plus: ['rice land', 'feeds itself early'], minus: ['off the routes', 'no forest'],
    fields: 8, crop: 'rice', fishing: 1, forest: 0, fever: 0.06, storm: 0.06, stormMonths: [10, 11], charter: 90_000,
    works: ['tinmine'], buys: ['textiles', 'tools', 'timber', 'porcelain'],
  },
  mauritius: {
    blurb: 'An empty island on the way to the Indies: ebony forests, fresh water, and cyclones.',
    plus: ['ebony and timber', 'on the Indies route', 'fishing'], minus: ['cyclones', 'little farmland'],
    fields: 3, crop: 'grain', fishing: 3, forest: 0.7, fever: 0.03, storm: 0.3, stormMonths: [0, 1, 2], charter: 120_000,
    works: ['saltpans'], buys: ['cloth', 'wine', 'tools', 'rice'],
  },
  sthelena: {
    blurb: 'A lonely, healthy island in the South Atlantic: water and a stop for every ship sailing home.',
    plus: ['healthy', 'on the way home', 'good fishing'], minus: ['small', 'far from everything'],
    fields: 2, crop: 'grain', fishing: 4, forest: 0.15, fever: 0.01, storm: 0.02, stormMonths: [6, 7], charter: 80_000,
    works: ['curing'], buys: ['cloth', 'wine', 'tools', 'grain'],
  },
  berbice: {
    blurb: 'A river on the Wild Coast of Guiana: rich soil and forest, and fever.',
    plus: ['rich soil', 'forest'], minus: ['fever', 'far from home'],
    fields: 6, crop: 'grain', fishing: 1, forest: 0.8, fever: 0.13, storm: 0.02, stormMonths: [5, 6], charter: 100_000,
    works: ['tobacco', 'indigo'], buys: ['cloth', 'wine', 'tools', 'salt'],
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
  /** Most of it (a function of the site, and for fields and boats of the stage reached). */
  max: (site: SiteInfo, s: Settlement) => number;
  /** A workshop: what it makes a day with all hands, and the hands it needs. */
  makes?: { good: string; perDay: number };
  jobs?: number;
  /** Needs this building first (the wharf needs the jetty). */
  needs?: string;
}

/** Fields and boats: the land and waters worked harder as the place grows (×2 a village, ×3 a town). */
const grown = (s: Settlement) => Math.max(1, STAGES.indexOf(s.stage));
/** A workshop the site allows. */
const works = (id: string) => (site: SiteInfo) => (site.works.includes(id) ? 3 : 0);

export const BUILDINGS: BuildingDef[] = [
  { id: 'jetty', name: 'Jetty', blurb: 'A place to land people and cargo: the beginning of a port.', cost: 20_000, timber: 20, tools: 4, work: 240, stage: 'camp', max: () => 1 },
  { id: 'storehouse', name: 'Storehouse', blurb: 'Room for 500 t more rice and grain in the granary, out of the rain.', cost: 15_000, timber: 30, tools: 4, work: 300, stage: 'camp', max: () => 3 },
  { id: 'houses', name: 'Houses', blurb: 'Room for 20 more people.', cost: 8_000, timber: 15, tools: 2, work: 150, stage: 'camp', max: () => 30 },
  { id: 'fields', name: 'Fields', blurb: 'Food from the land: 1.5 t a day (enough for 33 people), from the first harvest about 2½ months after they are cleared.', cost: 6_000, timber: 4, tools: 6, work: 300, stage: 'outpost', max: (site, s) => site.fields * grown(s) },
  { id: 'fishery', name: 'Fishing boats', blurb: 'Fresh fish, eaten the day it is landed: 1 t a day (enough for 22 people), from the day they are built.', cost: 8_000, timber: 12, tools: 3, work: 150, stage: 'outpost', max: (site, s) => site.fishing * grown(s) },
  { id: 'well', name: 'Well', blurb: 'Clean water: fever strikes half as often.', cost: 10_000, timber: 6, tools: 4, work: 160, stage: 'outpost', max: () => 1 },
  { id: 'sawmill', name: 'Sawmill', blurb: 'Timber from the forest, every day.', cost: 25_000, timber: 20, tools: 10, work: 400, stage: 'outpost', max: (s) => (s.forest > 0 ? 1 : 0) },
  // A village: the wharf, the market hall and the workshops.
  { id: 'wharf', name: 'Wharf', blurb: 'A stone wharf where seagoing ships lie alongside: a real harbour.', cost: 40_000, timber: 60, tools: 10, work: 600, stage: 'village', max: () => 1, needs: 'jetty' },
  { id: 'market', name: 'Market hall', blurb: 'Where traders meet: the heart of a town.', cost: 35_000, timber: 40, tools: 6, work: 500, stage: 'village', max: () => 1 },
  { id: 'pepper', name: 'Pepper gardens', blurb: 'Pepper vines on poles: 0.5 t of pepper a day.', cost: 30_000, timber: 20, tools: 6, work: 400, stage: 'village', max: works('pepper'), makes: { good: 'pepper', perDay: 0.5 }, jobs: 20 },
  { id: 'tinmine', name: 'Tin mine', blurb: 'Tin dug and smelted in the hills: 1 t a day.', cost: 40_000, timber: 30, tools: 15, work: 500, stage: 'village', max: works('tinmine'), makes: { good: 'tin', perDay: 1 }, jobs: 20 },
  { id: 'saltpans', name: 'Salt pans', blurb: 'Sea water dried in the sun: 2.5 t of salt a day.', cost: 20_000, timber: 10, tools: 5, work: 300, stage: 'village', max: works('saltpans'), makes: { good: 'salt', perDay: 2.5 }, jobs: 20 },
  { id: 'deerskins', name: 'Deerskin trade', blurb: 'Skins bought from the hill villages and cured: 0.4 t a day.', cost: 25_000, timber: 15, tools: 4, work: 350, stage: 'village', max: works('deerskins'), makes: { good: 'furs', perDay: 0.4 }, jobs: 20 },
  { id: 'curing', name: 'Fish curing', blurb: 'Fish salted and dried on racks: 1.2 t of stockfish a day.', cost: 20_000, timber: 20, tools: 4, work: 300, stage: 'village', max: works('curing'), makes: { good: 'cod', perDay: 1.2 }, jobs: 20 },
  { id: 'tobacco', name: 'Tobacco farm', blurb: 'Tobacco grown by free farmers and dried in barns: 0.7 t a day.', cost: 30_000, timber: 25, tools: 6, work: 400, stage: 'village', max: works('tobacco'), makes: { good: 'tobacco', perDay: 0.7 }, jobs: 20 },
  { id: 'indigo', name: 'Indigo works', blurb: 'Indigo steeped and dried into cakes of dye: 0.4 t a day.', cost: 35_000, timber: 20, tools: 8, work: 450, stage: 'village', max: works('indigo'), makes: { good: 'indigo', perDay: 0.4 }, jobs: 20 },
  // A town: the customs house opens the port.
  { id: 'customs', name: 'Customs house', blurb: 'Opens the port to the world: other merchants call, and the dues are yours.', cost: 60_000, timber: 50, tools: 10, work: 600, stage: 'town', max: () => 1 },
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
  /** Granary room (rice and grain) without a storehouse, and per storehouse. */
  store: 150,
  perStorehouse: 500,
  /** Building materials lie in a yard on the beach with its own room, so food never blocks a building. */
  yardGoods: ['timber', 'tools'],
  /** Share of the yard the sawmill leaves free, for tools landed from the ships. */
  sawmillReserve: 0.2,
  /** Warehouse room for what the workshops make, per workshop. */
  perWorkshop: 200,
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
  /** People who farm, fish and keep house; the rest can work in the workshops. */
  homeHands: 80,
  /** Harbour dues and trade a day for each person, once the port is open. */
  duesPerPerson: 1.5,
  /** What a stage needs. */
  outpost: { people: 40, foodDays: 60 },
  village: { people: 120 },
  town: { people: 250, workshops: 2 },
  port: { people: 400 },
};

const T = SETTLEMENT_TUNING;

export const siteOf = (s: Settlement): SiteInfo => SITES[s.site];
export const count = (s: Settlement, id: string): number => s.buildings[id] ?? 0;
export const housing = (s: Settlement): number => T.tents + count(s, 'houses') * T.perHouse;
export const storeRoom = (s: Settlement): number => T.store + count(s, 'storehouse') * T.perStorehouse;
export const inYard = (good: string): boolean => T.yardGoods.includes(good);
/** Food goes to the granary, timber and tools to the yard, everything else (what the workshops make) to the warehouse. */
export const inGranary = (good: string): boolean => good === 'rice' || good === 'grain';
/** Tons in the granary: the food. */
export const stored = (s: Settlement): number => (s.stores.rice ?? 0) + (s.stores.grain ?? 0);
/** The warehouse: room for what the workshops make (by the workshops there are), and what's in it. */
export const warehouseRoom = (s: Settlement): number => BUILDINGS.filter((b) => b.makes).reduce((n, b) => n + count(s, b.id), 0) * T.perWorkshop;
export const warehoused = (s: Settlement): number => Object.entries(s.stores).reduce((a, [g, t]) => a + (inYard(g) || inGranary(g) ? 0 : t), 0);
/** Tons in the yard (timber, iron and tools). */
export const yardStored = (s: Settlement): number => Object.entries(s.stores).reduce((a, [g, t]) => a + (inYard(g) ? t : 0), 0);
/** Room left for a good: in the yard for building materials, in the store for the rest. */
/** The sawmill has stopped: the yard is as full as it fills it (the rest is kept for tools). */
export const sawmillResting = (s: Settlement): boolean => count(s, 'sawmill') > 0 && yardStored(s) >= T.yard * (1 - T.sawmillReserve) - 0.5;
/** The workshops have stopped: their warehouse is full. */
export const workshopsResting = (s: Settlement): boolean => Object.keys(making(s)).length > 0 && warehoused(s) >= warehouseRoom(s) - 0.5;
/** What's in the warehouse: the workshops' goods, to ship out and sell. */
export const storeGoods = (s: Settlement): string[] => Object.keys(s.stores).filter((k) => !inYard(k) && !inGranary(k) && (s.stores[k] ?? 0) >= 0.5);
/** Room left for a good: in the yard, the granary or the warehouse. */
export const roomFor = (s: Settlement, good: string): number =>
  Math.max(0, inYard(good) ? T.yard - yardStored(s) : inGranary(good) ? storeRoom(s) - stored(s) : warehouseRoom(s) - warehoused(s));
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
/** The workshops built (the sawmill counts: it makes timber to sell). */
export const workshops = (s: Settlement): number => BUILDINGS.filter((b) => b.makes || b.id === 'sawmill').reduce((n, b) => n + count(s, b.id), 0);
/** Hands the workshops need, and the share of them at work (people beyond the home hands). */
export const jobs = (s: Settlement): number => BUILDINGS.reduce((n, b) => n + (b.jobs ?? 0) * count(s, b.id), 0);
export const staffed = (s: Settlement): number => (jobs(s) ? Math.min(1, Math.max(0, s.people - T.homeHands) / jobs(s)) : 1);
/** What the workshops make a day, by good (with the hands there are). */
export function making(s: Settlement): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of BUILDINGS) if (b.makes && count(s, b.id)) out[b.makes.good] = (out[b.makes.good] ?? 0) + b.makes.perDay * count(s, b.id) * staffed(s);
  return out;
}
/** Goods the place makes or grows to sell (for the opened port's market). */
export function products(s: Settlement): string[] {
  const site = siteOf(s);
  return [...new Set([...site.works.map((id) => BUILDING[id].makes!.good), ...(site.forest ? ['timber'] : []), ...(site.fields >= 6 ? [site.crop] : [])])];
}
/** Harbour dues and trade a day (once the port is open). */
export const dues = (s: Settlement): number => (s.stage === 'port' ? s.people * T.duesPerPerson : 0);
/** Settlers willing to sign on at home now. */
export const willing = (s: Settlement): number => Math.floor(s.willing ?? T.willingStart);

/** Can this building be started now? Null, or why not. */
export function cannotBuild(g: GameState, s: Settlement, id: string): string | null {
  const b = BUILDING[id];
  if (!b) return 'Unknown building.';
  if (s.project) return `The settlers are busy with the ${BUILDING[s.project.id].name.toLowerCase()}.`;
  if (STAGES.indexOf(b.stage) > stageIndex(s)) return `Needs the ${STAGE_NAMES[b.stage].toLowerCase()} stage.`;
  const most = b.max(siteOf(s), s);
  if (count(s, id) >= most) return most ? (b.max(siteOf(s), { ...s, stage: 'town' }) > most ? 'More once it grows.' : 'There is no room for more.') : 'Not at this site.';
  if (b.needs && !count(s, b.needs)) return `Needs the ${BUILDING[b.needs].name.toLowerCase()} first.`;
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
  if (s.stage === 'village' && s.people >= T.town.people && count(s, 'wharf') && count(s, 'market') && workshops(s) >= T.town.workshops) return 'town';
  if (s.stage === 'town' && s.people >= T.port.people && count(s, 'customs')) return 'port';
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
  if (s.stage === 'village') return { stage: 'town', needs: [
    { text: `${T.town.people} people (now ${Math.floor(s.people)})`, done: s.people >= T.town.people },
    { text: 'A wharf', done: !!count(s, 'wharf') },
    { text: 'A market hall', done: !!count(s, 'market') },
    { text: `${T.town.workshops} workshops (the sawmill counts; now ${workshops(s)})`, done: workshops(s) >= T.town.workshops },
  ] };
  if (s.stage === 'town') return { stage: 'port', needs: [
    { text: `${T.port.people} people (now ${Math.floor(s.people)})`, done: s.people >= T.port.people },
    { text: 'A customs house', done: !!count(s, 'customs') },
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
  // The sawmill rests once the yard is nearly full: room is kept for tools from the ships.
  if (count(s, 'sawmill')) store(s, 'timber', Math.min(site.forest, Math.max(0, T.yard * (1 - T.sawmillReserve) - yardStored(s))));
  // What the workshops make goes into their warehouse; they rest while it's full.
  for (const [good, tons] of Object.entries(making(s))) store(s, good, tons);
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
    note({
      outpost: `${name} is an outpost now: fields, a well, a sawmill and a stockade can be built.`,
      village: `${name} is a village now: it feeds itself, and its people mean to stay. Workshops, a wharf and a market hall can be built, and twice the fields and boats.`,
      town: `${name} is a town now, with a wharf and a market. Build a customs house to open the port to the world.`,
      port: `${name} is open as a port! Other merchants will call, its market trades with the world, and the harbour dues are yours.`,
      camp: '',
    }[up], 'good');
  }
  const income = dues(s);
  if (income) s.dues = (s.dues ?? 0) + income;
  // Rent to the local ruler, less the dues the open port brings in (negative: it earns).
  return (site.charter * T.rent) / 365 - income;
}

/** The settlement's site point, in a world (for maps: its lon/lat). */
export function settlementPort(world: World, g: GameState): string | null {
  return g.settlement && world.ports[g.settlement.site] ? g.settlement.site : null;
}

/**
 * Make the world match the game: its settlement, once a port, is in the port list (with a board,
 * a market and prices); otherwise no settlement is. Called on a new game, on loading, and when the
 * port opens.
 */
export function syncSettlementPort(world: World, g: GameState): void {
  const s = g.settlement;
  if (!world.era.wind) return;
  if (s?.stage !== 'port' || !world.ports[s.site]) { world.setOpenPort(null); return; }
  const site = SITES[s.site];
  world.setOpenPort({
    id: s.site,
    produces: products(s).map((good) => ({ good, weight: 1 })),
    demands: site.buys.map((good) => ({ good, strength: 1.1 })),
    portFee: 900,
  });
  const ps = (g.ports[s.site] ??= { fuelDev: 0, board: [], market: [], prices: {} });
  ps.prices ??= {};
  if (!ps.board.length) regenerateBoard(world, g, s.site);
  ensureTrade(world, g);
}

/** The buildings the next stage asks for (and the houses and food it takes to get there). */
export function stageGoals(s: Settlement, day: number): string[] {
  const goals: Record<Stage, string[]> = {
    camp: ['jetty', 'storehouse'],
    outpost: ['well', ...(feedsItself(s, day) ? [] : ['fields', 'fishery'])],
    village: ['wharf', 'market', ...(workshops(s) < T.town.workshops ? ['sawmill', ...BUILDINGS.filter((b) => b.makes).map((b) => b.id)] : [])],
    town: ['customs'],
    port: [],
  };
  const site = SITES[s.site];
  const roomy = housing(s) - s.people >= 10;
  const ids = [...(roomy ? [] : ['houses']), ...goals[s.stage]];
  // Only what can still be built there, and not what's under way already.
  return ids.filter((id, i) => {
    const b = BUILDINGS.find((x) => x.id === id);
    return b && ids.indexOf(id) === i && s.project?.id !== id && count(s, id) < b.max(site, { ...s, stage: 'port' })
      && (id === 'houses' || !['fields', 'fishery'].includes(id) || count(s, id) === 0 || !feedsItself(s, day))
      && (!['wharf', 'market', 'customs', 'jetty', 'storehouse', 'well'].includes(id) || count(s, id) === 0);
  });
}

/**
 * What to bring on the next run: two months of food the place doesn't grow, the timber and tools
 * for the next stage's buildings (less what's in the yard), and settlers for the room there is.
 */
export function bringList(s: Settlement, day: number): { good: string; tons: number; why: string }[] {
  const out: { good: string; tons: number; why: string }[] = [];
  const up10 = (n: number) => Math.ceil(n / 10) * 10;
  const short = Math.max(0, eats(s) - localFood(s, day));
  const food = up10(Math.max(0, short * 60 - foodStock(s)));
  if (food > 0) out.push({ good: 'food', tons: food, why: `two months' food (${fmt(short)} t a day they don't grow)` });
  // Workshops: one more is enough to list (any of them counts).
  let shopListed = false;
  const goals = stageGoals(s, day).filter((id) => {
    const b = BUILDINGS.find((x) => x.id === id)!;
    if (!b.makes && id !== 'sawmill') return true;
    if (shopListed) return false;
    shopListed = true; return true;
  });
  const need = (k: 'timber' | 'tools') => goals.reduce((a, id) => a + BUILDINGS.find((b) => b.id === id)![k], 0);
  const names = goals.map((id) => BUILDINGS.find((b) => b.id === id)!.name.toLowerCase());
  const why = names.length ? `for ${names.slice(0, 3).join(', ')}` : '';
  const timber = up10(Math.max(0, need('timber') - (s.stores.timber ?? 0)));
  const tools = Math.ceil(Math.max(0, need('tools') - (s.stores.tools ?? 0)));
  if (timber > 0) out.push({ good: 'timber', tons: timber, why });
  if (tools > 0) out.push({ good: 'tools', tons: tools, why });
  const room = Math.floor(housing(s) - s.people);
  const sign = Math.min(room, willing(s));
  if (room >= 5 && sign >= 1) out.push({ good: 'settlers', tons: sign, why: `room for ${room} more` });
  return out;
}
