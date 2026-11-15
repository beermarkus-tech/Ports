# Deadweight (working title)

A calm, strategic shipping-company game built as a PWA. Start with one tired
old coaster and $150,000, carry cargo between ten world ports, and grow from
there. The full design is in [docs/design.md](docs/design.md).

**Status: Phase 2 (ships and market).** Six ship classes, a second-hand market
in every port and new ships at three shipyards, bank loans, and age effects, on
top of Phase 1: ten ports, cargo contracts, bunker fuel, wear and repairs,
storms and breakdowns, an animated world map, and autosave.

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
Pages on every push to `main` (or manually from the Actions tab). One-time
setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

**Build number:** the commit count on `main`, shown under the logo and at the
bottom of the Log tab (with the commit id and build time). The ↻ button in the
header checks for a new version, installs it and reloads, with no need to
close the app. The game saves after every action, so reloading is always safe.

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
5. Late deliveries lose 15% of their pay for each day late. The bank allows an
   overdraft of up to −$50,000 (about 18% a year interest) for fuel and repairs.
   Past that limit, or with no way to reach any port, the game is over.
6. **Market:** trade your ship in for a better one. Every port has a few used
   ships; Rotterdam, Shanghai and Singapore also build new ones. The bank lends
   up to 60% of a ship's value at 8% a year. Keep cash for fuel: a bigger ship's
   full tank costs far more.
7. Goals are net-worth milestones (cash + ship value − loan): $1M, $5M, $25M, $100M.

### Ship classes

| Class          | Hold     | Speed | Carries          | New price |
|----------------|----------|-------|------------------|-----------|
| Coaster        | 3,000 t  | 10 kn | bulk, general    | $1.5M     |
| General cargo  | 8,000 t  | 13 kn | bulk, general    | $4.5M     |
| Reefer         | 5,000 t  | 17 kn | reefer, general  | $7.5M     |
| Bulk carrier   | 25,000 t | 14 kn | bulk             | $9M       |
| Product tanker | 30,000 t | 14 kn | liquid           | $10M      |
| Container ship | 15,000 t | 20 kn | general, reefer  | $15M      |

Stats are for a typical 15-year-old ship. Newer ships are a little faster, more
economical and more reliable; older ones are worse. Values drop about 7% a year.

## Code layout

```
src/data/        Editable game data: ports, goods, ships, sea-lane graph, canals
src/sim/         Pure simulation, no DOM (deterministic: seeded RNG stored in the save)
  world.ts       Loads data; shortest sea routes over the lane graph (Dijkstra)
  contracts.ts   Contract generation and pay formula (CONTRACT_TUNING)
  game.ts        Player actions and voyage resolution (RULES); every action returns a new state
  ships.ts       Ship value, age effects, the ship market, purchase quotes, loans (SHIP_TUNING)
  bot.ts         Greedy and casual captains used for balancing (and a seed for automation later)
  save.ts        localStorage save/load, with upgrades for older saves
src/ui/          Rendering: d3-geo world map, panels, styles
scripts/         balance.ts, compare.sh, progression.ts, ships.ts
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

Balance scripts use two bots: a **greedy** one (best net $/day every time) and a
**casual** one (picks a juicy-looking contract, never waits for offers, upgrades
less shrewdly), which is closer to a person playing for the first time.

- `scripts/compare.sh`: 10 legs × 300 games, early-game cash and bankruptcies.
- `npx tsx scripts/progression.ts 80 60 casual`: net worth over a long game, when the first upgrade happens, which ships bots end up with.
- `npx tsx scripts/ships.ts`: each ship class's earning power against its price.

Current results (net worth, starting at about $380k including the old coaster):

| Bot    | after 10 legs | after 40 legs | after 80 legs | bankrupt (80 legs) |
|--------|---------------|---------------|---------------|--------------------|
| greedy | $1.1M         | $7.0M         | $15.8M        | 0%                 |
| casual | $0.8M         | $2.8M         | $5.8M         | ~8%                |

The aim is for casual play to make steady money and good play to make a lot more.
