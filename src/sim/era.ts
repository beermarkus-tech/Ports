import type { Box, ChartOffer } from './charts';

// The two eras the game can be set in, and what differs between them that isn't
// plain data (ports, goods, ships, sea lanes, regions live in src/data/...).

export type EraId = 'modern' | 'sail';

/** The merchant houses of the Age of Sail: each is its own game, picked at the start. */
export type House = 'dutch' | 'chinese';

/** What a merchant house brings to the 1650 world: its own yards, ships, names and words. */
export interface HouseConfig {
  id: House;
  /** "Dutch house", for the start screen and the saved games. */
  name: string;
  /** Ship types its shipyards build and its brokers deal in. */
  ships: string[];
  /** Ports with a shipyard of this house (instead of the world data's). */
  shipyards?: string[];
  /** Ports this house calls by another name. */
  portNames?: Record<string, string>;
  /** Names for new ships, and for captains (family name first where `familyFirst`). */
  shipNames?: string[];
  captainNames?: { given: string[]; family: string[]; familyFirst?: boolean };
}

export interface EraConfig {
  id: EraId;
  name: string;
  /** The game's first day is 1 January of this year. */
  startYear: number;
  /** Money sign, written before amounts. */
  currency: string;
  start: {
    port: string; shipType: string; shipName: string; cash: number; fuel: number; condition: number; age: number;
    /** First line of the log. */
    intro: string;
  };
  /** Bunker prices follow a world oil index (and oil shocks happen). */
  hasOil: boolean;
  /** Pilot and tugs are charged on arrival (and you can dock yourself). */
  harbourServices: boolean;
  /** The side view of the ship at its quay. */
  portView: boolean;
  /** Sailing ships: speed depends on the prevailing wind and the season. */
  wind: boolean;
  /** Reference speed for deadlines, knots. */
  referenceSpeedKn: number;
  /** Multiplier on freight pay (sail cargoes are small but precious). */
  payFactor: number;
  /** Every board offers lots up to this size (what the starting ship can carry). */
  smallLot: number;
  /** Goods a harvest failure can hit. */
  harvestGoods: string[];
  /** You can buy and sell goods on your own account, with prices known by slow news. */
  trade?: boolean;
  /** Age of Sail: the merchant house the game is played as. */
  house?: HouseConfig;
  /** Fog of war: the waters known at the start, and charts for sale (none: no fog). */
  charts?: {
    known: Box[];
    offers: ChartOffer[];
    /** Names written on the unknown water (lon, lat, text, size); the map has Dutch ones by default. */
    names?: [number, number, string, number][];
  };
  /** Words for things that differ between the eras. */
  terms: {
    fuel: string;
    fuelUnit: string;
    bunker: string;
    drydock: string;
    strike: (port: string, days: number) => string;
  };
}

