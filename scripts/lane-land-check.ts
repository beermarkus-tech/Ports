// Lists sea lanes that run over land on the detailed coastline (beyond a short start inland, for
// river ports). Usage: npx tsx scripts/lane-land-check.ts
import { geoContains, geoDistance, geoInterpolate } from 'd3-geo';
import { readFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const topo = read('node_modules/world-atlas/land-50m.json') as Topology;
const land = feature(topo, topo.objects.land as never) as never;
const lanes = read('src/data/sail/sealanes.json');
const ports: { id: string; lat: number; lon: number }[] = read('src/data/sail/ports.json');
const pts: Record<string, [number, number]> = {};
for (const n of lanes.nodes) pts[n.id] = [n.lon, n.lat];
for (const p of ports) pts[p.id] = [p.lon, p.lat];
const isPort = new Set(ports.map((p) => p.id));
const RIVER: Record<string, number> = { canton: 80, ayutthaya: 60, london: 50, amsterdam: 45, jamestown: 45, danzig: 30, surat: 30, venice: 25 };
let bad = 0;
for (const raw of lanes.edges) {
  const [a, b] = Array.isArray(raw) ? raw : [raw.a, raw.b];
  const nm = geoDistance(pts[a], pts[b]) * 3440;
  const f = geoInterpolate(pts[a], pts[b]);
  const steps = Math.max(20, Math.ceil(nm / 4));
  // Land allowed at each end: a river port's river, or 12 nm for a dot on the shore.
  const allowA = isPort.has(a) ? RIVER[a] ?? 12 : 0, allowB = isPort.has(b) ? RIVER[b] ?? 12 : 0;
  let over = 0;
  for (let i = 1; i < steps; i++) {
    const d = (nm * i) / steps;
    if (d < allowA || nm - d < allowB) continue;
    if (geoContains(land, f(i / steps) as [number, number])) over += nm / steps;
  }
  if (over > 6) { bad++; console.log(`${a.padEnd(14)} - ${b.padEnd(14)} ${Math.round(over)} nm over land (of ${Math.round(nm)})`); }
}
console.log(bad ? `${bad} lanes over land` : 'no lane runs over land');
