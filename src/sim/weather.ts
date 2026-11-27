// The weather in a port (Age of Sail harbour views and their sound): worked out from where the port
// lies and the month, so it is true to the climate. Monsoon rains in South and South-East Asia,
// typhoons off China in late summer, cyclones in the southern Indian Ocean early in the year,
// hurricanes in the Caribbean in autumn, grey wet winters with fog and some snow in northern
// Europe, dry summers in the Mediterranean, almost no rain on the Red Sea and the Gulf.
// Deterministic: the same port on the same day always has the same weather, and it holds for a
// few days at a time.

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm' | 'snow';

export interface Weather {
  kind: WeatherKind;
  /** Wind strength, 0 (calm) to 1 (a storm). */
  wind: number;
  /** What a storm is called there (typhoon, cyclone, hurricane, gale). */
  storm: string;
}

interface Climate {
  /** Chance of rain, fog and snow on a day in each month (0 = January). */
  rain: number[];
  fog: number[];
  snow: number[];
  /** Chance of a storm on a day in each month, and its name. */
  storm: number[];
  stormName: string;
}

const months = (f: (m: number) => number) => Array.from({ length: 12 }, (_, m) => f(m));
const inMonths = (list: number[], hit: number, miss = 0) => months((m) => (list.includes(m) ? hit : miss));

/** The climate at a place, from its latitude and longitude. */
export function climateAt(lat: number, lon: number): Climate {
  const north = lat >= 0;
  const abs = Math.abs(lat);
  const c: Climate = { rain: months(() => 0.2), fog: months(() => 0.03), snow: months(() => 0), storm: months(() => 0), stormName: 'gale' };
  const monsoonAsia = lon >= 60 && lon <= 135 && lat >= -12 && lat <= 36;
  const arabia = lon >= 32 && lon < 62 && lat >= 10 && lat <= 32;
  const med = lon >= -10 && lon <= 40 && lat >= 30 && lat < 46;
  const caribbean = lon >= -100 && lon <= -55 && lat >= 8 && lat <= 32;
  if (arabia) {
    c.rain = months(() => 0.02); c.fog = months(() => 0.01);
  } else if (monsoonAsia) {
    // Wet with the south-west monsoon in the north (June to September), the north-west monsoon
    // in the south (December to March); drier the rest of the year.
    c.rain = north ? inMonths([5, 6, 7, 8], 0.5, lat > 20 ? 0.16 : 0.12) : inMonths([11, 0, 1, 2], 0.45, 0.12);
    if (lat > 22) c.rain = c.rain.map((r, m) => ([3, 4].includes(m) ? Math.max(r, 0.3) : r));   // the plum rains
    c.fog = months((m) => (lat > 22 && [1, 2, 3].includes(m) ? 0.08 : 0.02));
    // Typhoons off China, Formosa, Japan and Luzon; cyclones in the Bay of Bengal.
    if (lon >= 105 && lat >= 10) { c.storm = inMonths([6, 7, 8, 9], 0.03, 0); c.stormName = 'typhoon'; }
    else if (lon >= 78 && lon < 100 && lat >= 8) { c.storm = inMonths([4, 9, 10], 0.015, 0); c.stormName = 'cyclone'; }
    if (lat > 30) c.snow = inMonths([0, 1], 0.03);
  } else if (!north && lat > -32 && lon >= 30 && lon <= 100) {
    // The southern Indian Ocean: rain and cyclones in the hot months.
    c.rain = inMonths([11, 0, 1, 2, 3], 0.35, 0.15);
    c.storm = inMonths([0, 1, 2], 0.03, 0); c.stormName = 'cyclone';
  } else if (caribbean) {
    c.rain = inMonths([5, 6, 7, 8, 9, 10], 0.35, 0.12);
    c.storm = inMonths([7, 8, 9], 0.025, 0); c.stormName = 'hurricane';
  } else if (med) {
    c.rain = inMonths([10, 11, 0, 1, 2], 0.25, 0.04);
  } else if (abs < 15) {
    // Elsewhere in the tropics: a wet season with the sun overhead.
    const wet = north ? [5, 6, 7, 8, 9] : [11, 0, 1, 2, 3];
    c.rain = inMonths(wet, 0.42, 0.14);
  } else if (abs >= 45) {
    // Northern Europe (and the far north): rain all year, fog and snow in winter, autumn gales.
    const winter = north ? [11, 0, 1] : [5, 6, 7];
    const autumn = north ? [9, 10, 11, 0, 1] : [3, 4, 5, 6, 7];
    c.rain = months((m) => (winter.includes(m) ? 0.32 : 0.28));
    c.fog = months((m) => (winter.includes(m) || (north ? [10, 2] : [4, 8]).includes(m) ? 0.12 : 0.04));
    c.snow = months((m) => (winter.includes(m) ? (abs > 52 ? 0.16 : 0.1) : (north ? [2] : [8]).includes(m) ? 0.04 : 0));
    c.storm = inMonths(autumn, 0.02, 0.004); c.stormName = 'gale';
  } else {
    // The temperate rest: a wetter winter half, fog on cool coasts.
    const winter = north ? [10, 11, 0, 1, 2, 3] : [4, 5, 6, 7, 8, 9];
    c.rain = months((m) => (winter.includes(m) ? 0.28 : 0.14));
    c.fog = months((m) => (winter.includes(m) ? 0.06 : 0.03));
    if (abs > 35) c.snow = inMonths(north ? [0, 1] : [6, 7], 0.04);
    c.storm = inMonths(winter, 0.006, 0); c.stormName = 'gale';
  }
  return c;
}

