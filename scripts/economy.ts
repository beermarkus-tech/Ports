// Phase 3 check: does the economy move? Route concentration, price levels,
// oil prices and world events over long bot games.
// Usage: npx tsx scripts/economy.ts [legs] [seeds]

import { botStep } from '../src/sim/bot';
import { newGame } from '../src/sim/game';
import type { WorldEventKind } from '../src/sim/types';
import { getWorld } from '../src/sim/world';

const legs = Number(process.argv[2] ?? 60);
const seeds = Number(process.argv[3] ?? 30);
const world = getWorld();

let topShare = 0;
let days = 0;
let oilMin = Infinity;
let oilMax = 0;
const eventKinds: Record<string, number> = {};
let lowestPrice = 1;
let pricedown = 0;
let samples = 0;

for (let s = 1; s <= seeds; s++) {
  let g = newGame(s * 7907);
  const routes = new Map<string, number>();
  const seen = new Set<number>();
  for (let i = 0; i < legs && !g.gameOver; i++) {
    const from = g.ship.location;
    g = botStep(g);
    const key = `${from}>${g.lastVoyage!.to}`;
    routes.set(key, (routes.get(key) ?? 0) + 1);
    oilMin = Math.min(oilMin, g.oil.index);
    oilMax = Math.max(oilMax, g.oil.index);
    for (const e of g.events) {
      if (!seen.has(e.id)) { seen.add(e.id); eventKinds[e.kind] = (eventKinds[e.kind] ?? 0) + 1; }
    }
    for (const p of Object.values(g.ports)) {
      for (const v of Object.values(p.prices)) {
        lowestPrice = Math.min(lowestPrice, v);
        if (v < 0.85) pricedown++;
        samples++;
      }
    }
  }
  const top = Math.max(...routes.values());
  topShare += top / legs;
  days += g.day;
}

const kinds = Object.entries(eventKinds).map(([k, n]) => `${k as WorldEventKind} ${n}`).join(', ');
console.log(`greedy bot, ${legs} legs × ${seeds} seeds, ${Math.round(days / seeds)} days per game`);
console.log(`  most-used route share: ${((topShare / seeds) * 100).toFixed(0)}% of legs`);
console.log(`  oil index range: ${oilMin.toFixed(2)} – ${oilMax.toFixed(2)}`);
console.log(`  events per 1000 days: ${((Object.values(eventKinds).reduce((a, b) => a + b, 0) / days) * 1000).toFixed(1)}  (${kinds})`);
console.log(`  depressed price levels (<0.85): ${((pricedown / Math.max(1, samples)) * 100).toFixed(0)}% of tracked; lowest ${lowestPrice.toFixed(2)}`);
console.log(`  ports: ${world.portList.length}`);
