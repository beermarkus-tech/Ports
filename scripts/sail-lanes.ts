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
// Port links are checked on the coarse coastline (the detailed one has islets off every harbour);
// the hand-placed lanes of the China seas on the detailed one (straits and islands matter there).
const topo = read('node_modules/world-atlas/land-110m.json') as Topology;
const land = feature(topo, topo.objects.land as never) as never;
const topoFine = read('node_modules/world-atlas/land-50m.json') as Topology;
const landFine = feature(topoFine, topoFine.objects.land as never) as never;

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

/** How far a port's first leg may run over land (rivers, and islands the coarse coast doesn't show). */
const RIVER_NM: Record<string, number> = {};
let riverNm = 80;

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
    else if (atSea || (dist(from, to) * i) / steps > riverNm) return false;
  }
  return true;
}

// Seas the modern lanes don't need but 1650 did: the Baltic and the Adriatic.
const CHAINS: Pt[][] = [
  [{ id: 'skagerrak', lat: 57.9, lon: 9.0 }, { id: 'kattegat', lat: 57.0, lon: 11.4 }, { id: 'oresund', lat: 55.6, lon: 12.75 },
    { id: 'baltic_s', lat: 55.2, lon: 15.5 }, { id: 'gdansk_bay', lat: 54.75, lon: 18.9 }],
  [{ id: 'ionian_w', lat: 37.6, lon: 19.6 }, { id: 'otranto', lat: 39.9, lon: 18.8 }, { id: 'adriatic_s', lat: 42.3, lon: 16.6 }, { id: 'adriatic_n', lat: 44.6, lon: 13.2 }],
];
for (const chain of CHAINS) {
  chain.forEach((n, i) => { nodes.push(n); if (i) edges.push([chain[i - 1].id, n.id]); });
  // Join the chain's mouth to the nearest existing waypoint it can reach by sea.
  // Join the chain's mouth to the two nearest waypoints it can reach by sea (so ships needn't sail past and back).
  const head = chain[0];
  const joins = nodes.filter((n) => !chain.includes(n) && !n.id.startsWith('wp_'))
    .map((n) => ({ n, d: dist(head, n) })).sort((a, b) => a.d - b.d).filter(({ n }) => seaLeg(head, n)).slice(0, 2);
  for (const j of joins) { edges.push([head.id, j.n.id]); console.log(`chain ${head.id} joins ${j.n.id} (${Math.round(j.d)} nm)`); }
  if (!joins.length) { console.error('chain not joined', head.id); process.exitCode = 1; }
}

/** Open water all the way between two points at sea (for waypoint-to-waypoint lanes). */
function openWater(a: Pt, b: Pt): boolean {
  const f = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const steps = Math.max(10, Math.ceil(dist(a, b) / 8));
  for (let i = 1; i < steps; i++) if (geoContains(landFine, f(i / steps) as [number, number])) return false;
  return true;
}

