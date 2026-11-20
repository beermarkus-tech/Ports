# Deadweight (working title)

A calm, strategic shipping-company game built as a PWA. Start with one tired
old coaster and $150,000, carry cargo between 26 world ports, and grow from
there. The full design is in [docs/design.md](docs/design.md); ideas for later
(such as an age-of-sail game mode) are in [docs/ideas.md](docs/ideas.md).

**Status: world clock and fleet.** Time runs on a clock (1 day per second,
2× and 4×, pause) and you can own several ships at once; arrivals pause the
game. Built on Phase 3 (dynamic economy: reacting prices, oil trends, world
events), Phase 2 (twelve ship classes, ship market, loans, ageing) and
Phase 1 (ten ports, contracts, fuel, wear and repairs, storms, map, autosave).
Graphics pass 1: ship art per family, a living map (night side, waves, coastal
glow, clouds, storm cells, wakes), cash and payment effects, synthesised sound
effects with a mute button. The world has 26 ports and 29 goods (rice, sugar,
bauxite, rubber, cotton, wool, tea, palm oil, fish and dairy among them). Captains run ships by themselves in a region or on a
lane, for a wage; premium jobs reward the ships you command yourself. Next:
decision events (storms: around or through), then goals.

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

## Several games

The ☰ button (top right) opens **Your games**: every saved game with its era,
date, fleet and net worth. Open another and the current one waits where you left
it; each keeps its own clock. Start a new company there (pick a name and an
era: Modern from 2000, or the Age of Sail from 1650), rename or delete games.
With more than one game saved, the app opens on this screen. A save from before
slots becomes the first game automatically.

## The Age of Sail (1650)

A second era with its own world: found a merchant house in Amsterdam with the
*Duifje*, a little jacht, and ƒ150,000. Money is in guilders, the calendar starts
on 1 January 1650, and the chart is drawn on parchment.

- **40 ports of the 1650s**: Amsterdam, London, Danzig, Lisbon, Cádiz, Venice,
  Elmina, the Cape, Mocha, Surat, Goa, Malacca, Batavia, the Banda Islands,
  Canton, Dejima, Havana, Portobelo, New Amsterdam and more, trading 26 period
  goods: spices, tea, silk, porcelain, silver, sugar, furs, cod, salt…
- **No canals**: the way to the Indies is round the Cape, months at sea.
- **Wind**: speed depends on the prevailing wind for the course and the month.
  Trade winds and westerlies help or hinder; the doldrums are slow; the monsoon
  of the Indian Ocean and the South China Sea turns with the seasons, so when you
  sail matters as much as where.
- **Victuals** instead of fuel, counted in casks; **careening** instead of dry dock.
  Plague quarantines replace dock strikes; there is no oil market, no port view
  and no pilots or tugs.
- **Six period ships**: jacht, fluyt, large fluyt, pinas, East Indiaman and
  retourschip. Shipyards at Amsterdam and Batavia.

- **Fog of war**: you start with what the Dutch knew around 1650: the Cape
  route to the Indies, the China seas and Japan, the Atlantic coasts and the way
  round Cape Horn. East Africa (Mozambique, Zanzibar), the South Sea (Acapulco,
  Callao) and the Pacific lie under fog. Uncharted ports show as rumours: you can
  sail there on a voyage of discovery (slower going, more storms), every league
  sailed gets charted, and the first of your ships in a new port finds its
  merchants paying handsomely for a while. Nobody charters cargo to uncharted
  places. Charts are for sale in some ports: a Portuguese rutter of the Swahili
  coast in Goa, the Spanish galleon route in Manila, a rutter of the South Sea
  in Portobelo.

- **Trade on your own account**: alongside charters, buy goods where they're
  produced (pepper in Bantam, nutmeg in Banda, cloth in Amsterdam) and sell
  them where they're wanted. A buyer pays more the farther it is from the
  nearest producer; prices wander from day to day, your own buying pushes the
  price up and a big sale floods the market. Goods aboard take hold space and
  count in your net worth at cost; profit is booked when you sell.
- **Slow news**: where one of your ships lies you see today's prices. Anywhere
  else you know prices only as of the latest letter from there, carried by
  other people's ships from wherever yours are (or from home): Batavia's prices
  reach Amsterdam months old. Every price shown is dated.

Still to come for this era: more nations (a Chinese merchant house next). The trade in enslaved
people is not part of the game.

## How to play

0. **Time and the fleet.** The clock runs at 1 day per second (2× and 4× in the
   header; space bar pauses), but only while no ship needs a decision: a ship in
   port without orders stops everything (prices too) until you cast it off or
   tell it to wait (1 day, 5 days, or lay up until further notice). Arrivals,
   the end of a dry-dock stay or a wait, and new ships all ask for orders. Pick
   a ship in the strip under the map (or on the map) and the tabs act on it.