export const ERAS: Record<EraId, EraConfig> = {
  modern: {
    id: 'modern', name: 'Modern', startYear: 2000, currency: '$',
    start: { port: 'rotterdam', shipType: 'coaster', shipName: 'Tilly', cash: 150_000, fuel: 120, condition: 72, age: 24,
      intro: 'You take command of the Tilly, a tired old coaster, in Rotterdam.' },
    hasOil: true, harbourServices: true, portView: true, wind: false,
    referenceSpeedKn: 11, payFactor: 1, smallLot: 3000,
    harvestGoods: ['grain', 'coffee', 'cocoa', 'fruit'],
    terms: {
      fuel: 'Fuel', fuelUnit: 't', bunker: 'Bunkers', drydock: 'Dry dock',
      strike: (port, days) => `Dock strike in ${port}: calls there take ${days} extra days and fees are doubled.`,
    },
  },
  sail: {
    id: 'sail', name: 'Age of Sail', startYear: 1650, currency: 'ƒ',
    start: { port: 'amsterdam', shipType: 'jacht', shipName: 'Duifje', cash: 150_000, fuel: 220, condition: 80, age: 12,
      intro: 'You take command of the Duifje, a weathered little jacht, at Amsterdam. The Indies await.' },
    hasOil: false, harbourServices: false, portView: true, wind: true,
    referenceSpeedKn: 4, payFactor: 2, smallLot: 80,
    harvestGoods: ['pepper', 'nutmeg', 'sugar', 'grain', 'tea', 'silk', 'rice', 'coffee'],
    trade: true,
    house: { id: 'dutch', name: 'Dutch house', ships: ['jacht', 'fluyt', 'largefluyt', 'pinas', 'indiaman', 'retourschip'] },
    charts: {
      // What the Dutch knew around 1650: the Cape route to the Indies, the China seas and Japan,
      // the Atlantic coasts, and the way round Cape Horn (Le Maire, 1616). East Africa is Portuguese
      // water to them; the Pacific and the American west coast are still blank.
      known: [
        [-12, 34, 42, 66], [8, 53, 32, 66], [-6, 30, 37, 46],            // Europe, the Baltic, the Mediterranean
        [-40, -40, 22, 50], [-20, -6, 12, 30], [10, -38, 33, -15],       // the Atlantic run, Guinea, the Cape
        [18, -44, 108, -28], [42, -12, 100, 30], [60, 5, 92, 26],        // the roaring forties, the monsoon sea, India
        [92, -12, 120, 22], [119, -10, 136, 5], [104, 0, 123, 34],       // the Indies, the Spice Islands, the China seas
        [124, 26, 142, 40], [108, -36, 126, -12],                        // Japan, New Holland's west coast
        [-98, 8, -58, 32], [-82, 30, -55, 46], [-55, -30, -30, 2],       // the Caribbean, North America, Brazil
        [-82, -58, -50, -30], [44, -30, 64, -12],                        // round the Horn to Chile; Mauritius
        [-62, 30, -38, 52], [-62, 0, -38, 16], [30, 12, 44, 31],          // the North Atlantic crossing, the Wild Coast (Guiana), the Red Sea
      ],
      offers: [
        { id: 'swahili', port: 'goa', name: 'A Portuguese rutter of the Swahili coast',
          blurb: 'A Goa pilot will copy his rutter of Mozambique, Zanzibar and the waters inside Madagascar, for a price.',
          price: 90_000, boxes: [[30, -28, 56, 12]] },
        { id: 'galleon', port: 'manila', name: 'A Spanish chart of the galleon route',
          blurb: 'A drunken pilot of the Manila galleon sells the secret way across the Pacific to Acapulco.',
          price: 180_000, boxes: [[123, 10, 180, 45], [-180, 10, -98, 45], [-118, 8, -98, 24]] },
        { id: 'southsea', port: 'portobelo', name: 'A Spanish rutter of the South Sea',
          blurb: 'Smuggled out of the Casa de Contratación: the coast of Peru and New Spain, from Chile to Acapulco.',
          price: 150_000, boxes: [[-120, -30, -68, 24]] },
      ],
    },
    terms: {
      fuel: 'Victuals', fuelUnit: 'casks', bunker: 'Victuals', drydock: 'Careening',
      strike: (port, days) => `Plague in ${port}: the port is under quarantine. Calls take ${days} extra days and fees are doubled.`,
    },
  },
};

/** Charts on sale that any house can buy (when they would show it something new). */
const SAIL_OFFERS = ERAS.sail.charts!.offers;

/**
 * The Chinese house: a Hokkien trading house of Amoy, in 1650 the stronghold of Zheng Chenggong
 * (Koxinga) while the Qing take the south. It knows the China seas, Japan and the Nanyang (the
 * South Sea trade to Siam, Malaya, Java and the Philippines); India and everything beyond are blank.
 */