// The China seas, by hand: the modern lanes hang every port there off one point south of Hong
// Kong, and the coarse coast let lanes cut across Taiwan and Luzon. These are the waters the
// junks and the Dutch actually used: along the coast, through the Taiwan Strait by the
// Pescadores, the Luzon Strait, and across to the Goto islands for Nagasaki.
const CHINA: Pt[] = [
  { id: 'pearl_mouth', lat: 21.85, lon: 113.9 },   // the mouth of the Pearl River, for Canton and Macau
  { id: 'shantou_off', lat: 22.9, lon: 116.9 },     // off the Guangdong coast
  { id: 'amoy_off', lat: 24.25, lon: 118.45 },      // the roads off Amoy
  { id: 'pescadores', lat: 23.45, lon: 119.75 },    // Penghu, in the Taiwan Strait
  { id: 'luzon_str', lat: 20.6, lon: 120.9 },       // the Bashi channel
  { id: 'luzon_w', lat: 17.9, lon: 119.2 },         // off north-west Luzon
  { id: 'manila_off', lat: 14.25, lon: 119.95 },    // off the mouth of Manila Bay
  { id: 'manila_bay', lat: 14.33, lon: 120.65 },    // inside the bay, past Corregidor
  { id: 'varella', lat: 12.9, lon: 110.0 },         // off Cape Varella
  { id: 'hainan_e', lat: 18.6, lon: 111.4 },        // east of Hainan
  { id: 'hoian_off', lat: 15.9, lon: 108.75 },      // off Hoi An
  { id: 'goto', lat: 32.5, lon: 128.65 },           // the Goto islands, landfall for Nagasaki
  // Coasts elsewhere where straight lanes cut across land: offshore points that follow the coast.
  { id: 'konkan', lat: 17.2, lon: 72.85 },          // off the Konkan coast, between Bombay and Goa
  { id: 'goa_off', lat: 15.4, lon: 73.45 },
  { id: 'calicut_off', lat: 11.2, lon: 75.45 },
  { id: 'madras_off', lat: 13.0, lon: 80.6 },
  { id: 'ceylon_ne', lat: 8.8, lon: 81.9 },         // off Trincomalee
  { id: 'ceylon_se', lat: 6.2, lon: 82.0 },
  { id: 'muar_off', lat: 1.6, lon: 102.55 },        // south of Malacca, towards Singapore
  { id: 'delgado', lat: -10.6, lon: 41.0 },         // off Cape Delgado
  { id: 'comoros', lat: -11.8, lon: 45.0 },         // between the Comoros and Madagascar's tip
  { id: 'malta', lat: 35.4, lon: 14.6 },            // south of Sicily, past Malta
  { id: 'algoa', lat: -34.6, lon: 26.5 },           // the Cape coast, Natal and the Mozambique Channel
  { id: 'natal', lat: -30.6, lon: 32.0 },
  { id: 'channel_s', lat: -25.5, lon: 37.5 },
  { id: 'channel_n', lat: -16.5, lon: 41.6 },
  { id: 'sergipe', lat: -11.2, lon: -36.6 },        // the Brazilian coast between Bahia and Recife
  { id: 'alagoas', lat: -9.8, lon: -34.9 },
  { id: 'manzanillo', lat: 18.4, lon: -104.9 },     // the Pacific coast of New Spain
];
const CHINA_EDGES: [string, string][] = [
  ['pearl_mouth', 'shantou_off'], ['shantou_off', 'amoy_off'], ['amoy_off', 'pescadores'], ['amoy_off', 'taiwan'],
  ['pescadores', 'taiwan'], ['pescadores', 'luzon_str'], ['shantou_off', 'luzon_str'], ['pescadores', 'shantou_off'],
  ['luzon_str', 'luzon_e'], ['luzon_str', 'luzon_w'], ['luzon_w', 'manila_off'], ['manila_off', 'scs_s'],
  ['pearl_mouth', 'scs_n'], ['shantou_off', 'scs_n'], ['scs_n', 'luzon_w'], ['pearl_mouth', 'hainan_e'],
  ['hainan_e', 'hoian_off'], ['hoian_off', 'varella'], ['varella', 'scs_s'], ['manila_bay', 'manila_off'], ['hainan_e', 'scs_n'], ['manila_off', 'pearl_mouth'],
  ['manila_off', 'amoy_off'], ['goto', 'zhejiang'], ['goto', 'jeju_s'], ['goto', 'kyushu_s'],
  ['goto', 'taiwan'], ['ionian_w', 'malta'], ['malta', 'sicily'], ['mascarene', 'goa_off'],
  ['wp_mumbai', 'konkan'], ['konkan', 'goa_off'], ['goa_off', 'calicut_off'], ['calicut_off', 'kerala'],
  ['madras_off', 'ceylon_ne'], ['ceylon_ne', 'ceylon_se'], ['ceylon_se', 'dondra'], ['madras_off', 'aceh'], ['ceylon_ne', 'aceh'],
  ['malacca_s', 'muar_off'], ['muar_off', 'wp_singapore'],
  ['wp_mombasa', 'delgado'], ['delgado', 'channel_n'], ['delgado', 'comoros'],
  ['agulhas', 'algoa'], ['algoa', 'natal'], ['natal', 'channel_s'], ['channel_s', 'channel_n'], ['channel_n', 'comoros'],
  ['abrolhos', 'sergipe'], ['sergipe', 'alagoas'], ['alagoas', 'saoroque'],
  ['pac_e', 'manzanillo'], ['manzanillo', 'cabo'],
];
// Old lanes that cut across land or made every ship call at one point.
const DROP: [string, string][] = [['scs_n', 'hoian'], ['scs_n', 'taiwan'], ['hoian', 'taiwan'],
  ['wp_mumbai', 'kerala'], ['wp_mombasa', 'mascarene']];
