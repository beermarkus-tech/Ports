// Phase 2 balance check: how fast do bots climb the ship ladder?
// Usage: npx tsx scripts/progression.ts [legs] [seeds] [greedy|casual]

import { botStep, casualStep } from '../src/sim/bot';
import { newGame } from '../src/sim/game';
import { netWorth } from '../src/sim/ships';
import { getWorld } from '../src/sim/world';

const legs = Number(process.argv[2] ?? 60);
const seeds = Number(process.argv[3] ?? 60);
const policy = process.argv[4] === 'casual' ? 'casual' : 'greedy';
const step = policy === 'casual' ? casualStep : botStep;
const world = getWorld();

const checkpoints = [10, 20, 40, legs].filter((x, i, a) => x <= legs && a.indexOf(x) === i);
const worthAt: Record<number, number[]> = Object.fromEntries(checkpoints.map((c) => [c, []]));
const firstUpgradeLeg: number[] = [];
const firstUpgradeDay: number[] = [];
const finalTypes: Record<string, number> = {};
const firstTypes: Record<string, number> = {};
let bankrupt = 0;
let neverUpgraded = 0;

for (let s = 1; s <= seeds; s++) {
  let g = newGame(s * 104729);
  let upgraded = false;
  for (let i = 1; i <= legs && !g.gameOver; i++) {
    const before = g.stats.shipsOwned;
    g = step(g);
    if (!upgraded && g.stats.shipsOwned > before) {
      upgraded = true;
      firstUpgradeLeg.push(i);
      firstUpgradeDay.push(g.day);
      firstTypes[g.fleet[0].typeId] = (firstTypes[g.fleet[0].typeId] ?? 0) + 1;
    }
    if (worthAt[i]) worthAt[i].push(netWorth(g, world));
  }
  if (g.gameOver) bankrupt++;
  if (!upgraded) neverUpgraded++;
  finalTypes[g.fleet[0].typeId] = (finalTypes[g.fleet[0].typeId] ?? 0) + 1;
}

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const pct = (a: number[], p: number) => (a.length ? sorted(a)[Math.floor((a.length - 1) * p)] : NaN);
const m = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}k`);

console.log(`${policy} bot, ${legs} legs × ${seeds} seeds. Bankrupt: ${bankrupt}. Never upgraded: ${neverUpgraded}.`);
for (const c of checkpoints) {
  const a = worthAt[c];
  console.log(`  net worth after ${String(c).padStart(3)} legs: p10 ${m(pct(a, 0.1))}  median ${m(pct(a, 0.5))}  p90 ${m(pct(a, 0.9))}  (n=${a.length})`);
}
console.log(`  first upgrade: leg p25 ${pct(firstUpgradeLeg, 0.25)} / median ${pct(firstUpgradeLeg, 0.5)} / p75 ${pct(firstUpgradeLeg, 0.75)}; ` +
  `day median ${Math.round(pct(firstUpgradeDay, 0.5))}`);
console.log('  first ship bought:', firstTypes);
console.log('  ship at the end:  ', finalTypes);
