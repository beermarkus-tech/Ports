import './ui/style.css';
import { activeEvents, closedCanals, priceLevel, routeFor } from './sim/economy';
import {
  ActionError, LAID_UP, RULES, acceptContract, advance, atSea, borrow, buyFuel, buyShip, canCarry, cargoTons,
  dailyUpkeep, daysUntilNextShip, fuelPrice, getShip, inDryDock, isReady, isWaiting, needsDecision, newGame,
  nextMilestone, planVoyage, portFee, repair, repairQuote, repayLoan, sail, saleQuote, sellShip,
  shipsNeedingDecision, takeReport, typeOf, unloadContract, voyageProgress, waitInPort, type VoyagePlan,
} from './sim/game';
import { clearSave, loadGame, saveGame } from './sim/save';
import {
  SHIP_TUNING, consumptionFactor, effectiveSpeed, exportsFor, fleetValue, maxLoan, netWorth, quotePurchase, saleValue,
  stateValue,
} from './sim/ships';
import type { Contract, GameState, ShipOffer, ShipState, ShipTypeDef, VoyageReport } from './sim/types';
import { getWorld } from './sim/world';
import { compactMoney, days, esc, gameDate, money, tons } from './ui/format';
import { mapIconPath, shipFamily, shipSideView } from './ui/art';
import { MapView, type LonLat, type PortMarker, type ShipMarker, type WeatherCell } from './ui/map';
import { sound } from './ui/sound';
import { BUILD, consumeUpdatedFrom, initServiceWorker, isNewer, latestBuild, reloadApp } from './ui/update';

type Tab = 'contracts' | 'voyage' | 'ship' | 'market' | 'log';
/** Why the clock is stopped: the player paused it, or a ship (or an arrival report) needs the player. */
type PauseReason = 'user' | 'arrival' | 'decision';

const world = getWorld();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Game days per real second at 1× speed. */
const DAYS_PER_SECOND = 1;
const TICK_MS = 100;
const EVENT_LABELS = { storm: '⛈ Storm', breakdown: '⚙ Breakdown', emergencyFuel: '⛽ Out of fuel!', strike: '✊ Dock strike' } as const;
const EVENT_SOUNDS = { storm: 'thunder', breakdown: 'clank', emergencyFuel: 'clank', strike: 'clank' } as const;
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** Decorative weather systems drifting eastwards. */
const AMBIENT_CLOUDS = [
  { lon: -40, lat: 45, seed: 0.13 }, { lon: 20, lat: -42, seed: 0.37 }, { lon: 95, lat: 12, seed: 0.71 },
  { lon: 150, lat: 38, seed: 0.52 }, { lon: -150, lat: -30, seed: 0.88 }, { lon: -95, lat: 25, seed: 0.24 },
  { lon: 60, lat: -50, seed: 0.66 }, { lon: -10, lat: 5, seed: 0.05 },
];


/** How the cargo board can be ordered. Cargo a ship can't take always goes last. */
const CONTRACT_SORTS = {
  pay: { label: 'Pay, highest first', compare: (a: Contract, b: Contract) => b.pay - a.pay },
  dest: { label: 'Destination A–Z', compare: (a: Contract, b: Contract) => world.ports[a.dest].name.localeCompare(world.ports[b.dest].name) },
};
type ContractSort = keyof typeof CONTRACT_SORTS;
const SORT_KEY = 'deadweight.contractSort';

function loadContractSort(): ContractSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v && v in CONTRACT_SORTS) return v as ContractSort;
  } catch { /* storage blocked */ }
  return 'pay';
}
class App {
  private g: GameState;
  private activeId: number;
  private tab: Tab = 'contracts';
  private dest: string | null = null;
  private hoverDest: string | null = null;
  private marketPort: string | null = null;
  private contractSort: ContractSort = loadContractSort();
  private paused = true;
  private pausedBy: PauseReason | null = 'decision';
  private speed = 1;
  private pointerDown = false;
  private panelDirty = false;
  private renderedTab: Tab | null = null;
  private renderedShip: number | null = null;
  private renderedDay = -1;
  private lastSave = 0;
  private lastPanel = 0;
  /** Real seconds the clock has been running: drives the cosmetic day/night and weather. */
  private sceneTime = 0;
  private storms: { id: string; at: LonLat; from: number; until: number; seed: number }[] = [];
  private shownCash: number | null = null;
  private cashAnim = 0;
  private cashTarget: number | null = null;
  private map: MapView;

