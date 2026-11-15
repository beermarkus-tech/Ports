// The port view: a side view of one ship at the quay or in dry dock, drawn to one
// true scale (300 m of quay across the picture). Load shows as draft, the holds
// and bunker tank are cut open, and wear shows as rust, fading paint and smoke.

import type { CargoClass } from '../sim/types';
import type { ShipFamily } from './art';

export type TimeOfDay = 'day' | 'dusk' | 'night';
type Region = 'europe' | 'med' | 'desert' | 'tropic' | 'city' | 'mountain';

export interface SceneLot { good: string; cls: CargoClass; tons: number }

export interface SceneShip {
  id: number;
  name: string;
  typeId: string;
  family: ShipFamily;
  capacity: number;
  bunkerCapacity: number;
  cargo: SceneLot[];
  fuel: number;
  condition: number;
}

export interface SceneInput {
  ship: SceneShip;
  place: 'quay' | 'dock';
  portId: string;
  portName: string;
  time: TimeOfDay;
  /** Other ships of ours in the same port, moored at the edges of the picture. */
  neighbours: SceneShip[];
  /** Days left in dry dock, if docked. */
  dockDays?: number;
}

interface Dims { L: number; D: number; d0: number; d1: number; sup: number }

/** Length, depth (keel to deck), light and full-load draft, bridge height above deck: metres. */
const DIMS: Record<string, Dims> = {
  coaster: { L: 80, D: 7, d0: 2.2, d1: 5.5, sup: 9 },
  largecoaster: { L: 95, D: 8, d0: 2.5, d1: 6.5, sup: 10 },
  general: { L: 130, D: 11, d0: 3.2, d1: 8.5, sup: 12 },
  handysize: { L: 170, D: 14, d0: 4, d1: 10, sup: 14 },
  bulker: { L: 190, D: 16, d0: 4.5, d1: 11.5, sup: 15 },
  panamax: { L: 225, D: 19, d0: 5, d1: 13.5, sup: 17 },
  smallreefer: { L: 100, D: 9, d0: 2.8, d1: 6.5, sup: 11 },
  reefer: { L: 140, D: 12, d0: 3.5, d1: 8.5, sup: 13 },
  smalltanker: { L: 145, D: 13, d0: 3.5, d1: 9.5, sup: 13 },
  tanker: { L: 230, D: 21, d0: 6, d1: 14.5, sup: 17 },
  feeder: { L: 140, D: 11, d0: 3.5, d1: 8, sup: 14 },
  container: { L: 260, D: 22, d0: 7, d1: 12.5, sup: 22 },
};

function dimsFor(s: SceneShip): Dims {
  if (DIMS[s.typeId]) return DIMS[s.typeId];
  // Unknown class: scale from capacity.
  const L = Math.round(60 + 40 * Math.log2(s.capacity / 2000));
  return { L, D: L * 0.08, d0: L * 0.025, d1: L * 0.06, sup: 8 + L * 0.04 };
}

const FAMILY: Record<ShipFamily, { hull: string; band: string }> = {
  general: { hull: '#24486e', band: '#e0a92b' },
  bulk: { hull: '#7a2626', band: '#f0f0f0' },
  reefer: { hull: '#eef2f4', band: '#2f7fb8' },
  tanker: { hull: '#1f2b33', band: '#d64b2a' },
  container: { hull: '#1d5f4e', band: '#f2c14e' },
};

/** How each good looks in a cut-open hold. */
const GOOD_LOOK: Record<string, string> = {
  grain: '#d9b45a', rice: '#efe6cf', sugar: '#f4f1ea', coal: '#2a2a2a', ironore: '#8e3b24', bauxite: '#b5532e',
  copper: '#4f7f6a', fertilizer: '#cfd3d6', timber: '#8a5a32', steel: '#7d868c', machinery: '#5d6d7e', electronics: '#3d5a80',
  textiles: '#b07aa1', coffee: '#6f4e37', cocoa: '#5a3a28', wine: '#7b2d3a', cars: '#c0392b', cotton: '#f0ece2',
  wool: '#e8e0cc', tea: '#4f6b3a', rubber: '#3b3b3b', crude: '#1b1712', fuelproducts: '#8a5a12', chemicals: '#3f7f5a',
  palmoil: '#d07a1e', fruit: '#e8a33a', meat: '#c96a6a', fish: '#9fb8c8', dairy: '#f1f4f6',
};

const PORT_REGION: Record<string, Region> = {
  rotterdam: 'europe', houston: 'europe', genoa: 'med', istanbul: 'med', alexandria: 'desert', dubai: 'desert',
  porthedland: 'desert', lagos: 'tropic', santos: 'tropic', mumbai: 'tropic', colombo: 'tropic', mombasa: 'tropic',
  bangkok: 'tropic', jakarta: 'tropic', singapore: 'city', shanghai: 'city', busan: 'city', yokohama: 'city',
  newyork: 'city', buenosaires: 'city', sydney: 'city', capetown: 'mountain', vancouver: 'mountain',
  losangeles: 'mountain', valparaiso: 'mountain', auckland: 'mountain',
};

const SCENE_M = 300;   // metres of quay across the picture
const BELOW_M = 20;    // metres shown below the waterline (room for the dry dock)
const QUAY_M = 4;      // quay height above the water