for (const n of CHINA) nodes.push(n);
for (const [a, b] of DROP) {
  const i = edges.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
  if (i >= 0) edges.splice(i, 1);
}
for (const [a, b] of CHINA_EDGES) {
  const pa = nodes.find((n) => n.id === a)!, pb = nodes.find((n) => n.id === b)!;
  if (!openWater(pa, pb)) console.warn(`lane ${a} - ${b} touches land`);
  edges.push([a, b]);
}
/** Ports joined to the network by hand (where the nearest points mislead). */
const PORT_LINKS: Record<string, string[]> = {
  canton: ['pearl_mouth', 'macau'], macau: ['pearl_mouth'], amoy: ['amoy_off'], zeelandia: ['pescadores', 'luzon_str'],
  manila: ['manila_bay'], hoian: ['hoian_off'], dejima: ['goto'],
  // Coasts the coarse coastline smooths over: a way in from each direction along the coast.
  zanzibar: ['wp_mombasa', 'delgado'], madras: ['madras_off'], goa: ['goa_off'], calicut: ['calicut_off'],
  bahia: ['abrolhos', 'sergipe'], recife: ['alagoas', 'saoroque'], acapulco: ['pac_e', 'manzanillo'],
  malacca: ['malacca_s', 'muar_off'],
  // Settlement sites.
  tamsui: ['taiwan', 'zhejiang'], songkhla: ['gulfthai', 'wp_bangkok'], patani: ['gulfthai'], macassar: ['makassar', 'flores'], mozambique: ['channel_n', 'delgado'],
};

// Links that look like sea legs but cross an isthmus (no canal in 1650).
const NO_LINK: Record<string, string[]> = { portobelo: ['balboa', 'pac_e'], cartagena: ['balboa', 'pac_e'], acapulco: ['colon'] };

/**
 * Every other port joins the network in up to four directions (the nearest point first, then the
 * nearest in each new direction, 40° apart at least), and to neighbouring ports a short sail away:
 * with only the two nearest points, ships sailed out past the port and came back.
 */
const bearingOf = (a: Pt, b: Pt) => Math.atan2(b.lat - a.lat, (((b.lon - a.lon + 540) % 360) - 180) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180));
const out: { from: string; to: string; nm: number }[] = [];
const portPts: Pt[] = sailPorts.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon }));
const linked = new Set<string>();
const link = (a: string, b: string, nm: number) => {
  const k = [a, b].sort().join('>');
  if (linked.has(k)) return;
  linked.add(k);
  edges.push([a, b]);
  out.push({ from: a, to: b, nm: Math.round(nm) });
};
for (const p of portPts) {
  riverNm = RIVER_NM[p.id] ?? 80;
  if (PORT_LINKS[p.id]) {
    for (const id of PORT_LINKS[p.id]) {
      const n = [...nodes, ...portPts].find((x) => x.id === id)!;
      // (Canton lies up the Pearl River, among its islands: that one is checked by eye.)
      if (p.id !== 'canton' && !seaLeg(p, n)) console.warn(`hand link ${p.id} - ${id} crosses land`);
      link(p.id, id, dist(p, n));
    }
    continue;
  }
  const near = nodes.map((n) => ({ n, d: dist(p, n) })).filter((x) => x.d < 1800).sort((a, b) => a.d - b.d);
  const dirs: number[] = [];
  for (const { n, d } of near) {
    if (dirs.length >= 4) break;
    if (dirs.length && d > Math.max(900, near[0].d * 2.5)) break;
    if (NO_LINK[p.id]?.includes(n.id)) continue;
    const b = bearingOf(p, n);
    if (dirs.some((x) => Math.abs(((b - x + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < (40 * Math.PI) / 180)) continue;
    if (!seaLeg(p, n)) continue;
    dirs.push(b);
    link(p.id, n.id, d);
  }
  if (!dirs.length) { console.error('NO LINK for', p.id); process.exitCode = 1; }
  // Neighbouring ports a short sail apart: straight there.
  for (const q of portPts) {
    if (q.id === p.id || PORT_LINKS[q.id]) continue;
    const d = dist(p, q);
    if (d < 420 && seaLeg(p, q)) { riverNm = Math.max(RIVER_NM[p.id] ?? 80, RIVER_NM[q.id] ?? 80); if (seaLeg(q, p)) link(p.id, q.id, d); riverNm = RIVER_NM[p.id] ?? 80; }
  }
}
writeFileSync(root + 'src/data/sail/sealanes.json', JSON.stringify({ canals: {}, nodes, edges }, null, 0).replace(/\],\[/g, '],\n['));
if (process.argv.includes('-v')) for (const o of out) console.log(`${o.from.padEnd(14)} -> ${o.to.padEnd(16)} ${o.nm} nm`);
console.log(`${nodes.length} waypoints, ${edges.length} lanes`);
