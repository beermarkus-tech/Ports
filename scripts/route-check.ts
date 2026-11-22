// Finds odd sea routes in the 1650 world: legs that double back (a turn sharper than 150°), and
// routes much longer than the straight line between the ports. Usage: npx tsx scripts/route-check.ts
import { worldFor } from '../src/sim/world';

const w = worldFor('sail');
const DEG = Math.PI / 180;
const bearing = (a: string, b: string) => {
  const p = w.points[a], q = w.points[b];
  const dLon = (((q.lon - p.lon + 540) % 360) - 180) * Math.cos(((p.lat + q.lat) / 2) * DEG);
  return Math.atan2(q.lat - p.lat, dLon);
};
const hairpins = new Map<string, string[]>();
let routes = 0, bent = 0;
for (const a of w.portList) for (const b of w.portList) {
  if (a.id >= b.id) continue;
  const r = w.route(a.id, b.id);
  if (!r) continue;
  routes++;
  let has = false;
  for (let i = 1; i < r.path.length - 1; i++) {
    let turn = Math.abs(bearing(r.path[i], r.path[i + 1]) - bearing(r.path[i - 1], r.path[i]));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 150 * DEG) {
      has = true;
      const k = `${r.path[i - 1]} > ${r.path[i]} > ${r.path[i + 1]}`;
      (hairpins.get(k) ?? hairpins.set(k, []).get(k)!).push(`${a.name}–${b.name}`);
    }
  }
  if (has) bent++;
}
console.log(`${routes} routes, ${bent} with a hairpin turn, ${hairpins.size} distinct hairpins:`);
for (const [k, v] of [...hairpins].sort((x, y) => y[1].length - x[1].length)) console.log(`  ${k}  (${v.length} routes, e.g. ${v.slice(0, 3).join(', ')})`);