const SKY: Record<TimeOfDay, [string, string]> = { day: ['#8ec5e8', '#d9eef8'], dusk: ['#3c3f6e', '#f0a36b'], night: ['#060d1a', '#1a2a44'] };
const WATER: Record<TimeOfDay, string> = { day: '#2f6f93', dusk: '#3a4566', night: '#0b1a2c' };

/** Deterministic noise so rust and skylines don't jump around between frames. */
function rnd(seed: number): () => number {
  let s = Math.abs(Math.floor(seed)) % 2147483646 + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b), k = Math.max(0, Math.min(1, t));
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
}

export class PortScene {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hud: HTMLElement;
  private input: SceneInput | null = null;
  private zoomed = false;
  private sparkTimer = 0;
  private lastKey = '';

  constructor(container: HTMLElement, onMap: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'port-scene';
    this.el.hidden = true;
    this.el.innerHTML = `
      <canvas aria-label="Side view of the ship in port"></canvas>
      <div class="ps-hud"></div>
      <div class="ps-tools">
        <button class="ps-btn" data-ps="zoom" title="Zoom to the ship">Zoom</button>
        <button class="ps-btn" data-ps="map" title="Back to the world map">Map</button>
      </div>`;
    container.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.hud = this.el.querySelector('.ps-hud')!;
    this.el.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-ps]');
      if (btn?.dataset.ps === 'map') { onMap(); return; }
      if (btn?.dataset.ps === 'zoom' || ev.target === this.canvas) this.toggleZoom();
    });
    new ResizeObserver(() => { this.lastKey = ''; this.draw(); }).observe(this.el);
  }

  get visible(): boolean { return !this.el.hidden; }

  show(input: SceneInput): void {
    if (this.input?.ship.id !== input.ship.id) this.zoomed = false;
    this.input = input;
    this.el.hidden = false;
    this.draw();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (input.place === 'dock' && !reduce && !this.sparkTimer) {
      this.sparkTimer = window.setInterval(() => { this.lastKey = ''; this.draw(); }, 140);
    } else if (input.place !== 'dock') this.stopSparks();
  }

  hide(): void {
    this.el.hidden = true;
    this.stopSparks();
  }

  private stopSparks(): void {
    if (this.sparkTimer) { clearInterval(this.sparkTimer); this.sparkTimer = 0; }
  }

  private toggleZoom(): void {
    this.zoomed = !this.zoomed;
    this.lastKey = '';
    this.draw();
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    const input = this.input;
    if (!input || this.el.hidden) return;
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w < 10 || h < 10) return;
    const key = JSON.stringify([input, w, h, this.zoomed]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { ship, time: t } = input;
    const dims = dimsFor(ship);
    const dock = input.place === 'dock';
    // At least 300 m of quay across, and room for the tallest ship top to bottom.
    const m = Math.min(w / SCENE_M, h / 95);
    // Waterline at about two thirds of the height, or lower if the picture is short.
    const yW = Math.min(h - BELOW_M * m * 1.1, h * 0.66);
    const shipX = (w - dims.L * m) / 2;

    // Sky (full width and height, outside any zoom).
    const sky = c.createLinearGradient(0, 0, 0, yW);
    sky.addColorStop(0, SKY[t][0]); sky.addColorStop(1, SKY[t][1]);
    c.fillStyle = sky; c.fillRect(0, 0, w, h);

    c.save();
    if (this.zoomed) {
      const k = Math.max(1, Math.min((w * 0.86) / (dims.L * m), (h * 0.62) / ((dims.D + dims.sup + 8) * m)));
      const cx = shipX + (dims.L * m) / 2;
      c.translate(w / 2, yW - (h - yW) * 0.2);
      c.scale(k, k);
      c.translate(-cx, -yW);
    }
    if (t === 'night') {
      const r = rnd(7);
      c.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 80; i++) c.fillRect(r() * w, r() * yW * 0.7, 1.2, 1.2);
    }
    const quayTop = yW - QUAY_M * m;
    this.backdrop(PORT_REGION[input.portId] ?? 'europe', input.portId, w, quayTop, m, t);
    if (dock) this.dryDock(w, h, yW, m, t); else this.quay(w, yW, quayTop, m, t);

    // Neighbours at the edges, then our ship in the middle.
    const sides = [-1, 1];
    (dock ? [] : input.neighbours.slice(0, 2)).forEach((n, i) => {
      const nd = dimsFor(n);
      const x = sides[i] < 0 ? -nd.L * m + 45 * m : w - 45 * m;
      this.drawShip(n, nd, x, yW + this.draft(n, nd) * m, m, { cutaway: false, time: t, dock: false, faded: true });
    });
    const keelY = dock ? yW + (BELOW_M - 3.2) * m : yW + this.draft(ship, dims) * m;
    this.drawShip(ship, dims, shipX, keelY, m, { cutaway: dock, time: t, dock, faded: false });

    if (!dock) {
      c.fillStyle = WATER[t]; c.globalAlpha = 0.86;
      c.fillRect(-w, yW, w * 3, h);
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1;
      const r = rnd(3);
      for (let i = 0; i < 30; i++) {
        const y = yW + 3 + r() * (h - yW - 6), x = r() * w, l = 10 + r() * 30;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + l, y); c.stroke();
      }
      // The cutaway is a diagram: drawn over the water so the levels stay readable.
      c.save();
      c.clip(this.hullPath(dims, shipX, keelY, m));
      this.holds(ship, dims, shipX, keelY, m);
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(shipX, yW); c.lineTo(shipX + dims.L * m, yW); c.stroke();
      c.setLineDash([]);
    } else {
      this.sparks(shipX, keelY, dims, m);
    }
    c.restore();
    this.renderHud(input, dims);
    (this.el.querySelector('[data-ps=zoom]') as HTMLElement).textContent = this.zoomed ? 'Whole quay' : 'Zoom';
  }

  /** Draft from what's aboard: cargo plus fuel against the ship's deadweight. */
  private draft(s: SceneShip, d: Dims): number {
    const tons = s.cargo.reduce((a, l) => a + l.tons, 0) + s.fuel;
    const dw = Math.max(0, Math.min(1, tons / (s.capacity + s.bunkerCapacity)));
    return d.d0 + (d.d1 - d.d0) * dw;
  }

  private renderHud(input: SceneInput, d: Dims): void {
    const s = input.ship;
    const cargo = s.cargo.reduce((a, l) => a + l.tons, 0);
    const fuelShare = s.fuel / s.bunkerCapacity;
    const chip = (text: string, cls = '') => `<span class="${cls}">${text}</span>`;
    const draft = input.place === 'dock' ? null : this.draft(s, d);
    this.hud.innerHTML = [
      chip(`<strong>${esc(s.name)}</strong> · ${input.place === 'dock' ? 'dry dock' : 'quay'}, ${esc(input.portName)}`),
      chip(`${d.L} m`, 'opt'),
      draft !== null ? chip(`Draft ${draft.toFixed(1)} of ${d.d1} m`) : chip(`Ready in ${Math.max(1, Math.ceil(input.dockDays ?? 1))} day${Math.ceil(input.dockDays ?? 1) === 1 ? '' : 's'}`),
      chip(`Hold ${cargo.toLocaleString('en-US')} / ${s.capacity.toLocaleString('en-US')} t`),
      chip(`Bunkers ${Math.round(s.fuel)} / ${s.bunkerCapacity} t`, fuelShare < 0.15 ? 'bad' : fuelShare < 0.3 ? 'warn' : ''),
      chip(`Condition ${Math.round(s.condition)}%`, s.condition < 45 ? 'bad' : s.condition < 65 ? 'warn' : ''),
    ].join('');
  }

  private backdrop(region: Region, portId: string, w: number, base: number, m: number, t: TimeOfDay): void {
    const c = this.ctx;
    const far = t === 'night' ? '#152238' : t === 'dusk' ? '#5a4f73' : '#9fb6c6';
    const near = t === 'night' ? '#1c2c45' : t === 'dusk' ? '#6b5a78' : '#8aa3b5';
    const lit = '#f5d27a';
    let seed = 0;
    for (const ch of portId) seed = seed * 31 + ch.charCodeAt(0);
    const r = rnd(seed);
    c.fillStyle = far;
    if (region === 'mountain') {
      // A ridge of peaks; each snow cap sits on its own peak.
      const peaks: [number, number][] = [];
      const step = w / 7;
      for (let x = -step / 2; x <= w + step; x += step) peaks.push([x + r() * step * 0.4, base - (35 + r() * 45) * m]);
      c.beginPath(); c.moveTo(-10, base);
      for (let i = 0; i < peaks.length; i++) {
        const [px, py] = peaks[i];
        c.lineTo(px, py);
        if (i < peaks.length - 1) c.lineTo((px + peaks[i + 1][0]) / 2, base - (12 + r() * 10) * m);
      }
      c.lineTo(w + 10, base); c.closePath(); c.fill();
      c.fillStyle = t === 'night' ? '#30405a' : t === 'dusk' ? '#e8c9c0' : '#f4f8fb';
      for (let i = 0; i < peaks.length; i++) {
        const [px, py] = peaks[i];
        const left = i > 0 ? peaks[i - 1][0] : px - step;
        const right = i < peaks.length - 1 ? peaks[i + 1][0] : px + step;
        const depth = 9 * m;
        // Follow the two slopes down from the peak a little way.
        const lx = px - ((px - (left + px) / 2) * depth) / Math.max(1, base - py);
        const rx = px + ((((right + px) / 2) - px) * depth) / Math.max(1, base - py);
        c.beginPath(); c.moveTo(px, py);
        c.lineTo(lx, py + depth); c.lineTo(px - (px - lx) * 0.3, py + depth * 0.75);
        c.lineTo(px + (rx - px) * 0.25, py + depth * 0.85); c.lineTo(rx, py + depth);
        c.closePath(); c.fill();
      }
    } else if (region === 'med') {
      c.beginPath(); c.moveTo(0, base); c.quadraticCurveTo(w * 0.35, base - 70 * m, w, base - 20 * m); c.lineTo(w, base); c.fill();
      for (let i = 0; i < 46; i++) {
        const x = r() * w, y = base - r() * 40 * m;
        c.fillStyle = t === 'night' ? (r() < 0.4 ? lit : '#2a3a55') : '#efe9df';
        c.fillRect(x, y, 5 * m, 4 * m);
      }
    } else if (region === 'desert') {
      for (let i = 0; i < 9; i++) {
        const x = (i * w) / 9 + r() * 10, hgt = (16 + r() * 36) * m;
        c.fillStyle = far; c.fillRect(x, base - hgt, 10 * m, hgt);
        if (t !== 'day') { c.fillStyle = lit; for (let k = 0; k < 5; k++) c.fillRect(x + 2 * m, base - hgt + k * 6 * m + 2 * m, 1.5 * m, 1.5 * m); }
      }
      c.fillStyle = far; c.fillRect(w * 0.72, base - 68 * m, 4 * m, 68 * m);
      c.beginPath(); c.moveTo(w * 0.72, base - 68 * m); c.lineTo(w * 0.72 + 2 * m, base - 82 * m); c.lineTo(w * 0.72 + 4 * m, base - 68 * m); c.fill();
      for (let i = 0; i < 4; i++) this.palm(r() * w, base, (9 + r() * 4) * m, near);
    } else if (region === 'tropic') {
      c.beginPath(); c.moveTo(0, base);
      c.bezierCurveTo(w * 0.2, base - 50 * m, w * 0.4, base - 20 * m, w * 0.6, base - 38 * m);
      c.bezierCurveTo(w * 0.8, base - 55 * m, w * 0.9, base - 25 * m, w, base - 30 * m);
      c.lineTo(w, base); c.fill();
      for (let i = 0; i < 10; i++) this.palm(r() * w, base, (10 + r() * 6) * m, near);
    } else if (region === 'city') {
      for (let i = 0; i < 18; i++) {
        const x = r() * w, hgt = (25 + r() * 55) * m, bw = (8 + r() * 10) * m;
        c.fillStyle = far; c.fillRect(x, base - hgt, bw, hgt);
        if (t !== 'day') { c.fillStyle = lit; for (let k = 0; k < 12; k++) if (r() < 0.5) c.fillRect(x + r() * bw, base - r() * hgt, 1.5, 1.5); }
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const x = (i * w) / 6 + r() * 20, bw = (26 + r() * 14) * m, hgt = (10 + r() * 6) * m;
        c.fillStyle = far; c.fillRect(x, base - hgt, bw, hgt);
        c.beginPath(); c.moveTo(x, base - hgt); c.lineTo(x + bw / 2, base - hgt - 6 * m); c.lineTo(x + bw, base - hgt); c.fill();
      }
      c.strokeStyle = far; c.lineWidth = Math.max(1, 0.6 * m);
      for (let i = 0; i < 3; i++) {
        const x = w * (0.15 + i * 0.3), top = base - 62 * m;
        c.beginPath(); c.moveTo(x, base); c.lineTo(x, top); c.stroke();
        for (let k = 0; k < 3; k++) { const a = k * 2.1 + i; c.beginPath(); c.moveTo(x, top); c.lineTo(x + Math.cos(a) * 18 * m, top + Math.sin(a) * 18 * m); c.stroke(); }
      }
    }
  }

  private palm(x: number, base: number, hgt: number, col: string): void {
    const c = this.ctx;
    c.strokeStyle = col; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x, base); c.quadraticCurveTo(x + hgt * 0.2, base - hgt * 0.6, x + hgt * 0.1, base - hgt); c.stroke();
    c.fillStyle = col;
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k - 2.5) * 0.55;
      c.beginPath();
      c.ellipse(x + hgt * 0.1 + Math.cos(a) * hgt * 0.25, base - hgt + Math.sin(a) * hgt * 0.12 + hgt * 0.05, hgt * 0.26, hgt * 0.05, a, 0, Math.PI * 2);
      c.fill();
    }
  }

  private quay(w: number, yW: number, top: number, m: number, t: TimeOfDay): void {
    const c = this.ctx;
    c.fillStyle = t === 'night' ? '#3b4656' : '#b9bdb9'; c.fillRect(-w, top, w * 3, yW - top);
    c.fillStyle = t === 'night' ? '#2c3542' : '#8f948f'; c.fillRect(-w, yW - 1.2 * m, w * 3, 1.2 * m);
    // Warehouse at the left, a container stack at the right
    c.fillStyle = t === 'night' ? '#4a3a33' : '#9a5a44'; c.fillRect(6 * m, top - 15 * m, 56 * m, 15 * m);
    c.fillStyle = t === 'night' ? '#3a2c26' : '#7d4634';
    for (let i = 0; i < 4; i++) c.fillRect((10 + i * 13) * m, top - 7 * m, 8 * m, 7 * m);
    const cols = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#7d3c98', '#ca6f1e'];
    const r = rnd(11);
    for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) {
      if (k > 0 && r() < 0.35) continue;
      c.fillStyle = cols[Math.floor(r() * cols.length)];
      c.fillRect(w - (70 - i * 12.6) * m, top - (k + 1) * 2.6 * m, 12.2 * m, 2.5 * m);
    }
    for (const cx of [0.3, 0.7]) this.crane(w * cx, top, m, t);
    this.truck(72 * m, top, m, t);
    this.people([90, 93, 150, 214, 217], top, m, t);
    c.fillStyle = '#222';
    for (let x = 20; x < (w / m); x += 25) c.fillRect(x * m, top - 0.8 * m, 1.2 * m, 0.8 * m);
    if (t !== 'day') {
      for (const lx of [40, 130, 220]) {
        c.fillStyle = '#555'; c.fillRect(lx * m, top - 25 * m, 0.5 * m, 25 * m);
        const gl = c.createRadialGradient(lx * m, top - 25 * m, 0, lx * m, top - 25 * m, 22 * m);
        gl.addColorStop(0, 'rgba(255,214,140,0.55)'); gl.addColorStop(1, 'rgba(255,214,140,0)');
        c.fillStyle = gl; c.beginPath(); c.arc(lx * m, top - 25 * m, 22 * m, 0, Math.PI * 2); c.fill();
      }
    }
  }

  private crane(x: number, top: number, m: number, t: TimeOfDay): void {
    const c = this.ctx;
    c.strokeStyle = t === 'night' ? '#7a6a3a' : '#d9a520'; c.lineWidth = Math.max(1.2, 0.8 * m);
    const H = 34 * m;
    c.beginPath();
    c.moveTo(x - 5 * m, top); c.lineTo(x - 2 * m, top - H); c.lineTo(x + 2 * m, top - H); c.lineTo(x + 5 * m, top);
    c.moveTo(x - 4 * m, top - 10 * m); c.lineTo(x + 4 * m, top - 10 * m);
    c.moveTo(x, top - H); c.lineTo(x + 26 * m, top - H - 16 * m);
    c.moveTo(x, top - H - 8 * m); c.lineTo(x + 26 * m, top - H - 16 * m);
    c.moveTo(x, top - H); c.lineTo(x, top - H - 8 * m);
    c.stroke();
    c.fillStyle = t === 'night' ? '#6b5c34' : '#c89212'; c.fillRect(x - 4 * m, top - H - 4 * m, 8 * m, 5 * m);
    c.strokeStyle = '#333'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x + 26 * m, top - H - 16 * m); c.lineTo(x + 26 * m, top - 16 * m); c.stroke();
  }

  private truck(x: number, top: number, m: number, t: TimeOfDay): void {
    const c = this.ctx;
    c.fillStyle = t === 'night' ? '#5d2a2a' : '#b03a2e'; c.fillRect(x, top - 4 * m, 3 * m, 3.2 * m);
    c.fillStyle = '#2471a3'; c.fillRect(x + 3.3 * m, top - 3.6 * m, 12.2 * m, 2.6 * m);
    c.fillStyle = '#111';
    for (const wx of [1.4, 6, 13.5]) { c.beginPath(); c.arc(x + wx * m, top - 0.5 * m, 0.55 * m, 0, Math.PI * 2); c.fill(); }
  }

  private people(xs: number[], top: number, m: number, t: TimeOfDay): void {
    const c = this.ctx;
    c.fillStyle = t === 'night' ? '#d8c27a' : '#ff8a00';
    for (const x of xs) {
      c.fillRect(x * m, top - 1.8 * m, 0.5 * m, 1.3 * m);
      c.beginPath(); c.arc(x * m + 0.25 * m, top - 1.95 * m, 0.25 * m, 0, Math.PI * 2); c.fill();
    }
  }

  private dryDock(w: number, h: number, yW: number, m: number, t: TimeOfDay): void {
    const c = this.ctx;
    const top = yW - QUAY_M * m;
    c.fillStyle = t === 'night' ? '#38424f' : '#a9aca7'; c.fillRect(-w, top, w * 3, h * 2);
    const floorY = yW + (BELOW_M - 2) * m;
    const fl = c.createLinearGradient(0, floorY, 0, h);
    fl.addColorStop(0, t === 'night' ? '#2a313b' : '#7f827d'); fl.addColorStop(1, t === 'night' ? '#1c222a' : '#5f625e');
    c.fillStyle = fl; c.fillRect(-w, floorY, w * 3, h);
    // Puddles and the dock gate far behind
    c.fillStyle = 'rgba(80,120,150,0.35)';
    const pr = rnd(5);
    for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(pr() * w, floorY + (2 + pr() * 6) * m, (6 + pr() * 14) * m, 0.8 * m, 0, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = t === 'night' ? '#2a313b' : '#939690'; c.lineWidth = 1;
    for (let k = 0; k < 8; k++) { const y = top + k * 3 * m; c.beginPath(); c.moveTo(-w, y); c.lineTo(w * 2, y); c.stroke(); }
    c.fillStyle = WATER[t]; c.globalAlpha = 0.5; c.fillRect(-w, yW + (BELOW_M - 2) * m, w * 3, 1 * m); c.globalAlpha = 1;
    this.crane(w * 0.12, top, m, t);
    this.people([30, 34, 262], top, m, t);
  }

  private sparks(x0: number, keelY: number, d: Dims, m: number): void {
    const c = this.ctx;
    const r = rnd(Math.floor(Date.now() / 120));
    c.fillStyle = '#ffd36b';
    for (let s = 0; s < 3; s++) {
      const sx = x0 + (0.25 + s * 0.25) * d.L * m, sy = keelY - d.D * 0.45 * m;
      for (let i = 0; i < 9; i++) c.fillRect(sx + (r() - 0.5) * 6 * m, sy + r() * 4 * m, 1.5, 1.5);
    }
  }

  // ---------------------------------------------------------------- the ship

  private hullPath(d: Dims, x0: number, keelY: number, m: number): Path2D {
    const L = d.L * m, D = d.D * m, deckY = keelY - D, xs = x0, xb = x0 + L;
    const hull = new Path2D();
    hull.moveTo(xs, deckY);
    hull.lineTo(xs + 0.01 * L, keelY - 0.45 * D);
    hull.quadraticCurveTo(xs + 0.03 * L, keelY, xs + 0.08 * L, keelY);
    hull.lineTo(xb - 0.14 * L, keelY);
    hull.quadraticCurveTo(xb - 0.02 * L, keelY, xb, deckY - 0.12 * D);
    hull.lineTo(xb - 0.09 * L, deckY - 0.1 * D);
    hull.lineTo(xb - 0.09 * L, deckY);
    hull.closePath();
    return hull;
  }

  private drawShip(s: SceneShip, d: Dims, x0: number, keelY: number, m: number,
    o: { cutaway: boolean; time: TimeOfDay; dock: boolean; faded: boolean }): void {
    const c = this.ctx;
    const f = FAMILY[s.family];
    const L = d.L * m, D = d.D * m;
    const deckY = keelY - D;
    const xs = x0, xb = x0 + L;
    const wear = 1 - s.condition / 100;
    const hullCol = mix(f.hull, s.family === 'reefer' ? '#b9b4a8' : '#6d6a63', Math.max(0, wear - 0.2) * 0.9);
    c.save();
    if (o.faded) c.globalAlpha = 0.7;

    if (o.dock) {
      c.fillStyle = '#5b4a3a';
      for (let x = 0.08; x < 0.92; x += 0.07) c.fillRect(xs + x * L, keelY, 2.2 * m, 3 * m);
      // Scaffolding along the hull
      c.strokeStyle = 'rgba(90,90,90,0.8)'; c.lineWidth = 1;
      for (let x = 0.15; x < 0.9; x += 0.12) { c.beginPath(); c.moveTo(xs + x * L, keelY + 3 * m); c.lineTo(xs + x * L, deckY); c.stroke(); }
      for (let y = 0.25; y < 1; y += 0.25) { c.beginPath(); c.moveTo(xs + 0.15 * L, deckY + y * D); c.lineTo(xs + 0.87 * L, deckY + y * D); c.stroke(); }
    }

    const hull = this.hullPath(d, x0, keelY, m);
    c.save();
    c.clip(hull);
    c.fillStyle = hullCol; c.fillRect(xs, deckY - 0.2 * D, L, D * 1.3);
    // Red bottom paint up to the full-load line: it shows above the water when light.
    const bootY = keelY - d.d1 * m;
    c.fillStyle = mix('#a5312a', '#6d4a3a', wear * 0.6); c.fillRect(xs, bootY, L, keelY - bootY + 2);
    c.fillStyle = mix(f.band, '#8a857a', wear * 0.5); c.fillRect(xs, bootY - 0.5 * m, L, 0.5 * m);
    if (o.cutaway) this.holds(s, d, xs, keelY, m);
    this.wearAndTear(s, d, xs, deckY, bootY, m);
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1; c.stroke(hull);

    if (!o.faded) {
      // Draft marks at the bow, the load-line mark amidships
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.font = `${Math.max(7, 1.6 * m)}px system-ui, sans-serif`;
      for (let dd = 2; dd <= d.D - 1; dd += 2) c.fillText(String(dd), xb - 0.12 * L, keelY - dd * m + 3);
      const px = xs + 0.5 * L, py = keelY - d.d1 * m;
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = Math.max(1, 0.25 * m);
      c.beginPath(); c.arc(px, py, 1.6 * m, 0, Math.PI * 2); c.moveTo(px - 2.4 * m, py); c.lineTo(px + 2.4 * m, py); c.stroke();
    }
    this.deckGear(s, d, xs, deckY, m, f);
    this.superstructure(s, d, xs, deckY, m, o, f);
    c.restore();
  }

  private wearAndTear(s: SceneShip, d: Dims, xs: number, deckY: number, bootY: number, m: number): void {
    const c = this.ctx;
    const L = d.L * m, D = d.D * m, cond = s.condition;
    const r = rnd(s.id * 97 + 13);
    if (cond < 80) {
      const n = Math.round((80 - cond) * 0.9 * (d.L / 130));
      for (let i = 0; i < n; i++) {
        const x = xs + (0.04 + r() * 0.92) * L, len = (0.15 + r() * 0.5) * D;
        const gr = c.createLinearGradient(0, deckY, 0, deckY + len);
        gr.addColorStop(0, 'rgba(150,72,28,0.85)'); gr.addColorStop(1, 'rgba(150,72,28,0)');
        c.fillStyle = gr; c.fillRect(x, deckY, Math.max(1, (0.3 + r() * 0.5) * m), len);
      }
    }
    if (cond < 60) {
      const n = Math.round((60 - cond) * 0.7 * (d.L / 130));
      for (let i = 0; i < n; i++) {
        c.fillStyle = `rgba(${120 + r() * 40},${55 + r() * 25},25,${0.35 + r() * 0.4})`;
        c.beginPath();
        c.ellipse(xs + (0.05 + r() * 0.9) * L, bootY - (0.5 + r() * 2.5) * m, (0.8 + r() * 2.5) * m, (0.4 + r() * 1.2) * m, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    if (cond < 40) {
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const x = xs + (0.1 + r() * 0.8) * L, y = deckY + (0.2 + r() * 0.4) * D;
        c.beginPath(); c.arc(x, y, (1 + r() * 2) * m, 0.2, 2.6); c.stroke();
      }
    }
    if (cond >= 90) {
      const sh = c.createLinearGradient(0, deckY, 0, deckY + D * 0.4);
      sh.addColorStop(0, 'rgba(255,255,255,0.28)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sh; c.fillRect(xs, deckY, L, D * 0.4);
    }
  }

  /** Cut-open holds filled with the actual lots aboard, and the bunker tank under the bridge. */
  private holds(s: SceneShip, d: Dims, xs: number, keelY: number, m: number): void {
    const c = this.ctx;
    const L = d.L * m, D = d.D * m, deckY = keelY - D;
    const supW = Math.max(14, 0.13 * d.L) * m;
    const start = xs + 0.04 * L + supW + 2 * m, end = xs + L * 0.88;
    const n = Math.max(2, Math.round((end - start) / (26 * m)));
    const hw = (end - start) / n;
    const bottom = keelY - 1.4 * m, topY = deckY + 0.8 * m;
    const perHold = s.capacity / n;
    // Lots fill the holds from the bow aft, each to its share of the space.
    const queue = s.cargo.map((l) => ({ ...l, left: l.tons }));
    for (let i = n - 1; i >= 0; i--) {
      const x = start + i * hw + 0.6 * m, wid = hw - 1.2 * m;
      c.fillStyle = 'rgba(15,25,35,0.6)'; c.fillRect(x, topY, wid, bottom - topY);
      let room = perHold;
      let y = bottom;
      while (room > 0.5 && queue.length) {
        const lot = queue[0];
        const take = Math.min(room, lot.left);
        const hgt = ((bottom - topY) * take) / perHold;
        const last = room - take < 0.5 || queue.length === 1;
        this.cargoBlock(lot, x, y - hgt, wid, hgt, m, s.family === 'container', last && take === lot.left && lot.cls === 'bulk', i);
        y -= hgt; room -= take; lot.left -= take;
        if (lot.left <= 0.5) queue.shift();
      }
    }
    // Bunker tank
    const tx = xs + 0.04 * L + 1.5 * m, tw = supW - 3 * m, tb = keelY - 1.2 * m, tt = keelY - 0.45 * D;
    c.fillStyle = 'rgba(15,25,35,0.65)'; c.fillRect(tx, tt, tw, tb - tt);
    const share = Math.max(0, Math.min(1, s.fuel / s.bunkerCapacity));
    const fy = tb - (tb - tt) * share;
    c.fillStyle = share < 0.15 ? '#d03b3b' : share < 0.3 ? '#d08a1b' : '#1a1410';
    c.fillRect(tx, fy, tw, tb - fy);
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1; c.strokeRect(tx, tt, tw, tb - tt);
    if (tw > 20) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.font = `${Math.max(7, 1.5 * m)}px system-ui, sans-serif`; c.fillText('FUEL', tx + 2, tt - 3); }
  }

  private cargoBlock(lot: SceneLot, x: number, y: number, wid: number, hgt: number, m: number, boxed: boolean, heap: boolean, seed: number): void {
    const c = this.ctx;
    const col = GOOD_LOOK[lot.good] ?? '#a0763f';
    if (hgt <= 0.3) return;
    if (boxed) {
      const cols = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', col];
      const bh = 2.6 * m, bw = 6 * m;
      let k = seed;
      for (let yy = y + hgt - bh; yy >= y - 0.5; yy -= bh) for (let xx = x; xx + bw <= x + wid + 0.1; xx += bw) {
        c.fillStyle = cols[(k++ * 7) % cols.length]; c.fillRect(xx + 0.3, yy + 0.3, bw - 0.6, bh - 0.6);
      }
      return;
    }
    if (lot.cls === 'liquid') {
      c.fillStyle = col; c.fillRect(x, y, wid, hgt);
      c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x, y, wid, 1);
      return;
    }
    if (lot.cls === 'bulk') {
      c.fillStyle = col;
      c.beginPath(); c.moveTo(x, y + hgt);
      if (heap) { c.lineTo(x, y + Math.min(hgt, 1.5 * m)); c.quadraticCurveTo(x + wid / 2, y - Math.min(hgt, 1.5 * m), x + wid, y + Math.min(hgt, 1.5 * m)); }
      else { c.lineTo(x, y); c.lineTo(x + wid, y); }
      c.lineTo(x + wid, y + hgt); c.closePath(); c.fill();
      return;
    }
    // General and chilled cargo: crates or pallets
    const bh = 2.2 * m, bw = lot.cls === 'reefer' ? 2.8 * m : 3.4 * m;
    const shade = [col, mix(col.startsWith('#') ? col : '#a0763f', '#000000', 0.15), mix(col.startsWith('#') ? col : '#a0763f', '#ffffff', 0.15)];
    let k = seed;
    for (let yy = y + hgt - bh; yy >= y - bh * 0.5; yy -= bh) for (let xx = x; xx + bw <= x + wid + 0.1; xx += bw) {
      const top = Math.max(yy, y);
      c.fillStyle = shade[(k++ * 5) % 3]; c.fillRect(xx + 0.2, top + 0.2, bw - 0.4, yy + bh - top - 0.4);
    }
    if (lot.cls === 'reefer') { c.fillStyle = 'rgba(220,240,255,0.25)'; c.fillRect(x, y, wid, hgt); }
  }

  private deckGear(s: SceneShip, d: Dims, xs: number, deckY: number, m: number, f: { hull: string; band: string }): void {
    const c = this.ctx;
    const L = d.L * m;
    const supW = Math.max(14, 0.13 * d.L) * m;
    const start = xs + 0.04 * L + supW + 3 * m, end = xs + L * 0.86;
    if (s.family === 'container') {
      const fill = s.cargo.reduce((a, l) => a + l.tons, 0) / s.capacity;
      const tiers = Math.round((d.L > 200 ? 5 : 3) * Math.min(1, fill * 1.4));
      const cols = ['#c0392b', '#2471a3', '#d4ac0d', '#1e8449', '#7d3c98', '#ca6f1e', '#e5e7e9'];
      const r = rnd(s.id * 7 + 1);
      for (let x = start; x + 12.2 * m <= end; x += 12.6 * m) for (let k = 0; k < tiers; k++) {
        c.fillStyle = cols[Math.floor(r() * cols.length)];
        c.fillRect(x, deckY - (k + 1) * 2.6 * m, 12.2 * m, 2.5 * m);
      }
      return;
    }
    if (s.family === 'tanker') {
      c.strokeStyle = '#8a8f93'; c.lineWidth = Math.max(1, 0.4 * m);
      c.beginPath(); c.moveTo(start, deckY - 1.2 * m); c.lineTo(end, deckY - 1.2 * m); c.stroke();
      c.beginPath(); c.moveTo(start, deckY - 2.5 * m); c.lineTo(end, deckY - 2.5 * m); c.stroke();
      c.fillStyle = '#c8452a'; c.fillRect(xs + 0.55 * L, deckY - 4 * m, 1 * m, 4 * m);
      return;
    }
    const n = Math.max(2, Math.round((end - start) / (26 * m)));
    const hw = (end - start) / n;
    c.fillStyle = s.family === 'bulk' ? '#5f6a6f' : mix(f.hull, '#999999', 0.4);
    for (let i = 0; i < n; i++) c.fillRect(start + i * hw + 1 * m, deckY - 1.6 * m, hw - 2 * m, 1.6 * m);
    if (s.typeId !== 'panamax') {
      c.strokeStyle = s.family === 'reefer' ? '#2f7fb8' : '#e0a92b'; c.lineWidth = Math.max(1, 0.5 * m);
      for (let i = 1; i < n; i++) {
        const x = start + i * hw;
        c.beginPath(); c.moveTo(x, deckY); c.lineTo(x, deckY - 8 * m); c.lineTo(x + 0.6 * hw, deckY - 3 * m); c.stroke();
      }
    }
  }

  private superstructure(s: SceneShip, d: Dims, xs: number, deckY: number, m: number,
    o: { time: TimeOfDay; dock: boolean; faded: boolean }, f: { hull: string; band: string }): void {
    const c = this.ctx;
    const L = d.L * m;
    const w = Math.max(14, 0.13 * d.L) * m, hgt = d.sup * m;
    const x = xs + 0.04 * L, top = deckY - hgt;
    const wear = 1 - s.condition / 100;
    c.fillStyle = mix('#f4f4f2', '#b8b2a5', Math.max(0, wear - 0.3));
    c.fillRect(x, top, w, hgt);
    c.fillRect(x - 1.5 * m, top, w + 3 * m, 1.6 * m);
    c.strokeStyle = 'rgba(0,0,0,0.3)'; c.lineWidth = 1; c.strokeRect(x, top, w, hgt);
    const rows = Math.max(2, Math.floor(d.sup / 3));
    for (let rr = 0; rr < rows; rr++) for (let k = 0; k < Math.floor(w / (3 * m)); k++) {
      const lit = o.time !== 'day' && ((rr * 7 + k * 3 + s.id) % 5 < 3);
      c.fillStyle = lit ? '#ffd27a' : '#2c3e50';
      c.fillRect(x + (1 + k * 3) * m, top + (2.2 + rr * 3) * m, 1.6 * m, 1.2 * m);
    }
    const fx = x + w * 0.35, fw = Math.max(4 * m, w * 0.35);
    c.fillStyle = '#2b2b2b'; c.fillRect(fx, top - 5 * m, fw, 5 * m);
    c.fillStyle = f.band; c.fillRect(fx, top - 3.6 * m, fw, 1.4 * m);
    if (s.condition < 40 && !o.dock) {
      for (let i = 0; i < 5; i++) {
        c.fillStyle = `rgba(40,40,40,${0.35 - i * 0.06})`;
        c.beginPath(); c.arc(fx + fw / 2 - i * 3 * m, top - (7 + i * 3) * m, (1.5 + i * 0.9) * m, 0, Math.PI * 2); c.fill();
      }
    }
    if (!o.faded) {
      c.fillStyle = s.family === 'reefer' ? 'rgba(20,40,60,0.85)' : 'rgba(255,255,255,0.85)';
      c.font = `600 ${Math.max(7, 1.8 * m)}px system-ui, sans-serif`;
      // On the bow, just aft of the draft marks.
      const name = s.name.toUpperCase();
      c.fillText(name, xs + L * 0.88 - 1.5 * m - c.measureText(name).width, deckY + 2.8 * m);
    }
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}
