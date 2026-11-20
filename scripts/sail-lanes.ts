// Builds src/data/sail/sealanes.json: the modern sea-lane waypoints without the
// canals (no Suez or Panama in 1650), with each historical port linked to its
// nearest waypoints by legs that stay at sea (checked against the coastline).
// Usage: npx tsx scripts/sail-lanes.ts
import { geoContains, geoDistance, geoInterpolate } from 'd3-geo';
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';

const root = new URL('..', import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(root + p, 'utf8'));
const modernLanes = read('src/data/sealanes.json');
const modernPorts: { id: string; lat: number; lon: number }[] = read('src/data/ports.json');
const sailPorts: { id: string; name: string; lat: number; lon: number }[] = read('src/data/sail/ports.json');
const topo = read('node_modules/world-atlas/land-110m.json') as Topology;
const land = feature(topo, topo.objects.land as never) as never;

type Pt = { id: string; lat: number; lon: number };
const nodes: Pt[] = [];
// Waypoints, plus the modern ports as coastal waypoints (renamed so they don't clash).
for (const n of modernLanes.nodes as Pt[]) nodes.push(n);
for (const p of modernPorts) nodes.push({ id: `wp_${p.id}`, lat: p.lat, lon: p.lon });
const rename = (id: string) => (modernPorts.some((p) => p.id === id) ? `wp_${id}` : id);
const edges: [string, string][] = [];
for (const raw of modernLanes.edges) {
  const e = Array.isArray(raw) ? { a: raw[0], b: raw[1] } : raw;
  if (e.canal) continue;
  edges.push([rename(e.a), rename(e.b)]);
}

const NM = 3440.065;
const dist = (a: Pt, b: Pt) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * NM;
const onLand = (lon: number, lat: number) => geoContains(land, [lon, lat]);

/** From a port (perhaps up a river or behind a coast) to a waypoint at sea: once at sea, no more land. */
function seaLeg(from: Pt, to: Pt): boolean {
  const f = geoInterpolate([from.lon, from.lat], [to.lon, to.lat]);
  const steps = Math.max(10, Math.ceil(dist(from, to) / 15));
  let atSea = false;
  for (let i = 1; i < steps; i++) {
    const [lon, lat] = f(i / steps);
    const wet = !onLand(lon, lat);
    if (wet) atSea = true;
    // A port up a river may start on land, for a short way only (80 nm).
    else if (atSea || (dist(from, to) * i) / steps > 80) return false;
  }
  return true;
}

// Seas the modern lanes don't need but 1650 did: the Baltic and the Adriatic.
const CHAINS: Pt[][] = [
  [{ id: 'skagerrak', lat: 57.9, lon: 9.0 }, { id: 'kattegat', lat: 57.0, lon: 11.4 }, { id: 'oresund', lat: 55.6, lon: 12.75 },
    { id: 'baltic_s', lat: 55.2, lon: 15.5 }, { id: 'gdansk_bay', lat: 54.75, lon: 18.9 }],
  [{ id: 'otranto', lat: 39.9, lon: 18.8 }, { id: 'adriatic_s', lat: 42.3, lon: 16.6 }, { id: 'adriatic_n', lat: 44.6, lon: 13.2 }],
];
for (const chain of CHAINS) {
  chain.forEach((n, i) => { nodes.push(n); if (i) edges.push([chain[i - 1].id, n.id]); });
  // Join the chain's mouth to the nearest existing waypoint it can reach by sea.
  const head = chain[0];
  const join = nodes.filter((n) => !chain.includes(n) && !n.id.startsWith('wp_'))
    .map((n) => ({ n, d: dist(head, n) })).sort((a, b) => a.d - b.d).find(({ n }) => seaLeg(head, n));
  if (join) { edges.push([head.id, join.n.id]); console.log(`chain ${head.id} joins ${join.n.id} (${Math.round(join.d)} nm)`); }
  else { console.error('chain not joined', head.id); process.exitCode = 1; }
}

const out: { from: string; to: string; nm: number }[] = [];
for (const p of sailPorts) {
  const near = nodes.map((n) => ({ n, d: dist(p, n) })).filter((x) => x.d < 1800).sort((a, b) => a.d - b.d);
  const links = [];
  for (const { n, d } of near) {
    if (links.length >= 2) break;
    if (seaLeg(p, n)) links.push({ n, d });
  }
  if (!links.length) { console.error('NO LINK for', p.id); process.exitCode = 1; continue; }
  for (const l of links) { edges.push([p.id, l.n.id]); out.push({ from: p.id, to: l.n.id, nm: Math.round(l.d) }); }
}
writeFileSync(root + 'src/data/sail/sealanes.json', JSON.stringify({ canals: {}, nodes, edges }, null, 0).replace(/\],\[/g, '],\n['));
for (const o of out) console.log(`${o.from.padEnd(14)} -> ${o.to.padEnd(16)} ${o.nm} nm`);
console.log(`${nodes.length} waypoints, ${edges.length} lanes`);
