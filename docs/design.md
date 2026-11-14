# Ports of Call Remake – Design Document

A modern remake of the 1987 Amiga classic *Ports of Call*, built as a PWA with Claude Code. Same proven mechanics, modern graphics, plus fleet automation.

## Vision

The player starts as a small shipowner with one cheap, old ship and works their way up to a global shipping company. The heart of the game is the upgrade loop: find lucrative routes, earn money, buy the next bigger or better ship, carry more valuable cargo, earn even more. The game should feel calm and strategic, with the tension of risky long voyages and the joy of every new ship purchase.

## Core Loop

1. Look at available cargo contracts in the current port (cargo type, destination, pay, deadline).
2. Pick a contract and load the cargo.
3. Buy bunker oil — ideally where it is cheap — and plan the route.
4. Sail: time passes, events can happen (storms, breakdowns, price changes).
5. Arrive, deliver, get paid; pay port fees.
6. Spend money on repairs, upgrades, or a new ship.
7. Repeat — eventually with a whole fleet, partly automated.

## Ships

- Several ship types: small coaster, general cargo, bulk carrier, tanker, container ship, later reefers.
- Each ship has: capacity, speed, fuel consumption, condition (wear), age, purchase price, upkeep.
- Second-hand market: old ships are cheap but slow, thirsty, and break down more often. New ships are expensive but efficient and reliable.
- Ships lose condition over time; repairs in port cost money and time. Ships can be sold again.
- Clear progression: each bigger ship class unlocks more expensive cargo and longer, more profitable routes.

## Economy

- Around 10 ports in version 1, later 30+. Each port produces some goods and demands others, creating natural trade loops.
- Cargo pay depends on cargo value, distance, urgency, and supply/demand at the destination.
- Prices react to the player: delivering the same goods repeatedly to one port lowers the price, pushing the player to find new routes.
- Bunker oil price differs per port and changes over time — refuelling in the right place is a real decision.
- Costs that matter: fuel, port fees, repairs, upkeep, loan interest.
- World events: harvest failures, strikes, regional booms, canal closures — they shift prices and create opportunities.
- Loans from a bank to buy ships early, with interest.

## Fleet and Automation

- The player can own multiple ships at once and send them on different voyages.
- Once a good route is found, the player can program it: a round trip with stops, what to load at each stop, and where to refuel.
- Automated ships run their routes on their own and report profit per trip.
- A fleet overview shows each ship's position, cargo, condition, and profit, so the player manages rather than micromanages.
- Automated ships still face events and wear, so routes need occasional attention.

## Out of Scope for Version 1

- Harbour manoeuvring minigame (maybe later as an optional feature).
- Multiplayer.
- Space version (possible spin-off later).

## Visual Direction

- Modern, clean look: an attractive world map with animated ships, day/night, and weather.
- Polished UI with clear numbers, charts for prices and profits, and satisfying feedback when buying ships or getting paid.
- Ship art from a bought asset pack; lighting, water effects, and animation done in code.

## Phases

**Phase 1 – Numbers prototype.** Map with ports, one ship, contracts, fuel, money. Done when ten turns of play make route choices feel meaningful.

**Phase 2 – Ships and market.** Several ship types, second-hand market, wear and repairs, loans. Done when saving up for the next ship feels motivating.

**Phase 3 – Dynamic economy.** Supply/demand reaction, fluctuating oil prices, world events. Done when the best route changes over time.

**Phase 4 – Fleet and automation.** Multiple ships, programmable round trips, fleet overview. Done when running a fleet feels like management, not chores.

**Phase 5 – Graphics and polish.** Modern map, animations, effects, sound, PWA install.

## Technical Notes

- PWA, installable on Android and iPad; saves locally (later optional cloud save via Firebase).
- Simulation separated from rendering; off-screen ships are simulated with simple maths, not frame by frame.
- Game data (ports, goods, ships) kept in editable data files so balancing is easy.
