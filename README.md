# Deadweight (working title)

A calm, strategic shipping-company game built as a PWA. Start with one tired
old coaster and $120,000, carry cargo between ten world ports, and grow from
there. The full design is in [docs/design.md](docs/design.md).

**Status: Phase 1 (numbers prototype).** One ship, ten ports, cargo contracts,
bunker fuel, wear and repairs, storms and breakdowns, an animated world map, and
autosave.

## Running it

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # simulation tests
npm run balance    # headless balance report: greedy bot, 10 legs × 50 seeds
npm run balance -- 30 200   # 30 legs × 200 seeds
npm run build      # type-check and production build into dist/
```

## Play online / install

The game deploys to GitHub Pages: **https://beermarkus-tech.github.io/Ports/**

It's an installable PWA that runs fully offline once loaded:
- **Android (Chrome):** menu ⋮ → *Install app* (or the install prompt).
- **iPad / iPhone (Safari):** Share → *Add to Home Screen*.
- **Desktop (Chrome/Edge):** the install icon in the address bar.

Saves live in the browser on that device. New versions are picked up
automatically on the next launch.

### Deployment

`.github/workflows/deploy.yml` runs the tests, builds, and deploys `dist/` to
Pages on every push to `main` or the development branch (or manually from the
Actions tab). One-time setup: **Settings → Pages → Build and deployment →
Source: GitHub Actions**.

## How to play

1. **Contracts:** load cargo offered in your port. You can carry lots for
   several destinations at once, as long as they fit in the hold.
2. **Ship:** bunker fuel (prices differ by port and drift daily), or repair
   in dry dock. Low condition means more breakdowns and a thirstier engine.
3. **Voyage:** pick a destination (or tap a port on the map). The planner
   shows distance, days, fuel and the estimated result. You can't cast off
   without the fuel the leg needs, and legs beyond your bunker range need a
   stop on the way.
4. At sea you may hit storms (slower, more fuel, hull wear) or breakdowns
   (delay and repair bill). If you cut your fuel reserve too fine, a bunker
   tender rescues you at 2.5× the price.
5. Late deliveries lose 15% of their pay for each day late. Going below $0
   means bankruptcy.

## Code layout

```
src/data/        Editable game data: ports, goods, ships, sea-lane graph, canals
src/sim/         Pure simulation, no DOM (deterministic: seeded RNG stored in the save)
  world.ts       Loads data; shortest sea routes over the lane graph (Dijkstra)
  contracts.ts   Contract generation and pay formula (CONTRACT_TUNING)
  game.ts        Player actions and voyage resolution (RULES); every action returns a new state
  bot.ts         Greedy captain used for balancing (and a seed for automation later)
  save.ts        localStorage save/load
src/ui/          Rendering: d3-geo world map, panels, styles
scripts/         balance.ts
tests/           vitest
```

Distances come from a sea-lane graph (waypoints such as Gibraltar, Suez, Malacca
and Panama) and are within ~10% of real sea distances. Canals are tagged edges
with dues, so a canal closure in Phase 3 just reroutes (tests already cover
Suez closing and the route going round the Cape).

## Balancing knobs

- `CONTRACT_TUNING.payScale` in `src/sim/contracts.ts` is the main dial.
- Goods `freightRate` and lot sizes are in `src/data/goods.json`.
- Fuel prices, port fees, and what each port produces and demands are in `src/data/ports.json`.
- Storms, breakdowns, wear and the start conditions are in `RULES` in `src/sim/game.ts`.

Run `npm run balance` after changes. At the current settings a greedy bot ends
10 legs with a median of about $490k (p10 about $230k), with a few bankruptcies
from bad luck.
