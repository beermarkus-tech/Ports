// Headless balance check: run the greedy bot over many seeds and print how
// the economy behaves. Usage: npm run balance [-- legs seeds]

import { BOT_OPTIONS, botStep, casualStep, evaluateOptions } from '../src/sim/bot';
import { RULES, newGame } from '../src/sim/game';
import { getWorld, setEra } from '../src/sim/world';

// ERA=sail runs the Age of Sail world.
if (process.env.ERA === 'sail') setEra('sail');

const legs = Number(process.argv[2] ?? 10);
const seeds = Number(process.argv[3] ?? 50);
const policy = process.argv[4] === 'casual' ? 'casual' : 'greedy';
const step = policy === 'casual' ? casualStep : botStep;
const world = getWorld();
BOT_OPTIONS.upgrade = process.env.NO_UPGRADE !== '1';

const finalCash: number[] = [];
const perDay: number[] = [];
const routes = new Map<string, number>();
let bankrupt = 0;
let closeCalls = 0; // legs where 2nd-best option was within 15% of best
let options = 0;
const eventCounts: Record<string, number> = {};
let lateDeliveries = 0;
let deliveries = 0;

for (let s = 1; s <= seeds; s++) {
  let g = newGame(s * 7919);
  for (let i = 0; i < legs && !g.gameOver; i++) {
    const opts = evaluateOptions(g, g.fleet[0].id);
    if (opts.length > 1 && opts[0].score > 0 && opts[1].score > opts[0].score * 0.85) closeCalls++;
    options++;
    const from = g.fleet[0].location;
    g = step(g);
    const r = g.reports[g.reports.length - 1];
    if (!r) continue;
    const key = `${world.ports[from].name} → ${world.ports[r.to].name}`;
    routes.set(key, (routes.get(key) ?? 0) + 1);
    for (const e of r.events) eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;
    for (const d of r.deliveries) {
      deliveries++;
      if (d.lateDays > 0) lateDeliveries++;
    }
  }
  if (g.gameOver) bankrupt++;
  finalCash.push(g.cash);
  perDay.push((g.cash - RULES.startCash) / Math.max(1, g.day));
}

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const pct = (a: number[], p: number) => sorted(a)[Math.floor((a.length - 1) * p)];
const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

console.log(`${policy} bot, ${legs} legs × ${seeds} seeds`);
console.log(`Final cash  p10 ${fmt(pct(finalCash, 0.1))}  median ${fmt(pct(finalCash, 0.5))}  p90 ${fmt(pct(finalCash, 0.9))}`);
console.log(`Profit/day  p10 ${fmt(pct(perDay, 0.1))}  median ${fmt(pct(perDay, 0.5))}  p90 ${fmt(pct(perDay, 0.9))}`);
console.log(`Bankrupt: ${bankrupt}/${seeds}   Close calls (2nd best within 15%): ${((closeCalls / options) * 100).toFixed(0)}%`);
console.log(`Late deliveries: ${lateDeliveries}/${deliveries}   Events:`, eventCounts);
console.log(`Distinct routes used: ${routes.size}. Top 10:`);
for (const [k, v] of [...routes].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(v).padStart(4)}  ${k}`);
