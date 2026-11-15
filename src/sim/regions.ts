// Trading regions: what a captain is given to work in (one region, or a lane
// between two). Every port belongs to exactly one region.

export interface Region {
  id: string;
  name: string;
  ports: string[];
}

export const REGIONS: Region[] = [
  { id: 'europe', name: 'Europe & Mediterranean', ports: ['rotterdam', 'genoa', 'istanbul', 'alexandria'] },
  { id: 'naeast', name: 'North America East', ports: ['newyork', 'houston'] },
  { id: 'nawest', name: 'North America West', ports: ['losangeles', 'vancouver'] },
  { id: 'samerica', name: 'South America', ports: ['santos', 'buenosaires', 'valparaiso'] },
  { id: 'africa', name: 'Africa', ports: ['lagos', 'capetown', 'mombasa'] },
  { id: 'mideast', name: 'Middle East & India', ports: ['dubai', 'mumbai', 'colombo'] },
  { id: 'seasia', name: 'Southeast Asia', ports: ['singapore', 'jakarta', 'bangkok'] },
  { id: 'eastasia', name: 'East Asia', ports: ['shanghai', 'busan', 'yokohama'] },
  { id: 'oceania', name: 'Australia & New Zealand', ports: ['sydney', 'auckland', 'porthedland'] },
];

const BY_ID = new Map(REGIONS.map((r) => [r.id, r]));
const OF_PORT = new Map(REGIONS.flatMap((r) => r.ports.map((p) => [p, r.id] as const)));

export function region(id: string): Region {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`Unknown region ${id}`);
  return r;
}

export function regionOf(portId: string): string | undefined {
  return OF_PORT.get(portId);
}

/** All ports of a region or a lane. */
export function areaPorts(regions: string[]): string[] {
  return regions.flatMap((id) => region(id).ports);
}

export function areaName(regions: string[]): string {
  return regions.map((id) => region(id).name).join(' ⇄ ');
}
