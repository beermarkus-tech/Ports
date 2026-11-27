// Prevailing winds for the Age of Sail: trade winds, westerlies (the roaring
// forties in the south), the doldrums, and the monsoon of the Indian Ocean and the
// South China Sea, which turns with the seasons. A sailing ship's speed on a leg
// depends on the angle between its course and the wind.

import type { World } from './world';

export interface Wind {
  /** Direction the wind blows towards, radians (0 = east, π/2 = north). */
  toward: number;
  /** 0 (calm or fickle) .. 1 (steady and strong). */
  strength: number;
}

const DEG = Math.PI / 180;

/** The prevailing wind at a place in a month (0 = January). */
export function windAt(lon: number, lat: number, month: number): Wind {
  // The monsoon: south-west from June to September, north-east from November to March.
  if (lat > -5 && lat < 26 && lon > 40 && lon < 125) {
    if (month >= 5 && month <= 8) return { toward: 45 * DEG, strength: 1 };
    if (month >= 10 || month <= 2) return { toward: 225 * DEG, strength: 0.9 };
    return { toward: 90 * DEG, strength: 0.25 };
  }
  const a = Math.abs(lat);
  if (a < 5) return { toward: 270 * DEG, strength: 0.15 };            // doldrums: calms and squalls
  if (a < 30) return lat > 0
    ? { toward: 225 * DEG, strength: 0.85 }                            // north-east trades
    : { toward: 135 * DEG, strength: 0.85 };                           // south-east trades
  if (a < 36) return { toward: 0, strength: 0.3 };                     // horse latitudes
  if (lat < -37 && lat > -56) return { toward: 0, strength: 1 };       // roaring forties
  return { toward: 0, strength: 0.75 };                                // westerlies
}

/**
 * Speed factor on a course (radians) in a wind: 1 running before it, 0.4 beating against it, slow
 * in calms. A junk's battened sails point higher: against the wind she loses only half as much.
 */
export function windFactor(course: number, w: Wind, rig?: 'junk'): number {
  const cos = Math.cos(course - w.toward);
  const into = rig === 'junk' && cos < 0 ? 0.5 : 1;
  const f = 0.6 + w.strength * (0.1 + 0.3 * cos * into);
  return w.strength < 0.2 ? f * 0.75 : f;
}

/** The month (0..11) of a game day in this world's calendar. */
export function monthOf(world: World, day: number): number {
  return new Date(Date.UTC(world.era.startYear, 0, 1) + Math.floor(day) * 86_400_000).getUTCMonth();
}

/**
 * The average speed factor along a route at the time of sailing (time-weighted),
 * or 1 where ships don't depend on the wind.
 */
export function routeWind(world: World, path: string[], day: number, rig?: 'junk'): number {
  if (!world.era.wind || path.length < 2) return 1;
  const month = monthOf(world, day);
  let nm = 0, hours = 0;
  for (let i = 1; i < path.length; i++) {
    const a = world.points[path[i - 1]], b = world.points[path[i]];
    if (!a || !b) continue;
    const dLon = ((b.lon - a.lon + 540) % 360) - 180;
    const midLat = (a.lat + b.lat) / 2;
    const dx = dLon * Math.cos(midLat * DEG), dy = b.lat - a.lat;
    const len = Math.hypot(dx, dy) * 60;   // nautical miles, near enough for weighting
    if (len < 1e-6) continue;
    const course = Math.atan2(dy, dx);
    const w = windAt(a.lon + dLon / 2, midLat, month);
    nm += len;
    hours += len / windFactor(course, w, rig);
  }
  return hours > 0 ? nm / hours : 1;
}