1. **Contracts:** load cargo offered in your port. You can carry lots for
   several destinations at once, as long as they fit in the hold.
2. **Ship:** bunker fuel (prices differ by port and drift daily), or repair
   in dry dock (the ship is out of action for a few days). Low condition means
   more breakdowns and a thirstier engine. Upkeep is paid daily for every ship.
3. **Voyage:** pick a destination (or tap a port on the map). The planner
   shows distance, days, fuel and the estimated result. You can't cast off
   without the fuel the leg needs, and legs beyond your bunker range need a
   stop on the way.
4. At sea you may hit storms (slower, more fuel, hull wear) or breakdowns
   (delay and repair bill). If you cut your fuel reserve too fine, a bunker
   tender rescues you at 2.5× the price.
5. Late deliveries lose 15% of their pay for each day late. If cash runs out,
   the bank automatically extends your loan (up to 60% of the fleet's value,
   8% a year), then allows an overdraft of up to −$50,000 (18% a year). Past
   that, or when no ship can reach another port, the game is over.
6. **Market:** buy ships in any port's market (pick the port at the top); a
   new ship joins your fleet there with a little fuel. Every port has a few
   used ships; Rotterdam, Shanghai, Singapore and Busan also build new ones. Sell a
   ship from the Ship tab. Keep cash for fuel: a big ship's full tank costs a lot.
7. Goals are net-worth milestones (cash + fleet value − loan): $1M, $5M, $25M, $100M.
8. **The economy moves.** Every delivery lowers what that port pays for that good
   (the Cargo tab shows what each port pays well for and what's oversupplied);
   prices drift back over a couple of months. Bunker prices follow a world oil
   index (chart in the Ship tab). World events appear about every 40 days, are
   listed in the Voyage tab, and show on the map: dock strikes (3 extra days and
   double fees), harvest failures and booms (higher prices), canal closures
   (long detours) and oil shocks.
9. **Captains.** A ship only sails by itself with a hired captain. Hire them in
   the Company tab (2 posts to start, one more per net-worth goal): each has a
   wage, a skill (★ green to ★★★ veteran) and a home region where he gets more
   cargo booked. In a ship's Voyage tab, "Hand over to a captain…" gives him a
   region to trade in, or a lane between two regions; a short market report per
   region shows the regular cargo for that ship, what's on the quays, leg length,
   fuel prices and range. The captain picks ports himself (best pay per day over
   waiting, loads for the whole area, waits for better offers rather than sail at
   a loss, repositions empty only towards real trade, and reports back after ten
   idle days). Less skilled captains misjudge more, wait less and buy fuel
   anywhere. "Take command" gets the ship back; letting a captain go costs a
   month's wage. **Premium jobs** (★ Express, Dangerous goods, Government,
   Project cargo: 1.8–2.6× pay, tight deadlines) are only for ships you command.
10. **Port view:** when a ship needs orders (or you tap a ship in port or dry
   dock), the map gives way to a side view of it at the quay, drawn to one true
   scale (300 m of quay, cranes and people for comparison). It sits deeper as
   cargo and fuel go aboard (red bottom paint, draft marks, load line); the
   holds and bunker tank are cut open; wear shows as rust, fading paint, dents
   and smoke. Dry dock drains the water and puts it on keel blocks. Six
   regional backdrops, time of day from the map's sun. An inset map shows the
   route of the destination you picked or the cargo you point at; tap it (or
   Map) for the world map, which also returns by itself when the clock runs.
11. **Docking yourself.** Every arrival costs pilot and tugs (60% of the port
   fee). When a ship you command arrives, the report offers "Dock her yourself":
   a top-down harbour at true scale (five layouts: breakwater, river, bay,
   dogleg channel, open jetty; big ships use outer or deep-water berths), with
   wind and current. Engine in steps (W/S), rudder (A/D, Space midships), tugs
   pushing sideways while held (Q/E). Moor slowly alongside the yellow berth:
   you keep the pilot and tugs money, a perfect docking also gets the port fee
   waived, bumps above 0.7 knots cost condition. "Hand over to the pilot" any
   time. Ships with captains always take the pilot.
12. **Company tab:** the books. Net worth at the end of each month (line) and
   the monthly result, revenue less running costs (bars, profit teal, loss
   orange), with hover/tap tooltips; this month and last month broken down into
   revenue, fuel, port fees and canals, upkeep, interest, repairs and incidents.
   Then your captains and the ones looking for work, and every ship with its
   captain or "under your command", status, hold, fuel, condition, a small chart
   of its last 12 months (same scale for all ships) and its last 30 days.

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