  constructor() {
    this.g = loadGame() ?? newGame();
    saveGame(this.g);
    this.activeId = (this.g.fleet.find((s) => isReady(this.g, s)) ?? this.g.fleet[0]).id;
    this.map = new MapView(
      $('#map'),
      world,
      (id) => this.selectDest(id),
      (id) => { this.hoverDest = id; this.renderRoutes(); },
      (id) => this.selectShip(id),
    );

    document.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (t && !t.hasAttribute('disabled')) this.handle(t.dataset.action!, t.dataset);
    });
    document.addEventListener('change', (ev) => {
      const t = ev.target as HTMLSelectElement;
      // A native dropdown can swallow the pointerup, so don't wait for it here.
      this.pointerDown = false;
      if (t.dataset.action === 'market-port') { this.marketPort = t.value; this.renderPanel(); }
    });
    document.addEventListener('mouseover', (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>('[data-hover-dest]');
      const id = row?.dataset.hoverDest ?? null;
      if (id !== this.hoverDest) { this.hoverDest = id; this.renderRoutes(); }
    });
    // Don't redraw under the player's finger mid-click.
    document.addEventListener('pointerdown', () => { this.pointerDown = true; sound.unlock(); });
    const released = () => { this.pointerDown = false; if (this.panelDirty) this.render(); };
    document.addEventListener('pointerup', released);
    document.addEventListener('pointercancel', released);
    document.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space' && !(ev.target instanceof HTMLInputElement) && $('#modal').hidden) {
        ev.preventDefault();
        this.togglePause();
      }
    });
    setInterval(() => this.tick(), TICK_MS);
    this.renderMute();
    this.render();
    if (this.g.reports.length) this.showNextReport();
  }

  private ship(): ShipState {
    return this.g.fleet.find((s) => s.id === this.activeId) ?? this.g.fleet[0];
  }

  // ------------------------------------------------------------ the clock

  private tick(): void {
    if (this.paused || !$('#modal').hidden || this.g.gameOver) return;
    // Nothing moves while a ship is waiting for orders.
    if (shipsNeedingDecision(this.g).length) {
      this.pause('decision');
      this.goToNextDecision();
      return;
    }
    const before = this.g;
    this.sceneTime += (TICK_MS / 1000) * this.speed;
    // Stop exactly when the next ship arrives, leaves dry dock or ends its wait.
    let step = (DAYS_PER_SECOND * this.speed * TICK_MS) / 1000;
    const next = daysUntilNextShip(this.g);
    if (next !== null) step = Math.min(step, next + 1e-6);
    this.g = advance(this.g, Math.max(1e-6, step));
    this.flashEvents(before, this.g);
    if (this.g.reports.length) {
      this.pause('arrival');
      this.showNextReport();
      return;
    }
    const freed = shipsNeedingDecision(this.g).filter((s) => !shipsNeedingDecision(before).some((b) => b.id === s.id));
    if (freed.length) {
      saveGame(this.g);
      this.pause('decision');
      for (const s of freed) {
        const wasDocked = before.fleet.find((b) => b.id === s.id)?.busyUntil !== undefined;
        this.toast(`${s.name} ${wasDocked ? 'is out of dry dock' : 'has finished waiting'} in ${world.ports[s.location].name} and needs orders.`, 'good');
      }
      sound.play('bell');
      this.goToNextDecision();
      this.render();
      return;
    }
    if (Math.floor(this.g.day) !== Math.floor(before.day) || performance.now() - this.lastSave > 5000) {
      saveGame(this.g);
      this.lastSave = performance.now();
    }
    this.renderLive();
    // The Cargo, Voyage and Ship tabs show day-to-day things (offers, deadlines, voyage progress, prices):
    // refresh them when the day changes, at most once a second. Market and Log only change on actions.
    const dayChanged = Math.floor(this.g.day) !== this.renderedDay;
    const live = this.tab === 'contracts' || this.tab === 'voyage' || this.tab === 'ship';
    // Don't redraw under an open dropdown (it would snap shut).
    const picking = document.activeElement?.tagName === 'SELECT';
    if (dayChanged && live && !picking && performance.now() - this.lastPanel > 1000) this.renderPanel();
    if (this.g.gameOver) this.showGameOver();
  }

  /** Storms, breakdowns and the like pop up over the ship as they happen. */
  private flashEvents(before: GameState, after: GameState): void {
    for (const ship of after.fleet) {
      const v = ship.voyage;
      if (!v) continue;
      for (const e of v.events) {
        if (e.atDay > before.day && e.atDay <= after.day) {
          const { at } = this.map.positionAlong(v.path, voyageProgress(after, ship));
          this.map.flashAt(at, `${ship.name}: ${EVENT_LABELS[e.kind]}`, 'bad');
          sound.play(EVENT_SOUNDS[e.kind]);
          if (e.kind === 'storm') {
            this.storms.push({ id: `storm-${ship.id}-${e.atDay.toFixed(2)}`, at, from: after.day, until: after.day + 6, seed: (e.atDay * 7.31) % 1 });
          }
        }
      }
    }
  }

  private pause(reason: PauseReason): void {
    this.paused = true;
    this.pausedBy = reason;
    this.renderTime();
  }

  private resume(): void {
    if (this.g.gameOver) return;
    const waiting = shipsNeedingDecision(this.g);
    if (waiting.length) {
      // The clock can't run while a ship waits for orders: take the player to it.
      this.pause('decision');
      this.goToNextDecision();
      this.toast(`The ${waiting[0].name} needs orders first: cast off, or let it wait in port.`, 'bad');
      this.render();
      return;
    }
    this.paused = false;
    this.pausedBy = null;
    this.renderTime();
  }

  private togglePause(): void {
    if (this.paused) this.resume();
    else this.pause('user');
  }

  /** Select the next ship that needs orders (keeps the current one if it does). */
  private goToNextDecision(): void {
    const waiting = shipsNeedingDecision(this.g);
    if (!waiting.length || waiting.some((s) => s.id === this.activeId)) return;
    this.activeId = waiting[0].id;
    this.dest = null;
    this.marketPort = null;
    if (this.tab === 'log' || this.tab === 'market') this.tab = 'contracts';
  }

  /** After an order: on to the next ship that needs one, or let the clock run again. */
  private afterDecision(): void {
    const waiting = shipsNeedingDecision(this.g);
    if (waiting.length) {
      this.goToNextDecision();
      const next = waiting.find((s) => s.id === this.activeId) ?? waiting[0];
      this.toast(`Next: the ${next.name} in ${world.ports[next.location].name} needs orders.`, 'good');
    } else if (this.paused && this.pausedBy !== 'user' && !this.g.reports.length) {
      this.resume();
    }
  }

  // ------------------------------------------------------------ actions

  private act(fn: (g: GameState) => GameState): boolean {
    try {
      this.g = fn(this.g);
      saveGame(this.g);
      return true;
    } catch (e) {
      if (e instanceof ActionError) { this.toast(e.message, 'bad'); return false; }
      throw e;
    }
  }

  private handle(action: string, data: DOMStringMap): void {
    const ship = this.ship();
    const id = ship.id;
    const type = typeOf(ship);
    switch (action) {
      case 'tab': this.tab = data.tab as Tab; break;
      case 'toggle-time': this.togglePause(); return;
      case 'speed': this.speed = Number(data.speed); if (this.paused) this.resume(); else this.renderTime(); return;
      case 'select-ship': this.selectShip(Number(data.id)); return;
      case 'accept': {
        const c = this.g.ports[ship.location].board.find((x) => x.id === Number(data.id));
        // Pre-select where this cargo is going, so the plan is one tap away.
        if (this.act((g) => acceptContract(g, id, Number(data.id))) && c && !this.dest) this.dest = c.dest;
        break;
      }
      case 'unload': this.act((g) => unloadContract(g, id, Number(data.id))); break;
      case 'fuel': {
        const amount = data.amount === 'fill' ? type.bunkerCapacity : Number(data.amount);
        this.act((g) => buyFuel(g, id, amount));
        break;
      }
      case 'fuel-for-leg': {
        const plan = this.dest ? planVoyage(this.g, id, this.dest) : null;
        if (plan) this.act((g) => buyFuel(g, id, Math.ceil(plan.fuelNeeded * 1.15) - getShip(g, id).fuel));
        break;
      }
      case 'repair': this.act((g) => repair(g, id, Number(data.points))); break;
      case 'borrow': this.act((g) => borrow(g, data.amount === 'max' ? Infinity : Number(data.amount))); break;
      case 'repay': this.act((g) => repayLoan(g, data.amount === 'all' ? Infinity : Number(data.amount))); break;
      case 'buy-ship': {
        const port = data.port!;
        const offer = this.g.ports[port].market.find((o) => o.id === Number(data.id));
        if (!offer) break;
        const q = quotePurchase(this.g, offer, world);
        const ok = confirm(`Buy the ${q.type.name} ${offer.name} in ${world.ports[port].name} for ${money(offer.price)}?${
          q.borrow > 0 ? `\n\nThe bank lends ${money(q.borrow)} at 8% a year.` : ''}\n\nIt joins your fleet; your other ships are not affected.`);
        if (ok && this.act((g) => buyShip(g, port, offer.id))) {
          const bought = this.g.fleet[this.g.fleet.length - 1];
          sound.play('fanfare');
          this.map.pulseAt(this.map.portPosition(port), 'good');
          this.selectShip(bought.id, 'contracts');
          this.showNewShip(bought.id);
          return;
        }
        break;
      }
      case 'sell-ship': {
        const q = saleQuote(this.g, id);
        if (q.blocked) { this.toast(q.blocked, 'bad'); break; }
        const ok = confirm(`Sell the ${type.name} ${ship.name} for ${money(q.price)}${q.fuelRefund ? ` (plus ${money(q.fuelRefund)} for its fuel)` : ''}?${
          q.repay ? `\n\n${money(q.repay)} of that goes to repaying the loan, since the bank lends against your fleet.` : ''}`);
        if (ok && this.act((g) => sellShip(g, id))) {
          sound.play('coins');
          this.toast(`Sold the ${ship.name}.`, 'good');
          this.selectShip(this.g.fleet[0].id);
          this.afterDecision();
          return;
        }
        break;
      }
      case 'dest': this.selectDest(data.id!); return;
      case 'sail': this.sail(); return;
      case 'bunker-sail': {
        const plan = this.dest ? planVoyage(this.g, id, this.dest) : null;
        if (!plan) break;
        const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * 1.15));
        if (this.act((g) => buyFuel(g, id, target - getShip(g, id).fuel)) && this.ship().fuel >= plan.fuelNeeded) {
          this.sail();
          return;
        }
        break;
      }
      case 'wait': {
        const days = data.days === 'layup' ? Infinity : Number(data.days);
        if (this.act((g) => waitInPort(g, id, days))) {
          this.dest = null;
          this.afterDecision();
        }
        break;
      }
      case 'stop-wait':
        this.act((g) => ({ ...g, fleet: g.fleet.map((s) => (s.id === id ? { ...s, waitUntil: undefined } : s)) }));
        this.pause('decision');
        break;
      case 'contract-sort':
        this.contractSort = this.contractSort === 'pay' ? 'dest' : 'pay';
        try { localStorage.setItem(SORT_KEY, this.contractSort); } catch { /* not saved, still works */ }
        this.renderPanel();
        return;
      case 'mute':
        sound.setEnabled(!sound.enabled);
        this.renderMute();
        return;
      case 'close-report':
        $('#modal').hidden = true;
        if (this.g.reports.length) { this.showNextReport(); return; }
        break;
      case 'new-game':
        if (!this.g.gameOver && !confirm('Start a new game? Your current company will be lost.')) return;
        clearSave();
        this.g = newGame();
        this.activeId = this.g.fleet[0].id;
        this.dest = null;
        this.marketPort = null;
        this.tab = 'contracts';
        $('#modal').hidden = true;
        saveGame(this.g);
        this.pause('decision');
        break;
    }
    this.render();
  }

  private selectShip(id: number, tab?: Tab): void {
    if (id !== this.activeId) {
      this.activeId = id;
      this.dest = null;
      this.marketPort = null;
    }
    if (tab) this.tab = tab;
    this.render();
  }

  private selectDest(portId: string): void {
    const ship = this.ship();
    if (!isReady(this.g, ship)) return;
    this.dest = portId === ship.location ? null : portId;
    this.tab = 'voyage';
    this.render();
  }

  private sail(): void {
    if (!this.dest) return;
    const ship = this.ship();
    if (!this.act((g) => sail(g, ship.id, this.dest!))) { this.render(); return; }
    sound.play('horn');
    this.dest = null;
    this.tab = 'voyage';
    this.afterDecision();
    this.render();
  }

  // ------------------------------------------------------------ rendering

  private render(): void {
    this.renderLive();
    this.renderPanel();
    this.renderPorts();
    this.renderRoutes();
    this.renderTime();
    if (this.g.gameOver) this.showGameOver();
  }

  /** The parts that change every tick: date, money, fleet strip, ships on the map. */
  private renderLive(): void {
    this.renderHeader();
    if (!this.pointerDown) this.renderFleet();
    this.renderShips();
    this.renderScenery();
  }

  /** Day and night, waves and weather. Cosmetic: the light circles the globe every 90 s of running time. */
  private renderScenery(): void {
    const t = REDUCED_MOTION ? 0 : this.sceneTime;
    const doy = this.g.day % 365;
    const declination = 23.44 * Math.sin((2 * Math.PI * (doy - 80)) / 365);
    const sunLon = ((((-t * 4) + 30) % 360) + 540) % 360 - 180;
    this.map.setSun([sunLon, declination]);
    this.map.setWaves(t);
    const day = this.g.day;
    this.storms = this.storms.filter((s) => s.until > day && s.from <= day + 0.001);
    const cells: WeatherCell[] = AMBIENT_CLOUDS.map((c, i) => ({
      id: `cloud-${i}`,
      kind: 'cloud',
      at: [((((c.lon + t * 0.6) % 360) + 540) % 360) - 180, c.lat + Math.sin(t / 40 + i) * 3] as LonLat,
      scale: 1 + (i % 3) * 0.35,
      opacity: 0.55,
      seed: c.seed,
    }));
    for (const st of this.storms) {
      const life = (day - st.from) / (st.until - st.from);
      cells.push({ id: st.id, kind: 'storm', at: st.at, scale: 1.3, opacity: life < 0.1 ? life * 10 : life > 0.7 ? (1 - life) / 0.3 : 1, seed: st.seed });
    }
    this.map.updateWeather(cells);
  }

  private renderTime(): void {
    const btn = $('#play');
    btn.textContent = this.paused ? '▶' : '❚❚';
    btn.title = this.paused ? 'Run the clock (space)' : 'Pause (space)';
    btn.classList.toggle('paused', this.paused);
    document.querySelectorAll<HTMLElement>('[data-action=speed]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === this.speed);
    });
    const waiting = shipsNeedingDecision(this.g);
    const state = !this.paused
      ? `${this.speed} day${this.speed > 1 ? 's' : ''} per second`
      : waiting.length
        ? `Waiting for your orders: ${waiting.map((s) => s.name).join(', ')}`
        : this.pausedBy === 'arrival' ? 'Paused for an arrival' : 'Paused';
    $('#clock-state').textContent = state;
    $('.time-ctl').dataset.state = state; // shown beside the buttons on phones
  }

  private renderHeader(): void {
    const g = this.g;
    $('#date').textContent = gameDate(g.day);
    this.animateCash(g.cash);
    const worth = netWorth(g, world);
    const next = nextMilestone(g);
    const prev = [...g.milestones].sort((a, b) => b.amount - a.amount)[0]?.amount ?? 0;
    const progress = next ? Math.max(0, Math.min(1, (worth - prev) / (next - prev))) : 1;
    $('#goal-bar').style.width = `${progress * 100}%`;
    $('#goal-text').textContent = g.cash < 0
      ? `Overdraft · limit ${compactMoney(RULES.overdraftLimit)} · 18%/yr`
      : next
        ? `Worth ${compactMoney(worth)} → ${compactMoney(next)}`
        : `Worth ${compactMoney(worth)} · all goals reached`;
    $('#goal-text').title = 'Net worth: cash + fleet value − loan';
  }

  /** The cash figure counts towards its new value instead of jumping; big changes flash. */
  private animateCash(target: number): void {
    const el = $('#cash');
    el.classList.toggle('negative', target < 0);
    if (this.shownCash === null || REDUCED_MOTION) {
      this.shownCash = target;
      el.textContent = money(target);
      return;
    }
    // Already counting towards (nearly) this value: let the animation run.
    if (this.cashTarget !== null && Math.abs(target - this.cashTarget) < 20_000) {
      this.cashTarget = target;
      return;
    }
    const from = this.shownCash;
    const diff = target - from;
    if (Math.abs(diff) < 1) return;
    // Small daily costs just tick; payments and purchases animate and flash.
    if (Math.abs(diff) < 20_000) {
      this.shownCash = target;
      el.textContent = money(target);
      return;
    }
    this.cashTarget = target;
    el.classList.remove('up', 'down');
    void el.offsetWidth;
    el.classList.add(diff > 0 ? 'up' : 'down');
    const start = performance.now();
    const id = ++this.cashAnim;
    const step = (now: number) => {
      if (id !== this.cashAnim) return;
      const k = Math.min(1, (now - start) / 700);
      const eased = 1 - (1 - k) ** 3;
      // Aim at the latest target, so small changes during the animation are included.
      const end = this.cashTarget ?? target;
      this.shownCash = from + (end - from) * eased;
      el.textContent = money(this.shownCash);
      if (k < 1) requestAnimationFrame(step);
      else { this.shownCash = end; this.cashTarget = null; }
    };
    requestAnimationFrame(step);
  }

  private shipStatus(ship: ShipState): { text: string; state: 'sea' | 'ready' | 'busy'; progress?: number } {
    const g = this.g;
    if (ship.voyage) {
      const left = Math.max(0, ship.voyage.arriveDay - g.day);
      return { text: `→ ${world.ports[ship.voyage.to].name} · ${days(Math.ceil(left * 10) / 10)}`, state: 'sea', progress: voyageProgress(g, ship) };
    }
    if (inDryDock(g, ship)) return { text: `Dry dock, ${world.ports[ship.location].name} · ${days(Math.ceil((ship.busyUntil! - g.day) * 10) / 10)}`, state: 'busy' };
    if (isWaiting(g, ship)) {
      return ship.waitUntil! >= LAID_UP
        ? { text: `Laid up in ${world.ports[ship.location].name}`, state: 'busy' }
        : { text: `Waiting in ${world.ports[ship.location].name} · ${days(Math.ceil((ship.waitUntil! - g.day) * 10) / 10)}`, state: 'busy' };
    }
    return { text: `Needs orders in ${world.ports[ship.location].name}`, state: 'ready' };
  }

  private renderFleet(): void {
    const g = this.g;
    const ship = this.ship();
    const type = typeOf(ship);
    const chips = g.fleet.map((s) => {
      const st = this.shipStatus(s);
      return `<button class="ship-chip ${st.state} ${s.id === ship.id ? 'selected' : ''}" data-action="select-ship" data-id="${s.id}">
        <span class="sc-art">${shipSideView(typeOf(s), 64)}</span>
        <span class="sc-name">${esc(s.name)}${st.state === 'ready' ? '<span class="sc-ready">Orders</span>' : ''}</span>
        <span class="sc-status">${esc(st.text)}</span>
        ${st.progress !== undefined ? `<span class="sc-bar"><span style="width:${(st.progress * 100).toFixed(1)}%"></span></span>` : ''}
      </button>`;
    }).join('');
    const load = cargoTons(ship);
    const fuel = ship.voyage ? ship.voyage.startFuel - (ship.voyage.startFuel - ship.voyage.fuelAtArrival) * voyageProgress(g, ship) : ship.fuel;
    const cond = ship.condition;
    $('#ship-strip').innerHTML = `
      <div class="fleet">${chips}</div>
      <div class="active-ship">
        <div class="ship-name"><strong>${esc(ship.name)}</strong><span>${esc(type.name)} · ${Math.floor(ship.age)} yrs</span></div>
        ${gauge('Fuel', fuel / type.bunkerCapacity, `${Math.round(fuel)} / ${type.bunkerCapacity} t`, 'fuel')}
        ${gauge('Hold', load / type.capacity, `${tons(load)} / ${tons(type.capacity)}`, 'hold')}
        ${gauge('Condition', cond / 100, `${Math.round(cond)}%`, cond < 45 ? 'cond bad' : cond < 65 ? 'cond warn' : 'cond')}
      </div>`;
  }

  private renderShips(): void {
    const g = this.g;
    const docked = new Map<string, number>();
    const markers: ShipMarker[] = g.fleet.map((s) => {
      const st = this.shipStatus(s);
      const type = typeOf(s);
      const look = { family: shipFamily(type), icon: mapIconPath(type) };
      if (s.voyage) {
        const p = voyageProgress(g, s);
        const { at, angle } = this.map.positionAlong(s.voyage.path, p);
        // A wake about 350 nm long, in five points.
        const span = Math.min(p, 350 / s.voyage.distance);
        const wake = span > 0.001 ? [0, 1, 2, 3, 4].map((k) => this.map.positionAlong(s.voyage!.path, p - (span * k) / 4).at) : undefined;
        return { id: s.id, name: `${s.name} (${st.text})`, at, angle, state: 'sea', selected: s.id === this.activeId, wake, ...look };
      }
      // Fan out several ships in the same port.
      const n = docked.get(s.location) ?? 0;
      docked.set(s.location, n + 1);
      const offset: [number, number] = n === 0 ? [0, 0] : [Math.cos(n * 2.1) * 13, Math.sin(n * 2.1) * 13];
      return { id: s.id, name: `${s.name} (${st.text})`, at: this.map.portPosition(s.location), angle: -90, offset, state: st.state, selected: s.id === this.activeId, ...look };
    });
    this.map.updateShips(markers);
  }

  private renderPorts(): void {
    const g = this.g;
    const ship = this.ship();
    const cargoDests = new Set(ship.cargo.map((c) => c.dest));
    const events = activeEvents(g);
    const here = ship.voyage ? null : ship.location;
    const markers: PortMarker[] = world.portList.map((p) => ({
      id: p.id,
      name: p.name,
      fuelPrice: fuelPrice(g, p.id),
      role: p.id === here ? 'here' : p.id === (this.dest ?? ship.voyage?.to) ? 'dest' : cargoDests.has(p.id) ? 'cargo' : 'normal',
      strike: events.some((e) => e.kind === 'strike' && e.port === p.id),
      boom: events.some((e) => e.kind === 'boom' && e.port === p.id),
    }));
    this.map.updatePorts(markers);
    this.map.setClosedCanals(closedCanals(g));
  }

  private renderRoutes(): void {
    const ship = this.ship();
    if (ship.voyage) {
      this.map.showRoutes(ship.voyage.path);
      return;
    }
    const here = ship.location;
    const primary = this.dest ? routeFor(world, this.g, here, this.dest)?.path ?? null : null;
    const hover = this.hoverDest && this.hoverDest !== this.dest && this.hoverDest !== here
      ? routeFor(world, this.g, here, this.hoverDest)?.path : null;
    this.map.showRoutes(primary, hover ? [hover] : []);
  }

  private renderPanel(): void {
    if (this.pointerDown) { this.panelDirty = true; return; }
    this.panelDirty = false;
    this.lastPanel = performance.now();
    const g = this.g;
    const ship = this.ship();
    this.renderedDay = Math.floor(g.day);
    const loadable = isReady(g, ship) ? g.ports[ship.location].board.filter((c) => canCarry(ship, c) === null).length : 0;
    const tabs: [Tab, string, string?][] = [
      ['contracts', 'Cargo', loadable ? String(loadable) : undefined],
      ['voyage', 'Voyage'],
      ['ship', 'Ship'],
      ['market', 'Market'],
      ['log', 'Log'],
    ];
    $('#tabs').innerHTML = tabs.map(([id, label, badge]) =>
      `<button class="tab ${this.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${this.tab === id}">
        ${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`).join('');
    const body = $('#panel-body');
    // Keep the scroll position and any opened details across redraws.
    const scroll = body.scrollTop;
    const open = new Set([...body.querySelectorAll<HTMLDetailsElement>('details[open][data-key]')].map((d) => d.dataset.key));
    body.innerHTML = {
      contracts: () => this.contractsTab(), voyage: () => this.voyageTab(), ship: () => this.shipTab(),
      market: () => this.marketTab(), log: () => this.logTab(),
    }[this.tab]();
    body.querySelectorAll<HTMLDetailsElement>('details[data-key]').forEach((d) => { if (open.has(d.dataset.key)) d.open = true; });
    if (this.renderedTab !== this.tab || this.renderedShip !== ship.id) {
      body.scrollTop = 0;
      this.renderedTab = this.tab;
      this.renderedShip = ship.id;
    } else {
      body.scrollTop = scroll;
    }
    this.renderPorts();
    this.renderRoutes();
  }

  /** Shown in the Cargo and Voyage tabs while the selected ship can't take orders. */
  private busyCard(): string {
    const g = this.g;
    const ship = this.ship();
    const v = ship.voyage;
    if (v) {
      const p = voyageProgress(g, ship);
      const passed = v.events.filter((e) => e.atDay <= g.day);
      const due = ship.cargo.filter((c) => c.dest === v.to);
      return `<section class="card plan underway">
        <h3>${esc(ship.name)} → ${esc(world.ports[v.to].name)}</h3>
        <div class="voy-bar"><span style="width:${(p * 100).toFixed(1)}%"></span></div>
        <div class="plan-facts">
          <div><strong>${esc(world.ports[v.from].name)}</strong><span>from</span></div>
          <div><strong>${v.distance.toLocaleString('en-US')}</strong><span>nm</span></div>
          <div><strong>${Math.round(p * 100)}%</strong><span>done</span></div>
          <div><strong>${gameDate(v.arriveDay)}</strong><span>ready</span></div>
        </div>
        ${passed.length ? `<ul class="events">${passed.map((e) => `<li class="${e.kind}"><span>Day ${e.day}</span> ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="calm">All quiet so far.</p>'}
        ${due.length ? `<p class="hint">Delivering ${due.length} lot${due.length > 1 ? 's' : ''} worth ${compactMoney(due.reduce((s, c) => s + c.pay, 0))} on arrival.</p>` : '<p class="hint">Sailing in ballast.</p>'}
        <p class="hint">You'll get its orders back when it arrives. Meanwhile, pick another ship below.</p>
      </section>`;
    }
    return `<section class="card plan underway">
      <h3>${esc(ship.name)} is in dry dock</h3>
      <p>In ${esc(world.ports[ship.location].name)}, ready on ${gameDate(ship.busyUntil!)}.</p>
    </section>`;
  }

  private contractRow(c: Contract, mode: 'board' | 'hold'): string {
    const g = this.g;
    const ship = this.ship();
    const good = world.goods[c.good];
    const daysLeft = c.deadline - g.day;
    const nm = routeFor(world, g, c.origin, c.dest)?.nm ?? world.distance(c.origin, c.dest);
    const why = mode === 'board' ? canCarry(ship, c) : null;
    const plan = mode === 'board' ? planVoyage(g, ship.id, c.dest) : null;
    const reach = plan && !plan.inRange ? '<span class="tag warn">needs refuel stop</span>' : '';
    const urgent = daysLeft < (nm / (effectiveSpeed(typeOf(ship), ship) * 24)) + 1.5;
    const button = mode === 'board'
      ? `<button class="btn small" data-action="accept" data-id="${c.id}" ${why ? 'disabled' : ''} title="${esc(why ?? 'Load this cargo')}">Load</button>`
      : c.origin === ship.location && isReady(g, ship)
        ? `<button class="btn small ghost" data-action="unload" data-id="${c.id}">Unload</button>` : '';
    return `
      <li class="contract ${why ? 'unavailable' : ''}" data-hover-dest="${c.dest}">
        <div class="c-main">
          <div class="c-good"><span class="cls ${good.cargoClass}">${good.cargoClass}</span> ${esc(good.name)} · ${tons(c.tons)}</div>
          <div class="c-route">→ <strong>${esc(world.ports[c.dest].name)}</strong> · ${nm.toLocaleString('en-US')} nm ${reach}</div>
          <div class="c-meta ${urgent ? 'urgent' : ''}">Due ${gameDate(c.deadline)} (${days(Math.max(0, Math.round(daysLeft)))})${why ? ` · <span class="why">${esc(why)}</span>` : ''}</div>
        </div>
        <div class="c-side">
          <div class="c-pay">${compactMoney(c.pay)}</div>
          <div class="c-rate">${money(c.pay / c.tons)}/t</div>
          ${button}
        </div>
      </li>`;
  }

  private contractsTab(): string {
    const g = this.g;
    const ship = this.ship();
    const hold = ship.cargo.length ? `<h3>In the hold</h3><ul class="contracts">${ship.cargo.map((c) => this.contractRow(c, 'hold')).join('')}</ul>` : '';
    if (!isReady(g, ship)) return this.busyCard() + hold;
    const port = world.ports[ship.location];
    // Cargo this ship can take first, then the rest; each group in the chosen order.
    const order = CONTRACT_SORTS[this.contractSort].compare;
    const board = [...g.ports[port.id].board].sort((a, b) =>
      Number(canCarry(ship, a) !== null) - Number(canCarry(ship, b) !== null) || order(a, b) || b.pay - a.pay);
    const sortPick = `<div class="sort-row">Sorted by <button class="btn small" data-action="contract-sort"
      title="Switch the order">${CONTRACT_SORTS[this.contractSort].label} ⇅</button></div>`;
    const free = typeOf(ship).capacity - cargoTons(ship);
    return `
      <header class="port-head">
        <div><h2>${esc(port.name)}</h2><span class="sub">${esc(ship.name)} · port fee ${money(portFee(g, ship, port.id))} · fuel ${money(fuelPrice(g, port.id))}/t</span></div>
      </header>
      ${this.waitControls()}
      <p class="hint">Free hold space: <strong>${tons(free)}</strong>. New offers appear as days pass. Hover a contract to see its route.</p>
      ${this.priceHints(port.id)}
      ${board.length > 1 ? sortPick : ''}
      ${board.length ? `<ul class="contracts">${board.map((c) => this.contractRow(c, 'board')).join('')}</ul>`
        : '<p class="empty">No cargo on offer right now. Let some time pass, or sail on.</p>'}
      ${hold}
      ${this.nextStepBar()}`;
  }

  /** The two kinds of order a ship in port can get: cast off (Voyage tab), or wait here. */
  private waitControls(): string {
    const g = this.g;
    const ship = this.ship();
    if (isWaiting(g, ship)) {
      const until = ship.waitUntil! >= LAID_UP ? 'laid up until further notice' : `waiting until ${gameDate(ship.waitUntil!)}`;
      return `<div class="wait-bar waiting"><span>The ${esc(ship.name)} is ${until}. You can still load it and cast off any time.</span>
        <button class="btn small" data-action="stop-wait">Stop waiting</button></div>`;
    }
    if (!needsDecision(g, ship)) return '';
    return `<div class="wait-bar">
      <span><strong>${esc(ship.name)} needs orders.</strong> Cast off from the Voyage tab, or wait here:</span>
      <span class="btn-row">
        <button class="btn small" data-action="wait" data-days="1" title="New offers may appear; prices move">1 day</button>
        <button class="btn small" data-action="wait" data-days="5">5 days</button>
        <button class="btn small ghost" data-action="wait" data-days="layup" title="Park the ship until you give it new orders. Upkeep still runs.">Lay up</button>
      </span>
    </div>`;
  }

  /** Sticky bar under the contracts: one tap from loading cargo to planning the voyage. */
  private nextStepBar(): string {
    const ship = this.ship();
    if (ship.cargo.length === 0) return '';
    const byDest = new Map<string, { lots: number; pay: number }>();
    for (const c of ship.cargo) {
      const d = byDest.get(c.dest) ?? { lots: 0, pay: 0 };
      d.lots++;
      d.pay += c.pay;
      byDest.set(c.dest, d);
    }
    const buttons = [...byDest].sort((a, b) => b[1].pay - a[1].pay).map(([id, d]) =>
      `<button class="btn primary" data-action="dest" data-id="${id}" data-hover-dest="${id}">Plan voyage → ${esc(world.ports[id].name)}<span>${d.lots} lot${d.lots > 1 ? 's' : ''} · ${compactMoney(d.pay)}</span></button>`).join('');
    return `<div class="next-step">${buttons}</div>`;
  }

  private shipTab(): string {
    const g = this.g;
    const ship = this.ship();
    const type = typeOf(ship);
    const ready = isReady(g, ship);
    const here = ship.location;
    const price = fuelPrice(g, here);
    const space = Math.floor(type.bunkerCapacity - ship.fuel);
    const cheapest = world.portList.map((p) => ({ p, price: fuelPrice(g, p.id) })).sort((a, b) => a.price - b.price);
    const rank = cheapest.findIndex((x) => x.p.id === here) + 1;
    const plan = this.dest && ready ? planVoyage(g, ship.id, this.dest) : null;
    const q10 = repairQuote(ship, 10);
    const qFull = repairQuote(ship, 100);
    const speed = effectiveSpeed(type, ship);
    const burn = type.fuelPerDay * consumptionFactor(ship);
    const range = Math.round((ship.fuel / burn) * speed * 24);
    const limit = maxLoan(g, world);
    const room = Math.max(0, limit - g.loan);
    const yearly = Math.round(g.loan * SHIP_TUNING.loanDailyRate * 365);
    const sale = saleQuote(g, ship.id);
    const fuelBtn = (amount: number | 'fill', label: string) => {
      const n = amount === 'fill' ? space : Math.min(amount, space);
      return `<button class="btn small" data-action="fuel" data-amount="${amount}" ${n <= 0 || !ready ? 'disabled' : ''}>${label}<span>${money(n * price)}</span></button>`;
    };
    return `
      ${this.oilCard()}
      <section class="card">
        <h3>Bunkers · ${esc(ship.name)}</h3>
        ${ready ? `<div class="kv"><span>Price here</span><strong>${money(price)}/t</strong><em>${rank === 1 ? 'cheapest in the world' : `#${rank} of ${cheapest.length}`}</em></div>` : `<p class="hint">${atSea(ship) ? 'At sea: bunker on arrival.' : 'In dry dock.'}</p>`}
        <div class="kv"><span>Aboard</span><strong>${Math.round(ship.fuel)} / ${type.bunkerCapacity} t</strong><em>range ≈ ${range.toLocaleString('en-US')} nm</em></div>
        <div class="kv"><span>Burn</span><strong>${burn.toFixed(1)} t/day</strong><em>at ${speed.toFixed(1)} kn, more when worn or old</em></div>
        <div class="btn-row">${fuelBtn(25, '+25 t')}${fuelBtn(50, '+50 t')}${fuelBtn(100, '+100 t')}${fuelBtn('fill', 'Fill up')}</div>
        ${plan && plan.inRange ? `<button class="btn wide" data-action="fuel-for-leg" ${ship.fuel >= Math.ceil(plan.fuelNeeded * 1.15) ? 'disabled' : ''}>Top up for ${esc(world.ports[plan.dest].name)} (+15% reserve)</button>` : ''}
        <p class="hint">Cheapest bunkers right now: ${cheapest.slice(0, 3).map((x) => `${esc(x.p.name)} ${money(x.price)}`).join(' · ')}</p>
      </section>
      <section class="card">
        <h3>Dry dock</h3>
        <div class="kv"><span>Condition</span><strong>${Math.round(ship.condition)}%</strong><em>low condition → more breakdowns, higher fuel burn</em></div>
        <div class="btn-row">
          <button class="btn small" data-action="repair" data-points="10" ${q10.points && ready ? '' : 'disabled'}>Repair +${q10.points}%<span>${money(q10.cost)} · ${days(q10.days)}</span></button>
          <button class="btn small" data-action="repair" data-points="100" ${qFull.points && ready ? '' : 'disabled'}>Full overhaul<span>${money(qFull.cost)} · ${days(qFull.days)}</span></button>
        </div>
        <p class="hint">The ship can't sail while it's in dock; upkeep runs as usual.</p>
      </section>
      <section class="card">
        <h3>The ${esc(ship.name)}</h3>
        <div class="o-art">${shipSideView(type, 260)}</div>
        <div class="kv"><span>Class</span><strong>${esc(type.name)}</strong><em>${Math.floor(ship.age)} years old</em></div>
        <div class="kv"><span>Capacity</span><strong>${tons(type.capacity)}</strong><em>${type.cargoClasses.join(' & ')} cargo</em></div>
        <div class="kv"><span>Speed</span><strong>${speed.toFixed(1)} kn</strong><em>${Math.round(speed * 24)} nm/day</em></div>
        <div class="kv"><span>Upkeep</span><strong>${money(type.dailyCost)}/day</strong><em>crew, insurance, stores</em></div>
        <div class="kv"><span>Value</span><strong>${money(stateValue(ship, world))}</strong><em>a broker pays ${money(saleValue(ship, world))}</em></div>
        <button class="btn ghost wide" data-action="sell-ship" ${sale.blocked ? 'disabled' : ''} title="${esc(sale.blocked ?? '')}">Sell the ${esc(ship.name)}${sale.blocked ? `<span>${esc(sale.blocked)}</span>` : `<span>${money(sale.price + sale.fuelRefund)}</span>`}</button>
      </section>
      <section class="card">
        <h3>Bank · whole company</h3>
        <div class="kv"><span>Loan</span><strong>${money(g.loan)}</strong><em>${g.loan ? `8% a year ≈ ${money(yearly)}/yr` : 'no loan'}</em></div>
        <div class="kv"><span>Limit</span><strong>${money(limit)}</strong><em>${Math.round(SHIP_TUNING.loanToValue * 100)}% of your fleet's value (${compactMoney(fleetValue(g, world))})</em></div>
        <div class="kv"><span>Upkeep</span><strong>${money(dailyUpkeep(g))}/day</strong><em>all ships, at sea or in port</em></div>
        <div class="btn-row">
          <button class="btn small" data-action="borrow" data-amount="100000" ${room >= 1000 ? '' : 'disabled'}>Borrow<span>${money(Math.min(100_000, room))}</span></button>
          <button class="btn small" data-action="borrow" data-amount="max" ${room >= 1000 ? '' : 'disabled'}>Borrow max<span>${money(room)}</span></button>
          <button class="btn small" data-action="repay" data-amount="100000" ${g.loan > 0 && g.cash > 0 ? '' : 'disabled'}>Repay<span>${money(Math.min(100_000, g.loan, Math.max(0, g.cash)))}</span></button>
          <button class="btn small" data-action="repay" data-amount="all" ${g.loan > 0 && g.cash > 0 ? '' : 'disabled'}>Repay all<span>${money(Math.min(g.loan, Math.max(0, g.cash)))}</span></button>
        </div>
        <p class="hint">If you run short of cash, the bank automatically extends this loan up to the limit. Beyond that there's an overdraft of up to ${money(RULES.overdraftLimit)} at 18% a year.</p>
      </section>`;
  }

  /** What a port pays well for right now, and what it has had too much of. */
  private priceHints(portId: string): string {
    const port = world.ports[portId];
    const levels = port.demands.map((d) => ({ good: world.goods[d.good].name.toLowerCase(), level: priceLevel(this.g, port.id, d.good) }));
    const fmt = (l: { good: string; level: number }) => `${esc(l.good)} ${l.level > 1 ? '+' : '−'}${Math.round(Math.abs(l.level - 1) * 100)}%`;
    const high = levels.filter((l) => l.level >= 1.08).sort((a, b) => b.level - a.level);
    const low = levels.filter((l) => l.level <= 0.92).sort((a, b) => a.level - b.level);
    if (!high.length && !low.length) return '';
    return `<p class="price-hints">
      ${high.length ? `<span class="up">▲ ${port.name} pays well for ${high.map(fmt).join(', ')}</span>` : ''}
      ${low.length ? `<span class="down">▼ Oversupplied: ${low.map(fmt).join(', ')}</span>` : ''}
    </p>`;
  }

  /** Active world events. */
  private newsCard(): string {
    const active = activeEvents(this.g);
    if (!active.length) return '';
    return `<section class="card news">
      <h3>World news</h3>
      <ul>${active.map((e) => `<li><span class="n-kind ${e.kind}">${{ strike: 'Strike', harvest: 'Harvest', boom: 'Boom', canal: 'Canal', oilShock: 'Oil' }[e.kind]}</span>
        <span>${esc(e.headline)} <em>Until about ${gameDate(e.endDay)}.</em></span></li>`).join('')}</ul>
    </section>`;
  }

  /** The world oil price index with a one-year sparkline. */
  private oilCard(): string {
    const g = this.g;
    const h = [...g.oil.history.slice(-52)];
    const now = g.oil.index;
    const pct = Math.round((now - 1) * 100);
    const monthAgo = h.length > 4 ? h[h.length - 5] : h[0];
    const trend = now - monthAgo;
    const arrow = Math.abs(trend) < 0.02 ? '→ steady' : trend > 0 ? '↑ rising' : '↓ falling';
    return `<section class="card">
      <h3>Oil price</h3>
      <div class="oil-head"><strong>${(now * 100).toFixed(0)}</strong><span>index (100 = normal) · ${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% · ${arrow} over the last month</span></div>
      ${sparkline(h, now)}
      <p class="hint">Every port's bunker price follows this index. Fill up when it's low.</p>
    </section>`;
  }

  private marketTab(): string {
    const g = this.g;
    const ship = this.ship();
    const portId = this.marketPort ?? ship.location;
    const port = world.ports[portId];
    const offers = g.ports[portId].market;
    const yards = world.portList.filter((p) => p.shipyard).map((p) => p.name).join(', ');
    const ships = (pid: string) => g.fleet.filter((s) => !s.voyage && s.location === pid).length;
    const options = world.portList.map((p) => `<option value="${p.id}" ${p.id === portId ? 'selected' : ''}>${esc(p.name)}${p.shipyard ? ' (shipyard)' : ''}${ships(p.id) ? ` · ${ships(p.id)} of your ships` : ''}</option>`).join('');
    return `
      <header class="port-head">
        <div><h2>Ships for sale</h2><span class="sub">${port.shipyard ? 'Shipyard: new ships of every class, plus used ones' : `Second-hand market. New ships are built in ${esc(yards)}`}</span></div>
      </header>
      <label class="port-pick">Market in <select data-action="market-port">${options}</select></label>
      <p class="hint">A ship you buy joins your fleet in ${esc(port.name)}, with a little fuel aboard. Markets turn over every few weeks. Compared with the ${esc(ship.name)} (selected below the map).</p>
      ${this.yourShipCard()}
      <ul class="offers">${offers.map((o) => this.offerCard(portId, o)).join('')}</ul>`;
  }

  /** The selected ship in the same layout as the offers, as the baseline for comparing. */
  private yourShipCard(): string {
    const ship = this.ship();
    const type = typeOf(ship);
    return `
      <section class="offer mine">
        <div class="o-head">
          <div><span class="mine-label">Your ship</span> <strong>${esc(type.name)}</strong> <span class="sub">${esc(ship.name)}</span></div>
          <div class="o-price">${compactMoney(saleValue(ship, world))}<span class="o-price-note">sale value</span></div>
        </div>
        <div class="o-art">${shipSideView(type, 220)}</div>
        <div class="o-tags">
          <span class="tag">${Math.floor(ship.age)} years old</span>
          <span class="tag ${ship.condition < 50 ? 'warn' : ''}">condition ${Math.round(ship.condition)}%</span>
          <span class="tag">${type.cargoClasses.join(' & ')}</span>
        </div>
        ${statBoxes(shipSpec(type, ship))}
      </section>`;
  }

  private offerCard(portId: string, offer: ShipOffer): string {
    const g = this.g;
    const ship = this.ship();
    const cur = typeOf(ship);
    const type = world.shipTypes[offer.typeId];
    const q = quotePurchase(g, offer, world);
    const a = shipSpec(cur, ship);
    const b = shipSpec(type, offer);
    const gained = type.cargoClasses.filter((c) => !cur.cargoClasses.includes(c));
    const lost = cur.cargoClasses.filter((c) => !type.cargoClasses.includes(c));
    const afterCash = g.cash - q.fromCash;
    const running = Math.round(type.bunkerCapacity * fuelPrice(g, portId) + type.dailyCost * 30);
    const tight = !q.blocked && afterCash < running;
    const line = (label: string, v: number, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${money(v, true)}</span></div>`;
    return `
      <li class="offer">
        <div class="o-head">
          <div><strong>${esc(type.name)}</strong> <span class="sub">${esc(offer.name)}</span></div>
          <div class="o-price">${compactMoney(offer.price)}</div>
        </div>
        <div class="o-art">${shipSideView(type, 220)}</div>
        <div class="o-tags">
          <span class="tag ${offer.age === 0 ? 'good' : ''}">${offer.age === 0 ? 'New' : `${offer.age} years old`}</span>
          <span class="tag ${offer.condition < 50 ? 'warn' : ''}">condition ${offer.condition}%</span>
          <span class="tag">${type.cargoClasses.join(' & ')}</span>
          ${gained.map((c) => `<span class="tag good">+ ${c}</span>`).join('')}
          ${lost.map((c) => `<span class="tag bad">no ${c}</span>`).join('')}
        </div>
        <p class="o-desc">${esc(type.description)}</p>
        ${statBoxes(b, a)}
        <details class="o-deal" data-key="deal-${offer.id}">
          <summary>${q.blocked ? 'Can’t buy yet' : q.borrow > 0 ? `Buy with a ${compactMoney(q.borrow)} loan` : 'Buy outright'} · details</summary>
          <div class="ledger">
            ${line('Price', -offer.price)}
            ${q.borrow > 0 ? line('New bank loan', q.borrow) : ''}
            <div class="line total"><span>Cash after the deal</span><span>${money(afterCash)}</span></div>
            <div class="line per-day"><span>Loan after the deal</span><span>${money(q.loanAfter)} of ${money(q.loanLimit)} limit</span></div>
            <div class="line per-day"><span>Fleet upkeep after the deal</span><span>${money(dailyUpkeep(g) + type.dailyCost)}/day</span></div>
          </div>
        </details>
        ${q.blocked ? `<p class="o-warn bad">${esc(q.blocked)}</p>` : ''}
        ${tight ? `<p class="o-warn">You'd keep ${money(afterCash)}, but a full tank and a month's upkeep for this ship cost about ${money(running)}.</p>` : ''}
        <button class="btn ${tight ? '' : 'primary'} wide" data-action="buy-ship" data-port="${portId}" data-id="${offer.id}" ${q.blocked ? 'disabled' : ''}>Buy the ${esc(offer.name)}</button>
      </li>`;
  }

  private voyageTab(): string {
    const g = this.g;
    const ship = this.ship();
    if (!isReady(g, ship)) return this.newsCard() + this.busyCard();
    const here = ship.location;
    const rows = world.portList.filter((p) => p.id !== here).map((p) => ({ p, plan: planVoyage(g, ship.id, p.id)! }))
      .sort((a, b) => a.plan.route.nm - b.plan.route.nm);
    const type = typeOf(ship);
    const list = rows.map(({ p, plan }) => {
      const cargo = plan.deliveries.length;
      const exports = exportsFor(world, type, p.id).map((id) => world.goods[id].name.toLowerCase());
      return `<li class="dest ${p.id === this.dest ? 'selected' : ''} ${plan.inRange ? '' : 'out'}" data-action="dest" data-id="${p.id}" data-hover-dest="${p.id}">
        <span class="d-name">${esc(p.name)}${cargo ? ` <span class="tag good">${cargo} to deliver</span>` : ''}</span>
        <span class="d-meta">${plan.route.nm.toLocaleString('en-US')} nm · ${days(Math.round(plan.seaDays * 10) / 10)} · ${plan.inRange ? `${plan.fuelNeeded} t` : 'out of range'}</span>
        <span class="d-exports ${exports.length ? '' : 'none'}">${exports.length ? `Exports for you: ${esc(exports.join(', '))}` : 'Exports nothing this ship can carry'}</span>
      </li>`;
    }).join('');
    return `
      ${this.newsCard()}
      ${this.waitControls()}
      ${this.dest ? this.planCard(planVoyage(g, ship.id, this.dest)!) : `<p class="hint">Where should the ${esc(ship.name)} go? Pick a destination below or tap a port on the map.</p>`}
      <p class="hint">"Exports for you" lists what each port ships that your ${esc(type.name.toLowerCase())} can carry.</p>
      <ul class="dests">${list}</ul>`;
  }

  private planCard(plan: VoyagePlan): string {
    const g = this.g;
    const ship = this.ship();
    const name = world.ports[plan.dest].name;
    const price = fuelPrice(g, ship.location);
    const fuelValue = plan.fuelNeeded * price;
    const reserve = ship.fuel - plan.fuelNeeded;
    const undelivered = ship.cargo.filter((c) => c.dest !== plan.dest);
    const type = typeOf(ship);
    const warnings: string[] = [];
    if (!plan.inRange) warnings.push(`Beyond this ship's range (${plan.fuelNeeded} t needed, bunkers hold ${type.bunkerCapacity} t). Plan a stop on the way.`);
    if (plan.strike) warnings.push(`Dock strike in ${name}: ${plan.strikeDays} extra days in port and double fees (included above).`);
    const normal = world.route(ship.location, plan.dest);
    if (normal && normal.nm < plan.route.nm - 50) {
      const closed = closedCanals(g).filter((c) => normal.canals.includes(c)).map((c) => world.canals[c].name).join(' and ');
      warnings.push(`The ${closed} is closed: this route is ${(plan.route.nm - normal.nm).toLocaleString('en-US')} nm longer than usual.`);
    }
    for (const d of plan.deliveries) if (d.late) warnings.push(`${world.goods[d.contract.good].name} will arrive after its deadline.`);
    if (undelivered.length) warnings.push(`${undelivered.length} cargo lot(s) stay aboard for other ports.`);
    if (plan.deliveries.length === 0) warnings.push('Sailing in ballast: no cargo for this port.');
    const line = (label: string, v: number, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${money(v, true)}</span></div>`;

    const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * 1.15));
    const topUp = Math.max(0, target - Math.floor(ship.fuel));
    const short = plan.fuelShort > 0;
    const fuelState = !plan.inRange ? 'bad' : short ? 'bad' : reserve < plan.fuelNeeded * 0.12 ? 'warn' : 'good';
    const fuelText = !plan.inRange ? 'out of range'
      : short ? `short by ${Math.ceil(plan.fuelShort)} t`
        : `reserve ${Math.floor(reserve)} t${fuelState === 'warn' ? ', thin: a storm could leave you adrift' : ''}`;
    const fuelBlock = `
      <div class="fuel-row ${fuelState}">
        <div><span class="lbl">Fuel</span> <strong>${Math.floor(ship.fuel)} t</strong> aboard · leg needs <strong>${plan.fuelNeeded} t</strong> · <em>${fuelText}</em></div>
        ${plan.inRange && !short && topUp > 0 ? `<button class="btn small" data-action="fuel-for-leg">+${topUp} t reserve<span>${money(topUp * price)}</span></button>` : ''}
      </div>`;
    const loss = plan.estimatedNet < 0 ? ` <span>estimate ${money(plan.estimatedNet)}</span>` : '';
    const sailButton = !plan.inRange
      ? `<button class="btn primary wide" disabled>Out of range</button>`
      : short
        ? `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="bunker-sail">Bunker ${topUp} t (${money(topUp * price)}) &amp; cast off${loss}</button>`
        : `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="sail">Cast off for ${esc(name)}${loss}</button>`;
    const total = plan.seaDays + RULES.portDays + plan.strikeDays;
    return `
      <section class="card plan">
        <h3>${esc(ship.name)} to ${esc(name)}</h3>
        <div class="plan-facts">
          <div><strong>${plan.route.nm.toLocaleString('en-US')}</strong><span>nm</span></div>
          <div><strong>${days(Math.round(total * 10) / 10)}</strong><span>incl. port</span></div>
          <div><strong>${plan.fuelNeeded} t</strong><span>fuel</span></div>
          <div><strong>${gameDate(g.day + total)}</strong><span>ready</span></div>
        </div>
        ${plan.route.canals.length ? `<p class="hint">Via the ${plan.route.canals.map((c) => world.canals[c].name).join(' and ')}.</p>` : ''}
        <div class="ledger">
          ${line('Freight revenue', plan.revenue, 'good')}
          ${line('Upkeep', -plan.upkeep)}
          ${line(`Port fee ${name}`, -plan.portFee)}
          ${plan.canalFees ? line('Canal dues', -plan.canalFees) : ''}
          ${line(`Fuel burned (at ${money(price)}/t)`, -fuelValue)}
          <div class="line total ${plan.estimatedNet >= 0 ? 'good' : 'bad'}"><span>Estimated result</span><span>${money(plan.estimatedNet, true)}</span></div>
          <div class="line per-day"><span>per day</span><span>${money(plan.estimatedNet / total, true)}</span></div>
        </div>
        ${fuelBlock}
        ${warnings.length ? `<ul class="warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${sailButton}
      </section>`;
  }

  private logTab(): string {
    const g = this.g;
    const s = g.stats;
    return `
      <div class="stats">
        <div><strong>${g.fleet.length}</strong><span>ships</span></div>
        <div><strong>${s.voyages}</strong><span>voyages</span></div>
        <div><strong>${compactMoney(s.revenue)}</strong><span>revenue</span></div>
        <div><strong>${compactMoney(s.fuelSpent)}</strong><span>fuel bought</span></div>
        <div><strong>${compactMoney(s.upkeepPaid)}</strong><span>upkeep paid</span></div>
        <div><strong>${compactMoney(s.interestPaid)}</strong><span>interest paid</span></div>
      </div>
      <ul class="log">${g.log.map((e) => `
        <li><span class="l-day">${gameDate(e.day)}</span><span class="l-text">${esc(e.text)}</span>
        ${e.amount !== undefined ? `<span class="l-amt ${e.amount >= 0 ? 'good' : 'bad'}">${money(e.amount, true)}</span>` : ''}</li>`).join('')}
      </ul>
      <button class="btn ghost wide" data-action="new-game">New game</button>
      <p class="build-info">Build ${esc(BUILD.number)} · ${esc(BUILD.sha)} · built ${esc(new Date(BUILD.time).toLocaleString())}</p>`;
  }

  // ------------------------------------------------------------ modals

  private showNextReport(): void {
    const { state, report } = takeReport(this.g);
    if (!report) return;
    this.g = state;
    saveGame(this.g);
    if (this.g.fleet.some((s) => s.id === report.shipId)) {
      this.activeId = report.shipId;
      this.dest = null;
      this.marketPort = null;
      this.tab = 'contracts';
    }
    sound.play('bell');
    if (report.revenue > 0) {
      this.map.flashAt(this.map.portPosition(report.to), money(report.revenue, true), 'good');
      this.map.pulseAt(this.map.portPosition(report.to), 'good');
      setTimeout(() => sound.play('coins'), 500);
    }
    this.render();
    this.showReport(report);
  }

  private showReport(r: VoyageReport): void {
    const line = (label: string, v: number, cls = '') => `<div class="line ${cls}"><span>${esc(label)}</span><span>${money(v, true)}</span></div>`;
    const more = this.g.reports.length;
    $('#modal-body').innerHTML = `
      ${this.g.fleet.some((s) => s.id === r.shipId) ? `<div class="report-art">${shipSideView(typeOf(getShip(this.g, r.shipId)), 240)}</div>` : ''}
      <h2>${esc(r.shipName)} arrived in ${esc(world.ports[r.to].name)}</h2>
      <p class="sub">${r.distance.toLocaleString('en-US')} nm from ${esc(world.ports[r.from].name)} in ${days(Math.round((r.arriveDay - r.departDay) * 10) / 10)} · ${r.fuelUsed} t fuel burned · condition −${r.conditionLoss}%</p>
      ${r.events.length ? `<ul class="events">${r.events.map((e) => `<li class="${e.kind}"><span>Day ${e.day}</span> ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="calm">A calm passage.</p>'}
      ${r.news.length ? `<div class="news-in-report"><h3>News while at sea</h3><ul>${r.news.map((n) => `<li>📰 ${esc(n)}</li>`).join('')}</ul></div>` : ''}
      <div class="ledger">
        ${r.deliveries.map((d) => line(`${world.goods[d.contract.good].name}, ${tons(d.contract.tons)}${d.lateDays > 0 ? ` (late, ${Math.round((d.paid / d.contract.pay) * 100)}% paid)` : ''}`, d.paid, 'good')).join('')}
        ${line('Upkeep on the way (paid daily)', -r.upkeep)}
        ${line('Port fee', -r.portFee)}
        ${r.canalFees ? line('Canal dues', -r.canalFees) : ''}
        ${r.eventCosts ? line('Repairs & emergencies', -r.eventCosts, 'bad') : ''}
        <div class="line total ${r.net >= 0 ? 'good' : 'bad'}"><span>Result for the leg</span><span>${money(r.net, true)}</span></div>
      </div>
      ${r.marketNotes.length ? `<ul class="market-notes">${r.marketNotes.map((n) => `<li>▼ ${esc(n)}</li>`).join('')}</ul>` : ''}
      <div class="line memo"><span>Memo: fuel burned, paid when bunkering</span><span>≈ ${money(r.fuelUsed * fuelPrice(this.g, r.from))}</span></div>
      <button class="btn primary wide" data-action="close-report">${more ? `Next arrival (${more} more)` : `Give the ${esc(r.shipName)} new orders`}</button>`;
    $('#modal').hidden = false;
    ($('#modal-body').querySelector('.btn.primary') as HTMLElement)?.focus();
  }

  /** A short celebration for a new ship. */
  private showNewShip(id: number): void {
    const ship = getShip(this.g, id);
    const type = typeOf(ship);
    const speed = effectiveSpeed(type, ship);
    $('#modal-body').dataset.kind = 'newship';
    $('#modal-body').innerHTML = `
      <div class="new-ship">
        <p class="new-ship-kicker">New ship</p>
        <div class="new-ship-art">${shipSideView(type, 340)}</div>
        <h2>Welcome aboard the ${esc(ship.name)}</h2>
        <p class="sub">${esc(type.name)} · ${ship.age === 0 ? 'brand new' : `${Math.floor(ship.age)} years old`} · in ${esc(world.ports[ship.location].name)}</p>
        <div class="plan-facts">
          <div><strong>${tons(type.capacity)}</strong><span>hold</span></div>
          <div><strong>${speed.toFixed(1)} kn</strong><span>speed</span></div>
          <div><strong>${type.cargoClasses.join(' & ')}</strong><span>carries</span></div>
          <div><strong>${this.g.fleet.length}</strong><span>ships now</span></div>
        </div>
        <p class="hint">It has a little fuel aboard. Bunker up and find it some cargo.</p>
        <button class="btn primary wide" data-action="close-report">Give it orders</button>
      </div>`;
    $('#modal').hidden = false;
  }

  private renderMute(): void {
    const b = $('#mute');
    b.textContent = sound.enabled ? '🔊' : '🔇';
    b.title = sound.enabled ? 'Sound on: tap to mute' : 'Sound off: tap to unmute';
    b.setAttribute('aria-pressed', String(!sound.enabled));
  }

  private showGameOver(): void {
    if (!$('#modal').hidden && $('#modal-body').dataset.kind === 'gameover') return;
    this.paused = true;
    $('#modal-body').dataset.kind = 'gameover';
    $('#modal-body').innerHTML = `
      <h2>Game over</h2>
      <p>${esc(this.g.gameOver!)}</p>
      <p class="sub">You lasted until ${gameDate(this.g.day)}, owned ${this.g.stats.shipsOwned} ship${this.g.stats.shipsOwned > 1 ? 's' : ''} and completed ${this.g.stats.voyages} voyages.</p>
      <button class="btn primary wide" data-action="new-game">Start again</button>`;
    $('#modal').hidden = false;
  }

  private toast(text: string, kind: 'good' | 'bad'): void {
    toast(text, kind);
  }
}


function toast(text: string, kind: 'good' | 'bad' | 'info', ms = 3200): void {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/**
 * A one-series sparkline (no legend needed): 2px line, a recessive "normal"
 * baseline at 100, and a hover readout per weekly sample.
 */
function sparkline(history: number[], now: number): string {
  const pts = [...history, now];
  const W = 300;
  const H = 64;
  const pad = 4;
  const lo = Math.min(0.8, ...pts) - 0.05;
  const hi = Math.max(1.2, ...pts) + 0.05;
  const x = (i: number) => pad + (i / Math.max(1, pts.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const step = (W - pad * 2) / Math.max(1, pts.length - 1);
  const hits = pts.map((v, i) => {
    const weeks = pts.length - 1 - i;
    const label = weeks === 0 ? 'Now' : `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    return `<rect x="${(x(i) - step / 2).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${H}" class="spark-hit"><title>${label}: ${(v * 100).toFixed(0)}</title></rect>`;
  }).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Oil price index over the last year, now ${(now * 100).toFixed(0)}">
    <line x1="${pad}" x2="${W - pad}" y1="${y(1).toFixed(1)}" y2="${y(1).toFixed(1)}" class="spark-base"/>
    <text x="${W - pad}" y="${(y(1) - 4).toFixed(1)}" class="spark-label" text-anchor="end">normal</text>
    <path d="${line}" class="spark-line"/>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(now).toFixed(1)}" r="4" class="spark-dot"/>
    ${hits}
  </svg>`;
}

interface ShipSpec { cap: number; speed: number; burn: number; upkeep: number; range: number }

/** A ship's effective numbers, after age and wear. */
function shipSpec(t: ShipTypeDef, ship: { age: number; condition: number }): ShipSpec {
  const speed = effectiveSpeed(t, ship);
  const burn = t.fuelPerDay * consumptionFactor(ship);
  return { cap: t.capacity, speed, burn, upkeep: t.dailyCost, range: (t.bunkerCapacity / burn) * speed * 24 };
}

/**
 * The five stat boxes. With `base` (your ship), each box also shows the
 * difference: green when it's an improvement, red when it's worse.
 */
function statBoxes(s: ShipSpec, base?: ShipSpec): string {
  const sign = (d: number) => (d > 0 ? '+' : '−');
  const kTons = (n: number) => (Math.abs(n) >= 10_000 ? `${(Math.abs(n) / 1000).toFixed(Math.abs(n) % 1000 ? 1 : 0)}k t` : tons(Math.abs(n)));
  const rows: { label: string; val: string; key: keyof ShipSpec; higherIsBetter: boolean; diff: (d: number) => string }[] = [
    { label: 'Hold', key: 'cap', val: kTons(s.cap), higherIsBetter: true, diff: (d) => `${sign(d)}${kTons(d)}` },
    { label: 'Speed', key: 'speed', val: `${s.speed.toFixed(1)} kn`, higherIsBetter: true, diff: (d) => `${sign(d)}${Math.abs(d).toFixed(1)} kn` },
    { label: 'Burn', key: 'burn', val: `${s.burn.toFixed(s.burn < 10 ? 1 : 0)} t/day`, higherIsBetter: false,
      diff: (d) => `${sign(d)}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)} t` },
    { label: 'Upkeep', key: 'upkeep', val: `$${(s.upkeep / 1000).toFixed(1)}k/d`, higherIsBetter: false,
      diff: (d) => `${sign(d)}$${(Math.abs(d) / 1000).toFixed(1)}k` },
    { label: 'Range', key: 'range', val: `${(s.range / 1000).toFixed(1)}k nm`, higherIsBetter: true,
      diff: (d) => `${sign(d)}${(Math.abs(d) / 1000).toFixed(1)}k nm` },
  ];
  return `<div class="o-stats">${rows.map((r) => {
    if (!base) return `<div><span>${r.label}</span><strong>${r.val}</strong></div>`;
    const d = s[r.key] - base[r.key];
    const same = Math.abs(d) / Math.max(1e-9, Math.abs(base[r.key])) < 0.02;
    const cls = same ? 'same' : (d > 0) === r.higherIsBetter ? 'up' : 'down';
    return `<div><span>${r.label}</span><strong>${r.val}</strong><em class="${cls}">${same ? 'same' : r.diff(d)}</em></div>`;
  }).join('')}</div>`;
}

function gauge(label: string, frac: number, text: string, cls: string): string {
  const f = Math.max(0, Math.min(1, frac));
  return `<div class="gauge ${cls}"><div class="g-head"><span>${label}</span><span>${text}</span></div><div class="g-track"><div class="g-fill" style="width:${f * 100}%"></div></div></div>`;
}

$('#build').textContent = `Build ${BUILD.number}`;
$('#build').title = `Commit ${BUILD.sha}, built ${BUILD.time}`;

// ---------------------------------------------------------------- updates

const reloadBtn = $('#reload');

function markUpdate(latest: number | null): void {
  const available = isNewer(latest);
  reloadBtn.classList.toggle('has-update', available);
  reloadBtn.title = available ? `Build ${latest} is available: tap to update` : 'Check for updates';
}

async function checkForUpdate(): Promise<void> {
  markUpdate(await latestBuild());
}

reloadBtn.addEventListener('click', async () => {
  if (reloadBtn.classList.contains('spinning')) return;
  reloadBtn.classList.add('spinning');
  const outcome = await reloadApp();
  if (outcome === 'updating') {
    toast('Updating…', 'info');
    return; // the page reloads
  }
  reloadBtn.classList.remove('spinning');
  markUpdate(null);
  if (outcome === 'latest') toast(`You're on the latest build (${BUILD.number}).`, 'good');
  else toast(`Couldn't reach the server, so there's no update check right now. You're on build ${BUILD.number}.`, 'bad', 4500);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkForUpdate();
});

initServiceWorker();
new App();
const updatedFrom = consumeUpdatedFrom();
if (updatedFrom) toast(`Updated from build ${updatedFrom} to build ${BUILD.number}.`, 'good', 4500);
void checkForUpdate();
