# Deadweight (working title)

A calm, strategic shipping-company game built as a PWA. Start with one tired
old coaster and $150,000, carry cargo between ten world ports, and grow from
there. The full design is in [docs/design.md](docs/design.md).

**Status: Phase 3 (dynamic economy).** Port prices react to your deliveries,
the world oil price moves in trends, and world events (strikes, harvest
failures, booms, canal closures, oil shocks) shift the best routes. Built on
Phase 2 (twelve ship classes, ship market, loans, ageing) and Phase 1 (ten
ports, contracts, fuel, wear and repairs, storms, animated map, autosave).

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
5. Late deliveries lose 15% of their pay for each day late. If cash runs out,
   the bank automatically extends your ship loan (up to 60% of the ship's value,
   8% a year), then allows an overdraft of up to −$50,000 (18% a year). Past
   that, or with no way to reach any port, the game is over.
6. **Market:** trade your ship in for a better one. Every port has a few used
   ships; Rotterdam, Shanghai and Singapore also build new ones. The bank lends
   up to 60% of a ship's value at 8% a year. Keep cash for fuel: a bigger ship's
   full tank costs far more.
7. Goals are net-worth milestones (cash + ship value − loan): $1M, $5M, $25M, $100M.
8. **The economy moves.** Every delivery lowers what that port pays for that good
   (the Cargo tab shows what each port pays well for and what's oversupplied);
   prices drift back over a couple of months. Bunker prices follow a world oil
   index (chart in the Ship tab). World events appear about every 40 days, are
   listed in the Voyage tab, and show on the map: dock strikes (3 extra days and
   double fees), harvest failures and booms (higher prices), canal closures
   (long detours) and oil shocks.

### Ship classes

The main ladder carries bulk and general cargo; specialists sit beside it.

| Class               | Hold     | Speed | Carries          | New price |
|---------------------|----------|-------|------------------|-----------|
| Coaster             | 3,000 t  | 10 kn | bulk, general    | $1.5M     |
| Large coaster       | 5,000 t  | 11 kn | bulk, general    | $3.0M     |
| General cargo ship  | 8,000 t  | 13 kn | bulk, general    | $5.5M     |
| Handysize freighter | 15,000 t | 14 kn | bulk, general    | $8.5M     |
| Bulk carrier        | 25,000 t | 14 kn | bulk             | $6.0M     |
| Panamax bulker      | 45,000 t | 14 kn | bulk             | $13M      |
| Small reefer        | 3,000 t  | 16 kn | reefer, general  | $3.8M     |
| Reefer              | 5,000 t  | 17 kn | reefer, general  | $7.2M     |
| Product tanker      | 12,000 t | 13 kn | liquid           | $3.5M     |
| Crude tanker        | 40,000 t | 14 kn | liquid           | $12M      |
| Container feeder    | 6,000 t  | 17 kn | general, reefer  | $7.0M     |
| Container ship      | 15,000 t | 20 kn | general, reefer  | $13M      |

Prices are set so a new ship pays for itself in roughly 280 days (coaster) to
600 days (container ship) of typical trading (`npx tsx scripts/ships.ts`).
Tweak ships with `python3 scripts/tune-ships.py id.field=value ...`.

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
  economy.ts     Port price levels, oil market, world events (ECONOMY)
  bot.ts         Greedy and casual captains used for balancing (and a seed for automation later)
  save.ts        localStorage save/load, with upgrades for older saves
src/ui/          Rendering: d3-geo world map, panels, styles
scripts/         balance.ts, compare.sh, progression.ts, ships.ts, economy.ts, tune-ships.py
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
- `npx tsx scripts/economy.ts`: route concentration, price levels, oil range and event frequency.

Current results (net worth, starting at about $380k including the old coaster):

| Bot    | after 10 legs | after 40 legs | after 80 legs | bankrupt (80 legs) |
|--------|---------------|---------------|---------------|--------------------|
| greedy | $1.2M         | $7.9M         | $18.6M        | ~2%                |
| casual | $0.7M         | $2.8M         | $6.8M         | ~13%               |

The aim is for casual play to make steady money and good play to make a lot more.