Chilled (reefer) cargo — fruit, meat, fish, dairy — pays about 40% more than
ordinary freight, which is what earns back a reefer's higher price. Most of it
flows from the southern hemisphere north, so reefers take general cargo on the
way back. `scripts/reefer-trade.py` records that data change.

Prices are set so a new ship pays for itself in roughly 280 days (coaster) to
600 days (container ship) of typical trading (`npx tsx scripts/ships.ts`).
Tweak ships with `python3 scripts/tune-ships.py id.field=value ...`.

Stats are for a typical 15-year-old ship. Newer ships are a little faster, more
economical and more reliable; older ones are worse. Values drop about 7% a year.

## Code layout

```
src/data/        Editable game data: ports, goods, ships, sea-lane graph, canals, regions
src/data/sail/   The 1650 world (generated by scripts/sail-world.py and scripts/sail-lanes.ts)
src/sim/         Pure simulation, no DOM (deterministic: seeded RNG stored in the save)
  era.ts         What differs between the eras beyond data (start, currency, rules, words)
  world.ts       Loads data per era (worldFor, setEra, getWorld); shortest sea routes (Dijkstra)
  wind.ts        Prevailing winds and the monsoon; speed factor along a route
  charts.ts      Fog of war: charted waters, voyages of discovery, charts for sale (CHART_TUNING)
  trade.ts       Own-account trade and slow news: prices, drift, weekly samples, letters (TRADE_TUNING)
  contracts.ts   Contract generation and pay formula (CONTRACT_TUNING)
  game.ts        Fleet, world clock (advance), player actions and voyages (RULES); every action returns a new state
  ships.ts       Ship value, age effects, the ship market, purchase quotes, loans (SHIP_TUNING)
  economy.ts     Port price levels, oil market, world events (ECONOMY)
  bot.ts         Greedy and casual captains used for balancing (and a seed for automation later)
  save.ts        localStorage save/load, with upgrades for older saves
src/ui/          Rendering: d3-geo world map (map.ts), ship art (art.ts), port view (port-scene.ts), sound (sound.ts), panels, styles
scripts/         balance.ts, compare.sh, progression.ts, ships.ts, economy.ts, tune-ships.py
tests/           vitest
```

Distances come from a sea-lane graph (waypoints such as Gibraltar, Suez, Malacca
and Panama) and are mostly within ~10% of real sea distances (a few coastal hops, such as Busan–Yokohama
and round Cape Horn, run up to 25% long). Canals are tagged edges
with dues, so a canal closure in Phase 3 just reroutes (tests already cover
Suez closing and the route going round the Cape).

## Balancing knobs

- `CONTRACT_TUNING.payScale` in `src/sim/contracts.ts` is the main dial.
- Goods `freightRate` and lot sizes are in `src/data/goods.json`.
- Fuel prices, port fees, and what each port produces and demands are in `src/data/ports.json`
  (`label` sets which side of the dot the map label goes). `scripts/add-ports.py` built the
  26-port world from the original ten.
- `CONTRACT_TUNING.laneBias` and `nearbyNm` decide where cargo goes: lots cluster on lanes already
  on the board, and nearer buyers are likelier, so ships can fill up for one trip.
- Storms, breakdowns, wear and the start conditions are in `RULES` in `src/sim/game.ts`.

Balance scripts use two bots: a **greedy** one (best net $/day every time) and a
**casual** one (picks a juicy-looking contract, never waits for offers, upgrades
less shrewdly), which is closer to a person playing for the first time.

- `scripts/compare.sh`: 10 legs × 300 games, early-game cash and bankruptcies.
- `npx tsx scripts/progression.ts 80 60 casual`: net worth over a long game, when the first upgrade happens, which ships bots end up with.
- `npx tsx scripts/ships.ts`: each ship class's earning power against its price.
- `npx tsx scripts/economy.ts`: route concentration, price levels, oil range and event frequency.
- `ORDERS` in `src/sim/game.ts` and `serviceLotsPerStop` / `serviceChance` / `serviceLotsMax` in
  `CONTRACT_TUNING` tune standing orders. With them, an old coaster on five well-chosen Atlantic
  ports makes roughly 70% of what the greedy bot makes by hand; poorly chosen pairs lose money.

Current results (net worth, starting at about $380k including the old coaster):

| Bot    | after 10 legs | after 40 legs | after 80 legs | bankrupt (80 legs) |
|--------|---------------|---------------|---------------|--------------------|
| greedy | $1.2M         | $7.9M         | $18.6M        | ~2%                |
| casual | $0.7M         | $2.8M         | $6.8M         | ~13%               |

The aim is for casual play to make steady money and good play to make a lot more.
