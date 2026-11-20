import type { Box, ChartOffer } from './charts';

// The two eras the game can be set in, and what differs between them that isn't
// plain data (ports, goods, ships, sea lanes, regions live in src/data/...).

export type EraId = 'modern' | 'sail';

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
  /** Fog of war: the waters known at the start, and charts for sale (none: no fog). */
  charts?: { known: Box[]; offers: ChartOffer[] };
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
