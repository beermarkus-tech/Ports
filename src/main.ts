import './ui/style.css';
import { activeEvents, closedCanals, priceLevel, routeFor } from './sim/economy';
import { CHART_TUNING, chartOffers, fogFor, isCharted, unchartedShare, wantedGoods } from './sim/charts';
import { bestKnownMarkets, buyPrice, goodsBuyQuote, goodsSaleQuote, hasTrade, priceNews, type PriceNews } from './sim/trade';
import {
  ActionError, LAID_UP, RULES, acceptContract, advance, atSea, borrow, buyFuel, buyShip, canCarry, cargoTons, clearOrders,
  assignCaptain, buyChart, buyGoods, sellGoods, captainOf, fireCaptain, hireCaptain, monthOf, monthProfit, onOrders, resumeOrders,
  dailyUpkeep, daysUntilNextShip, fuelPrice, getShip, inDryDock, isReady, isWaiting, needsDecision, newGame,
  dockByHand, nextMilestone, planVoyage, portFee, repair, repairQuote, repayLoan, sail, saleQuote, sellShip,
  shipsNeedingDecision, takeReport, typeOf, unloadContract, jettisonClaim, jettisonContract, jettisonGoods, voyageProgress, waitInPort, type VoyagePlan,
} from './sim/game';
import {
  clearSave, createSlot, deleteSlot, listSlots, loadGame, loadSlot, renameSlot, saveGame, setActiveSlot, activeSlot, type SlotInfo,
} from './sim/save';
import {
  SHIP_TUNING, consumptionFactor, effectiveSpeed, exportsFor, fleetValue, legTrade, maxLoan, netWorth, quotePurchase, saleValue,
  stateValue,
} from './sim/ships';
import type { Captain, Contract, GameState, PremiumKind, ShipOffer, ShipState, ShipTypeDef, VoyageReport } from './sim/types';
import { currentEra, getWorld, setEra } from './sim/world';
import { compactMoney, currency, days, esc, gameDate, money, setEraFormat, startYear, tons } from './ui/format';
import { mapIconPath, shipFamily, shipSideView } from './ui/art';
import { CLASS_LABEL, goodIcon } from './ui/goods-icons';
import { MapView, type LonLat, type PortMarker, type ShipMarker, type WeatherCell } from './ui/map';
import { PortScene, shipLength, type SceneShip, type TimeOfDay } from './ui/port-scene';
import { DockingGame } from './ui/docking-game';
import { barChart, lineChart, miniBars, type ChartPoint } from './ui/charts';
import { captainSlots } from './sim/captains';
import { areaName, areaPorts, region, regionOf, regions } from './sim/regions';
import { sound } from './ui/sound';
import { BUILD, consumeUpdatedFrom, initServiceWorker, isNewer, justUpdated, latestBuild, reloadApp } from './ui/update';

type Tab = 'contracts' | 'voyage' | 'ship' | 'market' | 'fleet' | 'log';
/** Why the clock is stopped: the player paused it, or a ship (or an arrival report) needs the player. */
type PauseReason = 'user' | 'arrival' | 'decision';

let world = getWorld();

/** Set the engine, the formats and the look for a game's era. */
function applyEra(era: 'modern' | 'sail'): void {
  setEra(era);
  world = getWorld();
  setEraFormat(world.era.startYear, world.era.currency);
  document.documentElement.classList.toggle('era-sail', era === 'sail');
  // The Age of Sail has its own music (it starts with the first tap, as browsers require).
  sound.setMusicWanted(era === 'sail');
}

/** Words that differ between the eras. */
const isSail = (): boolean => world.era.wind;
const FUEL = (): string => world.era.terms.fuel;
/** An amount of fuel (tons) or victuals (rations). */
const fuelAmt = (n: number): string => `${Math.round(n).toLocaleString('en-US')} ${isSail() ? 'casks' : 't'}`;
/** Price per unit of fuel or victuals. */
const perFuel = (): string => (isSail() ? '/cask' : '/t');
const DOCK = (): string => world.era.terms.drydock;

/** Session flag: the page was reloaded to open a game of another era (skip the start screen). */
const ERA_SWITCH = 'deadweight.eraSwitch';
function eraSwitched(): boolean {
  try { const v = sessionStorage.getItem(ERA_SWITCH) !== null; sessionStorage.removeItem(ERA_SWITCH); return v; } catch { return false; }
}
/** The map and scenes are built for one world: a game of another era reloads the page. */
function reloadForEra(): void {
  try { sessionStorage.setItem(ERA_SWITCH, '1'); } catch { /* the start screen shows, no harm */ }
  location.reload();
}
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

const PREMIUM_LABEL: Record<PremiumKind, string> = {
  express: 'Express', hazardous: 'Dangerous goods', government: 'Government', project: 'Project cargo',
};

