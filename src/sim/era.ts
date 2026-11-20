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
    hasOil: false, harbourServices: false, portView: false, wind: true,
    referenceSpeedKn: 4, payFactor: 2, smallLot: 80,
    harvestGoods: ['pepper', 'nutmeg', 'sugar', 'grain', 'tea', 'silk', 'rice', 'coffee'],
    terms: {
      fuel: 'Victuals', fuelUnit: 'casks', bunker: 'Victuals', drydock: 'Careening',
      strike: (port, days) => `Plague in ${port}: the port is under quarantine. Calls take ${days} extra days and fees are doubled.`,
    },
  },
};