export const CHINESE_HOUSE: EraConfig = {
  ...ERAS.sail,
  currency: 'Tls ',
  start: { port: 'amoy', shipType: 'smalljunk', shipName: 'Kim Ho', cash: 150_000, fuel: 220, condition: 80, age: 12,
    intro: 'You take command of the Kim Ho, a weathered little Fujian junk, at Amoy. The Nanyang awaits.' },
  smallLot: 100,
  // Short legs in rich seas: freight pays less per league than on the Dutch long hauls.
  payFactor: 1.2,
  house: {
    id: 'chinese',
    name: 'Chinese house',
    ships: ['smalljunk', 'oceanjunk', 'nanyangjunk', 'greatjunk'],
    // Fujian built the junks; Siam built them for Chinese merchants too.
    shipyards: ['amoy', 'ayutthaya'],
    // Chinese merchants traded in Nagasaki itself (the Dutch were kept on Dejima).
    portNames: { dejima: 'Nagasaki' },
    shipNames: ['Kim Hin', 'Hong Seng', 'Kim Soon', 'Tek Hoa', 'Ban Hin', 'Hock Seng', 'Eng Hong', 'Chin Bee', 'Guan Seng', 'Hong Guan',
      'Soon Lee', 'Kim Eng', 'Tai Hong', 'Bun Hin', 'Lim Seng', 'Ho Seng', 'Teck Guan', 'Sin Hong', 'Swee Hin', 'Ban Seng', 'Chop Hin', 'Hong Hock'],
    captainNames: {
      family: ['Lim', 'Tan', 'Ong', 'Ng', 'Teo', 'Chua', 'Koh', 'Lee', 'Gan', 'Yeo', 'Khoo', 'Cheng', 'Tay', 'Sim', 'Low', 'Ang', 'Goh', 'Quek'],
      given: ['Boon Hock', 'Chin Huat', 'Eng Soon', 'Guan Teck', 'Hock Lai', 'Kim Swee', 'Lam Seng', 'Ah Bee', 'Tiong Hin', 'Bak Seng',
        'Kok Leong', 'Seng Kee', 'Hong Bin', 'Cheng Lock', 'Swee Lian', 'Ah Kow', 'Teck Seng', 'Poh Lin'],
      familyFirst: true,
    },
  },
  charts: {
    known: [
      [104, 0, 146, 42],                                    // the China coast, Formosa, the Philippines, Japan and Korea
      [97, -2, 110, 17],                                    // the Gulf of Siam and the Malay coast
      [103, -11, 136, 2],                                   // Java, Borneo, Celebes and the Spice Islands
      [94, 0, 104, 8],                                      // the Strait of Malacca
    ],
    offers: [
      { id: 'bengal', port: 'malacca', name: 'A Gujarati pilot\'s rutter of the western seas',
        blurb: 'A Muslim pilot from Surat will copy his rutter: the monsoon crossing to Ceylon, Coromandel, Malabar and on to Surat.',
        price: 80_000, boxes: [[60, 0, 100, 26]] },
      { id: 'caperoute', port: 'batavia', name: 'A Company chart of the Cape route',
        blurb: 'A Dutch mate deep in debt sells a copy of the Company\'s chart: the roaring forties, the Cape and the long way to Holland.',
        price: 250_000, boxes: [[18, -44, 108, -28], [10, -38, 33, -15], [-20, -6, 12, 30], [-12, 34, 42, 66], [8, 53, 32, 66], [-40, -40, 22, 50]] },
      ...SAIL_OFFERS,
    ],
    names: [
      [-128, 4, 'The Great Eastern Ocean', 18], [-120, -30, 'Beyond all charts', 17], [-140, 40, 'Here be dragons', 15],
      [80, -20, 'The Western Ocean', 18], [140, -58, 'The Southern Waste', 16], [-32, 17, 'The Sea of the Franks', 15],
    ],
  },
};

/** The rules and data of a game: its era, and in the Age of Sail its house. */
export function eraConfig(era: EraId, house?: House): EraConfig {
  return era === 'sail' && house === 'chinese' ? CHINESE_HOUSE : ERAS[era];
}