/** A number in [0, 1) from a port and a day: the same every time. */
function hash(id: string, n: number, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ n, 2654435761);
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Days a spell of weather holds (it changes every few days, at a different rhythm in each port). */
const SPELL = 3;

/**
 * The weather in a port on a game day. `month` is 0–11. Storms can be left out (`storms: false`)
 * where the game rolls its own (your settlement's storms come with their news).
 */
export function weatherAt(port: { id: string; lat: number; lon: number }, day: number, month: number, storms = true): Weather {
  const c = climateAt(port.lat, port.lon);
  const offset = Math.floor(hash(port.id, 0, 7) * SPELL);
  const spell = Math.floor((day + offset) / SPELL);
  const name = c.stormName;
  // A storm lasts a day or two: rolled by the day, not the spell.
  if (storms && hash(port.id, Math.floor(day / 2), 11) < c.storm[month] * 2) return { kind: 'storm', wind: 0.9 + hash(port.id, day, 13) * 0.1, storm: name };
  const r = hash(port.id, spell, 17);
  const windBase = 0.15 + hash(port.id, spell, 19) * 0.35;
  const cold = c.snow[month] > 0;
  if (cold && r < c.snow[month]) return { kind: 'snow', wind: windBase, storm: name };
  let edge = c.snow[month];
  if (r < (edge += c.rain[month])) return { kind: 'rain', wind: Math.min(0.75, windBase + 0.2), storm: name };
  if (r < (edge += c.fog[month])) return { kind: 'fog', wind: 0.05, storm: name };
  if (r < edge + 0.22) return { kind: 'cloudy', wind: windBase, storm: name };
  return { kind: 'clear', wind: windBase * 0.8, storm: name };
}

/** A few words for the weather (for the harbour view's chips). */
export function weatherWords(w: Weather): string {
  const wind = w.wind > 0.6 ? 'strong wind' : w.wind > 0.35 ? 'fresh breeze' : w.wind > 0.15 ? 'light breeze' : 'calm';
  switch (w.kind) {
    case 'storm': return w.storm === 'gale' ? 'A gale' : `A ${w.storm}`;
    case 'rain': return `Rain · ${wind}`;
    case 'fog': return 'Fog · calm';
    case 'snow': return `Snow · ${wind}`;
    case 'cloudy': return `Overcast · ${wind}`;
    default: return `Fair · ${wind}`;
  }
}
