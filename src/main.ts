import './ui/style.css';
import { activeEvents, closedCanals, priceLevel, routeFor } from './sim/economy';
import { CHART_TUNING, chartOffers, fogFor, isCharted, wantedGoods } from './sim/charts';
import { bestKnownMarkets, buyPrice, goodsBuyQuote, goodsSaleQuote, hasTrade, priceNews, saleFactor, type PriceNews } from './sim/trade';
import {
  ActionError, LAID_UP, RULES, acceptContract, advance, atSea, borrow, buyFuel, buyShip, canCarry, cargoTons, clearOrders,
  assignCaptain, buyChart, callsOnTheWay, detour, onTheWay, setPlannedDest, type CallOnTheWay, buyGoods, sellGoods, captainOf, fireCaptain, hireCaptain, monthOf, monthProfit, onOrders, resumeOrders,
  dailyUpkeep, daysUntilNextShip, fuelPrice, getShip, inDryDock, isReady, isWaiting, needsDecision, newGame,
  dockByHand, planVoyage, foundSettlement, hasCharter, recruitSettlers, startBuilding, unloadAtSettlement, swapAtSettlement, loadFromSettlement, portFee, repair, repairQuote, repayLoan, sail, saleQuote, sellShip,
  shipsNeedingDecision, takeReport, typeOf, unloadContract, jettisonClaim, jettisonContract, jettisonGoods, voyageProgress, waitInPort, type VoyagePlan,
} from './sim/game';
import {
  clearSave, createSlot, deleteSlot, removeSlotByUid, listSlots, loadGame, loadSlot, renameSlot, saveGame, setActiveSlot, activeSlot, type SlotInfo,
} from './sim/save';
import {
  SHIP_TUNING, consumptionFactor, effectiveSpeed, exportsFor, fleetValue, legTrade, maxLoan, netWorth, quotePurchase, saleValue,
  stateValue,
} from './sim/ships';
import type { Captain, Contract, GameState, PremiumKind, ShipOffer, ShipState, ShipTypeDef, VoyageReport } from './sim/types';
import { currentEra, currentHouse, getWorld, setEra } from './sim/world';
import { currentChapter, guideChapters, updateGuide, type GuideChapter } from './sim/guide';
import { BUILDINGS, SETTLEMENT_TUNING, SITES, STAGE_NAMES, bringList, sawmillResting, stageGoals, storeGoods, warehouseRoom, warehoused, workshopsResting, buildDays, cannotBuild, count as bcount, eats, foodDays, grows, housing, nextStageNeeds, siteOf, roomFor, storeRoom, stored, willing, yardStored, fish, STAGES, dues, jobs, making as makingNow, products, staffed } from './sim/settlement';
import { compactMoney, currency, days, esc, gameDate, money, setEraFormat, startYear, tons } from './ui/format';
import { mapIconPath, shipFamily, shipSideView } from './ui/art';
import { applyCheck, changedSinceSync, checkCloud, clearConfig, CloudError, defaultDeviceName, findOrCreateGist, loadConfig, saveConfig, type Check, type CloudGame, type SyncedSlot } from './cloud';
import { CLASS_LABEL, goodIcon } from './ui/goods-icons';
import { GlMapView as MapView } from './ui/map-gl';
import { type LonLat, type PortMarker, type ShipMarker, type WeatherCell } from './ui/map';
import { PortScene, shipLength, type SceneShip, type TimeOfDay } from './ui/port-scene';
import { DockingGame } from './ui/docking-game';
import { barChart, lineChart, miniBars, type ChartPoint } from './ui/charts';
import { captainSlots } from './sim/captains';
import { areaName, areaPorts, region, regionOf, regions } from './sim/regions';
import { sound } from './ui/sound';
import { townBell } from './ui/port-scene-sail';
import { weatherAt, type Weather } from './sim/weather';
import { SARABANDE } from './ui/music';
import { NANYANG } from './ui/music-nanyang';
import { BUILD, consumeUpdatedFrom, initServiceWorker, isNewer, justUpdated, latestBuild, reloadApp } from './ui/update';

/** The side panel: the selected ship's orders, the settlement, the fleet, the company. */
type Tab = 'orders' | 'settlement' | 'fleet' | 'company';
/** Why the clock is stopped: the player paused it, or a ship (or an arrival report) needs the player. */
type PauseReason = 'user' | 'arrival' | 'decision';

let world = getWorld();

