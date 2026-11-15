import './ui/style.css';
import {
  ActionError, RULES, acceptContract, borrow, buyFuel, buyShip, canCarry, cargoTons, fuelPrice, newGame, nextMilestone,
  planVoyage, portFee, repair, repairQuote, repayLoan, sail, shipType, unloadContract, waitDay, type VoyagePlan,
} from './sim/game';
import { clearSave, loadGame, saveGame } from './sim/save';
import {
  SHIP_TUNING, consumptionFactor, currentShipValue, effectiveSpeed, maxLoan, netWorth, quotePurchase, saleValue,
} from './sim/ships';
import type { Contract, GameState, ShipOffer, ShipTypeDef } from './sim/types';
import { getWorld } from './sim/world';
import { compactMoney, days, esc, gameDate, money, tons } from './ui/format';
import { MapView, type PortMarker } from './ui/map';
import { BUILD, initServiceWorker, reloadApp } from './ui/update';

type Tab = 'contracts' | 'voyage' | 'ship' | 'market' | 'log';

const world = getWorld();
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

class App {
  private g: GameState;
  private tab: Tab = 'contracts';
  private dest: string | null = null;
  private hoverDest: string | null = null;
  private busy = false;
  private renderedTab: Tab | null = null;
  private map: MapView;

  constructor() {
    this.g = loadGame() ?? newGame();
    saveGame(this.g);
    this.map = new MapView(
      $('#map'),
      world,
      (id) => this.selectDest(id),
      (id) => { this.hoverDest = id; this.renderRoutes(); },
    );
    this.map.placeShip(this.g.ship.location);

    document.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (t && !t.hasAttribute('disabled')) this.handle(t.dataset.action!, t.dataset);
    });
    document.addEventListener('mouseover', (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>('[data-hover-dest]');
      const id = row?.dataset.hoverDest ?? null;
      if (id !== this.hoverDest) { this.hoverDest = id; this.renderRoutes(); }
    });
    this.render();
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
    if (this.busy) return;
    const type = shipType(this.g);
    switch (action) {
      case 'tab': this.tab = data.tab as Tab; break;
      case 'accept': {
        const c = this.g.ports[this.g.ship.location].board.find((x) => x.id === Number(data.id));
        // Pre-select where this cargo is going, so the plan is one tap away.
        if (this.act((g) => acceptContract(g, Number(data.id))) && c && !this.dest) this.dest = c.dest;
        break;
      }
      case 'unload': this.act((g) => unloadContract(g, Number(data.id))); break;
      case 'fuel': {
        const amount = data.amount === 'fill' ? type.bunkerCapacity : Number(data.amount);
        this.act((g) => buyFuel(g, amount));
        break;
      }
      case 'fuel-for-leg': {
        const plan = this.dest ? planVoyage(this.g, this.dest) : null;
        if (plan) this.act((g) => buyFuel(g, Math.ceil(plan.fuelNeeded * 1.15) - g.ship.fuel));
        break;
      }
      case 'repair': this.act((g) => repair(g, Number(data.points))); break;
      case 'borrow': {
        const amount = data.amount === 'max' ? Infinity : Number(data.amount);
        this.act((g) => borrow(g, amount));
        break;
      }
      case 'repay': {
        const amount = data.amount === 'all' ? Infinity : Number(data.amount);
        this.act((g) => repayLoan(g, amount));
        break;
      }
      case 'buy-ship': {
        const offer = this.g.ports[this.g.ship.location].market.find((o) => o.id === Number(data.id));
        if (!offer) break;
        const q = quotePurchase(this.g, offer, world);
        const ok = confirm(`Sell the ${shipType(this.g).name} ${this.g.ship.name} for ${money(q.tradeIn)} and buy the ${
          q.type.name} ${offer.name} for ${money(offer.price)}?${q.borrow > 0 ? `\n\nThe bank lends ${money(q.borrow)} at 8% a year.` : ''}`);
        if (ok && this.act((g) => buyShip(g, offer.id))) {
          this.toast(`Welcome aboard the ${offer.name}!`, 'good');
          this.tab = 'ship';
        }
        break;
      }
      case 'wait': this.act((g) => waitDay(g)); break;
      case 'dest': this.selectDest(data.id!); return;
      case 'sail': void this.sail(); return;
      case 'bunker-sail': {
        const plan = this.dest ? planVoyage(this.g, this.dest) : null;
        if (!plan) break;
        const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * 1.15));
        if (this.act((g) => buyFuel(g, target - g.ship.fuel)) && this.g.ship.fuel >= plan.fuelNeeded) {
          void this.sail();
          return;
        }
        break;
      }
      case 'close-report': $('#modal').hidden = true; break;
      case 'new-game':
        if (!this.g.gameOver && !confirm('Start a new game? Your current company will be lost.')) return;
        clearSave();
        this.g = newGame();
        this.dest = null;
        this.tab = 'contracts';
        this.map.placeShip(this.g.ship.location);
        $('#modal').hidden = true;
        saveGame(this.g);
        break;
    }
    this.render();
  }

  private selectDest(id: string): void {
    if (this.busy) return;
    this.dest = id === this.g.ship.location ? null : id;
    this.tab = 'voyage';
    this.render();
  }

  private async sail(): Promise<void> {
    if (!this.dest) return;
    const before = this.g;
    if (!this.act((g) => sail(g, this.dest!))) { this.render(); return; }
    const report = this.g.lastVoyage!;
    this.busy = true;
    this.dest = null;
    document.body.classList.add('sailing');
    this.render(before);
    this.map.showRoutes(report.path);

    const total = report.arriveDay - report.departDay;
    const shown = new Set<number>();
    const duration = Math.min(5200, Math.max(1800, total * 140));
    await this.map.animateVoyage(report.path, duration, (t) => {
      $('#date').textContent = gameDate(report.departDay + t * total);
      report.events.forEach((e, i) => {
        if (!shown.has(i) && t >= Math.min(0.95, e.day / total)) {
          shown.add(i);
          const label = { storm: '⛈ Storm', breakdown: '⚙ Breakdown', emergencyFuel: '⛽ Out of fuel!' }[e.kind];
          this.map.flash(label, 'bad');
        }
      });
    });
    if (report.revenue > 0) this.map.flash(money(report.revenue, true), 'good');

    this.busy = false;
    document.body.classList.remove('sailing');
    this.tab = 'contracts';
    this.render();
    this.showReport();
  }

  // ------------------------------------------------------------ rendering

  private render(g: GameState = this.g): void {
    this.renderHeader(g);
    this.renderShipStrip(g);
    this.renderPanel(g);
    this.renderPorts(g);
    this.renderRoutes();
    if (g.gameOver && !this.busy) this.showGameOver();
  }

  private renderHeader(g: GameState): void {
    $('#date').textContent = gameDate(g.day);
    const cash = $('#cash');
    cash.textContent = money(g.cash);
    cash.classList.toggle('negative', g.cash < 0);
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
    $('#goal-text').title = 'Net worth: cash + ship value − loan';
  }

  private renderShipStrip(g: GameState): void {
    const type = shipType(g);
    const load = cargoTons(g);
    const where = this.busy ? 'At sea' : `In ${world.ports[g.ship.location].name}`;
    const cond = g.ship.condition;
    $('#ship-strip').innerHTML = `
      <div class="ship-name"><strong>${esc(g.ship.name)}</strong><span>${esc(type.name)} · ${Math.floor(g.ship.age)} yrs · ${where}</span></div>
      ${gauge('Fuel', g.ship.fuel / type.bunkerCapacity, `${Math.round(g.ship.fuel)} / ${type.bunkerCapacity} t`, 'fuel')}
      ${gauge('Hold', load / type.capacity, `${tons(load)} / ${tons(type.capacity)}`, 'hold')}
      ${gauge('Condition', cond / 100, `${Math.round(cond)}%`, cond < 45 ? 'cond bad' : cond < 65 ? 'cond warn' : 'cond')}
    `;
  }

  private renderPorts(g: GameState): void {
    const cargoDests = new Set(g.ship.cargo.map((c) => c.dest));
    const markers: PortMarker[] = world.portList.map((p) => ({
      id: p.id,
      name: p.name,
      fuelPrice: fuelPrice(g, p.id),
      role: p.id === g.ship.location && !this.busy ? 'here' : p.id === this.dest ? 'dest' : cargoDests.has(p.id) ? 'cargo' : 'normal',
    }));
    this.map.updatePorts(markers);
  }

  private renderRoutes(): void {
    if (this.busy) return;
    const here = this.g.ship.location;
    const primary = this.dest ? world.route(here, this.dest)?.path ?? null : null;
    const hover = this.hoverDest && this.hoverDest !== this.dest && this.hoverDest !== here
      ? world.route(here, this.hoverDest)?.path : null;
    this.map.showRoutes(primary, hover ? [hover] : []);
  }

  private renderPanel(g: GameState): void {
    const loadable = g.ports[g.ship.location].board.filter((c) => canCarry(g, c) === null).length;
    const tabs: [Tab, string, string?][] = [
      ['contracts', 'Cargo', String(loadable)],
      ['voyage', 'Voyage'],
      ['ship', 'Ship'],
      ['market', 'Market'],
      ['log', 'Log'],
    ];
    $('#tabs').innerHTML = tabs.map(([id, label, badge]) =>
      `<button class="tab ${this.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}" role="tab" aria-selected="${this.tab === id}">
        ${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`).join('');
    const body = $('#panel-body');
    body.innerHTML = this.busy
      ? `<div class="at-sea"><div class="wave">〰〰〰</div><p>Under way…</p></div>`
      : {
        contracts: () => this.contractsTab(g), voyage: () => this.voyageTab(g), ship: () => this.shipTab(g),
        market: () => this.marketTab(g), log: () => this.logTab(g),
      }[this.tab]();
    if (this.renderedTab !== this.tab) {
      body.scrollTop = 0;
      this.renderedTab = this.tab;
    }
  }

  private contractRow(g: GameState, c: Contract, mode: 'board' | 'hold'): string {
    const good = world.goods[c.good];
    const daysLeft = c.deadline - g.day;
    const nm = world.distance(c.origin, c.dest);
    const why = mode === 'board' ? canCarry(g, c) : null;
    const plan = planVoyage(g, c.dest);
    const reach = plan && !plan.inRange ? '<span class="tag warn">needs refuel stop</span>' : '';
    const urgent = daysLeft < (nm / (effectiveSpeed(shipType(g), g.ship) * 24)) + 1.5;
    const button = mode === 'board'
      ? `<button class="btn small" data-action="accept" data-id="${c.id}" ${why ? 'disabled' : ''} title="${esc(why ?? 'Load this cargo')}">Load</button>`
      : c.origin === g.ship.location
        ? `<button class="btn small ghost" data-action="unload" data-id="${c.id}">Unload</button>` : '';
    return `
      <li class="contract ${why ? 'unavailable' : ''}" data-hover-dest="${c.dest}">
        <div class="c-main">
          <div class="c-good"><span class="cls ${good.cargoClass}">${good.cargoClass}</span> ${esc(good.name)} · ${tons(c.tons)}</div>
          <div class="c-route">→ <strong>${esc(world.ports[c.dest].name)}</strong> · ${nm.toLocaleString('en-US')} nm ${reach}</div>
          <div class="c-meta ${urgent ? 'urgent' : ''}">Due ${gameDate(c.deadline)} (${days(Math.max(0, daysLeft))})${why ? ` · <span class="why">${esc(why)}</span>` : ''}</div>
        </div>
        <div class="c-side">
          <div class="c-pay">${compactMoney(c.pay)}</div>
          <div class="c-rate">${money(c.pay / c.tons)}/t</div>
          ${button}
        </div>
      </li>`;
  }

  private contractsTab(g: GameState): string {
    const port = world.ports[g.ship.location];
    // Cargo this ship can take first, then the rest; each group by pay.
    const board = [...g.ports[port.id].board].sort((a, b) =>
      Number(canCarry(g, a) !== null) - Number(canCarry(g, b) !== null) || b.pay - a.pay);
    const type = shipType(g);
    const free = type.capacity - cargoTons(g);
    return `
      <header class="port-head">
        <div><h2>${esc(port.name)}</h2><span class="sub">${esc(port.country)} · port fee ${money(portFee(g, port.id))} · fuel ${money(fuelPrice(g, port.id))}/t</span></div>
        <button class="btn ghost small" data-action="wait" title="Costs one day of upkeep (${money(type.dailyCost)})">Wait a day</button>
      </header>
      <p class="hint">Free hold space: <strong>${tons(free)}</strong>. Hover a contract to see its route; you can carry cargo for several ports at once.</p>
      ${board.length ? `<ul class="contracts">${board.map((c) => this.contractRow(g, c, 'board')).join('')}</ul>`
        : '<p class="empty">No cargo on offer. Wait a day or sail on.</p>'}
      ${g.ship.cargo.length ? `<h3>In the hold</h3><ul class="contracts">${g.ship.cargo.map((c) => this.contractRow(g, c, 'hold')).join('')}</ul>` : ''}
      ${this.nextStepBar(g)}`;
  }

  /** Sticky bar under the contracts: one tap from loading cargo to planning the voyage. */
  private nextStepBar(g: GameState): string {
    if (g.ship.cargo.length === 0) return '';
    const byDest = new Map<string, { lots: number; pay: number }>();
    for (const c of g.ship.cargo) {
      const d = byDest.get(c.dest) ?? { lots: 0, pay: 0 };
      d.lots++;
      d.pay += c.pay;
      byDest.set(c.dest, d);
    }
    const buttons = [...byDest].sort((a, b) => b[1].pay - a[1].pay).map(([id, d]) =>
      `<button class="btn primary" data-action="dest" data-id="${id}" data-hover-dest="${id}">Plan voyage → ${esc(world.ports[id].name)}<span>${d.lots} lot${d.lots > 1 ? 's' : ''} · ${compactMoney(d.pay)}</span></button>`).join('');
    return `<div class="next-step">${buttons}</div>`;
  }

  private shipTab(g: GameState): string {
    const type = shipType(g);
    const here = g.ship.location;
    const price = fuelPrice(g, here);
    const space = Math.floor(type.bunkerCapacity - g.ship.fuel);
    const cheapest = world.portList.map((p) => ({ p, price: fuelPrice(g, p.id) })).sort((a, b) => a.price - b.price);
    const rank = cheapest.findIndex((x) => x.p.id === here) + 1;
    const plan = this.dest ? planVoyage(g, this.dest) : null;
    const q10 = repairQuote(g, 10);
    const qFull = repairQuote(g, 100);
    const speed = effectiveSpeed(type, g.ship);
    const burn = type.fuelPerDay * consumptionFactor(g.ship);
    const range = Math.round((g.ship.fuel / burn) * speed * 24);
    const value = currentShipValue(g, world);
    const limit = maxLoan(g, world);
    const room = Math.max(0, limit - g.loan);
    const yearly = Math.round(g.loan * SHIP_TUNING.loanDailyRate * 365);
    const fuelBtn = (amount: number | 'fill', label: string) => {
      const n = amount === 'fill' ? space : Math.min(amount, space);
      return `<button class="btn small" data-action="fuel" data-amount="${amount}" ${n <= 0 ? 'disabled' : ''}>${label}<span>${money(n * price)}</span></button>`;
    };
    return `
      <section class="card">
        <h3>Bunkers</h3>
        <div class="kv"><span>Price here</span><strong>${money(price)}/t</strong><em>${rank === 1 ? 'cheapest in the world' : `#${rank} of ${cheapest.length}`}</em></div>
        <div class="kv"><span>Aboard</span><strong>${Math.round(g.ship.fuel)} / ${type.bunkerCapacity} t</strong><em>range ≈ ${range.toLocaleString('en-US')} nm</em></div>
        <div class="kv"><span>Burn</span><strong>${burn.toFixed(1)} t/day</strong><em>at ${speed.toFixed(1)} kn, more when worn or old</em></div>
        <div class="btn-row">${fuelBtn(25, '+25 t')}${fuelBtn(50, '+50 t')}${fuelBtn(100, '+100 t')}${fuelBtn('fill', 'Fill up')}</div>
        ${plan && plan.inRange ? `<button class="btn wide" data-action="fuel-for-leg" ${g.ship.fuel >= Math.ceil(plan.fuelNeeded * 1.15) ? 'disabled' : ''}>Top up for ${esc(world.ports[plan.dest].name)} (+15% reserve)</button>` : ''}
        <p class="hint">Cheapest bunkers right now: ${cheapest.slice(0, 3).map((x) => `${esc(x.p.name)} ${money(x.price)}`).join(' · ')}</p>
      </section>
      <section class="card">
        <h3>Dry dock</h3>
        <div class="kv"><span>Condition</span><strong>${Math.round(g.ship.condition)}%</strong><em>low condition → more breakdowns, higher fuel burn</em></div>
        <div class="btn-row">
          <button class="btn small" data-action="repair" data-points="10" ${q10.points ? '' : 'disabled'}>Repair +${q10.points}%<span>${money(q10.cost)} · ${days(q10.days)}</span></button>
          <button class="btn small" data-action="repair" data-points="100" ${qFull.points ? '' : 'disabled'}>Full overhaul<span>${money(qFull.cost)} · ${days(qFull.days)}</span></button>
        </div>
        <p class="hint">Time in dock also costs ${money(type.dailyCost)}/day upkeep.</p>
      </section>
      <section class="card">
        <h3>Bank</h3>
        <div class="kv"><span>Loan</span><strong>${money(g.loan)}</strong><em>${g.loan ? `8% a year ≈ ${money(yearly)}/yr` : 'no loan'}</em></div>
        <div class="kv"><span>Limit</span><strong>${money(limit)}</strong><em>${Math.round(SHIP_TUNING.loanToValue * 100)}% of your ship's value</em></div>
        <div class="btn-row">
          <button class="btn small" data-action="borrow" data-amount="100000" ${room >= 1000 ? '' : 'disabled'}>Borrow<span>${money(Math.min(100_000, room))}</span></button>
          <button class="btn small" data-action="borrow" data-amount="max" ${room >= 1000 ? '' : 'disabled'}>Borrow max<span>${money(room)}</span></button>
          <button class="btn small" data-action="repay" data-amount="100000" ${g.loan > 0 && g.cash > 0 ? '' : 'disabled'}>Repay<span>${money(Math.min(100_000, g.loan, Math.max(0, g.cash)))}</span></button>
          <button class="btn small" data-action="repay" data-amount="all" ${g.loan > 0 && g.cash > 0 ? '' : 'disabled'}>Repay all<span>${money(Math.min(g.loan, Math.max(0, g.cash)))}</span></button>
        </div>
        <p class="hint">Separately, the bank covers an overdraft of up to ${money(RULES.overdraftLimit)} at 18% a year.</p>
      </section>
      <section class="card">
        <h3>The ${esc(g.ship.name)}</h3>
        <div class="kv"><span>Class</span><strong>${esc(type.name)}</strong><em>${Math.floor(g.ship.age)} years old</em></div>
        <div class="kv"><span>Capacity</span><strong>${tons(type.capacity)}</strong><em>${type.cargoClasses.join(' & ')} cargo</em></div>
        <div class="kv"><span>Speed</span><strong>${speed.toFixed(1)} kn</strong><em>${Math.round(speed * 24)} nm/day</em></div>
        <div class="kv"><span>Upkeep</span><strong>${money(type.dailyCost)}/day</strong><em>crew, insurance, stores</em></div>
        <div class="kv"><span>Value</span><strong>${money(value)}</strong><em>a broker pays ${money(saleValue(g, world))}</em></div>
        <button class="btn ghost wide" data-action="tab" data-tab="market">Look at ships for sale</button>
      </section>`;
  }

  private marketTab(g: GameState): string {
    const port = world.ports[g.ship.location];
    const offers = g.ports[port.id].market;
    const yards = world.portList.filter((p) => p.shipyard).map((p) => p.name).join(', ');
    return `
      <header class="port-head">
        <div><h2>Ships for sale</h2><span class="sub">${esc(port.name)} · ${port.shipyard ? 'shipyard: new ships of every class' : 'second-hand market'}</span></div>
      </header>
      <p class="hint">Your ${esc(shipType(g).name)} would fetch <strong>${money(saleValue(g, world))}</strong> as a trade-in.
        ${port.shipyard ? '' : `New ships are built in ${esc(yards)}.`} Each port's market changes after every voyage.</p>
      ${g.ship.cargo.length ? '<p class="hint warn-text">Deliver or unload your cargo before swapping ships.</p>' : ''}
      <ul class="offers">${offers.map((o) => this.offerCard(g, o)).join('')}</ul>`;
  }

  private offerCard(g: GameState, offer: ShipOffer): string {
    const cur = shipType(g);
    const type = world.shipTypes[offer.typeId];
    const q = quotePurchase(g, offer, world);
    const spec = (t: ShipTypeDef, ship: { age: number; condition: number }) => {
      const speed = effectiveSpeed(t, ship);
      const burn = t.fuelPerDay * consumptionFactor(ship);
      return { cap: t.capacity, speed, burn, upkeep: t.dailyCost, range: (t.bunkerCapacity / burn) * speed * 24 };
    };
    const a = spec(cur, g.ship);
    const b = spec(type, offer);
    const cmp = (label: string, val: string, better: boolean | null) =>
      `<div><span>${label}</span><strong class="${better === null ? '' : better ? 'up' : 'down'}">${val}</strong></div>`;
    const same = (x: number, y: number) => Math.abs(x - y) / Math.max(1, Math.abs(y)) < 0.02;
    const afterCash = g.cash - q.fromCash;
    const running = Math.round(type.bunkerCapacity * fuelPrice(g, g.ship.location) + type.dailyCost * 30);
    const tight = !q.blocked && afterCash < running;
    const line = (label: string, v: number, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${money(v, true)}</span></div>`;
    return `
      <li class="offer">
        <div class="o-head">
          <div><strong>${esc(type.name)}</strong> <span class="sub">${esc(offer.name)}</span></div>
          <div class="o-price">${compactMoney(offer.price)}</div>
        </div>
        <div class="o-tags">
          <span class="tag ${offer.age === 0 ? 'good' : ''}">${offer.age === 0 ? 'New' : `${offer.age} years old`}</span>
          <span class="tag ${offer.condition < 50 ? 'warn' : ''}">condition ${offer.condition}%</span>
          <span class="tag">${type.cargoClasses.join(' & ')}</span>
        </div>
        <p class="o-desc">${esc(type.description)}</p>
        <div class="o-stats">
          ${cmp('Hold', b.cap >= 10_000 ? `${b.cap / 1000}k t` : tons(b.cap), same(b.cap, a.cap) ? null : b.cap > a.cap)}
          ${cmp('Speed', `${b.speed.toFixed(1)} kn`, same(b.speed, a.speed) ? null : b.speed > a.speed)}
          ${cmp('Burn', `${b.burn.toFixed(0)} t/day`, same(b.burn, a.burn) ? null : b.burn < a.burn)}
          ${cmp('Upkeep', `$${(b.upkeep / 1000).toFixed(1)}k/d`, same(b.upkeep, a.upkeep) ? null : b.upkeep < a.upkeep)}
          ${cmp('Range', `${(b.range / 1000).toFixed(1)}k nm`, same(b.range, a.range) ? null : b.range > a.range)}
        </div>
        <details class="o-deal">
          <summary>${q.blocked ? 'Can’t buy yet' : q.borrow > 0 ? `Buy with a ${compactMoney(q.borrow)} loan` : 'Buy outright'} · details</summary>
          <div class="ledger">
            ${line('Price', -offer.price)}
            ${line(`Trade-in of the ${g.ship.name}`, q.tradeIn, 'good')}
            ${q.borrow > 0 ? line('New bank loan', q.borrow) : ''}
            <div class="line total"><span>Cash after the deal</span><span>${money(afterCash)}</span></div>
            <div class="line per-day"><span>Loan after the deal</span><span>${money(q.loanAfter)} of ${money(q.loanLimit)} limit</span></div>
          </div>
        </details>
        ${q.blocked ? `<p class="o-warn bad">${esc(q.blocked)}</p>` : ''}
        ${tight ? `<p class="o-warn">You'd keep ${money(afterCash)}, but a full tank and a month's upkeep for this ship cost about ${money(running)}. You may be stuck in port.</p>` : ''}
        <button class="btn ${tight ? '' : 'primary'} wide" data-action="buy-ship" data-id="${offer.id}" ${q.blocked ? 'disabled' : ''}>Buy the ${esc(offer.name)}</button>
      </li>`;
  }

  private voyageTab(g: GameState): string {
    const here = g.ship.location;
    const rows = world.portList.filter((p) => p.id !== here).map((p) => ({ p, plan: planVoyage(g, p.id)! }))
      .sort((a, b) => a.plan.route.nm - b.plan.route.nm);
    const list = rows.map(({ p, plan }) => {
      const cargo = plan.deliveries.length;
      return `<li class="dest ${p.id === this.dest ? 'selected' : ''} ${plan.inRange ? '' : 'out'}" data-action="dest" data-id="${p.id}" data-hover-dest="${p.id}">
        <span class="d-name">${esc(p.name)}${cargo ? ` <span class="tag good">${cargo} to deliver</span>` : ''}</span>
        <span class="d-meta">${plan.route.nm.toLocaleString('en-US')} nm · ${days(plan.seaDays)} · ${plan.inRange ? `${plan.fuelNeeded} t` : 'out of range'}</span>
      </li>`;
    }).join('');
    return `
      ${this.dest ? this.planCard(g, planVoyage(g, this.dest)!) : '<p class="hint">Pick a destination below or tap a port on the map.</p>'}
      <ul class="dests">${list}</ul>`;
  }

  private planCard(g: GameState, plan: VoyagePlan): string {
    const name = world.ports[plan.dest].name;
    const price = fuelPrice(g, g.ship.location);
    const fuelValue = plan.fuelNeeded * price;
    const reserve = g.ship.fuel - plan.fuelNeeded;
    const undelivered = g.ship.cargo.filter((c) => c.dest !== plan.dest);
    const type = shipType(g);
    const warnings: string[] = [];
    if (!plan.inRange) warnings.push(`Beyond this ship's range (${plan.fuelNeeded} t needed, bunkers hold ${type.bunkerCapacity} t). Plan a stop on the way.`);
    for (const d of plan.deliveries) if (d.late) warnings.push(`${world.goods[d.contract.good].name} will arrive after its deadline.`);
    if (undelivered.length) warnings.push(`${undelivered.length} cargo lot(s) stay aboard for other ports.`);
    if (plan.deliveries.length === 0) warnings.push('Sailing in ballast: no cargo for this port.');
    const line = (label: string, v: number, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${money(v, true)}</span></div>`;

    // Fuel, right here in the plan: no trip to the Ship tab needed.
    const target = Math.min(type.bunkerCapacity, Math.ceil(plan.fuelNeeded * 1.15));
    const topUp = Math.max(0, target - Math.floor(g.ship.fuel));
    const short = plan.fuelShort > 0;
    const fuelState = !plan.inRange ? 'bad' : short ? 'bad' : reserve < plan.fuelNeeded * 0.12 ? 'warn' : 'good';
    const fuelText = !plan.inRange ? 'out of range'
      : short ? `short by ${Math.ceil(plan.fuelShort)} t`
        : `reserve ${Math.floor(reserve)} t${fuelState === 'warn' ? ', thin: a storm could leave you adrift' : ''}`;
    const fuelBlock = `
      <div class="fuel-row ${fuelState}">
        <div><span class="lbl">Fuel</span> <strong>${Math.floor(g.ship.fuel)} t</strong> aboard · leg needs <strong>${plan.fuelNeeded} t</strong> · <em>${fuelText}</em></div>
        ${plan.inRange && !short && topUp > 0 ? `<button class="btn small" data-action="fuel-for-leg">+${topUp} t reserve<span>${money(topUp * price)}</span></button>` : ''}
      </div>`;

    const loss = plan.estimatedNet < 0 ? ` <span>estimate ${money(plan.estimatedNet)}</span>` : '';
    const sailButton = !plan.inRange
      ? `<button class="btn primary wide" disabled>Out of range</button>`
      : short
        ? `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="bunker-sail">Bunker ${topUp} t (${money(topUp * price)}) &amp; cast off${loss}</button>`
        : `<button class="btn primary wide ${loss ? 'loss' : ''}" data-action="sail">Cast off for ${esc(name)}${loss}</button>`;
    return `
      <section class="card plan">
        <h3>To ${esc(name)}</h3>
        <div class="plan-facts">
          <div><strong>${plan.route.nm.toLocaleString('en-US')}</strong><span>nm</span></div>
          <div><strong>${days(plan.seaDays + RULES.portDays)}</strong><span>incl. port</span></div>
          <div><strong>${plan.fuelNeeded} t</strong><span>fuel</span></div>
          <div><strong>${gameDate(g.day + plan.seaDays + RULES.portDays)}</strong><span>arrival</span></div>
        </div>
        ${plan.route.canals.length ? `<p class="hint">Via the ${plan.route.canals.map((c) => world.canals[c].name).join(' and ')}.</p>` : ''}
        <div class="ledger">
          ${line('Freight revenue', plan.revenue, 'good')}
          ${line('Upkeep', -plan.upkeep)}
          ${line(`Port fee ${name}`, -plan.portFee)}
          ${plan.canalFees ? line('Canal dues', -plan.canalFees) : ''}
          ${line(`Fuel burned (at ${money(price)}/t)`, -fuelValue)}
          <div class="line total ${plan.estimatedNet >= 0 ? 'good' : 'bad'}"><span>Estimated result</span><span>${money(plan.estimatedNet, true)}</span></div>
          <div class="line per-day"><span>per day</span><span>${money(plan.estimatedNet / (plan.seaDays + RULES.portDays), true)}</span></div>
        </div>
        ${fuelBlock}
        ${warnings.length ? `<ul class="warnings">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        ${sailButton}
      </section>`;
  }

  private logTab(g: GameState): string {
    const s = g.stats;
    return `
      <div class="stats">
        <div><strong>${s.voyages}</strong><span>voyages</span></div>
        <div><strong>${compactMoney(s.revenue)}</strong><span>revenue</span></div>
        <div><strong>${compactMoney(s.fuelSpent)}</strong><span>fuel bought</span></div>
        <div><strong>${tons(s.delivered)}</strong><span>delivered</span></div>
        <div><strong>${compactMoney(s.interestPaid)}</strong><span>interest paid</span></div>
        <div><strong>${s.shipsOwned}</strong><span>ships owned</span></div>
      </div>
      <ul class="log">${g.log.map((e) => `
        <li><span class="l-day">${gameDate(e.day)}</span><span class="l-text">${esc(e.text)}</span>
        ${e.amount !== undefined ? `<span class="l-amt ${e.amount >= 0 ? 'good' : 'bad'}">${money(e.amount, true)}</span>` : ''}</li>`).join('')}
      </ul>
      <button class="btn ghost wide" data-action="new-game">New game</button>
      <p class="build-info">Build ${esc(BUILD.number)} · ${esc(BUILD.sha)} · built ${esc(new Date(BUILD.time).toLocaleString())}</p>`;
  }

  // ------------------------------------------------------------ modals

  private showReport(): void {
    const r = this.g.lastVoyage;
    if (!r) return;
    const line = (label: string, v: number, cls = '') => `<div class="line ${cls}"><span>${esc(label)}</span><span>${money(v, true)}</span></div>`;
    $('#modal-body').innerHTML = `
      <h2>Arrived in ${esc(world.ports[r.to].name)}</h2>
      <p class="sub">${r.distance.toLocaleString('en-US')} nm from ${esc(world.ports[r.from].name)} in ${days(r.arriveDay - r.departDay)} · ${r.fuelUsed} t fuel burned · condition −${r.conditionLoss}%</p>
      ${r.events.length ? `<ul class="events">${r.events.map((e) => `<li class="${e.kind}"><span>Day ${e.day}</span> ${esc(e.text)}</li>`).join('')}</ul>` : '<p class="calm">A calm passage.</p>'}
      <div class="ledger">
        ${r.deliveries.map((d) => line(`${world.goods[d.contract.good].name}, ${tons(d.contract.tons)}${d.lateDays > 0 ? ` (late, ${Math.round((d.paid / d.contract.pay) * 100)}% paid)` : ''}`, d.paid, 'good')).join('')}
        ${line('Upkeep at sea', -r.upkeep)}
        ${line('Port fee', -r.portFee)}
        ${r.canalFees ? line('Canal dues', -r.canalFees) : ''}
        ${r.eventCosts ? line('Repairs & emergencies', -r.eventCosts, 'bad') : ''}
        ${r.interest ? line('Overdraft interest', -r.interest, 'bad') : ''}
        <div class="line total ${r.net >= 0 ? 'good' : 'bad'}"><span>Result for the leg</span><span>${money(r.net, true)}</span></div>
      </div>
      <div class="line memo"><span>Memo: fuel burned, paid when bunkering</span><span>≈ ${money(r.fuelUsed * fuelPrice(this.g, r.from))}</span></div>
      <button class="btn primary wide" data-action="close-report">Continue</button>`;
    $('#modal').hidden = false;
    ($('#modal-body').querySelector('.btn.primary') as HTMLElement)?.focus();
  }

  private showGameOver(): void {
    $('#modal-body').innerHTML = `
      <h2>Game over</h2>
      <p>${esc(this.g.gameOver!)}</p>
      <p class="sub">You lasted until ${gameDate(this.g.day)} and completed ${this.g.stats.voyages} voyages.</p>
      <button class="btn primary wide" data-action="new-game">Start again</button>`;
    $('#modal').hidden = false;
  }

  private toast(text: string, kind: 'good' | 'bad'): void {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
}

function gauge(label: string, frac: number, text: string, cls: string): string {
  const f = Math.max(0, Math.min(1, frac));
  return `<div class="gauge ${cls}"><div class="g-head"><span>${label}</span><span>${text}</span></div><div class="g-track"><div class="g-fill" style="width:${f * 100}%"></div></div></div>`;
}

$('#build').textContent = `Build ${BUILD.number}`;
$('#build').title = `Commit ${BUILD.sha}, built ${BUILD.time}`;
$('#reload').addEventListener('click', () => {
  $('#reload').classList.add('spinning');
  void reloadApp();
});
initServiceWorker();
new App();
