// Compare ship classes: earning power (best net $/day, averaged over ports and
// seeds) against price. Usage: npx tsx scripts/ships.ts [seeds] [age]

import { earningPower } from '../src/sim/bot';
import { newGame } from '../src/sim/game';
import { REFERENCE_AGE, shipValue } from '../src/sim/ships';
import { getWorld } from '../src/sim/world';

const seeds = Number(process.argv[2] ?? 20);
const age = Number(process.argv[3] ?? 0);
const world = getWorld();

console.log(`Ships aged ${age} (stats are for age ${REFERENCE_AGE}), ${seeds} sampled worlds`);
console.log('class            price       $/day   payback(days)');
for (const type of Object.values(world.shipTypes)) {
  let sum = 0;
  for (let s = 1; s <= seeds; s++) {
    const g = newGame(s * 31337);
    sum += earningPower(g, { typeId: type.id, age, condition: age === 0 ? 100 : 75 });
  }
  const perDay = sum / seeds;
  const price = age === 0 ? type.newPrice : shipValue(type, age, 75);
  console.log(`${type.name.padEnd(16)} ${('$' + (price / 1e6).toFixed(2) + 'M').padStart(8)} ${('$' + Math.round(perDay)).padStart(10)} ${String(Math.round(price / perDay)).padStart(10)}`);
}