/** "machinery, cars and steel" from good ids. */
function goodsList(ids: string[]): string {
  const names = ids.map((id) => world.goods[id].name.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
}

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
  /** What the big area shows: the world map, or the selected ship in port. */
  private view: 'map' | 'port' = 'map';
  private portScene!: PortScene;
  private portBtn!: HTMLButtonElement;
  private sunLon = 30;
  /** Routes hidden from the map (tap the selected ship again to toggle). */
  private routesHidden = false;
  private miniShown = false;
  /** A route being put together for a ship (stops in order), or null. */
  /** Handing a ship to a captain: which captain, which region(s), when to dock. */
  private areaDraft: { shipId: number; captainId: number | null; regions: string[]; repairBelow: number } | null = null;
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

  constructor(opts: { showStart: boolean } = { showStart: false }) {
    const loaded = loadGame();
    applyEra(loaded?.era ?? 'modern');
    this.g = loaded ?? newGame();
    saveGame(this.g);
    this.activeId = (this.g.fleet.find((s) => isReady(this.g, s)) ?? this.g.fleet[0]).id;
    this.map = new MapView(
      $('#map'),
      world,
      (id) => this.selectDest(id),
      (id) => { this.hoverDest = id; this.renderRoutes(); },
      (id) => this.selectShip(id),
    );
    this.portScene = new PortScene($('#map'), world, () => { this.view = 'map'; this.renderView(); });
    this.portBtn = document.createElement('button');
    this.portBtn.className = 'port-open';
    this.portBtn.textContent = '⚓ Port view';
    this.portBtn.hidden = true;
    this.portBtn.addEventListener('click', () => { this.view = 'port'; this.renderView(); });
    $('#map').appendChild(this.portBtn);

    document.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
      // Dropdowns act on 'change' (below); handling their click would redraw the panel and close them.
      if (t && t.tagName !== 'SELECT' && !t.hasAttribute('disabled')) this.handle(t.dataset.action!, t.dataset);
    });
    document.addEventListener('change', (ev) => {
      const t = ev.target as HTMLSelectElement;
      // A native dropdown can swallow the pointerup, so don't wait for it here.
      this.pointerDown = false;
      if (t.dataset.action === 'market-port') { this.marketPort = t.value; this.renderPanel(); }
    });
    // Chart tooltips: hover on a computer, tap on a touch screen.
    const tip = document.createElement('div');
    tip.id = 'chart-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    let tipFor: Element | null = null;
    const showTip = (target: Element, x: number, y: number) => {
      tipFor?.classList.remove('on');
      tipFor = target;
      target.classList.add('on');
      tip.innerHTML = target.getAttribute('data-tip') ?? '';
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2))}px`;
      tip.style.top = `${y - r.height - 14 < 8 ? y + 18 : y - r.height - 14}px`;
    };
    const hideTip = () => { tip.hidden = true; tipFor?.classList.remove('on'); tipFor = null; };
    document.addEventListener('pointermove', (ev) => {
      const t = (ev.target as Element).closest?.('[data-tip]');
      if (t) showTip(t, ev.clientX, ev.clientY);
      else if (ev.pointerType === 'mouse') hideTip();
    });
    document.addEventListener('pointerdown', (ev) => {
      const t = (ev.target as Element).closest?.('[data-tip]');
      if (t) showTip(t, ev.clientX, ev.clientY); else hideTip();
    });
    document.addEventListener('scroll', hideTip, true);
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
    this.drainAutoReports();
    if (this.g.reports.length) this.showNextReport();
    else if (shipsNeedingDecision(this.g).some((s) => s.id === this.activeId)) { this.view = 'port'; this.renderView(); }
    // With more than one game saved, start on the start screen (not after an update reload).
    if (opts.showStart && listSlots().length > 1 && $('#modal').hidden) this.showGames();
  }

  private ship(): ShipState {
    return this.g.fleet.find((s) => s.id === this.activeId) ?? this.g.fleet[0];
  }

  // ------------------------------------------------------------ the clock

  private tick(): void {
    if (this.paused || !$('#modal').hidden || this.dockingGame || this.g.gameOver) return;
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
    this.drainAutoReports();
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
        if (s.orders?.halted) this.toast(`${s.name} stopped its route in ${world.ports[s.location].name}: ${s.orders.halted}`, 'bad');
        else this.toast(`${s.name} ${wasDocked ? (isSail() ? 'is careened and afloat again' : 'is out of dry dock') : 'has finished waiting'} in ${world.ports[s.location].name} and needs orders.`, 'good');
      }
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
    const live = this.tab === 'contracts' || this.tab === 'voyage' || this.tab === 'ship' || this.tab === 'fleet';
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
          this.map.flashAt(at, `${ship.name}: ${isSail() && e.kind === 'emergencyFuel' ? '🍞 Out of victuals!' : isSail() && e.kind === 'breakdown' ? '⚓ Sprung a leak' : EVENT_LABELS[e.kind]}`, 'bad');
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
    this.view = 'map';
    this.renderTime();
    this.renderView();
  }

  private togglePause(): void {
    if (this.paused) this.resume();
    else this.pause('user');
  }

  /** Select the next ship that needs orders (keeps the current one if it does). */
  private goToNextDecision(): void {
    const waiting = shipsNeedingDecision(this.g);
    if (waiting.length) this.view = 'port';
    if (!waiting.length || waiting.some((s) => s.id === this.activeId)) return;
    this.activeId = waiting[0].id;
    this.dest = null;
    this.marketPort = null;
    if (this.tab === 'log' || this.tab === 'market') this.tab = 'contracts';
  }

  /**
   * After an order: on to the next ship that needs one, or, once no ship is
   * waiting for orders, start the clock again (also when it was paused by hand).
   */
  private afterDecision(): void {
    const waiting = shipsNeedingDecision(this.g);
    if (waiting.length) {
      this.goToNextDecision();
      const next = waiting.find((s) => s.id === this.activeId) ?? waiting[0];
      this.toast(`Next: the ${next.name} in ${world.ports[next.location].name} needs orders.`, 'good');
    } else if (this.paused && !this.g.reports.length) {
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
      case 'jettison': {
        const c = ship.cargo.find((x) => x.id === Number(data.id));
        if (!c) break;
        if (!confirm(`Jettison ${tons(c.tons)} of ${world.goods[c.good].name.toLowerCase()} for ${world.ports[c.dest].name}? The shipper will claim ${money(jettisonClaim(c))} in compensation.`)) return;
        this.act((g) => jettisonContract(g, id, c.id));
        break;
      }
      case 'jettison-goods': {
        const l = ship.goods?.find((x) => x.good === data.good);
        if (!l || !confirm(`Throw ${tons(l.tons)} of ${world.goods[l.good].name.toLowerCase()} overboard? You lose the ${money(l.cost)} it cost.`)) return;
        this.act((g) => jettisonGoods(g, id, l.good));
        break;
      }
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
      case 'repair':
        if (this.act((g) => repair(g, id, Number(data.points)))) this.afterDecision();
        break;
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
      case 'sail': this.castOff(); return;
      case 'bunker-sail': {
        const plan = this.dest ? planVoyage(this.g, id, this.dest) : null;
        if (!plan) break;
        const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * 1.15));
        if (this.act((g) => buyFuel(g, id, target - getShip(g, id).fuel)) && this.ship().fuel >= plan.fuelNeeded) {
          this.castOff();
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
      case 'area-edit': {
        const free = (this.g.captains ?? []).find((c) => c.shipId === undefined);
        const home = regionOf(ship.voyage?.to ?? ship.location);
        this.areaDraft = {
          shipId: id,
          captainId: ship.captainId ?? free?.id ?? null,
          regions: ship.orders?.area ? [...ship.orders.area] : home ? [home] : [],
          repairBelow: ship.orders?.repairBelow ?? 50,
        };
        this.tab = 'voyage';
        this.render();
        return;
      }
      case 'area-captain':
        if (this.areaDraft) this.areaDraft.captainId = Number(data.id);
        this.renderPanel();
        return;
      case 'area-region': this.toggleRegion(data.id!); return;
      case 'area-repair':
        if (this.areaDraft) this.areaDraft.repairBelow = Number(data.pct);
        this.renderPanel();
        return;
      case 'area-cancel':
        this.areaDraft = null;
        this.render();
        return;
      case 'area-start': {
        const d = this.areaDraft;
        if (!d || d.captainId === null) return;
        const captainId = d.captainId;
        if (this.act((g) => assignCaptain(g, captainId, d.shipId, d.regions, d.repairBelow))) {
          this.areaDraft = null;
          this.dest = null;
          sound.play(isSail() ? 'sails' : 'horn');
          const c = this.g.captains!.find((x) => x.id === captainId)!;
          this.toast(`Captain ${c.name} takes the ${ship.name}: ${areaName(d.regions)}.`, 'good');
          this.afterDecision();
        }
        this.render();
        return;
      }
      case 'buy-goods':
        this.act((g) => buyGoods(g, this.activeId, data.good!, data.tons === 'max' ? Infinity : Number(data.tons)));
        break;
      case 'sell-goods':
        this.act((g) => sellGoods(g, this.activeId, data.good!));
        break;
      case 'buy-chart':
        if (this.act((g) => buyChart(g, data.id!))) this.toast('The chart is yours: new waters open on the map.', 'good');
        break;
      case 'hire': {
        if (this.act((g) => hireCaptain(g, Number(data.id)))) {
          const c = this.g.captains![this.g.captains!.length - 1];
          this.toast(`Captain ${c.name} is on the payroll. Hand a ship over from its Voyage tab.`, 'good');
        }
        break;
      }
      case 'fire': {
        const c = (this.g.captains ?? []).find((x) => x.id === Number(data.id));
        if (!c) break;
        if (!confirm(`Let Captain ${c.name} go? Severance: ${money(c.wage)}.${c.shipId !== undefined ? ' You take command of their ship.' : ''}`)) return;
        this.act((g) => fireCaptain(g, c.id));
        break;
      }
      case 'goto-company':
        this.tab = 'fleet';
        this.render();
        return;
      case 'route-stop':
        if (this.act((g) => clearOrders(g, id))) this.toast(`You take command of the ${ship.name}${isReady(this.g, this.ship()) ? '. It needs orders' : '. It waits for your orders at its next port'}.`, 'good');
        break;
      case 'route-resume':
        if (this.act((g) => resumeOrders(g, id))) {
          const s = this.ship();
          if (s.orders?.halted) this.toast(`Still stuck: ${s.orders.halted}`, 'bad');
          else this.afterDecision();
        }
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
      case 'music':
        sound.setMusicOn(!sound.musicOn);
        this.renderMute();
        return;
      case 'dock-yourself':
        this.startDocking(Number(data.id));
        return;
      case 'close-report':
        $('#modal').hidden = true;
        if (this.g.reports.length) { this.showNextReport(); return; }
        break;
      case 'games': this.showGames(); return;
      case 'close-games':
        $('#modal').hidden = true;
        $('#modal').classList.remove('wide');
        break;
      case 'slot-open': this.switchTo(data.id!); return;
      case 'slot-rename': {
        const slot = listSlots().find((x) => x.id === data.id);
        const name = slot ? prompt('New name for this game:', slot.name)?.trim() : '';
        if (slot && name) {
          renameSlot(slot.id, name);
          if (slot.id === activeSlot()) { this.g = { ...this.g, company: name }; saveGame(this.g); }
        }
        this.showGames();
        return;
      }
      case 'slot-delete': {
        const slot = listSlots().find((x) => x.id === data.id);
        if (slot && confirm(`Delete "${slot.name}"? This can't be undone.`)) deleteSlot(slot.id);
        this.showGames();
        return;
      }
      case 'slot-new': {
        const era = data.era === 'sail' ? 'sail' : 'modern';
        const input = document.getElementById('new-name') as HTMLInputElement | null;
        const name = input?.value.trim() || 'My shipping company';
        saveGame(this.g);
        const before = currentEra();
        setEra(era);
        const g = newGame();
        g.era = era;
        g.company = name;
        createSlot(g, name);
        setEra(before);
        if (era !== before) { reloadForEra(); return; }
        this.loadInto(g);
        this.toast(`${name} is founded. Good luck!`, 'good');
        return;
      }
      case 'new-game':
        if (!this.g.gameOver && !confirm('Start this company over? Its current game will be lost.')) return;
        clearSave();
        this.g = { ...newGame(), era: this.g.era ?? 'modern', company: this.g.company };
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
      this.routesHidden = false;
    } else if (!tab) {
      // Tapping the selected ship again clears its route from the map (and again brings it back).
      this.routesHidden = !this.routesHidden;
    }
    // A ship in port or dry dock is shown at its quay; one at sea on the map.
    this.view = atSea(this.ship()) ? 'map' : 'port';
    if (tab) this.tab = tab;
    this.render();
  }

  private selectDest(portId: string): void {
    const ship = this.ship();
    if (this.areaDraft?.shipId === ship.id) { const r = regionOf(portId); if (r) this.toggleRegion(r); return; }
    if (!isReady(this.g, ship)) return;
    this.dest = portId === ship.location ? null : portId;
    this.routesHidden = false;
    this.tab = 'voyage';
    this.render();
  }

  private castOff(): void {
    if (!this.dest) return;
    const ship = this.ship();
    if (!this.act((g) => sail(g, ship.id, this.dest!))) { this.render(); return; }
    // A horn for a steamer; for a sailing ship, the sails filling with wind.
    sound.play(isSail() ? 'sails' : 'horn');
    this.dest = null;
    this.tab = 'voyage';
    this.view = 'map';
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

  /** The port view over the map when the selected ship is in port (and the button to get to it). */
  private renderView(): void {
    if (!world.era.portView) this.view = 'map';
    const ship = this.ship();
    const inPort = !atSea(ship);
    if (this.view === 'port' && inPort) {
      const docked = inDryDock(this.g, ship);
      const port = world.ports[ship.location];
      this.portScene.show({
        ship: this.sceneShip(ship),
        place: docked ? 'dock' : 'quay',
        portId: port.id,
        portName: port.name,
        time: this.timeOfDay(port.lon),
        neighbours: this.g.fleet.filter((s) => s.id !== ship.id && !atSea(s) && !inDryDock(this.g, s) && s.location === ship.location)
          .map((s) => this.sceneShip(s)),
        dockDays: docked ? ship.busyUntil! - this.g.day : undefined,
      });
      if (!this.portScene.visible || !this.miniShown) { this.miniShown = true; this.renderRoutes(); }
      this.portBtn.hidden = true;
    } else {
      this.portScene.hide();
      this.miniShown = false;
      this.portBtn.hidden = !inPort || !world.era.portView;
    }
  }

  private sceneShip(s: ShipState): SceneShip {
    const type = typeOf(s);
    return {
      id: s.id, name: s.name, typeId: type.id, family: shipFamily(type),
      capacity: type.capacity, bunkerCapacity: type.bunkerCapacity,
      cargo: s.cargo.map((c) => ({ good: c.good, cls: world.goods[c.good].cargoClass, tons: c.tons })),
      fuel: s.fuel, condition: s.condition,
    };
  }

  /** Local time of day at a port, from where the map's sun is right now. */
  private timeOfDay(lon: number): TimeOfDay {
    const hour = ((12 + (lon - this.sunLon) / 15) % 24 + 24) % 24;
    if (hour >= 7 && hour < 17.5) return 'day';
    if ((hour >= 5 && hour < 7) || (hour >= 17.5 && hour < 19.5)) return 'dusk';
    return 'night';
  }

  /** The parts that change every tick: date, money, fleet strip, ships on the map. */
  private renderLive(): void {
    this.renderView();
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
    this.sunLon = sunLon;
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
    const tag = document.querySelector('.brand .tagline');
    if (tag) tag.textContent = g.company ?? 'shipping company';
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
    const route = onOrders(ship) ? '↻ ' : '';
    if (ship.voyage) {
      const left = Math.max(0, ship.voyage.arriveDay - g.day);
      return { text: `${route}→ ${world.ports[ship.voyage.to].name} · ${days(Math.ceil(left * 10) / 10)}`, state: 'sea', progress: voyageProgress(g, ship) };
    }
    if (ship.orders?.halted && !inDryDock(g, ship)) return { text: `Route stopped in ${world.ports[ship.location].name}`, state: 'ready' };
    if (inDryDock(g, ship)) return { text: `${route}${DOCK()}, ${world.ports[ship.location].name} · ${days(Math.ceil((ship.busyUntil! - g.day) * 10) / 10)}`, state: 'busy' };
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
        ${st.progress !== undefined ? `<span class="sc-bar"><span style="width:${(st.progress * 100).toFixed(1)}%"></span></span>` : '<span class="sc-bar placeholder"></span>'}
      </button>`;
    }).join('');
    const load = cargoTons(ship);
    const fuel = ship.voyage ? ship.voyage.startFuel - (ship.voyage.startFuel - ship.voyage.fuelAtArrival) * voyageProgress(g, ship) : ship.fuel;
    const cond = ship.condition;
    $('#ship-strip').innerHTML = `
      <div class="fleet">${chips}</div>
      <div class="active-ship">
        <div class="ship-name"><strong>${esc(ship.name)}</strong><span>${esc(type.name)} · ${Math.floor(ship.age)} yrs</span></div>
        ${gauge(FUEL(), fuel / type.bunkerCapacity, `${Math.round(fuel)} / ${fuelAmt(type.bunkerCapacity)}`, 'fuel')}
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
      role: p.id === here ? 'here'
        : p.id === (this.dest ?? ship.voyage?.to) || (this.areaDraft?.shipId === ship.id && areaPorts(this.areaDraft.regions).includes(p.id)) ? 'dest'
          : cargoDests.has(p.id) ? 'cargo' : 'normal',
      strike: events.some((e) => e.kind === 'strike' && e.port === p.id),
      boom: events.some((e) => e.kind === 'boom' && e.port === p.id),
    }));
    this.map.setCharted(g.charted ? new Set(g.charted) : null);
    this.map.updatePorts(markers);
    this.map.setClosedCanals(closedCanals(g));
  }

  private renderRoutes(): void {
    const ship = this.ship();
    const g = this.g;
    if (this.routesHidden && !this.dest && this.areaDraft?.shipId !== ship.id) {
      this.map.showRoutes(null, []);
      this.portScene.showRoutes({ here: ship.voyage?.to ?? ship.location, primary: [], secondary: [] });
      return;
    }
    const path = (a: string, b: string) => (a === b ? null : routeFor(world, g, a, b)?.path ?? null);
    const some = (xs: (string[] | null)[]) => xs.filter((x): x is string[] => !!x);
    /** The legs of a route: in order and back to the start, or between every pair of ports. */
    const legsOf = (stops: string[], mode: 'best' | 'loop') => {
      if (stops.length < 2) return [];
      if (mode === 'loop') return some(stops.map((a, i) => path(a, stops[(i + 1) % stops.length])));
      return some(stops.flatMap((a, i) => stops.slice(i + 1).map((b) => path(a, b))));
    };

    const d = this.areaDraft?.shipId === ship.id ? this.areaDraft : null;
    if (d) {
      // Picking an area: its ports are highlighted (no lines).
      this.map.showRoutes(null, []);
      this.portScene.showRoutes({ here: ship.voyage?.to ?? ship.location, primary: [], secondary: [], stops: areaPorts(d.regions) });
      return;
    }
    // A ship on a route shows its whole route faintly behind the current leg.
    const orderLegs = ship.orders && !ship.orders.area ? legsOf(ship.orders.stops, ship.orders.mode ?? 'loop') : [];
    if (ship.voyage) {
      this.map.showRoutes(ship.voyage.path, orderLegs);
      return;
    }
    const here = ship.location;
    const primary = this.dest ? path(here, this.dest) : null;
    const hover = this.hoverDest && this.hoverDest !== this.dest && this.hoverDest !== here ? path(here, this.hoverDest) : null;
    const secondary = hover ? [hover] : orderLegs;
    this.map.showRoutes(primary, secondary);
    this.portScene.showRoutes({ here, primary: primary ? [primary] : [], secondary, stops: hover ? undefined : ship.orders?.stops });
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
      ['fleet', 'Company'],
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
      market: () => this.marketTab(), fleet: () => this.fleetTab(), log: () => this.logTab(),
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
        <p class="hint">${onOrders(ship) ? 'On its route: it carries on by itself when it arrives.' : "You'll get its orders back when it arrives. Meanwhile, pick another ship below."}</p>
      </section>`;
    }
    return `<section class="card plan underway">
      <h3>${esc(ship.name)} ${isSail() ? 'is being careened' : 'is in dry dock'}</h3>
      <p>In ${esc(world.ports[ship.location].name)}, ready on ${gameDate(ship.busyUntil!)}.</p>
    </section>`;
  }

  private contractRow(c: Contract, mode: 'board' | 'hold'): string {
    const g = this.g;
    const ship = this.ship();
    const good = world.goods[c.good];
    const daysLeft = c.deadline - g.day;
    const nm = routeFor(world, g, c.origin, c.dest)?.nm ?? world.distance(c.origin, c.dest);
    const why = mode !== 'board' ? null
      : c.premium && ship.captainId !== undefined ? 'Premium jobs need you in command' : canCarry(ship, c);
    const plan = mode === 'board' ? planVoyage(g, ship.id, c.dest) : null;
    const reach = plan && !plan.inRange ? '<span class="tag warn">needs refuel stop</span>' : '';
    const urgent = daysLeft < (nm / (effectiveSpeed(typeOf(ship), ship) * 24)) + 1.5;
    const button = mode === 'board'
      ? `<button class="btn small" data-action="accept" data-id="${c.id}" ${why ? 'disabled' : ''} title="${esc(why ?? 'Load this cargo')}">Load</button>`
      : c.origin === ship.location && isReady(g, ship)
        ? `<button class="btn small ghost" data-action="unload" data-id="${c.id}">Unload</button>`
        : `<button class="btn small ghost jettison" data-action="jettison" data-id="${c.id}" title="Throw it overboard: the shipper claims ${money(jettisonClaim(c))}">Jettison</button>`;
    return `
      <li class="contract ${why ? 'unavailable' : ''} ${c.premium ? 'premium' : ''}" data-hover-dest="${c.dest}">
        <div class="c-icon">${goodIcon(c.good, 36)}</div>
        <div class="c-main">
          <div class="c-good">${c.premium ? `<span class="tag premium">★ ${PREMIUM_LABEL[c.premium]}</span> ` : ''}${esc(good.name)} · ${tons(c.tons)}</div>
          <div class="c-route"><span class="cmark ${good.cargoClass}" title="${CLASS_LABEL[good.cargoClass]}" aria-label="${CLASS_LABEL[good.cargoClass]}"></span>→ <strong>${esc(world.ports[c.dest].name)}</strong> · ${nm.toLocaleString('en-US')} nm ${reach}</div>
          <div class="c-meta ${urgent ? 'urgent' : ''}">Due ${gameDate(c.deadline)} (${days(Math.max(0, Math.round(daysLeft)))})${why ? ` · <span class="why">${esc(why)}</span>` : ''}</div>
        </div>
        <div class="c-side">
          <div class="c-pay">${compactMoney(c.pay)}</div>
          <div class="c-rate">${money(c.pay / c.tons)}/t</div>
          ${button}
        </div>
      </li>`;
  }

  /** Pick a region for the area (a second one makes a lane; a third replaces the second). */
  private toggleRegion(id: string): void {
    const d = this.areaDraft;
    if (!d) return;
    if (d.regions.includes(id)) d.regions = d.regions.filter((r) => r !== id);
    else if (d.regions.length < 2) d.regions.push(id);
    else d.regions = [d.regions[0], id];
    this.renderPanel();
  }

  private stars(c: Captain): string {
    return `<span class="stars" title="${c.skill === 3 ? 'Veteran' : c.skill === 2 ? 'Experienced' : 'Green'}">${'★'.repeat(c.skill)}${'☆'.repeat(3 - c.skill)}</span>`;
  }

  /** The Voyage tab's captain card: who runs this ship, or how to hand it over. */
  private captainCard(): string {
    const g = this.g;
    const ship = this.ship();
    const c = captainOf(g, ship);
    if (!c) {
      const free = (g.captains ?? []).filter((x) => x.shipId === undefined);
      const room = (g.captains ?? []).length < captainSlots(g);
      return `<section class="card orders">
        <div class="orders-head"><h3>Under your command</h3>
          ${free.length ? '<button class="btn small" data-action="area-edit">Hand over to a captain…</button>'
            : `<button class="btn small" data-action="goto-company">${room ? 'Hire a captain…' : 'Captains…'}</button>`}</div>
        <p class="hint">${free.length ? `A captain trades in a region (or on a lane between two) by himself, for a wage.`
          : room ? 'Hire a captain in the Company tab and he can run this ship by himself in a region you choose.'
            : 'All your captains have ships. More posts come with each net-worth goal.'}
          Only ships you command take ★ premium jobs.</p>
      </section>`;
    }
    const o = ship.orders;
    const earned = (ship.earnings ?? []).filter((e) => e.day > g.day - 30).reduce((sum, e) => sum + e.net, 0);
    const where = ship.voyage ? `Heading for ${esc(world.ports[ship.voyage.to].name)}.` : '';
    return `<section class="card orders ${o?.halted ? 'halted' : ''}">
      <div class="orders-head"><h3>Captain ${esc(c.name)} ${this.stars(c)}</h3>
        <span class="orders-btns">
          ${o?.halted ? '<button class="btn small primary" data-action="route-resume">Resume</button>' : ''}
          <button class="btn small" data-action="area-edit">Change area</button>
          <button class="btn small ghost" data-action="route-stop">Take command</button>
        </span></div>
      <p class="area-line">↻ ${o?.area ? esc(areaName(o.area)) : 'Own route'} ${where}</p>
      ${o?.halted ? `<p class="warn-line">Stopped: ${esc(o.halted)}</p>` : ''}
      <p class="hint">From ${esc(region(c.home).name)} · ${money(c.wage)} a month · docks below ${o?.repairBelow ?? 50}% condition. Last 30 days: <strong>${money(earned, true)}</strong> after fuel.</p>
    </section>`;
  }

  /** A short market report for a region or lane, for this ship. */
  private areaReport(regions: string[], ship: ShipState): string {
    const g = this.g;
    const type = typeOf(ship);
    const ports = areaPorts(regions);
    const pairs: [string, string][] = regions.length > 1
      ? region(regions[0]).ports.flatMap((a) => region(regions[1]).ports.flatMap((b) => [[a, b], [b, a]] as [string, string][]))
      : ports.flatMap((a) => ports.filter((b) => b !== a).map((b) => [a, b] as [string, string]));
    const perNm = (type.fuelPerDay * consumptionFactor(ship)) / (effectiveSpeed(type, ship) * 24);
    const legs = pairs.map(([a, b]) => ({ a, b, nm: world.route(a, b)?.nm ?? Infinity }));
    const reachable = legs.filter((l) => l.nm * perNm <= type.bunkerCapacity);
    const goods = [...new Set(reachable.flatMap((l) => legTrade(world, type, l.a, l.b)))];
    const pairSet = new Set(reachable.map((l) => `${l.a}>${l.b}`));
    const lots = ports.flatMap((p) => g.ports[p].board.filter((c) => !c.premium && pairSet.has(`${p}>${c.dest}`)
      && type.cargoClasses.includes(world.goods[c.good].cargoClass) && c.tons <= type.capacity));
    const avg = reachable.length ? reachable.reduce((s2, l) => s2 + l.nm, 0) / reachable.length : 0;
    const prices = ports.map((p) => fuelPrice(g, p));
    const events = activeEvents(g).filter((e) => (e.port && ports.includes(e.port)));
    const out = reachable.length < legs.length;
    const lines = [
      goods.length ? `<li class="ok">Regular cargo for your ${esc(type.name.toLowerCase())}: ${esc(goodsList(goods))}</li>`
        : `<li class="bad">No regular cargo for your ${esc(type.name.toLowerCase())} here</li>`,
      `<li>On the quays now: ${lots.length} lot${lots.length === 1 ? '' : 's'}${lots.length ? `, ${compactMoney(lots.reduce((s2, c) => s2 + c.pay, 0))}` : ''}</li>`,
      reachable.length ? `<li>Typical leg ${Math.round(avg).toLocaleString('en-US')} nm · ${days(Math.round(avg / (effectiveSpeed(type, ship) * 24) * 10) / 10)} · ${FUEL().toLowerCase()} ${currency()}${Math.min(...prices)}–${Math.max(...prices)}${perFuel()}</li>` : '',
      out ? `<li class="${reachable.length ? 'warn' : 'bad'}">${reachable.length ? 'Some legs are' : 'Every leg is'} beyond this ship's range</li>` : '',
      ...events.map((e) => `<li class="warn">${esc(e.headline)}</li>`),
    ];
    return `<ul class="area-report">${lines.join('')}</ul>`;
  }

  /** Handing a ship to a captain: pick the captain, the region or lane, and when to dock. */
  private areaEditor(): string {
    const g = this.g;
    const d = this.areaDraft!;
    const ship = this.ship();
    const captains = (g.captains ?? []).filter((c) => c.shipId === undefined || c.shipId === ship.id);
    const pickCaptain = captains.length
      ? captains.map((c) => `<button class="cap-chip ${c.id === d.captainId ? 'on' : ''}" data-action="area-captain" data-id="${c.id}">
          <strong>${esc(c.name)}</strong> ${this.stars(c)}<span>from ${esc(region(c.home).name)} · ${money(c.wage)}/mo</span></button>`).join('')
      : '<p class="warn-line">No free captain. Hire one in the Company tab first.</p>';
    const cards = regions().map((r) => {
      const on = d.regions.includes(r.id);
      const laneWith = !on && d.regions.length === 1 ? d.regions[0] : null;
      const home = captains.find((c) => c.id === d.captainId)?.home === r.id;
      return `<li class="region ${on ? 'on' : ''}" data-action="area-region" data-id="${r.id}">
        <div class="r-head"><strong>${on ? '✓ ' : ''}${esc(r.name)}</strong>${home ? '<span class="tag good">captain\'s home</span>' : ''}</div>
        <div class="r-ports">${r.ports.map((p) => esc(world.ports[p].name)).join(' · ')}</div>
        ${laneWith ? `<div class="r-lane">As a lane with ${esc(region(laneWith).name)}:</div>${this.areaReport([laneWith, r.id], ship)}` : this.areaReport([r.id], ship)}
      </li>`;
    }).join('');
    const pct = [40, 50, 60, 70].map((p) =>
      `<button class="btn small ${p === d.repairBelow ? 'primary' : 'ghost'}" data-action="area-repair" data-pct="${p}">${p}%</button>`).join('');
    const ready = d.regions.length > 0 && d.captainId !== null;
    return `<section class="card orders editing">
      <h3>Hand the ${esc(ship.name)} to a captain</h3>
      <div class="cap-pick">${pickCaptain}</div>
      <p class="hint">Pick a region to trade in, or two for a lane between them (long legs, cargo both ways: good for big ships). The captain chooses the ports himself. Tap regions below or ports on the map.</p>
      ${d.regions.length ? `<div class="area-sel"><strong>${esc(areaName(d.regions))}</strong>${this.areaReport(d.regions, ship)}</div>` : ''}
      <div class="repair-pick"><span>${DOCK()} below</span>${pct}</div>
      <div class="orders-btns">
        <button class="btn primary" data-action="area-start" ${ready ? '' : 'disabled'}>${ship.captainId !== undefined ? 'Save' : 'Hand over'}</button>
        <button class="btn ghost" data-action="area-cancel">Cancel</button>
      </div>
    </section>
    <h3>Regions</h3>
    <ul class="regions">${cards}</ul>`;
  }

  /** Captains on the payroll and the ones looking for work. */
  private captainsCard(): string {
    const g = this.g;
    const hired = g.captains ?? [];
    const slots = captainSlots(g);
    const ship = (c: Captain) => g.fleet.find((s) => s.id === c.shipId);
    const row = (c: Captain, hire: boolean) => {
      const s = ship(c);
      const status = hire ? '' : s ? `on the ${esc(s.name)}${s.orders?.area ? `, ${esc(areaName(s.orders.area))}` : ''}${s.orders?.halted ? ' · <span class="bad">stopped</span>' : ''}` : 'ashore, waiting for a ship';
      return `<li class="cap-row">
        <div><strong>${esc(c.name)}</strong> ${this.stars(c)}<span class="sub">from ${esc(region(c.home).name)} · ${money(c.wage)} a month</span>
          ${status ? `<span class="cap-status">${status}</span>` : ''}</div>
        ${hire ? `<button class="btn small" data-action="hire" data-id="${c.id}" ${hired.length >= slots ? 'disabled title="All posts filled"' : ''}>Hire</button>`
          : `<button class="btn small ghost" data-action="fire" data-id="${c.id}">Let go</button>`}
      </li>`;
    };
    return `<section class="card captains">
      <h3>Captains <span class="count">${hired.length} of ${slots} posts</span></h3>
      ${hired.length ? `<ul class="cap-list">${hired.map((c) => row(c, false)).join('')}</ul>` : '<p class="hint">No captains yet: every ship waits for your orders.</p>'}
      <h4>Looking for work</h4>
      <ul class="cap-list">${(g.captainPool ?? []).map((c) => row(c, true)).join('')}</ul>
      <p class="hint">★ green: cheap, misjudges cargo and ports, impatient. ★★ experienced. ★★★ veteran: picks the best, loads for the whole area, buys fuel where it's cheap. A captain gets more cargo booked in his home region. Wages are paid daily; letting one go costs a month's wage. One more post with each net-worth goal.</p>
    </section>`;
  }

  /** How the company is doing: net worth and monthly results, from the books. */
  private companyCard(): string {
    const g = this.g;
    const books = (g.books ?? []).slice(-24);
    const now = monthOf(g.day);
    const live = netWorth(g, world);
    if (!books.length) {
      return `<section class="card company"><h3>Company</h3>
        <p class="hint">Your books start today. The charts fill in as the months go by.</p></section>`;
    }
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const name = (m: number) => `${MONTHS[m % 12]} ${startYear() + Math.floor(m / 12)}`;
    const every = Math.ceil(books.length / 7);
    const label = (m: number, i: number) => (i % every === 0 || i === books.length - 1
      ? (m % 12 === 0 ? String(startYear() + Math.floor(m / 12)) : MONTHS[m % 12]) : '');
    const tipLine = (k: string, v: number, cls = '') => `<div class="tl ${cls}"><span>${k}</span><b>${money(v, cls !== '')}</b></div>`;
    const worth: ChartPoint[] = books.map((b, i) => {
      const v = b.m === now ? live : b.netWorth;
      return { label: label(b.m, i), value: v, tip: `<strong>${name(b.m)}${b.m === now ? ' (so far)' : ''}</strong>${tipLine('Net worth', v)}${tipLine('Cash', b.m === now ? g.cash : b.cash)}${tipLine('Loan', b.m === now ? g.loan : b.loan)}` };
    });
    const result: ChartPoint[] = books.map((b, i) => {
      const p = monthProfit(b);
      const costs = b.fuel + b.fees + b.upkeep + b.interest + b.repairs + b.incidents;
      return { label: label(b.m, i), value: p, tip: `<strong>${name(b.m)}${b.m === now ? ' (so far)' : ''}</strong>${tipLine('Revenue', b.revenue)}${tipLine('Running costs', -costs)}${tipLine('Result', p, p >= 0 ? 'up' : 'down')}` };
    });

    const done = books.filter((b) => b.m < now);
    const last = done[done.length - 1];
    const before = done.slice(-4, -1);
    let trend = '';
    if (last && before.length) {
      const avg = before.reduce((a, b) => a + monthProfit(b), 0) / before.length;
      const diff = monthProfit(last) - avg;
      trend = `<span class="trend ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${compactMoney(Math.abs(diff))} vs the ${before.length === 1 ? 'month' : `${before.length} months`} before</span>`;
    }
    const cur = books[books.length - 1].m === now ? books[books.length - 1] : null;
    const row = (k: string, f: (b: typeof books[number]) => number, sign: 1 | -1, cls = '') =>
      `<tr class="${cls}"><th>${k}</th><td>${cur ? money(sign * f(cur), sign < 0 && f(cur) !== 0) : '—'}</td><td>${last ? money(sign * f(last), sign < 0 && f(last) !== 0) : '—'}</td></tr>`;
    const resultRow = (b: typeof books[number] | null | undefined) => b ? `<span class="${monthProfit(b) >= 0 ? 'up' : 'down'}">${money(monthProfit(b), true)}</span>` : '—';
    return `<section class="card company">
      <h3>Company</h3>
      <div class="kpis">
        <div><span class="lbl">Net worth</span><strong>${compactMoney(live)}</strong></div>
        <div><span class="lbl">${last ? `Result ${name(last.m)}` : 'Result'}</span><strong>${last ? resultRow(last) : '—'}</strong>${trend}</div>
        <div><span class="lbl">This month so far</span><strong>${resultRow(cur)}</strong></div>
      </div>
      <h4>Net worth <span>end of each month</span></h4>
      ${lineChart(worth, 'Net worth by month')}
      <h4>Monthly result <span>revenue less running costs</span>
        <span class="legend"><i class="up"></i>profit <i class="down"></i>loss</span></h4>
      ${barChart(result, 'Profit or loss by month')}
      <table class="books">
        <thead><tr><th></th><th>${cur ? `${name(cur.m)} so far` : 'This month'}</th><th>${last ? name(last.m) : 'Last month'}</th></tr></thead>
        <tbody>
          ${row('Revenue', (b) => b.revenue, 1)}
          ${hasTrade(world) ? row('Trade on own account', (b) => b.trade ?? 0, 1) : ''}
          ${row(FUEL(), (b) => b.fuel, -1)}
          ${row('Port fees & canals', (b) => b.fees, -1)}
          ${row('Upkeep', (b) => b.upkeep, -1)}
          ${row('Interest', (b) => b.interest, -1)}
          ${row('Repairs', (b) => b.repairs, -1)}
          ${row('Breakdowns & emergencies', (b) => b.incidents, -1)}
          <tr class="total"><th>Result</th><td>${resultRow(cur)}</td><td>${resultRow(last)}</td></tr>
          ${(cur?.shipsBought || cur?.shipsSold || last?.shipsBought || last?.shipsSold)
            ? row('Ships bought (not in result)', (b) => b.shipsBought, -1, 'capital') + row('Ships sold (not in result)', (b) => b.shipsSold, 1, 'capital') : ''}
        </tbody>
      </table>
      <p class="hint">Running costs are fuel bought, port fees, canal dues, upkeep, interest, repairs and incidents at sea. Buying and selling ships changes your net worth, not the result.</p>
    </section>`;
  }

  /** Every ship at a glance. */
  private fleetTab(): string {
    const g = this.g;
    // Each ship's last 12 months on one shared scale.
    const nowM = monthOf(g.day);
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const months = (s: ShipState) => (s.books ?? []).filter((b) => b.m > nowM - 12);
    const maxAbs = Math.max(1, ...g.fleet.flatMap((s) => months(s).map((b) => Math.abs(b.revenue - b.costs))));
    const shipChart = (s: ShipState) => {
      const ms = months(s);
      if (!ms.length) return '<span class="fr-nochart">No months yet</span>';
      return miniBars(ms.map((b) => ({
        label: '', value: b.revenue - b.costs,
        tip: `<strong>${esc(s.name)} · ${MONTHS[b.m % 12]} ${startYear() + Math.floor(b.m / 12)}${b.m === nowM ? ' (so far)' : ''}</strong><div class="tl"><span>Revenue</span><b>${money(b.revenue)}</b></div><div class="tl"><span>Costs</span><b>${money(-b.costs)}</b></div><div class="tl ${b.revenue >= b.costs ? 'up' : 'down'}"><span>Result</span><b>${money(b.revenue - b.costs, true)}</b></div>`,
      })), maxAbs, `${s.name}: result by month`);
    };
    const rows = g.fleet.map((s) => {
      const type = typeOf(s);
      const st = this.shipStatus(s);
      const earned = (s.earnings ?? []).filter((e) => e.day > g.day - 30).reduce((sum, e) => sum + e.net, 0);
      const fuel = s.voyage ? s.voyage.fuelAtArrival : s.fuel;
      const route = s.orders ? s.orders.stops.map((id) => world.ports[id].name).join(s.orders.mode === 'best' ? ' · ' : ' → ') : '';
      return `<li class="fleet-row ${st.state} ${s.id === this.activeId ? 'selected' : ''}" data-action="select-ship" data-id="${s.id}">
        <span class="fr-art">${shipSideView(type, 72)}</span>
        <span class="fr-main">
          <strong>${esc(s.name)}</strong> <span class="sub">${esc(type.name)} · ${Math.floor(s.age)} yrs</span>
          <span class="fr-status">${esc(st.text)}</span>
          ${captainOf(g, s) ? `<span class="fr-route ${s.orders?.halted ? 'halted' : ''}">↻ Captain ${esc(captainOf(g, s)!.name)} · ${esc(s.orders?.area ? areaName(s.orders.area) : route)}${s.orders?.halted ? ' · stopped' : ''}</span>` : '<span class="fr-route mine">Under your command</span>'}
        </span>
        <span class="fr-chart">${shipChart(s)}</span>
        <span class="fr-stats">
          <span><em>Hold</em>${cargoTons(s).toLocaleString('en-US')}/${tons(type.capacity)}</span>
          <span><em>${FUEL()}</em>${Math.round(fuel)}/${fuelAmt(type.bunkerCapacity)}</span>
          <span class="${s.condition < 45 ? 'bad' : s.condition < 65 ? 'warn' : ''}"><em>Condition</em>${Math.round(s.condition)}%</span>
          <span class="${earned < 0 ? 'bad' : earned > 0 ? 'good' : ''}"><em>30 days</em>${money(earned, true)}</span>
        </span>
      </li>`;
    }).join('');
    const total = g.fleet.reduce((sum, s) => sum + (s.earnings ?? []).filter((e) => e.day > g.day - 30).reduce((a, e) => a + e.net, 0), 0);
    const routed = g.fleet.filter((s) => s.orders).length;
    return `
      ${this.companyCard()}
      ${this.captainsCard()}
      <header class="port-head"><div><h2>Your fleet</h2>
        <span class="sub">${g.fleet.length} ship${g.fleet.length > 1 ? 's' : ''} · ${routed} on routes · last 30 days ${money(total, true)} after fuel</span></div></header>
      <p class="hint">Tap a ship to select it. "30 days" is what its finished legs earned after port fees, canal dues, upkeep and fuel.</p>
      <ul class="fleet-list">${rows}</ul>`;
  }

  /** Arrivals of ships on routes don't stop the game: just the payment on the map and the coins. */
  private drainAutoReports(): void {
    const autos = this.g.reports.filter((r) => r.auto);
    if (!autos.length) return;
    this.g = { ...this.g, reports: this.g.reports.filter((r) => !r.auto) };
    for (const r of autos) {
      if (r.revenue > 0) {
        this.map.flashAt(this.map.portPosition(r.to), money(r.revenue, true), 'good');
        this.map.pulseAt(this.map.portPosition(r.to), 'good');
        sound.play('coins');
      }
    }
    saveGame(this.g);
  }

  /** A reefer in a port with no chilled cargo: say where to find some. */
  private chilledHint(ship: ShipState, portId: string): string {
    if (!typeOf(ship).cargoClasses.includes('reefer')) return '';
    const chilled = (good: string) => world.goods[good].cargoClass === 'reefer';
    if (this.g.ports[portId].board.some((c) => chilled(c.good))) return '';
    const sources = world.portList
      .filter((p) => p.id !== portId && p.produces.some((x) => chilled(x.good)))
      .map((p) => ({ p, nm: world.route(portId, p.id)?.nm ?? Infinity }))
      .sort((a, b) => a.nm - b.nm)
      .slice(0, 4)
      .map(({ p }) => {
        const goods = p.produces.filter((x) => chilled(x.good)).map((x) => world.goods[x.good].name.toLowerCase());
        return `<strong>${esc(p.name)}</strong> (${goods.join(', ')})`;
      });
    return `<p class="hint">No chilled cargo on offer here. Nearest ports that ship it: ${sources.join(', ')}.
      Until then, the ${esc(ship.name)} can take general cargo.</p>`;
  }

  private contractsTab(): string {
    const g = this.g;
    const ship = this.ship();
    const hold = (ship.cargo.length ? `<h3>In the hold</h3><ul class="contracts">${ship.cargo.map((c) => this.contractRow(c, 'hold')).join('')}</ul>` : '')
      + (!isReady(g, ship) ? this.ownGoods(ship) : '');
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
        <div><h2>${esc(port.name)}</h2><span class="sub">${esc(ship.name)} · port fee ${money(portFee(g, ship, port.id))} · ${FUEL().toLowerCase()} ${money(fuelPrice(g, port.id))}${perFuel()}</span></div>
      </header>
      ${this.waitControls()}
      ${this.chartsCard(port.id)}
      <p class="hint">Free hold space: <strong>${tons(free)}</strong>. New offers appear as days pass. Hover a contract to see its route.</p>
      ${this.priceHints(port.id)}
      ${this.chilledHint(ship, port.id)}
      ${board.length > 1 ? sortPick : ''}
      ${board.length ? `<ul class="contracts">${board.map((c) => this.contractRow(c, 'board')).join('')}</ul>`
        : '<p class="empty">No cargo on offer right now. Let some time pass, or sail on.</p>'}
      ${this.tradeCard(ship)}
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
      ${world.era.hasOil ? this.oilCard() : ''}
      <section class="card">
        <h3>${world.era.terms.bunker} · ${esc(ship.name)}</h3>
        ${ready ? `<div class="kv"><span>Price here</span><strong>${money(price)}${perFuel()}</strong><em>${rank === 1 ? 'cheapest in the world' : `#${rank} of ${cheapest.length}`}</em></div>` : `<p class="hint">${atSea(ship) ? (isSail() ? 'At sea: victual on arrival.' : 'At sea: bunker on arrival.') : `In ${DOCK().toLowerCase()}.`}</p>`}
        <div class="kv"><span>Aboard</span><strong>${Math.round(ship.fuel)} / ${fuelAmt(type.bunkerCapacity)}</strong><em>range ≈ ${range.toLocaleString('en-US')} nm</em></div>
        <div class="kv"><span>${isSail() ? 'Eats' : 'Burn'}</span><strong>${burn.toFixed(1)} ${isSail() ? 'casks' : 't'}/day</strong><em>${isSail() ? `${speed.toFixed(1)} kn in a fair wind, slower when foul` : `at ${speed.toFixed(1)} kn, more when worn or old`}</em></div>
        <div class="btn-row">${fuelBtn(25, `+${fuelAmt(25)}`)}${fuelBtn(50, `+${fuelAmt(50)}`)}${fuelBtn(100, `+${fuelAmt(100)}`)}${fuelBtn('fill', 'Fill up')}</div>
        ${plan && plan.inRange ? `<button class="btn wide" data-action="fuel-for-leg" ${ship.fuel >= Math.ceil(plan.fuelNeeded * 1.15) ? 'disabled' : ''}>Top up for ${esc(world.ports[plan.dest].name)} (+15% reserve)</button>` : ''}
        <p class="hint">Cheapest ${isSail() ? 'victuals' : 'bunkers'} right now: ${cheapest.slice(0, 3).map((x) => `${esc(x.p.name)} ${money(x.price)}`).join(' · ')}</p>
      </section>
      <section class="card">
        <h3>${DOCK()}</h3>
        <div class="kv"><span>Condition</span><strong>${Math.round(ship.condition)}%</strong><em>${isSail() ? 'low condition → leaks, broken spars, a slower ship' : 'low condition → more breakdowns, higher fuel burn'}</em></div>
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
      <ul>${active.map((e) => `<li><span class="n-kind ${e.kind}">${{ strike: isSail() ? 'Plague' : 'Strike', harvest: 'Harvest', boom: 'Boom', canal: 'Canal', oilShock: 'Oil' }[e.kind]}</span>
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
    if (this.areaDraft?.shipId === ship.id) return this.areaEditor();
    if (!isReady(g, ship) || onOrders(ship)) return this.newsCard() + this.captainCard() + this.busyCard();
    const here = ship.location;
    const rows = world.portList.filter((p) => p.id !== here).map((p) => ({ p, plan: planVoyage(g, ship.id, p.id)! }))
      .sort((a, b) => a.plan.route.nm - b.plan.route.nm);
    const type = typeOf(ship);
    const list = rows.map(({ p, plan }) => {
      const cargo = plan.deliveries.length;
      const exportIds = exportsFor(world, type, p.id);
      const exports = exportIds.map((id) => world.goods[id].name.toLowerCase());
      const dark = !isCharted(g, p.id);
      return `<li class="dest ${p.id === this.dest ? 'selected' : ''} ${plan.inRange ? '' : 'out'} ${dark ? 'uncharted' : ''}" data-action="dest" data-id="${p.id}" data-hover-dest="${p.id}">
        <span class="d-name">${esc(p.name)}${cargo ? ` <span class="tag good">${cargo} to deliver</span>` : ''}${dark ? ' <span class="tag">uncharted</span>' : ''}</span>
        <span class="d-meta">${plan.route.nm.toLocaleString('en-US')} nm · ${days(Math.round(plan.seaDays * 10) / 10)} · ${plan.inRange ? fuelAmt(plan.fuelNeeded) : 'out of range'}</span>
        <span class="d-exports ${exports.length && !dark ? '' : 'none'}">${dark ? 'Known only from rumour: a voyage of discovery' : exports.length ? `Exports for you: ${exportIds.map((id) => `<span class="gchip">${goodIcon(id, 16)}${esc(world.goods[id].name.toLowerCase())}</span>`).join(' ')}` : 'Exports nothing this ship can carry'}</span>
      </li>`;
    }).join('');
    return `
      ${this.newsCard()}
      ${this.captainCard()}
      ${this.waitControls()}
      ${this.dest ? this.planCard(planVoyage(g, ship.id, this.dest)!) : `<p class="hint">Where should the ${esc(ship.name)} go? Pick a destination below or tap a port on the map.</p>`}
      <p class="hint">"Exports for you" lists what each port ships that your ${esc(type.name.toLowerCase())} can carry.</p>
      <ul class="dests">${list}</ul>`;
  }

  /** A known price, with how old the news is. */
  private newsText(n: PriceNews, unit = ''): string {
    if (n.live) return `${money(n.price)}${unit} <span class="asof">today</span>`;
    return `${money(n.price)}${unit} <span class="asof" title="The latest letter from there">as of ${gameDate(n.asOf)}</span>`;
  }

  /** Where a good sells best, by the news you have. */
  private bestMarkets(good: string, except: string, n = 2): string {
    const best = bestKnownMarkets(world, this.g, good, except).slice(0, n);
    return best.length ? best.map((b) => `${esc(world.ports[b.port].name)} ${this.newsText(b)}`).join(' · ') : 'no buyer you know of';
  }

  /** Goods on your own account aboard a ship (shown at sea too). */
  private ownGoods(ship: ShipState): string {
    const lots = ship.goods ?? [];
    if (!lots.length) return '';
    const here = isReady(this.g, ship) ? ship.location : null;
    return `<h3>Own goods aboard</h3><ul class="own-goods">${lots.map((l) => {
      const q = here ? goodsSaleQuote(world, this.g, here, l.good, l.tons) : null;
      const profit = q ? q.total - l.cost : 0;
      return `<li><div class="og-main">${goodIcon(l.good, 28)}<strong>${esc(world.goods[l.good].name)}</strong> · ${tons(l.tons)} <span class="hint">bought at ${money(Math.round(l.cost / l.tons))}/t in ${esc(world.ports[l.from].name)}</span></div>
        <div class="og-where hint">Best known: ${this.bestMarkets(l.good, here ?? '')}</div>
        <div class="btn-row">${here ? (q ? `<button class="btn small ${profit >= 0 ? 'primary' : 'loss'}" data-action="sell-goods" data-good="${l.good}">Sell all here<span>${money(q.total)} · ${money(profit, true)}</span></button>`
          : `<span class="hint">Nobody here buys it.</span>`) : ''}
          <button class="btn small ghost jettison" data-action="jettison-goods" data-good="${l.good}" title="Throw it overboard: you lose what it cost">Jettison</button></div>
      </li>`;
    }).join('')}</ul>`;
  }

  /** For the voyage plan: what your own goods should fetch at the destination, by the news you have. */
  private goodsOutlook(ship: ShipState, dest: string): string {
    const lots = ship.goods ?? [];
    if (!lots.length) return '';
    const name = world.ports[dest].name;
    const rows = lots.map((l) => {
      const n = priceNews(world, this.g, dest, l.good);
      const wanted = world.ports[dest].demands.some((d) => d.good === l.good);
      const good = esc(world.goods[l.good].name.toLowerCase());
      if (!wanted || !n) return `<li>${goodIcon(l.good, 18)} ${tons(l.tons)} of ${good}: nobody in ${esc(name)} buys it.</li>`;
      const value = n.price * l.tons;
      return `<li>${goodIcon(l.good, 18)} ${tons(l.tons)} of ${good}: ${esc(name)} paid ${this.newsText(n, '/t')}, ≈ ${compactMoney(value)} (${money(value - l.cost, true)} on cost).</li>`;
    }).join('');
    return `<div class="goods-outlook"><span class="lbl">Your own goods</span><ul>${rows}</ul></div>`;
  }

  /** Buy and sell on your own account (Age of Sail). */
  private tradeCard(ship: ShipState): string {
    if (!hasTrade(world)) return '';
    const g = this.g;
    const port = world.ports[ship.location];
    const type = typeOf(ship);
    const room = type.capacity - cargoTons(ship);
    const forSale = port.produces.map((x) => x.good).filter((good) => type.cargoClasses.includes(world.goods[good].cargoClass));
    const wanted = port.demands.map((d) => d.good);
    const buyBtn = (good: string, n: number | 'max', label: string) => {
      const t = n === 'max' ? room : Math.min(n, room);
      const q = t > 0 ? goodsBuyQuote(world, g, port.id, good, t) : null;
      return `<button class="btn small" data-action="buy-goods" data-good="${good}" data-tons="${n}" ${!q || q.total > g.cash ? 'disabled' : ''}>${label}<span>${q ? compactMoney(q.total) : '—'}</span></button>`;
    };
    const rows = forSale.map((good) => `<li>
        <div class="tg-main">${goodIcon(good, 28)}<strong>${esc(world.goods[good].name)}</strong> <b>${money(buyPrice(world, g, port.id, good)!)}/t</b></div>
        <div class="hint">Sells best in: ${this.bestMarkets(good, port.id)}</div>
        <div class="btn-row">${room > 10 ? buyBtn(good, 10, '+10 t') : ''}${room > 50 ? buyBtn(good, 50, '+50 t') : ''}${buyBtn(good, 'max', room > 0 ? `Fill ${tons(room)}` : 'Hold full')}</div>
      </li>`).join('');
    const wants = wanted.map((good) => `<span class="gchip">${goodIcon(good, 18)}${esc(world.goods[good].name.toLowerCase())} ${money(priceNews(world, g, port.id, good)!.price)}</span>`).join(' ');
    return `<section class="card trade-card">
      <h3>⚖ Trade on your own account</h3>
      <p class="hint">Buy goods here and sell them where they're wanted. Prices elsewhere are as of the latest letter from there: news travels by ship.</p>
      ${this.ownGoods(ship)}
      ${rows ? `<h4>For sale in ${esc(port.name)}</h4><ul class="trade-goods">${rows}</ul>` : `<p class="hint">${esc(port.name)} sells nothing your ${esc(type.name.toLowerCase())} can carry.</p>`}
      ${wants ? `<p class="hint"><strong>${esc(port.name)} buys:</strong> ${wants}</p>` : ''}
    </section>`;
  }

  /** Other nations' charts on sale in this port (Age of Sail). */
  private chartsCard(portId: string): string {
    const offers = chartOffers(world, this.g, portId);
    if (!offers.length) return '';
    return `<section class="card charts-card"><h3>🧭 Charts for sale</h3>${offers.map((o) => `
      <div class="chart-offer"><div><strong>${esc(o.name)}</strong><p class="hint">${esc(o.blurb)}</p></div>
        <button class="btn small" data-action="buy-chart" data-id="${o.id}" ${this.g.cash < o.price ? 'disabled' : ''}>Buy<span>${money(o.price)}</span></button></div>`).join('')}
    </section>`;
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
    if (!plan.inRange) warnings.push(`Beyond this ship's range (${fuelAmt(plan.fuelNeeded)} needed, ${isSail() ? 'the hold stores' : 'bunkers hold'} ${fuelAmt(type.bunkerCapacity)}). Plan a stop on the way.`);
    if (plan.strike) warnings.push(`Dock strike in ${name}: ${plan.strikeDays} extra days in port and double fees (included above).`);
    const normal = world.route(ship.location, plan.dest, [], fogFor(g), CHART_TUNING.unchartedPenalty);
    const dark = unchartedShare(world, g, plan.route.path);
    if (dark > 0) warnings.push(`A voyage of discovery: ${Math.round(dark * 100)}% of the way is uncharted water, slower going and more danger. Every league sailed gets charted${isCharted(g, plan.dest) ? '' : `, , and the first of your ships in ${name} will find it paying well above the usual for ${wantedGoods(world, plan.dest)}`}.`);
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
      : short ? `short by ${fuelAmt(Math.ceil(plan.fuelShort))}`
        : `reserve ${fuelAmt(Math.floor(reserve))}${fuelState === 'warn' ? ', thin: a storm could leave you adrift' : ''}`;
    const fuelBlock = `
      <div class="fuel-row ${fuelState}">
        <div><span class="lbl">${FUEL()}</span> <strong>${fuelAmt(Math.floor(ship.fuel))}</strong> aboard · leg needs <strong>${fuelAmt(plan.fuelNeeded)}</strong> · <em>${fuelText}</em></div>
        ${plan.inRange && !short && topUp > 0 ? `<button class="btn small" data-action="fuel-for-leg">+${fuelAmt(topUp)} reserve<span>${money(topUp * price)}</span></button>` : ''}
      </div>`;
    const loss = plan.estimatedNet < 0 ? ` <span>estimate ${money(plan.estimatedNet)}</span>` : '';
    const sailButton = !plan.inRange
      ? `<button class="btn primary wide" disabled>Out of range</button>`
      : short
        ? `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="bunker-sail">${isSail() ? 'Victual' : 'Bunker'} ${fuelAmt(topUp)} (${money(topUp * price)}) &amp; ${isSail() ? 'set sail' : 'cast off'}${loss}</button>`
        : `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="sail">Cast off for ${esc(name)}${loss}</button>`;
    const total = plan.seaDays + RULES.portDays + plan.strikeDays;
    return `
      <section class="card plan">
        <h3>${esc(ship.name)} to ${esc(name)}</h3>
        <div class="plan-facts">
          <div><strong>${plan.route.nm.toLocaleString('en-US')}</strong><span>nm</span></div>
          <div><strong>${days(Math.round(total * 10) / 10)}</strong><span>incl. port</span></div>
          <div><strong>${fuelAmt(plan.fuelNeeded)}</strong><span>${FUEL().toLowerCase()}</span></div>
          <div><strong>${gameDate(g.day + total)}</strong><span>ready</span></div>
        </div>
        ${plan.route.canals.length ? `<p class="hint">Via the ${plan.route.canals.map((c) => world.canals[c].name).join(' and ')}.</p>` : ''}
        <div class="ledger">
          ${line('Freight revenue', plan.revenue, 'good')}
          ${line('Upkeep', -plan.upkeep)}
          ${line(`Port fee ${name}`, -plan.portFee)}
          ${plan.services ? line('Pilot & tugs (dock yourself to save it)', -plan.services) : ''}
          ${plan.canalFees ? line('Canal dues', -plan.canalFees) : ''}
          ${line(`${isSail() ? 'Victuals eaten' : 'Fuel burned'} (at ${money(price)}${perFuel()})`, -fuelValue)}
          <div class="line total ${plan.estimatedNet >= 0 ? 'good' : 'bad'}"><span>Estimated result</span><span>${money(plan.estimatedNet, true)}</span></div>
          <div class="line per-day"><span>per day</span><span>${money(plan.estimatedNet / total, true)}</span></div>
        </div>
        ${fuelBlock}
        ${warnings.length ? `<ul class="warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${this.goodsOutlook(ship, plan.dest)}
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
      <button class="btn ghost wide" data-action="games">Your games · new game</button>
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
      this.view = 'port';
      this.dest = null;
      this.marketPort = null;
      this.tab = 'contracts';
    }
    if (report.revenue > 0) {
      this.map.flashAt(this.map.portPosition(report.to), money(report.revenue, true), 'good');
      this.map.pulseAt(this.map.portPosition(report.to), 'good');
      setTimeout(() => sound.play('coins'), 500);
    }
    this.render();
    this.showReport(report);
  }

  /** The start screen: your saved games, and a new one. */
  private showGames(): void {
    saveGame(this.g);
    const current = activeSlot();
    const slots = listSlots();
    const era = (x: SlotInfo) => (x.era === 'sail' ? 'Age of Sail · from 1650' : 'Modern · from 2000');
    const ago = (t: number) => {
      const d = Math.floor((Date.now() - t) / 86_400_000);
      return d <= 0 ? 'played today' : d === 1 ? 'played yesterday' : `played ${new Date(t).toLocaleDateString()}`;
    };
    const rows = slots.map((x) => `
      <li class="slot-row ${x.era} ${x.id === current ? 'current' : ''}">
        <div class="slot-main">
          <span class="slot-era">${esc(era(x))}${x.id === current ? ' · <b>open now</b>' : ''}</span>
          <strong>${esc(x.name)}</strong>
          <span class="sub">${gameDate(x.day)} · ${x.ships} ship${x.ships === 1 ? '' : 's'} · worth ${compactMoney(x.worth)} · ${ago(x.lastPlayed)}</span>
        </div>
        <div class="slot-btns">
          ${x.id === current ? '<button class="btn small primary" data-action="close-games">Back to it</button>'
            : `<button class="btn small primary" data-action="slot-open" data-id="${x.id}">Open</button>`}
          <button class="btn small ghost" data-action="slot-rename" data-id="${x.id}">Rename</button>
          ${x.id === current ? '' : `<button class="btn small ghost" data-action="slot-delete" data-id="${x.id}">Delete</button>`}
        </div>
      </li>`).join('');
    $('#modal').classList.add('wide');
    $('#modal-body').innerHTML = `
      <h2>Your games</h2>
      <p class="sub">Each game keeps its own clock. Open another, and this one waits where you left it.</p>
      <ul class="slot-list">${rows}</ul>
      <h3>New game</h3>
      <label class="new-name">Company name <input id="new-name" type="text" maxlength="40" value="${esc(this.suggestName(slots))}"></label>
      <div class="era-cards">
        <button class="era-card modern" data-action="slot-new" data-era="modern">
          <strong>Modern · from 2000</strong><span>Steel, diesel and containers: start with an old coaster and $150,000.</span><em>Start</em></button>
        <button class="era-card sail" data-action="slot-new" data-era="sail">
          <strong>Age of Sail · from 1650</strong><span>Fluyts, monsoons and spice: found a merchant house in Amsterdam with a little jacht and ƒ150,000.</span><em>Start</em></button>
      </div>
      <button class="btn ghost wide" data-action="close-games">Close</button>`;
    $('#modal').hidden = false;
  }

  private suggestName(slots: SlotInfo[]): string {
    const base = ['Northern Star Lines', 'Blue Anchor Shipping', 'Harbour & Sons', 'Meridian Freight', 'Tradewind Co.', 'Albatross Line'];
    return base.find((n) => !slots.some((x) => x.name === n)) ?? `Company ${slots.length + 1}`;
  }

  /** Open another saved game (this one is saved first). */
  private switchTo(id: string): void {
    saveGame(this.g);
    const g = loadSlot(id);
    if (!g) { this.toast('That game could not be read.', 'bad'); return; }
    setActiveSlot(id);
    if ((g.era ?? 'modern') !== currentEra()) { reloadForEra(); return; }
    this.loadInto(g);
    this.toast(`Opened ${listSlots().find((x) => x.id === id)?.name ?? 'the game'}.`, 'good');
  }

  /** Put a game on the table: reset what the screen remembers about the last one. */
  private loadInto(g: GameState): void {
    this.g = g;
    const waiting = shipsNeedingDecision(g);
    this.activeId = (waiting[0] ?? g.fleet[0]).id;
    this.dest = null;
    this.hoverDest = null;
    this.marketPort = null;
    this.areaDraft = null;
    this.routesHidden = false;
    this.storms = [];
    this.tab = 'contracts';
    // Show the new game's cash straight away (no counting from the old game's figure).
    this.shownCash = null;
    this.cashTarget = null;
    this.view = waiting.length ? 'port' : 'map';
    $('#modal').hidden = true;
    $('#modal').classList.remove('wide');
    this.pause(waiting.length ? 'decision' : 'user');
    this.drainAutoReports();
    this.render();
    if (this.g.reports.length) this.showNextReport();
  }

  /** For a ship you command: take her in yourself instead of the pilot. */
  private dockOffer(r: VoyageReport): string {
    const s = this.g.fleet.find((x) => x.id === r.shipId);
    const d = s?.docking;
    if (!s || !d || s.voyage || s.location !== r.to) return '';
    return `<div class="dock-offer">
      <button class="btn wide" data-action="dock-yourself" data-id="${s.id}">⚓ Dock her yourself · save ${money(d.services)}</button>
      <span class="hint">A perfect docking also gets the port fee (${money(d.portFee)}) waived. Bumps cost condition. Or the pilot takes her in (paid above).</span>
    </div>`;
  }

  private dockingGame: DockingGame | null = null;

  private startDocking(shipId: number): void {
    const s = this.g.fleet.find((x) => x.id === shipId);
    const d = s?.docking;
    if (!s || !d) return;
    const type = typeOf(s);
    const port = world.ports[s.location];
    $('#modal').hidden = true;
    // Wind and current vary from day to day.
    const strength = 0.25 + 0.6 * ((Math.sin(this.g.day * 1.37 + port.lon) + 1) / 2);
    this.dockingGame = new DockingGame({
      portId: port.id, portName: port.name, shipName: s.name, length: shipLength(type.id, type.capacity), family: shipFamily(type),
      strength, services: d.services, portFee: d.portFee, money,
      onDone: (result) => {
        this.dockingGame = null;
        if (result) {
          if (this.act((g) => dockByHand(g, shipId, result))) {
            sound.play('coins');
            this.toast(result.perfect ? `Perfect! Pilot, tugs and port fee saved.` : `Moored: pilot and tugs saved${result.damage ? `, ${result.damage}% condition lost to bumps` : ''}.`, 'good');
          }
        }
        if (this.g.reports.length) this.showNextReport();
        else this.render();
      },
    });
  }

  private showReport(r: VoyageReport): void {
    $('#modal').classList.remove('wide');
    const line = (label: string, v: number, cls = '') => `<div class="line ${cls}"><span>${esc(label)}</span><span>${money(v, true)}</span></div>`;
    const more = this.g.reports.length;
    $('#modal-body').innerHTML = `
      ${this.g.fleet.some((s) => s.id === r.shipId) ? `<div class="report-art">${shipSideView(typeOf(getShip(this.g, r.shipId)), 240)}</div>` : ''}
      <h2>${esc(r.shipName)} arrived in ${esc(world.ports[r.to].name)}</h2>
      <p class="sub">${r.distance.toLocaleString('en-US')} nm from ${esc(world.ports[r.from].name)} in ${days(Math.round((r.arriveDay - r.departDay) * 10) / 10)} · ${fuelAmt(r.fuelUsed)} ${isSail() ? 'eaten' : 'fuel burned'} · condition −${r.conditionLoss}%</p>
      ${r.events.length ? `<ul class="events">${r.events.map((e) => `<li class="${e.kind}"><span>Day ${e.day}</span> ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="calm">A calm passage.</p>'}
      ${r.discovered?.length ? `<div class="discovery"><h3>Discovery!</h3><p>The first of your ships to reach ${r.discovered.map((id) => esc(world.ports[id].name)).join(' and ')}. ${r.discovered.map((id) => `${esc(world.ports[id].name)} pays well above the usual for ${esc(wantedGoods(world, id))} for the next few months`).join('; ')}, and charters to it now appear on the quays.</p></div>`
        : r.charted ? `<p class="charted">🧭 Charted ${r.charted} new stretch${r.charted > 1 ? 'es' : ''} of water on the way.</p>` : ''}
      ${r.news.length ? `<div class="news-in-report"><h3>News while at sea</h3><ul>${r.news.map((n) => `<li>📰 ${esc(n)}</li>`).join('')}</ul></div>` : ''}
      <div class="ledger">
        ${r.deliveries.map((d) => `<div class="line good"><span class="gline">${goodIcon(d.contract.good, 22)}${esc(`${world.goods[d.contract.good].name}, ${tons(d.contract.tons)}${d.lateDays > 0 ? ` (late, ${Math.round((d.paid / d.contract.pay) * 100)}% paid)` : ''}`)}</span><span>${money(d.paid, true)}</span></div>`).join('')}
        ${line('Upkeep on the way (paid daily)', -r.upkeep)}
        ${line('Port fee', -r.portFee)}
        ${r.services ? line('Pilot & tugs', -r.services) : ''}
        ${r.canalFees ? line('Canal dues', -r.canalFees) : ''}
        ${r.eventCosts ? line('Repairs & emergencies', -r.eventCosts, 'bad') : ''}
        <div class="line total ${r.net >= 0 ? 'good' : 'bad'}"><span>Result for the leg</span><span>${money(r.net, true)}</span></div>
      </div>
      ${r.marketNotes.length ? `<ul class="market-notes">${r.marketNotes.map((n) => `<li>▼ ${esc(n)}</li>`).join('')}</ul>` : ''}
      <div class="line memo"><span>Memo: ${isSail() ? 'victuals eaten, paid when victualling' : 'fuel burned, paid when bunkering'}</span><span>≈ ${money(r.fuelUsed * fuelPrice(this.g, r.from))}</span></div>
      ${this.dockOffer(r)}
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
        <p class="hint">${isSail() ? 'It has a few weeks of victuals aboard. Stock up and find it some cargo.' : 'It has a little fuel aboard. Bunker up and find it some cargo.'}</p>
        <button class="btn primary wide" data-action="close-report">Give it orders</button>
      </div>`;
    $('#modal').hidden = false;
  }

  private renderMute(): void {
    const mu = $('#music');
    mu.hidden = !world.era.wind;
    mu.classList.toggle('off', !sound.musicOn || !sound.enabled);
    mu.title = !sound.enabled ? 'Sound is off' : sound.musicOn ? 'Music on: tap to stop it' : 'Music off: tap to play it';
    mu.setAttribute('aria-pressed', String(sound.musicOn));
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
    { label: 'Burn', key: 'burn', val: `${s.burn.toFixed(s.burn < 10 ? 1 : 0)} ${isSail() ? 'casks' : 't'}/day`, higherIsBetter: false,
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
new App({ showStart: !justUpdated() && !eraSwitched() });
const updatedFrom = consumeUpdatedFrom();
if (updatedFrom) toast(`Updated from build ${updatedFrom} to build ${BUILD.number}.`, 'good', 4500);
void checkForUpdate();
