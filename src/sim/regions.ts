// Trading regions: what a captain is given to work in (one region, or a lane
// between two). Every port belongs to exactly one region. They come with the
// era's world (src/data/regions.json, src/data/sail/regions.json).

import { getWorld } from './world';

export interface Region {
  id: string;
  name: string;
  ports: string[];
}

/** The current world's regions. */
export function regions(): Region[] {
  return getWorld().regions;
}

export function region(id: string): Region {
  const r = regions().find((x) => x.id === id);
  if (!r) throw new Error(`Unknown region ${id}`);
  return r;
}

export function regionOf(portId: string): string | undefined {
  return regions().find((r) => r.ports.includes(portId))?.id;
}

/** All ports of a region or a lane. */
export function areaPorts(ids: string[]): string[] {
  return ids.flatMap((id) => region(id).ports);
}

export function areaName(ids: string[]): string {
  return ids.map((id) => region(id).name).join(' ⇄ ');
}