/** Set the engine, the formats and the look for a game's era. */
function applyEra(era: 'modern' | 'sail', house?: 'dutch' | 'chinese'): void {
  setEra(era, house);
  world = getWorld();
  setEraFormat(world.era.startYear, world.era.currency);
  document.documentElement.classList.toggle('era-sail', era === 'sail');
  // The Age of Sail has its own music (it starts with the first tap, as browsers require).
  sound.setMusicWanted(era === 'sail', house === 'chinese' ? NANYANG : SARABANDE);
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
/** A saved game's date in its own era's calendar. */
function slotDate(x: SlotInfo): string {
  const d = new Date(Date.UTC(x.era === 'sail' ? 1650 : 2000, 0, 1) + Math.floor(x.day) * 86_400_000);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

/** A saved game's net worth in its own era's money. */
function slotMoney(x: SlotInfo): string {
  const c = x.era === 'sail' ? 'ƒ' : '$';
  const a = Math.abs(x.worth);
  return `${x.worth < 0 ? '−' : ''}${c}${a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${Math.round(a / 1e3)}k` : Math.round(a).toLocaleString('en-US')}`;
}

/** Set while the page reloads into another era: nothing may save the old game into the new slot then. */
let reloading = false;
function reloadForEra(): void {
  reloading = true;
  try { sessionStorage.setItem(ERA_SWITCH, '1'); } catch { /* the start screen shows, no harm */ }
  location.reload();
}
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Game days per real second at 1× speed. */
const DAYS_PER_SECOND = 1;
const TICK_MS = 100;
/**
 * Real seconds per "day" of harbour weather. The weather in the port view keeps its own pace,
 * whatever the game speed (and while the clock waits): a spell holds about three of these. The
 * season still follows the game's date. Weather is only for the picture and the sound.
 */
const WEATHER_SECONDS_PER_DAY = 4;
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
/** The cargo board's orders, in the order the toggle steps through them. */
const CONTRACT_SORTS = { perDay: 'Pay per day', pay: 'Total pay', dest: 'Destination A–Z' };
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
  return 'perDay';
}
class App {
  private g: GameState;
  private activeId: number;
  private tab: Tab = 'orders';
  private dest: string | null = null;
  private hoverDest: string | null = null;
  private marketPort: string | null = null;
  private contractSort: ContractSort = loadContractSort();
  /** What the big area shows: the world map, or the selected ship in port. */
  /** The map, the selected ship's port, or your settlement's harbour (from wherever you are). */
  private view: 'map' | 'port' | 'colony' = 'map';
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
  private lastWeather = 0;
  /** The panel section a tap came from and where it was on screen: kept in place across the redraw. */
  private anchor: { key: string; top: number } | null = null;
  private tickerOpen = false;
  private storms: { id: string; at: LonLat; from: number; until: number; seed: number }[] = [];
  private shownCash: number | null = null;
  private cashAnim = 0;
  private cashTarget: number | null = null;
  private map: MapView;

  constructor(opts: { showStart: boolean } = { showStart: false }) {
    const loaded = loadGame();
    applyEra(loaded?.era ?? 'modern', loaded?.house);
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
    // Thunder follows the lightning by a moment.
    this.portScene.onLightning = () => setTimeout(() => sound.play('thunder'), 400 + Math.random() * 1400);
    this.portScene.onAmbient = () => { sound.setAmbientOn(!sound.ambientOn); this.portScene.setAmbientButton(sound.ambientOn); };
    this.portBtn = document.createElement('button');
    this.portBtn.className = 'port-open';
    this.portBtn.textContent = '⚓ Port view';
    this.portBtn.hidden = true;
    this.portBtn.addEventListener('click', () => { this.view = 'port'; this.renderView(); });
    $('#map').appendChild(this.portBtn);

    document.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
      // Dropdowns act on 'change' (below); handling their click would redraw the panel and close them.
      if (t && t.tagName !== 'SELECT' && !t.hasAttribute('disabled')) {
        const sec = t.closest<HTMLElement>('#panel-body [data-anchor]');
        this.anchor = sec ? { key: sec.dataset.anchor!, top: sec.getBoundingClientRect().top } : null;
        try { this.handle(t.dataset.action!, t.dataset); } finally { this.anchor = null; }
      }
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
    // Cloud saves: check the cloud for newer saves now, then keep it up to date while playing.
    setTimeout(() => void this.cloudSync('launch'), 400);
    setInterval(() => {
      const cfg = loadConfig();
      if (!cfg || document.visibilityState !== 'visible') return;
      if (changedSinceSync(cfg) || Date.now() - (cfg.lastSync ?? 0) > 10 * 60_000) void this.cloudSync('timer');
    }, 90_000);
    document.addEventListener('visibilitychange', () => {
      if (!loadConfig()) return;
      if (document.visibilityState === 'hidden') {
        this.hiddenAt = Date.now();
        if (reloading) return;
        saveGame(this.g);
        if (changedSinceSync(loadConfig()!)) void this.cloudSync('hidden');
      } else if (Date.now() - this.hiddenAt > 60_000) {
        // Back after a while (perhaps after playing on another device): check the cloud again.
        void this.cloudSync('launch');
      }
    });
  }

  // ---------------------------------------------------------------- cloud saves

  private syncing = false;
  private hiddenAt = Date.now();
  private cloudWarned = false;
  private cloudAsk: { choices: Record<string, 'cloud' | 'device'>; resolve: (c: Record<string, 'cloud' | 'device'>) => void } | null = null;

  /**
   * Sync with the cloud: pull newer saves, push this device's, and ask when the game that's
   * open has a newer copy in the cloud, or a game was played on both devices since the last sync.
   */
  private async cloudSync(reason: 'launch' | 'timer' | 'hidden' | 'manual'): Promise<void> {
    const cfg = loadConfig();
    if (!cfg || this.syncing || reloading) return;
    this.syncing = true;
    try {
      saveGame(this.g);
      const check = await checkCloud(cfg);
      const d = check.decision;
      const activeUid = listSlots().find((x) => x.id === activeSlot())?.uid;
      const asks = d.conflicts.length > 0 || d.pull.some((g) => g.info.uid === activeUid) || d.removeLocal.some((t) => t.uid === activeUid);
      let choices: Record<string, 'cloud' | 'device'> = {};
      if (asks) {
        if (reason === 'hidden') return; // ask when the game is in front again
        choices = await this.askCloud(check, activeUid);
        // Keeping this device's copy of the open game: push it instead of pulling or deleting it.
        if (activeUid && choices[activeUid] === 'device') {
          d.pull = d.pull.filter((g) => g.info.uid !== activeUid);
          d.removeLocal = d.removeLocal.filter((t) => t.uid !== activeUid);
          if (!d.conflicts.some((c) => c.uid === activeUid)) d.push.push(activeUid);
        }
      }
      const res = await applyCheck(check, choices);
      const open = activeSlot();
      if (activeUid && res.removed.includes(activeUid)) {
        this.toast('The game you had open was deleted on another device.', 'bad');
        this.showGames();
      } else if (activeUid && res.replaced.includes(activeUid) && open) {
        const g = loadSlot(open);
        if (g) {
          const from = [...d.pull, ...d.conflicts.map((c) => c.cloud)].find((x) => x.info.uid === activeUid);
          this.loadInto(g);
          this.toast(`Loaded the save from ${from?.savedBy ?? 'the cloud'}.`, 'good');
        }
      } else if (!$('#modal').hidden && document.querySelector('.slot-list')) this.showGames();
      const pulledOthers = res.replaced.filter((u) => u !== activeUid).length;
      if (reason === 'manual') this.toast(pulledOthers ? `Synced: ${pulledOthers} game${pulledOthers > 1 ? 's' : ''} updated from the cloud.` : 'Synced with the cloud.', 'good');
      this.cloudWarned = false;
    } catch (e) {
      const msg = e instanceof CloudError ? e.message : 'Something went wrong with the cloud save.';
      const fresh = loadConfig();
      if (fresh) saveConfig({ ...fresh, lastError: msg });
      if (reason === 'manual' || !this.cloudWarned) this.toast(`Cloud save: ${msg}`, 'bad');
      this.cloudWarned = true;
    } finally {
      this.syncing = false;
    }
  }

  /** "Device or cloud?" for the open game and any game played on both sides. Resolves with the choices. */
  private askCloud(check: Check, activeUid: string | undefined): Promise<Record<string, 'cloud' | 'device'>> {
    this.pause('decision');
    const local = new Map(listSlots().map((x) => [x.uid!, x]));
    type Item = { uid: string; mine?: SyncedSlot; cloud?: CloudGame; both: boolean; deletedAt?: number };
    const items: Item[] = [
      ...check.decision.conflicts.map((c) => ({ uid: c.uid, mine: c.local, cloud: c.cloud, both: true })),
      ...check.decision.pull.filter((g) => g.info.uid === activeUid).map((g) => ({ uid: g.info.uid, mine: local.get(g.info.uid) as SyncedSlot | undefined, cloud: g, both: false })),
      ...check.decision.removeLocal.filter((t) => t.uid === activeUid).map((t) => ({ uid: t.uid, mine: local.get(t.uid) as SyncedSlot | undefined, both: false, deletedAt: t.at })),
    ];
    const choices: Record<string, 'cloud' | 'device'> = {};
    for (const it of items) choices[it.uid] = it.cloud && (!it.mine || it.cloud.info.lastPlayed >= it.mine.lastPlayed) ? 'cloud' : 'device';
    return new Promise((resolve) => {
      this.cloudAsk = { choices, resolve };
      this.renderCloudAsk(items);
    });
  }

  private cloudAskItems: Parameters<App['renderCloudAsk']>[0] = [];

  private renderCloudAsk(items: { uid: string; mine?: SyncedSlot; cloud?: CloudGame; both: boolean; deletedAt?: number }[]): void {
    this.cloudAskItems = items;
    const ch = this.cloudAsk!.choices;
    const ago = (t: number) => {
      const m = Math.round((Date.now() - t) / 60_000);
      return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString();
    };
    const facts = (x: SyncedSlot) => `${slotDate(x)} · ${x.ships} ship${x.ships === 1 ? '' : 's'} · worth ${slotMoney(x)}`;
    const opt = (uid: string, side: 'cloud' | 'device', title: string, body: string) =>
      `<button class="cloud-opt ${ch[uid] === side ? 'on' : ''}" data-action="cloud-pick" data-id="${uid}" data-side="${side}" aria-pressed="${ch[uid] === side}">
        <strong>${title}</strong><span>${body}</span></button>`;
    const rows = items.map((it) => {
      const name = esc((it.cloud?.info ?? it.mine)!.name);
      const cloudSide = it.cloud ? opt(it.uid, 'cloud', `Cloud · saved on ${esc(it.cloud.savedBy)}, ${ago(it.cloud.info.lastPlayed)}`, facts(it.cloud.info))
        : opt(it.uid, 'cloud', 'Delete it here too', `Deleted on another device ${ago(it.deletedAt ?? Date.now())}`);
      const mine = it.mine ? opt(it.uid, 'device', `This device · ${ago(it.mine.lastPlayed)}`, facts(it.mine)) : '';
      return `<li class="cloud-item"><h3>${name}</h3>
        <p class="sub">${it.both ? 'Played on this device and on another one since the last sync. Pick the one to keep; the other copy is replaced.'
          : it.cloud ? 'The cloud has a newer save of this game.' : ''}</p>
        <div class="cloud-opts">${cloudSide}${mine}</div></li>`;
    }).join('');
    $('#modal').classList.add('wide');
    $('#modal-body').innerHTML = `<h2>☁ Device or cloud?</h2><ul class="cloud-items">${rows}</ul>
      <button class="btn primary wide" data-action="cloud-continue">Continue</button>`;
    $('#modal').hidden = false;
  }

  /** Connect this device to the player's saves gist, then sync. */
  private async cloudConnect(): Promise<void> {
    const token = (document.getElementById('cloud-token') as HTMLInputElement | null)?.value.trim() ?? '';
    const device = (document.getElementById('cloud-device') as HTMLInputElement | null)?.value.trim() || defaultDeviceName();
    if (!token) { this.toast('Paste a GitHub token first.', 'bad'); return; }
    const btn = document.querySelector<HTMLButtonElement>('[data-action="cloud-connect"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    try {
      const gistId = await findOrCreateGist({ token, device, synced: {} });
      // A fresh install's untouched starter game shouldn't clutter the cloud.
      const slots = listSlots();
      const blank = slots.length === 1 && slots[0].day === 0 ? slots[0] : null;
      saveConfig({ token, device, gistId, synced: {} });
      if (blank) {
        const check = await checkCloud(loadConfig()!);
        if (check.bundle && check.bundle.games.length) {
          await applyCheck({ ...check, decision: { ...check.decision, push: check.decision.push.filter((u) => u !== blank.uid) } });
          const newest = listSlots().filter((x) => x.id !== blank.id).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
          if (newest) {
            setActiveSlot(newest.id);
            // Never in the cloud: remove it without recording a deletion for the other devices.
            removeSlotByUid(blank.uid!);
            this.toast(`Connected. Opening ${newest.name} from the cloud.`, 'good');
            const g = loadSlot(newest.id);
            if (g && ((g.era ?? 'modern') !== currentEra() || (g.era === 'sail' ? g.house ?? 'dutch' : undefined) !== currentHouse())) { reloadForEra(); return; }
            if (g) this.loadInto(g);
            return;
          }
        }
      }
      this.toast('Connected to your cloud saves.', 'good');
      await this.cloudSync('launch');
      if (!$('#modal').hidden && document.querySelector('.slot-list')) this.showGames();
    } catch (e) {
      this.toast(`Couldn't connect: ${e instanceof CloudError ? e.message : 'something went wrong.'}`, 'bad');
      if (btn) { btn.disabled = false; btn.textContent = 'Connect'; }
    }
  }

  /** The "Cloud saves" section of the games screen. */
  private cloudCard(): string {
    const cfg = loadConfig();
    if (!cfg) {
      return `<section class="cloud-card">
        <h3>☁ Cloud saves</h3>
        <p class="sub">Keep your games in sync between your devices, through a private gist on your GitHub account.
          When you open the game, it checks which save is newer: this device's or the cloud's.</p>
        <details><summary>How to get a token</summary>
          <ol class="cloud-help">
            <li>On github.com open <b>Settings → Developer settings → Personal access tokens → Tokens (classic)</b>.</li>
            <li>Choose <b>Generate new token (classic)</b>, give it a name such as "Here Be Dragons", and tick only <b>gist</b>.</li>
            <li>Copy the token and paste it below. Do the same on each device (the same token works everywhere).</li>
          </ol>
          <p class="sub">The token stays on this device only and can do nothing but read and write your gists.</p>
        </details>
        <label class="cloud-field">GitHub token <input id="cloud-token" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_…"></label>
        <label class="cloud-field">This device <input id="cloud-device" type="text" maxlength="30" value="${esc(defaultDeviceName())}"></label>
        <button class="btn primary" data-action="cloud-connect">Connect</button>
      </section>`;
    }
    const when = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'not yet';
    return `<section class="cloud-card on">
      <h3>☁ Cloud saves · on</h3>
      <p class="sub">This device: <b>${esc(cfg.device)}</b> · last synced ${esc(when)}${cfg.gistId ? ` · gist ${esc(cfg.gistId.slice(0, 8))}…` : ''}</p>
      ${cfg.lastError ? `<p class="cloud-error">${esc(cfg.lastError)}</p>` : ''}
      <div class="btn-row"><button class="btn small primary" data-action="cloud-sync">Sync now</button>
        <button class="btn small ghost" data-action="cloud-off">Turn off on this device</button></div>
    </section>`;
  }

  private ship(): ShipState {
    return this.g.fleet.find((s) => s.id === this.activeId) ?? this.g.fleet[0];
  }

  // ------------------------------------------------------------ the clock

  private tick(): void {
    if (this.paused || !$('#modal').hidden || this.dockingGame || this.g.gameOver) {
      // The harbour goes on while the clock waits: the light moves at the 1× pace, the weather by its own clock.
      if (!this.g.gameOver && $('#modal').hidden) { this.sceneTime += TICK_MS / 1000; this.renderScenery(); }
      if ($('#modal').hidden && performance.now() - this.lastWeather > 1000) { this.lastWeather = performance.now(); if (this.portScene.visible) this.renderView(); this.renderTicker(); }
      return;
    }
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
    // The Cargo, Voyage, Ship, Fleet and settlement tabs show day-to-day things (offers, deadlines, voyage
    // progress, the settlement's people, stores and building): refresh them when the day changes, at most
    // once a second. Market and Log only change on actions.
    const dayChanged = Math.floor(this.g.day) !== this.renderedDay;
    const live = this.tab === 'orders' || this.tab === 'fleet' || this.tab === 'settlement';
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
    if (this.tab === 'company' || this.tab === 'fleet') this.tab = 'orders';
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
          this.selectShip(bought.id, 'orders');
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
        this.tab = 'orders';
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
      case 'go-via': {
        const final = this.dest;
        if (!final || !data.id) return;
        this.viaFinal = final;
        this.dest = data.id;
        this.routesHidden = false;
        this.tab = 'orders';
        break;
      }
      case 'clear-via':
        this.viaFinal = null;
        break;
      case 'clear-planned': {
        const sid = this.ship().id;
        this.act((g) => setPlannedDest(g, sid, null));
        this.dest = null;
        this.viaFinal = null;
        break;
      }
      case 'buy-goods':
        this.act((g) => buyGoods(g, this.activeId, data.good!, data.tons === 'max' ? Infinity : Number(data.tons)));
        break;
      case 'sell-goods':
        this.act((g) => sellGoods(g, this.activeId, data.good!));
        break;
      case 'colony-view':
        this.view = 'colony';
        this.renderView();
        // On a phone the picture is above the panel: bring it into sight.
        $('#map').scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      case 'found':
        if (this.act((g) => foundSettlement(g, data.id!))) { this.toast(`The charter is signed: ${world.ports[data.id!].name} is yours to settle.`, 'good'); sound.play('coins'); }
        break;
      case 'recruit':
        if (this.act((g) => recruitSettlers(g, ship.id, Number(data.n)))) this.toast(`${data.n} settlers aboard the ${ship.name}.`, 'good');
        break;
      case 'swap-settlement':
        this.act((g) => swapAtSettlement(g, ship.id, data.good ?? ''));
        break;
      case 'unload-settlement':
        this.act((g) => unloadAtSettlement(g, ship.id, data.good || undefined));
        break;
      case 'load-settlement':
        this.act((g) => loadFromSettlement(g, ship.id, data.good ?? ''));
        break;
      case 'build':
        if (this.act((g) => startBuilding(g, data.id!))) this.toast('Work begins.', 'good');
        break;
      case 'buy-chart':
        if (this.act((g) => buyChart(g, data.id!))) this.toast('The chart is yours: new waters open on the map.', 'good');
        break;
      case 'hire': {
        if (this.act((g) => hireCaptain(g, Number(data.id)))) {
          const c = this.g.captains![this.g.captains!.length - 1];
          this.toast(`Captain ${c.name} is on the payroll. Hand a ship over from its Orders tab.`, 'good');
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
      case 'news-toggle':
        this.tickerOpen = !this.tickerOpen;
        this.renderTicker();
        return;
      case 'contract-sort':
        this.contractSort = this.contractSort === 'perDay' ? 'pay' : this.contractSort === 'pay' ? 'dest' : 'perDay';
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
      case 'guide': this.showGuide(); return;
      case 'cloud-connect': void this.cloudConnect(); return;
      case 'cloud-sync': void this.cloudSync('manual'); return;
      case 'cloud-off':
        if (!confirm('Stop syncing on this device? Your games stay here and in the cloud.')) return;
        clearConfig();
        this.showGames();
        return;
      case 'cloud-pick':
        if (this.cloudAsk && data.id) { this.cloudAsk.choices[data.id] = data.side === 'device' ? 'device' : 'cloud'; this.renderCloudAsk(this.cloudAskItems); }
        return;
      case 'cloud-continue': {
        const ask = this.cloudAsk;
        if (!ask) return;
        this.cloudAsk = null;
        $('#modal').hidden = true;
        $('#modal').classList.remove('wide');
        ask.resolve(ask.choices);
        return;
      }
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
        const house = era === 'sail' ? (data.house === 'chinese' ? 'chinese' : 'dutch') : undefined;
        const input = document.getElementById('new-name') as HTMLInputElement | null;
        const name = input?.value.trim() || 'My shipping company';
        saveGame(this.g);
        const before = currentEra(), beforeHouse = currentHouse();
        setEra(era, house);
        const g = newGame();
        g.era = era;
        g.company = name;
        createSlot(g, name);
        setEra(before, beforeHouse);
        if (era !== before || house !== beforeHouse) { reloadForEra(); return; }
        this.loadInto(g);
        this.toast(`${name} is founded. Good luck!`, 'good');
        return;
      }
      case 'new-game':
        if (!this.g.gameOver && !confirm('Start this company over? Its current game will be lost.')) return;
        clearSave();
        this.g = { ...newGame(), era: this.g.era ?? 'modern', company: this.g.company };
        if (this.g.era === 'sail') this.g.house = currentHouse();
        this.activeId = this.g.fleet[0].id;
        this.dest = null;
        this.marketPort = null;
        this.tab = 'orders';
        $('#modal').hidden = true;
        saveGame(this.g);
        this.pause('decision');
        break;
    }
    this.render();
  }

  /** Set by "Go via": the destination to remember while the ship calls at `this.dest`. */
  private viaFinal: string | null = null;

  private selectShip(id: number, tab?: Tab): void {
    if (id !== this.activeId) {
      this.activeId = id;
      this.dest = null;
      this.viaFinal = null;
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

  /** Ready in port with a remembered destination ("Go via")? Then that's the destination to plan for. */
  private applyPlannedDest(): void {
    const ship = this.ship();
    if (!this.dest && ship.plannedDest && ship.plannedDest !== ship.location && isReady(this.g, ship)) this.dest = ship.plannedDest;
  }

  /** Calls on the way for the active ship's chosen destination (worked out once per state). */
  private callsCache: { g: GameState; key: string; calls: CallOnTheWay[] } | null = null;
  private calls(): CallOnTheWay[] {
    const ship = this.ship();
    if (!this.dest || !isReady(this.g, ship)) return [];
    const key = `${ship.id}>${this.dest}`;
    if (this.callsCache?.g !== this.g || this.callsCache.key !== key) this.callsCache = { g: this.g, key, calls: callsOnTheWay(this.g, ship.id, this.dest) };
    return this.callsCache.calls;
  }

  private selectDest(portId: string): void {
    const ship = this.ship();
    if (this.areaDraft?.shipId === ship.id) { const r = regionOf(portId); if (r) this.toggleRegion(r); return; }
    if (!isReady(this.g, ship)) return;
    this.dest = portId === ship.location ? null : portId;
    this.viaFinal = null;
    this.routesHidden = false;
    this.tab = 'orders';
    this.render();
  }

  private castOff(): void {
    if (!this.dest) return;
    const ship = this.ship();
    const via = this.viaFinal;
    // Going via a stop keeps (or sets) where she's ultimately bound; any other destination replaces it.
    const planned = via ?? (ship.plannedDest && ship.plannedDest !== this.dest ? null : ship.plannedDest ?? null);
    if (!this.act((g) => sail(setPlannedDest(g, ship.id, planned), ship.id, this.dest!))) { this.render(); return; }
    this.viaFinal = null;
    // A horn for a steamer; for a sailing ship, the sails filling with wind.
    sound.play(isSail() ? 'sails' : 'horn');
    this.dest = null;
    this.tab = 'orders';
    this.view = 'map';
    this.afterDecision();
    this.render();
  }

  // ------------------------------------------------------------ rendering

  private render(): void {
    this.applyPlannedDest();
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
    if (this.view === 'colony' && !(this.g.settlement && world.ports[this.g.settlement.site])) this.view = 'map';
    const selected = this.ship();
    const inPort = !atSea(selected);
    const colony = this.view === 'colony' ? this.g.settlement! : null;
    // Looking at the settlement: one of our ships lying there (the selected one first), or none.
    const here = (s: ShipState) => colony !== null && !atSea(s) && s.location === colony.site;
    const ship = colony ? (here(selected) ? selected : this.g.fleet.find(here) ?? null) : selected;
    if ((this.view === 'port' && inPort) || colony) {
      const docked = ship ? inDryDock(this.g, ship) : false;
      const port = world.ports[colony ? colony.site : selected.location];
      const time = this.timeOfDay(port.lon);
      const weather = isSail() ? this.weatherHere(port.id) : undefined;
      const settle = this.g.settlement?.site === port.id ? this.g.settlement : undefined;
      if (weather) {
        sound.setAmbience({
          bell: settle ? (['village', 'town', 'port'].includes(settle.stage) ? (world.era.house?.id === 'chinese' ? 'temple' : 'church') : 'none') : townBell(port.id),
          time, weather: { kind: weather.kind, wind: Math.round(weather.wind * 20) / 20 }, warm: Math.abs(port.lat) < 35,
          building: !!settle?.project,
        });
        this.portScene.setAmbientButton(sound.ambientOn);
      } else { sound.setAmbience(null); this.portScene.setAmbientButton(null); }
      this.portScene.show({
        weather,
        ship: this.sceneShip(ship ?? selected),
        noShip: !ship,
        place: docked ? 'dock' : 'quay',
        portId: port.id,
        portName: port.name,
        time,
        neighbours: this.g.fleet.filter((s) => s.id !== ship?.id && !atSea(s) && !inDryDock(this.g, s) && s.location === port.id)
          .map((s) => this.sceneShip(s)),
        dockDays: docked ? ship!.busyUntil! - this.g.day : undefined,
        settlement: this.g.settlement?.site === port.id ? {
          people: this.g.settlement.people, buildings: this.g.settlement.buildings,
          house: world.era.house?.id === 'chinese' ? 'chinese' : 'dutch', forest: SITES[port.id].forest > 0,
          stage: this.g.settlement.stage, project: this.g.settlement.project?.id,
          stageName: STAGE_NAMES[this.g.settlement.stage],
          projectName: this.g.settlement.project ? BUILDINGS.find((b) => b.id === this.g.settlement!.project!.id)?.name : undefined,
        } : undefined,
      });
      if (!this.portScene.visible || !this.miniShown) { this.miniShown = true; this.renderRoutes(); }
      this.portBtn.hidden = true;
    } else {
      this.portScene.hide();
      sound.setAmbience(null);
      this.miniShown = false;
      this.portBtn.hidden = !inPort || !world.era.portView;
    }
  }

  private sceneShip(s: ShipState): SceneShip {
    const type = typeOf(s);
    return {
      id: s.id, name: s.name, typeId: type.id, family: shipFamily(type),
      capacity: type.capacity, bunkerCapacity: type.bunkerCapacity,
      // What's in the hold: the cargo carried for others and goods on your own account.
      cargo: [...s.cargo, ...(s.goods ?? [])].map((c) => ({ good: c.good, cls: world.goods[c.good].cargoClass, tons: c.tons })),
      fuel: s.fuel, condition: s.condition,
    };
  }

  /** The weather in a port today. At your settlement, storms are the ones its news reports. */
  private weatherHere(portId: string): Weather {
    const p = world.ports[portId];
    const day = Math.floor(this.g.day);
    const month = new Date(Date.UTC(world.era.startYear, 0, 1) + day * 86_400_000).getUTCMonth();
    // Spells by the weather's own clock (real time), not the game's days.
    const wxDay = Math.floor(Date.now() / 1000 / WEATHER_SECONDS_PER_DAY);
    const s = this.g.settlement;
    if (s?.site === portId) {
      const storm = s.news.some((n) => /storm struck/i.test(n.text) && day - n.day >= 0 && day - n.day <= 1);
      if (storm) return { kind: 'storm', wind: 0.95, storm: weatherAt(p, wxDay, month).storm };
      return weatherAt(p, wxDay, month, false);
    }
    return weatherAt(p, wxDay, month);
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
    this.renderTicker();
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
    // The guide: the chapter being played and how far along it is (tap for the steps).
    this.announceGuide();
    this.announceSettlement();
    const ch = currentChapter(world, g);
    const done = ch ? ch.steps.filter((x) => x.done).length : 1, total = ch ? ch.steps.length : 1;
    $('#goal-bar').style.width = `${(done / total) * 100}%`;
    $('#goal-text').textContent = g.cash < 0
      ? `Overdraft · limit ${compactMoney(RULES.overdraftLimit)} · 18%/yr`
      : ch ? `${ch.n}. ${ch.title} · ${done}/${total}` : `Worth ${compactMoney(worth)}`;
    $('.goal').title = `The guide: your next steps. Net worth ${compactMoney(worth)} (cash + fleet value − loan).`;
  }

  private seenNews = '';
  /** News from the settlement since last time, as messages (two at most at once). */
  private announceSettlement(): void {
    const news = this.g.settlement?.news ?? [];
    const key = news.length ? `${news[0].day}|${news[0].text}` : '';
    if (!this.seenNews) { this.seenNews = key || '-'; return; }
    if (key === this.seenNews || !key) return;
    const fresh: typeof news = [];
    for (const n of news) { if (`${n.day}|${n.text}` === this.seenNews) break; fresh.push(n); }
    this.seenNews = key;
    for (const n of fresh.slice(0, 2).reverse()) this.toast(n.text, n.kind === 'bad' ? 'bad' : 'good');
  }

  /** Steps and chapters of the guide finished since last time: a message, and the chapter's end in a dialog. */
  private announceGuide(): void {
    // A brand-new game opens with the guide's first steps.
    const fresh = !this.g.guide && this.g.day < 1 && this.g.stats.voyages === 0;
    const news = updateGuide(world, this.g);
    if (fresh && $('#modal').hidden) { this.showGuide(); return; }
    for (const st of news.steps) {
      this.toast(`✓ ${st.title}`, 'good');
      this.g.log.unshift({ day: this.g.day, text: `Guide: ${st.title} — done.` });
    }
    const ch = news.chapters[news.chapters.length - 1];
    if (ch && $('#modal').hidden) this.showGuide(ch);
  }

  /** The guide: the chapter being played, its steps and how to do them; or a finished chapter's end. */
  private showGuide(finished?: GuideChapter): void {
    const g = this.g;
    const chapters = guideChapters(world, g);
    const cur = currentChapter(world, g);
    const steps = (c: GuideChapter) => `<ol class="guide-steps">${c.steps.map((st) => `
      <li class="${st.done ? 'done' : ''}"><span class="gs-tick" aria-hidden="true">${st.done ? '✓' : ''}</span>
        <div><strong>${esc(st.title)}</strong>${st.done ? '' : `<span class="hint">${esc(st.hint)}</span>`}
        ${st.progress && !st.done ? `<div class="gs-bar"><i style="width:${(st.progress[0] / st.progress[1]) * 100}%"></i></div><span class="gs-num">${st.progress[0].toLocaleString('en-US')} / ${st.progress[1].toLocaleString('en-US')}</span>` : ''}</div></li>`).join('')}</ol>`;
    const past = chapters.filter((c) => c.steps.every((st) => st.done) && c !== finished);
    $('#modal').classList.remove('wide');
    $('#modal-body').innerHTML = `
      ${finished ? `<p class="new-ship-kicker">Chapter ${finished.n} complete</p><h2>${esc(finished.title)}</h2><p class="guide-epilogue">${esc(finished.epilogue)}</p>` : ''}
      ${cur ? `<p class="lbl">${finished ? 'Next' : `Chapter ${cur.n} of ${chapters.length}`}</p><h2>${esc(cur.title)}</h2>${steps(cur)}`
        : `<h2>The guide</h2><p>Every chapter so far is done. The next ones arrive with coming builds.</p>`}
      <p class="sub">Your ${isSail() ? 'house' : 'company'} is worth ${money(netWorth(g, world))} (cash and ships, less the loan).</p>
      ${past.length && !finished ? `<details class="guide-past"><summary>Chapters done (${past.length})</summary><ul>${past.map((c) => `<li>${c.n}. ${esc(c.title)}</li>`).join('')}</ul></details>` : ''}
      <button class="btn primary wide" data-action="close-games">${finished ? 'On we go' : 'Close'}</button>`;
    $('#modal').hidden = false;
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
    const chips = g.fleet.map((s) => {
      const st = this.shipStatus(s);
      return `<button class="ship-chip ${st.state} ${s.id === ship.id ? 'selected' : ''}" data-action="select-ship" data-id="${s.id}">
        <span class="sc-art">${shipSideView(typeOf(s), 64)}</span>
        <span class="sc-name">${esc(s.name)}${st.state === 'ready' ? '<span class="sc-ready">Orders</span>' : ''}</span>
        <span class="sc-status">${esc(st.text)}</span>
        ${st.progress !== undefined ? `<span class="sc-bar"><span style="width:${(st.progress * 100).toFixed(1)}%"></span></span>` : '<span class="sc-bar placeholder"></span>'}
      </button>`;
    }).join('');
    // The selected ship's hold, victuals and condition are at the top of the Orders tab.
    $('#ship-strip').innerHTML = `<div class="fleet">${chips}</div>`;
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
    const viaPorts = new Set(this.calls().map((c) => c.port));
    const events = activeEvents(g);
    const here = ship.voyage ? null : ship.location;
    const markers: PortMarker[] = [...world.portList, ...(g.settlement && !world.portList.includes(world.ports[g.settlement.site]) ? [world.ports[g.settlement.site]] : [])].map((p) => ({
      id: p.id,
      name: p.name,
      fuelPrice: fuelPrice(g, p.id),
      role: p.id === here ? 'here'
        : p.id === (this.dest ?? ship.voyage?.to) || (this.areaDraft?.shipId === ship.id && areaPorts(this.areaDraft.regions).includes(p.id)) ? 'dest'
          : viaPorts.has(p.id) ? 'via' : cargoDests.has(p.id) ? 'cargo' : 'normal',
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
    const s = g.settlement;
    const short = s && s.people >= 1 && (s.hungry || foodDays(s, g.day) < 15);
    const tabs: [Tab, string, string?][] = [
      ['orders', 'Orders', needsDecision(g, ship) ? '!' : loadable ? String(loadable) : undefined],
      ...(s || hasCharter(g) ? [['settlement', s ? world.ports[s.site].name : 'Charter', short ? '!' : undefined] as [Tab, string, string?]] : []),
      ['fleet', 'Fleet', shipsNeedingDecision(g).length > 1 ? String(shipsNeedingDecision(g).length) : undefined],
      ['company', 'Company'],
    ];
    $('#tabs').innerHTML = tabs.map(([id, label, badge]) =>
      `<button class="tab ${this.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${this.tab === id}">
        ${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`).join('');
    const body = $('#panel-body');
    // Keep the scroll position and any opened details across redraws.
    const scroll = body.scrollTop;
    const open = new Set([...body.querySelectorAll<HTMLDetailsElement>('details[open][data-key]')].map((d) => d.dataset.key));
    body.innerHTML = {
      orders: () => this.ordersTab(), settlement: () => this.settlementTab(), fleet: () => this.fleetTab(), company: () => this.companyTab(),
    }[this.tab]();
    body.querySelectorAll<HTMLDetailsElement>('details[data-key]').forEach((d) => { if (open.has(d.dataset.key)) d.open = true; });
    if (this.renderedTab !== this.tab || this.renderedShip !== ship.id) {
      body.scrollTop = 0;
      this.renderedTab = this.tab;
      this.renderedShip = ship.id;
    } else {
      body.scrollTop = scroll;
      // What grew or shrank above the section you tapped in (Where to, as cargo is loaded) mustn't move it.
      const el = this.anchor && body.querySelector<HTMLElement>(`[data-anchor="${this.anchor.key}"]`);
      if (el && this.anchor) {
        const delta = el.getBoundingClientRect().top - this.anchor.top;
        const scrolls = body.scrollHeight > body.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(body).overflowY);
        if (Math.abs(delta) > 1) { if (scrolls) body.scrollTop += delta; else window.scrollBy(0, delta); }
        this.anchor = null;
      }
    }
    this.renderPorts();
    this.renderRoutes();
  }

  /** The settlement: choose a site under the charter; then its people, stores, buildings and news. */
  private settlementTab(): string {
    const g = this.g;
    const ship = this.ship();
    const s = g.settlement;
    if (!s) {
      const cards = world.siteList.map((p) => {
        const site = SITES[p.id];
        const can = g.cash >= site.charter;
        return `<div class="site-card">
          <div class="port-head"><div><h3 class="site-name">${esc(p.name)}</h3><span class="sub">${esc(p.country)} · ${Math.round(routeFor(world, g, world.era.start.port, p.id)?.nm ?? 0).toLocaleString('en-US')} nm from ${esc(world.ports[world.era.start.port].name)}</span></div></div>
          <p>${esc(site.blurb)}</p>
          <div class="chips">${site.plus.map((x) => `<span class="chip plus">${esc(x)}</span>`).join('')}${site.minus.map((x) => `<span class="chip minus">${esc(x)}</span>`).join('')}</div>
          <p class="sub">Charter ${money(site.charter)} · rent ${money(Math.round(site.charter * SETTLEMENT_TUNING.rent))} a year · up to ${site.fields} field${site.fields === 1 ? '' : 's'} and ${site.fishing} fishing boat${site.fishing === 1 ? '' : 's'}${site.forest ? ' · forest for a sawmill' : ''}</p>
          <button class="btn primary wide" data-action="found" data-id="${p.id}" ${can ? '' : 'disabled'}>Found the settlement at ${esc(p.name)}</button>
        </div>`;
      }).join('');
      return `<h2>A settlement of your own</h2>
        <p class="hint">The charter lets your house found one settlement, at one of these three sites, leased from the local ruler. Settlers come by your ships from ${esc(world.ports[world.era.start.port].name)}; they need food every day, and timber and iron and tools to build. With care it grows from a camp to an outpost, a village and a town, and at last opens as a port the world trades with.</p>
        <div class="site-cards">${cards}</div>`;
    }
    const site = siteOf(s);
    const name = world.ports[s.site].name;
    const look = world.era.portView ? `<button class="btn wide" data-action="colony-view">🏡 Look at ${esc(name)}</button>` : '';
    const days = foodDays(s, g.day);
    const daysText = s.people < 1 ? 'nobody there yet' : days === Infinity ? 'feeds itself' : `${Math.floor(days)} days`;
    const need = nextStageNeeds(s, g.day);
    const tons = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')} t`;
    const goodsHere = [...new Set(['rice', 'grain', 'timber', 'tools', ...Object.keys(s.stores)])];
    const store = goodsHere.filter((k) => (s.stores[k] ?? 0) > 0.05 || k === 'timber' || k === 'tools' || k === site.crop)
      .map((k) => `<div class="kv"><span>${esc(world.goods[k].name)}</span><strong>${tons(s.stores[k] ?? 0)}</strong></div>`).join('');
    const made = makingNow(s);
    const making = [grows(s, g.day) ? `${tons(grows(s, g.day))} of ${site.crop} a day from the fields` : '', fish(s) ? `${tons(fish(s))} of fish a day from the boats, eaten fresh` : '', bcount(s, 'sawmill') ? `${tons(site.forest)} of timber a day from the sawmill` : '',
      ...Object.entries(made).map(([good, t]) => `${tons(t)} of ${world.goods[good].name.toLowerCase()} a day from the workshops`)].filter(Boolean);
    const hands = jobs(s) ? `<p class="sub">Workshops need ${jobs(s)} hands; ${Math.round(staffed(s) * 100)}% at work (the first ${SETTLEMENT_TUNING.homeHands} people farm, fish and keep house).</p>` : '';
    // Its own goods, to load aboard a ship lying there (they cost nothing).
    const sellable = goodsHere.filter((k) => !['tools'].includes(k) && (s.stores[k] ?? 0) >= 1 && (products(s).includes(k) || k === 'timber' || k === site.crop));
    const loadBox = isReady(g, ship) && ship.location === s.site && sellable.length && s.stage !== 'camp'
      ? `<div class="settler-box"><p><strong>Load aboard the ${esc(ship.name)}</strong> (room for ${tons(Math.max(0, typeOf(ship).capacity - cargoTons(ship)))}): your own goods cost nothing; sell them anywhere they are wanted.</p>
        <div class="btn-row">${sellable.map((k) => `<button class="btn small primary" data-action="load-settlement" data-good="${k}">Load ${esc(world.goods[k].name.toLowerCase())} (${tons(s.stores[k]!)})</button>`).join('')}</div>
        ${sellable.some((k) => k === 'rice' || k === 'grain') ? `<p class="hint">Leave food enough in store: they eat ${tons(eats(s))} a day.</p>` : ''}</div>` : '';
    const portLine = s.stage === 'port' ? `<p class="o-good">${esc(name)} is an open port: other merchants call, its market trades with the world. Harbour dues ${money(Math.round(dues(s) * 30))} a month (${money(Math.round(s.dues ?? 0))} so far).</p>` : '';
    const project = s.project ? (() => {
      const b = BUILDINGS.find((x) => x.id === s.project!.id)!;
      const left = Math.max(0, (b.work - s.project!.done) / Math.max(1, s.people * SETTLEMENT_TUNING.workShare));
      return `<div class="building-now"><span class="lbl">Building now</span><strong>${esc(b.name)}</strong>
        <div class="gs-bar"><i style="width:${Math.min(100, (s.project!.done / b.work) * 100).toFixed(0)}%"></i></div><span class="sub">about ${Math.ceil(left)} day${Math.ceil(left) === 1 ? '' : 's'} left</span></div>`;
    })() : '';
    const buildable = BUILDINGS.filter((b) => b.max(site, { ...s, stage: 'port' }) > 0);
    const buildRows = buildable.map((b) => {
      const why = cannotBuild(g, s, b.id);
      const have = bcount(s, b.id);
      const locked = STAGES.indexOf(b.stage) > STAGES.indexOf(s.stage);
      const most = b.max(site, s);
      return `<li class="${locked ? 'locked' : ''}"><div class="b-main"><strong>${esc(b.name)}${have ? ` <span class="sub">· ${have}${most > 1 ? ` of ${most}` : ''}</span>` : ''}</strong>
          <span class="hint">${esc(b.blurb)}</span>
          <span class="b-cost">${money(b.cost)} · ${b.timber} t timber · ${b.tools} t tools · ${s.people >= 1 ? `about ${Math.ceil(buildDays(s, b.id))} days` : `${b.work} days of work`}</span>
          ${why && !s.project ? `<span class="b-why">${esc(why)}</span>` : ''}</div>
        <button class="btn small ${why ? 'ghost' : 'primary'}" data-action="build" data-id="${b.id}" ${why ? 'disabled' : ''}>Build</button></li>`;
    });
    const builds = buildRows.join('');
    // Build next: what moves it to the next stage (possible ones first), at most three.
    const goals = stageGoals(s, g.day).filter((id) => buildable.some((b) => b.id === id));
    const nextIds = [...goals.filter((id) => !cannotBuild(g, s, id)), ...goals.filter((id) => cannotBuild(g, s, id))].slice(0, 3);
    const nextBuilds = nextIds.map((id) => buildRows[buildable.findIndex((b) => b.id === id)]).join('');
    // Settlers sign on at home; supplies come in the hold.
    const home = world.era.start.port;
    let settlers = '';
    if (isReady(g, ship) && ship.location === home) {
      const room = Math.floor((typeOf(ship).capacity - cargoTons(ship)) / SETTLEMENT_TUNING.settlerTons);
      const can = Math.min(room, willing(s));
      const opts = [10, 20, 30].filter((n) => n <= can);
      if (can > 0 && !opts.includes(can)) opts.push(can);
      settlers = `<div class="settler-box"><p><strong>Settlers for ${esc(name)}</strong> sign on here at ${money(SETTLEMENT_TUNING.settlerCost)} each, and take ${SETTLEMENT_TUNING.settlerTons} t of hold room apiece. ${willing(s)} are willing to go just now (more come forward every week); the ${esc(ship.name)} has room for ${room}.</p>
        <div class="btn-row">${opts.map((n) => `<button class="btn small primary" data-action="recruit" data-n="${n}">${n} settlers · ${money(n * SETTLEMENT_TUNING.settlerCost)}</button>`).join('') || `<span class="hint">${room ? 'Nobody else is willing just now.' : 'No room in her hold.'}</span>`}</div></div>`;
    } else settlers = `<p class="hint">Settlers sign on at ${esc(world.ports[home].name)}: open this tab with a ship in port there. ${willing(s)} are willing to go just now.${ship.settlers ? ` The ${esc(ship.name)} carries ${ship.settlers}.` : ''}</p>`;
    const supplies = SETTLEMENT_TUNING.supplies;
    const aboard = (ship.goods ?? []).filter((l) => supplies.includes(l.good));
    const lots = [...(ship.settlers ? [{ good: 'settlers', label: `${ship.settlers} settlers`, fits: true }] : []),
      ...aboard.map((l) => ({ good: l.good, label: `${tons(l.tons)} ${world.goods[l.good].name.toLowerCase()}`, fits: roomFor(s, l.good) > 0.05 }))];
    // A full yard: land timber or tools by taking the other aboard in their place, ton for ton.
    const swapBtns = aboard.filter((l) => SETTLEMENT_TUNING.yardGoods.includes(l.good)).map((l) => {
      const room = roomFor(s, l.good);
      const other = SETTLEMENT_TUNING.yardGoods.filter((x) => x !== l.good).reduce((a, x) => a + (s.stores[x] ?? 0), 0);
      if (l.tons - room < 0.5 || other < 0.5) return '';
      const landed = Math.min(l.tons, room + other);
      const what = l.good === 'tools' ? 'timber' : 'iron and tools';
      return `<button class="btn small primary" data-action="swap-settlement" data-good="${l.good}">Land ${tons(landed)} ${esc(world.goods[l.good].name.toLowerCase())}, take ${tons(landed - room)} ${esc(what)} aboard</button>`;
    }).join('');
    const swaps = swapBtns ? `<p class="hint">No room ashore. Exchange ton for ton: what comes aboard is yours to sell anywhere.</p><div class="btn-row">${swapBtns}</div>` : '';
    const unload = isReady(g, ship) && ship.location === s.site && lots.length
      ? `<div class="settler-box"><p><strong>Aboard the ${esc(ship.name)}</strong>: land what you choose. Timber and tools go to the yard, food to the store.</p>
        <div class="btn-row">${lots.map((l) => `<button class="btn small ${l.fits ? 'primary' : 'ghost'}" data-action="unload-settlement" data-good="${l.good}" ${l.fits ? '' : 'disabled title="No room"'}>Land ${esc(l.label)}</button>`).join('')}
        ${lots.length > 1 ? `<button class="btn small" data-action="unload-settlement" data-good="">Land all that fits</button>` : ''}</div>${swaps}</div>` : '';
    const news = s.news.slice(0, 8).map((n) => `<li class="${n.kind}"><span class="sub">${gameDate(n.day)}</span> ${esc(n.text)}</li>`).join('');
    const gauge = (label: string, value: string, share: number, cls: string) =>
      `<div class="sg ${cls}"><span>${label}</span><b>${value}</b><i><em style="width:${Math.round(Math.max(0, Math.min(1, share)) * 100)}%"></em></i></div>`;
    const foodShare = days === Infinity ? 1 : Math.min(1, days / 90);
    // The warehouse: what the workshops made, and where it sells best by the latest news.
    const wares = storeGoods(s).map((k) => {
      const best = bestKnownMarkets(world, g, k, s.site).slice(0, 2);
      return `<li class="bring-row"><strong>${esc(world.goods[k].name)} · ${tons(s.stores[k] ?? 0)}</strong><span>${best.length ? `sells best in ${best.map((b) => `${esc(world.ports[b.port].name)} ${money(b.price)}/t`).join(' · ')}` : 'no buyer you know of yet'}</span></li>`;
    }).join('');
    const bring = bringList(s, g.day);
    const bringName: Record<string, string> = { food: site.crop === 'grain' ? 'Rice or grain' : 'Rice', timber: 'Timber', tools: 'Iron and tools', settlers: 'Settlers' };
    const bringRows = bring.map((b) => `<li class="bring-row"><strong>${bringName[b.good] ?? esc(b.good)} · ${b.good === 'settlers' ? `up to ${b.tons}` : tons(b.tons)}</strong><span>${esc(b.why)}</span></li>`).join('');
    const stageWord = need ? (need.stage === 'outpost' ? 'an outpost' : need.stage === 'port' ? 'an open port' : `a ${need.stage}`) : '';
    const latest = s.news.slice(0, 2).map((n) => `<li class="${n.kind}"><span class="sub">${gameDate(n.day)}</span> ${esc(n.text)}</li>`).join('');
    return `<div class="ship-head"><div class="sh-name"><h2>${esc(name)}</h2><span>${STAGE_NAMES[s.stage].toLowerCase()} · ${Math.floor(s.people)} people · ${esc(world.ports[s.site].country)}</span></div>
      <div class="sh-gauges two">
        ${gauge('Food', daysText, foodShare, s.people >= 1 && days < 15 ? 'bad' : s.people >= 1 && days < 45 ? 'warn' : 'ok')}
        ${gauge('People', `${Math.floor(s.people)} · room ${housing(s)}`, s.people / Math.max(1, housing(s)), s.people > housing(s) ? 'warn' : 'ok')}
        ${gauge('Granary (rice, grain)', `${tons(stored(s))} / ${storeRoom(s)} t`, stored(s) / Math.max(1, storeRoom(s)), 'hold')}
        ${gauge('Yard (timber, tools)', `${tons(yardStored(s))} / ${SETTLEMENT_TUNING.yard} t`, yardStored(s) / SETTLEMENT_TUNING.yard, 'hold')}
        ${warehouseRoom(s) ? gauge('Warehouse (goods)', `${tons(warehoused(s))} / ${warehouseRoom(s)} t`, warehoused(s) / warehouseRoom(s), warehoused(s) >= warehouseRoom(s) - 0.5 ? 'warn' : 'hold') : ''}
      </div></div>
      ${s.hungry ? `<div class="ask warn"><strong>${esc(name)} has no food:</strong> people are leaving. Bring rice${site.crop === 'grain' ? ' or grain' : ''}.</div>` : s.people >= 1 && days < 15 ? `<div class="ask warn"><strong>Food for only ${Math.floor(days)} days.</strong> They eat ${tons(eats(s))} a day.</div>` : ''}
      ${workshopsResting(s) ? `<div class="ask warn"><strong>The warehouse is full:</strong> the workshops are resting. Ship their goods out and sell them.</div>` : ''}
      ${sawmillResting(s) ? `<div class="ask quiet">The yard is nearly full: the sawmill is resting. It keeps ${Math.round(SETTLEMENT_TUNING.yard * SETTLEMENT_TUNING.sawmillReserve)} t free for tools from your ships.</div>` : ''}
      ${portLine}
      ${loadBox}
      ${unload}
      ${wares ? `<div class="sec-h"><h3>Warehouse</h3><span>ship it out and sell</span></div><ul class="bring-list">${wares}</ul>` : ''}
      ${bringRows ? `<div class="sec-h"><h3>Bring on the next run</h3><span>buy them on your own account</span></div><ul class="bring-list">${bringRows}</ul>` : ''}
      ${project}
      ${need ? `<div class="sec-h"><h3>To become ${stageWord}</h3><span>${need.needs.filter((n) => n.done).length} of ${need.needs.length}</span></div><ul class="needs">${need.needs.map((n) => `<li class="${n.done ? 'done' : ''}">${n.done ? '✓' : '○'} ${esc(n.text)}</li>`).join('')}</ul>` : ''}
      ${nextBuilds && !s.project ? `<div class="sec-h"><h3>Build next</h3><span>for the next stage</span></div><ul class="build-list">${nextBuilds}</ul>` : ''}
      ${this.fold('builds', `All ${buildable.length} buildings`, `<ul class="build-list">${builds}</ul>`, !nextBuilds && !s.project)}
      ${look}
      ${settlers ? `<div class="sec-h"><h3>Settlers</h3></div>${settlers}` : ''}
      ${latest ? `<div class="sec-h"><h3>News</h3></div><ul class="settle-news">${latest}</ul>` : ''}
      ${this.fold('stores', 'Stores, what it makes, workers', `<div class="kvs">${store}</div>${making.length ? `<p class="sub">${making.map(esc).join(' · ')}</p>` : ''}${hands}`)}
      ${news && s.news.length > 2 ? this.fold('news', 'Older news', `<ul class="settle-news">${news}</ul>`) : ''}
      ${this.fold('rent', 'Supplies and rent', `<p class="hint">Supplies: buy rice${site.crop === 'grain' ? ' or grain' : ''}, timber, and iron and tools on your own account (Orders tab, best buys and all goods) and sail them here; on arrival settlers go ashore and supplies are landed (timber and tools in the yard, food in the store). Rent to the local ruler: ${money(Math.round(site.charter * SETTLEMENT_TUNING.rent))} a year.</p>`)}`;
  }

  /** Shown in the Orders tab while the selected ship can't take orders. */
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

  private contractRow(c: Contract, mode: 'board' | 'hold', best = false): string {
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
    // With a destination chosen: is this lot for it, on the way (at most 15% longer), or off course?
    const target = mode === 'board' && isReady(g, ship) ? this.dest : null;
    const way = !target ? null : c.dest === target ? { kind: 'dest' as const, nm: 0 }
      : (() => { const d = detour(g, ship.location, c.dest, target); return d ? { kind: onTheWay(d) ? 'on' as const : 'off' as const, nm: Math.round(d.extraNm) } : null; })();
    const wayTag = !way ? '' : way.kind === 'dest' ? '<span class="onway">your destination</span>'
      : way.kind === 'on' ? `<span class="onway">on your way · +${way.nm.toLocaleString('en-US')} nm</span>`
        : `<span class="offway" title="Calling there makes the voyage to ${esc(world.ports[target!].name)} this much longer">+${way.nm.toLocaleString('en-US')} nm</span>`;
    const button = mode === 'board'
      ? `<button class="btn small" data-action="accept" data-id="${c.id}" ${why ? 'disabled' : ''} title="${esc(why ?? 'Load this cargo')}">Load</button>`
      : c.origin === ship.location && isReady(g, ship)
        ? `<button class="btn small ghost" data-action="unload" data-id="${c.id}">Unload</button>`
        : `<button class="btn small ghost jettison" data-action="jettison" data-id="${c.id}" title="Throw it overboard: the shipper claims ${money(jettisonClaim(c))}">Jettison</button>`;
    return `
      <li class="contract ${why ? 'unavailable' : ''} ${c.premium ? 'premium' : ''} ${way?.kind === 'off' ? 'offcourse' : ''}" data-hover-dest="${c.dest}">
        <div class="c-icon">${goodIcon(c.good, 36)}</div>
        <div class="c-main">
          <div class="c-good">${c.premium ? `<span class="tag premium">★ ${PREMIUM_LABEL[c.premium]}</span> ` : ''}${esc(good.name)} · ${tons(c.tons)}${best ? ' <span class="tag best">best per day</span>' : ''}</div>
          <div class="c-route"><span class="cmark ${good.cargoClass}" title="${CLASS_LABEL[good.cargoClass]}" aria-label="${CLASS_LABEL[good.cargoClass]}"></span>→ <strong>${esc(world.ports[c.dest].name)}</strong> · ${nm.toLocaleString('en-US')} nm ${wayTag}${reach}</div>
          <div class="c-meta ${urgent ? 'urgent' : ''}">Due ${gameDate(c.deadline)} (${days(Math.max(0, Math.round(daysLeft)))})${why ? ` · <span class="why">${esc(why)}</span>` : ''}</div>
        </div>
        <div class="c-side">
          <div class="c-pay">${compactMoney(c.pay)}</div>
          <div class="c-rate" title="${money(c.pay / c.tons)} a ton">${plan ? `${money(c.pay / Math.max(0.5, plan.seaDays))}/day` : `${money(c.pay / c.tons)}/t`}</div>
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
          : room ? 'Hire a captain in the Fleet tab and he can run this ship by himself in a region you choose.'
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
    // Captains only sail to charted ports, so uncharted ones (1650) don't count here either.
    const known = (id: string) => isCharted(g, id);
    const ports = areaPorts(regions).filter(known);
    const pairs: [string, string][] = regions.length > 1
      ? region(regions[0]).ports.filter(known).flatMap((a) => region(regions[1]).ports.filter(known).flatMap((b) => [[a, b], [b, a]] as [string, string][]))
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
      : '<p class="warn-line">No free captain. Hire one in the Fleet tab first.</p>';
    const cards = regions().map((r) => {
      const on = d.regions.includes(r.id);
      // What each card shows is what the captain would actually sail: the chosen region or
      // lane on the chosen cards; on the others, the lane they would make with the first choice.
      const laneWith = !on && d.regions.length >= 1 ? d.regions[0] : null;
      const replaces = !on && d.regions.length === 2 ? d.regions[1] : null;
      const home = captains.find((c) => c.id === d.captainId)?.home === r.id;
      return `<li class="region ${on ? 'on' : ''}" data-action="area-region" data-id="${r.id}">
        <div class="r-head"><strong>${on ? '✓ ' : ''}${esc(r.name)}</strong>${home ? '<span class="tag good">captain\'s home</span>' : ''}</div>
        <div class="r-ports">${r.ports.map((p) => esc(world.ports[p].name)).join(' · ')}</div>
        ${on ? `<div class="r-lane">${d.regions.length > 1 ? `Your lane, ${esc(region(d.regions[0]).name)} ⇄ ${esc(region(d.regions[1]).name)}:` : 'Your area, on its own:'}</div>${this.areaReport(d.regions, ship)}`
          : laneWith ? `<div class="r-lane">${replaces ? `In place of ${esc(region(replaces).name)}, as a lane with ${esc(region(laneWith).name)}:` : `As a lane with ${esc(region(laneWith).name)}:`}</div>${this.areaReport([laneWith, r.id], ship)}`
          : this.areaReport([r.id], ship)}
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
          ${g.settlement || (g.books ?? []).some((b) => b.settlement) ? row('Settlement', (b) => b.settlement ?? 0, -1) : ''}
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
      <div class="sec-h"><h3>Your ships</h3><span>${g.fleet.length} · ${routed} on routes · 30 days ${money(total, true)}</span></div>
      <ul class="fleet-list">${rows}</ul>
      ${this.captainsCard()}
      ${this.shipsForSale()}`;
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

  /** Orders: what the selected ship needs, in the order you decide it (load, buy, where to). */
  private ordersTab(): string {
    const g = this.g;
    const ship = this.ship();
    if (this.areaDraft?.shipId === ship.id) return this.areaEditor();
    const head = this.shipHead(ship);
    const hold = ship.cargo.length ? `<div class="sec-h"><h3>In the hold</h3><span>${tons(cargoTons(ship))}</span></div><ul class="contracts">${ship.cargo.map((c) => this.contractRow(c, 'hold')).join('')}</ul>` : '';
    const shipFold = (open: boolean) => this.fold('ship', `${isSail() ? 'Victuals, careening' : 'Bunkers, dry dock'}, the ship`, this.shipTab('ship'), open);
    if (!isReady(g, ship) || onOrders(ship)) {
      return head + (isReady(g, ship) ? '' : this.busyCard()) + hold + this.ownGoods(ship) + shipFold(false) + this.captainCard();
    }
    const port = world.ports[ship.location];
    const board = g.ports[port.id].board;
    const perDay = this.perDayOf(ship);
    const order = this.contractSort === 'perDay' ? (a: Contract, b: Contract) => perDay(b) - perDay(a)
      : this.contractSort === 'dest' ? (a: Contract, b: Contract) => world.ports[a.dest].name.localeCompare(world.ports[b.dest].name) || b.pay - a.pay
        : (a: Contract, b: Contract) => b.pay - a.pay;
    const takes = (c: Contract) => !(c.premium && ship.captainId !== undefined) && canCarry(ship, c) === null;
    const fits = board.filter(takes).sort(order), rest = board.filter((c) => !takes(c)).sort(order);
    const best = fits.length > 1 ? [...fits].sort((a, b) => perDay(b) - perDay(a))[0].id : null;
    const free = typeOf(ship).capacity - cargoTons(ship);
    const sortBtn = `<button class="btn small sort-toggle" data-action="contract-sort" title="Sort by pay per day, total pay or destination">${CONTRACT_SORTS[this.contractSort]} ⇅</button>`;
    const condLow = ship.condition < 60;
    return `
      ${head}
      ${this.plannedBanner(ship)}
      ${this.attention(ship)}
      ${this.whereTo(ship)}
      <section data-anchor="cargo">
      <div class="sec-h"><h3>Cargo that fits</h3>${board.length > 1 ? sortBtn : ''}</div>
      <p class="sec-sub">${tons(free)} free · port fee ${money(portFee(g, ship, port.id))}</p>
      ${fits.length ? `<ul class="contracts">${fits.slice(0, 5).map((c) => this.contractRow(c, 'board', c.id === best)).join('')}</ul>`
        : `<p class="empty">${free < 1 ? 'The hold is full.' : board.length ? 'Nothing on offer that this ship can take.' : 'No cargo on offer right now.'} New offers come as days pass.</p>`}
      ${fits.length > 5 ? this.fold('fits', `${fits.length - 5} more that fit`, `<ul class="contracts">${fits.slice(5).map((c) => this.contractRow(c, 'board')).join('')}</ul>`) : ''}
      ${rest.length ? this.fold('cant', `${rest.length} more ${rest.length === 1 ? 'needs' : 'need'} another ship`, `<ul class="contracts">${rest.map((c) => this.contractRow(c, 'board')).join('')}</ul>`) : ''}
      ${this.chilledHint(ship, port.id)}
      </section>
      <section data-anchor="hold">${hold}</section>
      <section data-anchor="buys">${this.bestBuys(ship)}</section>
      ${this.priceHints(port.id)}
      ${this.chartsCard(port.id)}
      ${this.waitControls()}
      ${shipFold(condLow)}
      ${this.captainCard()}`;
  }

  /** Pay per day at sea for a contract from where the ship lies (memoised for one panel draw). */
  private perDayOf(ship: ShipState): (c: Contract) => number {
    const memo = new Map<string, number>();
    return (c: Contract) => {
      let d = memo.get(c.dest);
      if (d === undefined) { d = Math.max(0.5, planVoyage(this.g, ship.id, c.dest)?.seaDays ?? 99); memo.set(c.dest, d); }
      return c.pay / d;
    };
  }

  /** A folded section; it stays open across redraws once opened. */
  private fold(key: string, label: string, html: string, open = false): string {
    return `<details class="fold" data-key="${key}" ${open ? 'open' : ''}><summary>${label}</summary><div class="fold-body">${html}</div></details>`;
  }

  /** The selected ship at a glance: name, where, and three gauges. */
  private shipHead(ship: ShipState): string {
    const g = this.g;
    const type = typeOf(ship);
    const where = ship.voyage ? `→ ${esc(world.ports[ship.voyage.to].name)}` : `${inDryDock(g, ship) ? (isSail() ? 'careening at' : 'in dry dock,') : 'at'} ${esc(world.ports[ship.location].name)}`;
    const speed = effectiveSpeed(type, ship);
    const burn = type.fuelPerDay * consumptionFactor(ship);
    const range = Math.round((ship.fuel / Math.max(0.01, burn)) * speed * 24);
    const gauge = (label: string, value: string, share: number, cls: string, title = '') =>
      `<div class="sg ${cls}" title="${esc(title)}"><span>${label}</span><b>${value}</b><i><em style="width:${Math.round(Math.max(0, Math.min(1, share)) * 100)}%"></em></i></div>`;
    const held = cargoTons(ship);
    return `<div class="ship-head">
      <div class="sh-name"><h2>${esc(ship.name)}</h2><span>${esc(type.name.toLowerCase())} · ${where}</span></div>
      <div class="sh-gauges">
        ${gauge('Hold', `${Math.round(held)} / ${tons(type.capacity)}`, held / type.capacity, 'hold')}
        ${gauge(isSail() ? 'Victuals' : 'Bunkers', `${Math.round(ship.fuel)} ${isSail() ? 'casks' : 't'}`, ship.fuel / type.bunkerCapacity, range < 3000 ? 'warn' : 'ok', `range about ${range.toLocaleString('en-US')} nm`)}
        ${gauge('Condition', `${Math.round(ship.condition)}%`, ship.condition / 100, ship.condition < 40 ? 'bad' : ship.condition < 60 ? 'warn' : 'ok')}
      </div>
    </div>`;
  }

  /** What needs you about this ship now: orders, a wait, a worn hull, low victuals. */
  private attention(ship: ShipState): string {
    const g = this.g;
    const out: string[] = [];
    if (isWaiting(g, ship)) {
      const until = ship.waitUntil! >= LAID_UP ? 'laid up until further notice' : `waiting until ${gameDate(ship.waitUntil!)}`;
      out.push(`<div class="ask quiet"><span>The ${esc(ship.name)} is ${until}. You can still load her and cast off any time.</span> <button class="btn small" data-action="stop-wait">Stop waiting</button></div>`);
    }
    if (ship.condition < 60) out.push(`<div class="ask warn"><strong>Condition ${Math.round(ship.condition)}%.</strong> ${isSail() ? 'Careen her soon: a worn hull leaks and sails slow.' : 'Dry-dock her soon: a worn ship breaks down.'} See "${isSail() ? 'Victuals, careening' : 'Bunkers, dry dock'}" below.</div>`);
    return out.join('');
  }

  /** The best goods to buy here on your own account: the margin against the best price we know of. */
  private bestBuys(ship: ShipState): string {
    if (!hasTrade(world)) return '';
    const g = this.g;
    const port = world.ports[ship.location];
    const type = typeOf(ship);
    const room = type.capacity - cargoTons(ship);
    const buyBtn = (good: string, n: number | 'max', label: string) => {
      const t = n === 'max' ? room : Math.min(n, room);
      const q = t > 0 ? goodsBuyQuote(world, g, port.id, good, t) : null;
      return `<button class="btn small" data-action="buy-goods" data-good="${good}" data-tons="${n}" ${!q || q.total > g.cash ? 'disabled' : ''}>${label}<span>${q ? `costs ${compactMoney(q.total)}` : '—'}</span></button>`;
    };
    // Everything for the load she'd actually take (the room left): the price rises as you buy and falls as you sell.
    const lot = room >= 1 ? Math.floor(room) : 10;
    const goods = port.produces.map((x) => x.good).filter((good) => type.cargoClasses.includes(world.goods[good].cargoClass))
      .map((good) => {
        const price = buyPrice(world, g, port.id, good)!;
        const cost = goodsBuyQuote(world, g, port.id, good, lot)?.total ?? price * lot;
        const sales = bestKnownMarkets(world, g, good, port.id).slice(0, 2)
          .map((b) => ({ port: b.port, total: Math.round(b.price * saleFactor(world, good, lot) * lot) }))
          .sort((a, b) => b.total - a.total);
        return { good, price, cost, sales, profit: sales.length ? sales[0].total - cost : -Infinity };
      }).filter((x) => x.sales.length).sort((a, b) => b.profit - a.profit);
    const aboard = this.ownGoods(ship);
    if (!goods.length && !aboard) return '';
    const per = (total: number) => money(Math.round(total / lot));
    const rows = goods.slice(0, 3).map((x) => `<li class="buy-row">
        <div class="br-main">${goodIcon(x.good, 24)}<strong>${esc(world.goods[x.good].name)}</strong> <span class="sub">${money(x.price)}/t here</span></div>
        <div class="br-gain"><b class="${x.profit < 0 ? 'neg' : ''}">${x.profit < 0 ? '−' : '+'}${compactMoney(Math.abs(x.profit))}</b><span>profit for ${tons(lot)}</span></div>
        <div class="br-calc">Sells ≈ ${x.sales.map((sl) => `${compactMoney(sl.total)} in ${esc(world.ports[sl.port].name)} (${per(sl.total)}/t)`).join(' · ')}</div>
        <div class="btn-row">${room > 10 ? buyBtn(x.good, 10, '+10 t') : ''}${buyBtn(x.good, 'max', room > 0 ? `Fill ${tons(room)}` : 'Hold full')}</div>
      </li>`).join('');
    return `${aboard}
      ${rows ? `<div class="sec-h"><h3>Best buys here</h3><span>for a full hold, by the latest news</span></div><ul class="buy-list">${rows}</ul>` : ''}
      ${this.fold('trade', `All goods for sale in ${esc(port.name)}, and what it buys`, this.tradeCard(ship, false))}`;
  }

  /** Where to go: the ports the cargo aboard is bound for (and where own goods sell best); any other port folded. */
  private whereTo(ship: ShipState): string {
    const g = this.g;
    const here = ship.location;
    const byDest = new Map<string, { lots: number; pay: number; goods: string[] }>();
    for (const c of ship.cargo) {
      const d = byDest.get(c.dest) ?? { lots: 0, pay: 0, goods: [] };
      d.lots++; d.pay += c.pay; byDest.set(c.dest, d);
    }
    for (const l of ship.goods ?? []) {
      const top = bestKnownMarkets(world, g, l.good, here)[0];
      if (!top) continue;
      const d = byDest.get(top.port) ?? { lots: 0, pay: 0, goods: [] };
      d.goods.push(world.goods[l.good].name.toLowerCase()); byDest.set(top.port, d);
    }
    const items = [...byDest].filter(([id]) => id !== here && id !== this.dest).sort((a, b) => b[1].pay - a[1].pay).map(([id, d]) => {
      const plan = planVoyage(g, ship.id, id);
      const what = [d.lots ? `delivers ${d.lots} lot${d.lots > 1 ? 's' : ''}` : '', d.goods.length ? `sells your ${d.goods.join(', ')}` : ''].filter(Boolean).join(' · ');
      return `<li class="dest-s ${id === this.dest ? 'selected' : ''}" data-action="dest" data-id="${id}" data-hover-dest="${id}">
        <span class="ds-name">${esc(world.ports[id].name)}</span>
        <span class="ds-pay">${d.pay ? compactMoney(d.pay) : ''}<em>${plan ? days(Math.round(plan.seaDays)) : ''}</em></span>
        <span class="ds-what">${what}</span></li>`;
    }).join('');
    return `<section data-anchor="where"><div class="sec-h"><h3>Where to</h3><span>${items ? 'for what\'s aboard' : 'tap a port on the map'}</span></div>
      ${this.dest ? this.planCard(planVoyage(g, ship.id, this.dest)!) : ''}
      ${items ? `${this.dest ? '<p class="sec-sub">Or another port for what\'s aboard:</p>' : ''}<ul class="dest-list">${items}</ul>` : this.dest ? '' : `<p class="sec-sub">Load cargo below, or pick any port on the map.</p>`}
      ${this.fold('dests', 'Any other port, nearest first', `<p class="hint">"Exports for you" lists what each port ships that your ${esc(typeOf(ship).name.toLowerCase())} can carry.</p><ul class="dests">${this.destList(ship)}</ul>`)}</section>`;
  }

  /** Waiting instead of sailing: a day, five, or laid up. */
  private waitControls(): string {
    const g = this.g;
    const ship = this.ship();
    if (isWaiting(g, ship) || !needsDecision(g, ship)) return '';
    return `<div class="wait-row">
      <span>Or wait here:</span>
      <span class="btn-row">
        <button class="btn small" data-action="wait" data-days="1" title="New offers may appear; prices move">1 day</button>
        <button class="btn small" data-action="wait" data-days="5">5 days</button>
        <button class="btn small ghost" data-action="wait" data-days="layup" title="Park the ship until you give it new orders. Upkeep still runs.">Lay up</button>
      </span>
    </div>`;
  }

  private shipTab(part: 'ship' | 'bank'): string {
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
    const bank = `
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
        <details class="fold"><summary>How the bank works</summary><p class="hint">If you run short of cash, the bank automatically extends this loan up to the limit. Beyond that there's an overdraft of up to ${money(RULES.overdraftLimit)} at 18% a year.</p></details>
      </section>`;
    if (part === 'bank') return bank;
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
`;
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
  /** World news as a one-line ticker above the map: one item at a time; a tap shows them all. */
  private renderTicker(): void {
    const el = document.getElementById('news-ticker');
    if (!el) return;
    const active = activeEvents(this.g);
    const kind = (k: string) => ({ strike: isSail() ? 'Plague' : 'Strike', harvest: 'Harvest', boom: 'Boom', canal: 'Canal', oilShock: 'Oil' } as Record<string, string>)[k] ?? 'News';
    const item = (e: (typeof active)[number]) => `<span class="n-kind ${e.kind}">${kind(e.kind)}</span><span class="nt-text">${esc(e.headline)} <em>Until about ${gameDate(e.endDay)}.</em></span>`;
    const i = active.length ? Math.floor(Date.now() / 7000) % active.length : 0;
    const html = !active.length ? '' : this.tickerOpen
      ? `<ul>${active.map((e) => `<li>${item(e)}</li>`).join('')}</ul>`
      : `<div class="nt-one">${item(active[i])}${active.length > 1 ? `<span class="nt-count">${i + 1}/${active.length}</span>` : ''}</div>`;
    el.hidden = !active.length;
    el.classList.toggle('open', this.tickerOpen);
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
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

  private shipsForSale(): string {
    const g = this.g;
    const ship = this.ship();
    const portId = this.marketPort ?? ship.location;
    const port = world.ports[portId];
    const offers = g.ports[portId].market;
    const yards = world.portList.filter((p) => p.shipyard).map((p) => p.name).join(', ');
    const ships = (pid: string) => g.fleet.filter((s) => !s.voyage && s.location === pid).length;
    const options = world.portList.map((p) => `<option value="${p.id}" ${p.id === portId ? 'selected' : ''}>${esc(p.name)}${p.shipyard ? ' (shipyard)' : ''}${ships(p.id) ? ` · ${ships(p.id)} of your ships` : ''}</option>`).join('');
    const can = offers.filter((o) => !quotePurchase(g, o, world).blocked);
    const cannot = offers.filter((o) => quotePurchase(g, o, world).blocked);
    const shortBy = (o: ShipOffer) => { const m = /([ƒ$][\d,.]+[kM]?) short/.exec(quotePurchase(g, o, world).blocked ?? ''); return m ? `${m[1]} short` : 'not yet'; };
    const table = cannot.length ? `<div class="scroll"><table class="sale-table"><thead><tr><th>Ship</th><th>Hold</th><th>Kn</th><th>Price</th><th></th></tr></thead><tbody>${cannot.map((o) => {
      const t = world.shipTypes[o.typeId];
      return `<tr><td><strong>${esc(t.name)}</strong> <span class="sub">${o.age ? `${o.age} yrs` : 'new'}</span></td><td>${tons(t.capacity)}</td><td>${t.speedKn.toFixed(1)}</td><td>${compactMoney(o.price)}</td><td class="why">${esc(shortBy(o))}</td></tr>`;
    }).join('')}</tbody></table></div>` : '';
    return `
      <div class="sec-h"><h3>Ships for sale</h3><span>${port.shipyard ? 'shipyard' : 'second-hand'}</span></div>
      <label class="port-pick">Market in <select data-action="market-port">${options}</select></label>
      <p class="sec-sub">Compared with the ${esc(ship.name)}${port.shipyard ? '' : ` · new ships are built in ${esc(yards)}`}.</p>
      ${can.length ? `<ul class="offers">${can.map((o) => this.offerCard(portId, o)).join('')}</ul>` : '<p class="sec-sub">Nothing here you can buy yet, even with a loan.</p>'}
      ${cannot.length ? this.fold('sale-more', `${cannot.length} more you can't afford yet`, table) : ''}
      ${this.fold('sale-mine', `Your ${esc(typeOf(ship).name.toLowerCase())} for comparison`, this.yourShipCard())}`;
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
        ${tight ? `<p class="o-warn">You'd keep ${money(afterCash)}, but ${isSail() ? 'a full stock of victuals' : 'a full tank'} and a month's upkeep for this ship cost about ${money(running)}.</p>` : ''}
        <button class="btn ${tight ? '' : 'primary'} wide" data-action="buy-ship" data-port="${portId}" data-id="${offer.id}" ${q.blocked ? 'disabled' : ''}>Buy the ${esc(offer.name)}</button>
      </li>`;
  }

  /** Every port the ship can sail for, nearest first, with what it exports for her. */
  private destList(ship: ShipState): string {
    const g = this.g;
    const here = ship.location;
    const settlementPort = g.settlement && !world.portList.includes(world.ports[g.settlement.site]) ? [world.ports[g.settlement.site]] : [];
    const rows = [...world.portList, ...settlementPort].filter((p) => p.id !== here).map((p) => ({ p, plan: planVoyage(g, ship.id, p.id)! }))
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
    return list;
  }

  /** A known price, with how old the news is. */
  private newsText(n: PriceNews, unit = ''): string {
    if (n.live) return `${money(n.price)}${unit} <span class="asof">today</span>`;
    return `${money(n.price)}${unit} <span class="asof" title="The latest letter from there">as of ${gameDate(n.asOf)}</span>`;
  }

  /**
   * Where a good sells best, by the news you have; with `lot`, what selling that many tons there
   * would fetch on average (the price falls as you sell).
   */
  private bestMarkets(good: string, except: string, n = 2, lot = 0): string {
    const best = bestKnownMarkets(world, this.g, good, except).slice(0, n);
    const avg = (price: number) => (lot >= 1 ? ` <span class="avg">(≈ ${money(Math.round(price * saleFactor(world, good, lot)))}/t for ${tons(lot)})</span>` : '');
    return best.length ? best.map((b) => `${esc(world.ports[b.port].name)} ${this.newsText(b)}${avg(b.price)}`).join(' · ') : 'no buyer you know of';
  }

  /** Goods on your own account aboard a ship (shown at sea too). */
  private ownGoods(ship: ShipState): string {
    const lots = ship.goods ?? [];
    if (!lots.length) return '';
    const here = isReady(this.g, ship) ? ship.location : null;
    return `<h3>Own goods aboard</h3><ul class="own-goods">${lots.map((l) => {
      const q = here ? goodsSaleQuote(world, this.g, here, l.good, l.tons) : null;
      const profit = q ? q.total - l.cost : 0;
      return `<li><div class="og-main">${goodIcon(l.good, 28)}<strong>${esc(world.goods[l.good].name)}</strong> · ${tons(l.tons)} <span class="hint">${l.cost === 0 && this.g.settlement?.site === l.from ? `your own, from ${esc(world.ports[l.from].name)}` : `bought at ${money(Math.round(l.cost / l.tons))}/t in ${esc(world.ports[l.from].name)}`}</span></div>
        <div class="og-where hint">Best known: ${this.bestMarkets(l.good, here ?? '', 2, l.tons)}</div>
        <div class="btn-row">${here ? (q ? `<button class="btn small ${profit >= 0 ? 'primary' : 'loss'}" data-action="sell-goods" data-good="${l.good}">Sell all here<span>${money(q.total)} · ${money(profit, true)}</span></button>`
          : `<span class="hint">Nobody here buys it.</span>`) : ''}
          <button class="btn small ghost jettison" data-action="jettison-goods" data-good="${l.good}" title="Throw it overboard: you lose what it cost">Jettison</button></div>
      </li>`;
    }).join('')}</ul>`;
  }

  /** Buy and sell on your own account (Age of Sail). */
  private tradeCard(ship: ShipState, full = true): string {
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
        <div class="hint">Sells best in: ${this.bestMarkets(good, port.id, 2, Math.min(room, 300))}</div>
        <div class="btn-row">${room > 10 ? buyBtn(good, 10, '+10 t') : ''}${room > 50 ? buyBtn(good, 50, '+50 t') : ''}${buyBtn(good, 'max', room > 0 ? `Fill ${tons(room)}` : 'Hold full')}</div>
      </li>`).join('');
    const wants = wanted.map((good) => `<span class="gchip">${goodIcon(good, 18)}${esc(world.goods[good].name.toLowerCase())} ${money(priceNews(world, g, port.id, good)!.price)}</span>`).join(' ');
    return `<section class="card trade-card">
      ${full ? '<h3>⚖ Trade on your own account</h3>' : ''}
      <p class="hint">Buy goods here and sell them where they're wanted. Prices elsewhere are as of the latest letter from there: news travels by ship. A price is for the first ton: the more you buy, the dearer it gets, and the more you sell, the less each ton fetches (≈ shows the average for a whole lot).</p>
      ${full ? this.ownGoods(ship) : ''}
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

  /** "Worth a call on the way": ports a short detour away where calling pays, with Go via. */
  private callsCard(dest: string): string {
    if (this.viaFinal) {
      return `<div class="via-note">Calling here on the way to <strong>${esc(world.ports[this.viaFinal].name)}</strong>; the game will remember it.
        <button class="btn small ghost" data-action="clear-via">Sail direct instead</button></div>`;
    }
    const calls = this.calls();
    if (!calls.length) return '';
    const sail = isSail();
    const lines = calls.map((c) => {
      const what = [
        ...c.deliveries.map((d) => `${goodIcon(d.good, 18)} deliver your ${esc(world.goods[d.good].name.toLowerCase())} (${tons(d.tons)}, ${compactMoney(d.pay)})`),
        ...c.freight.map((f) => sail
          ? `${goodIcon(f.good, 18)} usually ships ${esc(world.goods[f.good].name.toLowerCase())} for ${esc(world.ports[dest].name)}: a lot of ${tons(f.tons)} pays about ${compactMoney(f.pay)}`
          : `${goodIcon(f.good, 18)} ${esc(world.goods[f.good].name)} ${tons(f.tons)} for ${esc(world.ports[dest].name)} on the quay, ${compactMoney(f.pay)}`),
        ...c.sales.map((s) => `${goodIcon(s.good, 18)} buys your ${esc(world.goods[s.good].name.toLowerCase())} at ${this.newsText({ price: s.price, asOf: s.asOf, live: s.live }, '/t')}: +${compactMoney(s.gain)} over ${esc(world.ports[dest].name)}`),
      ].join('<br>');
      const extra = c.extraNm < 30 ? 'on the route' : `+${c.extraNm.toLocaleString('en-US')} nm`;
      return `<div class="way">
        <div><div class="n">${esc(world.ports[c.port].name)} <span class="onway">${extra} · +${days(Math.round(c.extraDays * 10) / 10)}</span></div><div class="d">${what}</div></div>
        <div class="net">${sail ? `≈ +${compactMoney(c.net)}` : money(c.net, true)}<small>after the call</small></div>
        <div class="d foot">${c.lateLoss > 0 ? `Cargo for ${esc(world.ports[dest].name)} arrives later: −${compactMoney(c.lateLoss)} late pay (counted).` : 'Cargo aboard still arrives in time.'}
          <button class="btn small" data-action="go-via" data-id="${c.port}">Go via ${esc(world.ports[c.port].name)}</button></div>
      </div>`;
    }).join('');
    return `<div class="ways"><h5>Worth a call on the way${sail ? ' · by the latest news' : ''}</h5>${lines}</div>`;
  }

  /** The remembered destination, while a ship calls on the way. */
  private plannedBanner(ship: ShipState): string {
    if (!ship.plannedDest || !isReady(this.g, ship) || ship.plannedDest === ship.location) return '';
    const p = world.ports[ship.plannedDest];
    const nm = routeFor(world, this.g, ship.location, p.id)?.nm;
    const aboard = ship.cargo.filter((c) => c.dest === p.id).length;
    return `<div class="planned"><div><span class="k">Continuing to</span><strong>${esc(p.name)}</strong>${nm ? ` · ${nm.toLocaleString('en-US')} nm` : ''}${aboard ? ` · ${aboard} lot${aboard > 1 ? 's' : ''} aboard for it` : ''}</div>
      <button class="btn small ghost" data-action="clear-planned">Change destination</button></div>`;
  }

  private planCard(plan: VoyagePlan): string {
    const g = this.g;
    const ship = this.ship();
    const name = world.ports[plan.dest].name;
    const price = fuelPrice(g, ship.location);
    const type = typeOf(ship);
    const normal = world.route(ship.location, plan.dest, [], fogFor(g), CHART_TUNING.unchartedPenalty);
    const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * 1.15));
    const topUp = Math.max(0, target - Math.floor(ship.fuel));
    const short = plan.fuelShort > 0;
    const loss = plan.estimatedNet < 0 ? ` <span>estimate ${money(plan.estimatedNet)}</span>` : '';
    const sailButton = !plan.inRange
      ? `<button class="btn primary wide" disabled>Out of range</button>`
      : short
        ? `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="bunker-sail">${isSail() ? 'Victual' : 'Bunker'} ${fuelAmt(topUp)} (${money(topUp * price)}) &amp; ${isSail() ? 'set sail' : 'cast off'}${loss}</button>`
        : `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="sail">Cast off for ${esc(name)}${loss}</button>`;
    const total = plan.seaDays + RULES.portDays + plan.strikeDays;
    // Only what changes the decision shows: a late delivery, a strike there, a closed canal.
    const urgent = [
      ...plan.deliveries.filter((d) => d.late).map((d) => `${world.goods[d.contract.good].name} would arrive after its deadline.`),
      ...(plan.strike ? [`Dock strike in ${name}: ${plan.strikeDays} extra days in port.`] : []),
      ...(normal && normal.nm < plan.route.nm - 50 ? [`A canal is closed: ${(plan.route.nm - normal.nm).toLocaleString('en-US')} nm longer than usual.`] : []),
    ];
    const callsHtml = this.callsCard(plan.dest);
    const calls = !callsHtml ? '' : this.viaFinal ? callsHtml
      : this.fold('calls', `Worth a call on the way${isSail() ? ' · by the latest news' : ''}`, callsHtml.replace(/<h5>[^<]*<\/h5>/, ''));
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
        ${urgent.length ? `<p class="plan-warn">${urgent.map(esc).join(' ')}</p>` : ''}
        ${calls}
        ${sailButton}
      </section>`;
  }

  /** Company: money at a glance, the bank, the books; the guide, achievements, record and log. */
  private companyTab(): string {
    const g = this.g;
    const cell = (label: string, value: string, cls = '') => `<div class="sg ${cls}"><span>${label}</span><b>${value}</b></div>`;
    return `<div class="ship-head"><div class="sh-name"><h2>${esc(g.company ?? 'Your company')}</h2><span>${gameDate(g.day)}</span></div>
      <div class="sh-gauges">${cell('Cash', compactMoney(g.cash), g.cash < 0 ? 'bad' : 'money')}${cell('Worth', compactMoney(netWorth(g, world)))}${cell('Loan', compactMoney(g.loan))}</div></div>
      ${this.shipTab('bank')}
      ${this.companyCard()}
      ${this.logTab()}`;
  }

  private logTab(): string {
    const g = this.g;
    const s = g.stats;
    const chapters = guideChapters(world, g);
    const cur = currentChapter(world, g);
    const when = g.guide?.when ?? {};
    const chapterBlock = (c: GuideChapter) => {
      const done = c.steps.filter((st) => st.done).length;
      return `<details class="ach-chapter" data-key="ach-${c.n}" ${c.n === cur?.n ? 'open' : ''}>
        <summary><span>${c.n}. ${esc(c.title)}</span><span class="ach-count ${done === c.steps.length ? 'good' : ''}">${done === c.steps.length ? '✓' : `${done}/${c.steps.length}`}</span></summary>
        <ul class="ach-steps">${c.steps.map((st) => `<li class="${st.done ? 'done' : ''}"><span class="gs-tick" aria-hidden="true">${st.done ? '✓' : ''}</span>
          <span class="ach-title">${esc(st.title)}${st.done ? '' : `<span class="hint">${esc(st.hint)}</span>`}</span>
          <span class="ach-when">${st.done ? (when[st.id] !== undefined ? gameDate(when[st.id]) : 'done') : st.progress ? `${st.progress[0].toLocaleString('en-US')} / ${st.progress[1].toLocaleString('en-US')}` : ''}</span></li>`).join('')}</ul>
      </details>`;
    };
    const stepsDone = chapters.reduce((n, c) => n + c.steps.filter((st) => st.done).length, 0);
    const stepsAll = chapters.reduce((n, c) => n + c.steps.length, 0);
    const discovered = isSail() && g.charted ? g.charted.filter((id) => world.ports[id] && !world.isSite(id)).length : 0;
    return `
      <div class="journal-guide">
        <p class="lbl">The guide${cur ? ` · chapter ${cur.n} of ${chapters.length}` : ''}</p>
        <h3>${cur ? esc(cur.title) : 'Every chapter so far is done'}</h3>
        <p class="hint">${cur ? `${cur.steps.filter((st) => st.done).length} of ${cur.steps.length} steps done.` : 'The next chapters arrive with coming builds.'} Tap the bar under your cash for the guide at any time.</p>
        <button class="btn small primary" data-action="guide">Open the guide</button>
      </div>
      <h3 class="section-h">Achievements <span class="ach-count">${stepsDone} of ${stepsAll}</span></h3>
      ${chapters.map(chapterBlock).join('')}
      <ul class="ach-steps ach-worth">${RULES.milestones.map((m) => {
        const got = g.milestones.find((x) => x.amount === m);
        return `<li class="${got ? 'done' : ''}"><span class="gs-tick" aria-hidden="true">${got ? '✓' : ''}</span><span class="ach-title">Worth ${money(m)}</span><span class="ach-when">${got ? gameDate(got.day) : ''}</span></li>`;
      }).join('')}</ul>
      <h3 class="section-h">Your record</h3>
      <div class="stats">
        <div><strong>${g.fleet.length}</strong><span>ships</span></div>
        <div><strong>${s.voyages}</strong><span>voyages</span></div>
        <div><strong>${compactMoney(s.revenue)}</strong><span>revenue</span></div>
        <div><strong>${compactMoney(s.fuelSpent)}</strong><span>fuel bought</span></div>
        <div><strong>${compactMoney(s.upkeepPaid)}</strong><span>upkeep paid</span></div>
        <div><strong>${compactMoney(s.interestPaid)}</strong><span>interest paid</span></div>
        <div><strong>${Math.round(s.delivered).toLocaleString('en-US')} t</strong><span>cargo delivered</span></div>
        <div><strong>${s.shipsOwned ?? g.fleet.length}</strong><span>ships owned, all told</span></div>
        ${isSail() ? `<div><strong>${discovered}</strong><span>ports charted</span></div>` : ''}
      </div>
      <h3 class="section-h">Log</h3>
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
      this.tab = 'orders';
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
    const era = (x: SlotInfo) => (x.era === 'sail' ? `Age of Sail · ${x.house === 'chinese' ? 'Chinese' : 'Dutch'} house · from 1650` : 'Modern · from 2000');
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
        <button class="era-card sail" data-action="slot-new" data-era="sail" data-house="dutch">
          <strong>Age of Sail · Dutch house · from 1650</strong><span>Fluyts, monsoons and spice: found a merchant house in Amsterdam with a little jacht and ƒ150,000. You know the way round the Cape to the Indies.</span><em>Start</em></button>
        <button class="era-card sail chinese" data-action="slot-new" data-era="sail" data-house="chinese">
          <strong>Age of Sail · Chinese house · from 1650</strong><span>Junks, silk and silver: found a trading house in Amoy with a small Fujian junk and Tls 150,000. You know the China seas, Japan and the Nanyang; India and Europe are blank.</span><em>Start</em></button>
      </div>
      ${this.cloudCard()}
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
    if ((g.era ?? 'modern') !== currentEra() || (g.era === 'sail' ? g.house ?? 'dutch' : undefined) !== currentHouse()) { reloadForEra(); return; }
    this.loadInto(g);
    this.toast(`Opened ${listSlots().find((x) => x.id === id)?.name ?? 'the game'}.`, 'good');
  }

  /** Put a game on the table: reset what the screen remembers about the last one. */
  private loadInto(g: GameState): void {
    this.g = g;
    this.map.resetZoom();
    const waiting = shipsNeedingDecision(g);
    this.activeId = (waiting[0] ?? g.fleet[0]).id;
    this.dest = null;
    this.hoverDest = null;
    this.marketPort = null;
    this.areaDraft = null;
    this.routesHidden = false;
    this.storms = [];
    this.tab = 'orders';
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
      diff: (d) => `${sign(d)}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)} ${isSail() ? 'casks' : 't'}` },
    { label: 'Upkeep', key: 'upkeep', val: `${currency()}${(s.upkeep / 1000).toFixed(1)}k/d`, higherIsBetter: false,
      diff: (d) => `${sign(d)}${currency()}${(Math.abs(d) / 1000).toFixed(1)}k` },
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
  const hidden = document.visibilityState === 'hidden';
  sound.setHidden(hidden);
  if (!hidden) void checkForUpdate();
});
// Some Android browsers fire only these when the app is put away or comes back.
window.addEventListener('pagehide', () => sound.setHidden(true));
window.addEventListener('pageshow', () => { if (document.visibilityState === 'visible') sound.setHidden(false); });

initServiceWorker();
new App({ showStart: !justUpdated() && !eraSwitched() });
const updatedFrom = consumeUpdatedFrom();
if (updatedFrom) toast(`Updated from build ${updatedFrom} to build ${BUILD.number}.`, 'good', 4500);
void checkForUpdate();
