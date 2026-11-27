// Harbour life for the 1650 port view: what moves over the still picture. Dockers carry
// sacks and casks up the gangway while you load or sell; builders hammer on the scaffolding
// of whatever your settlement is building; other merchants' ships warp in to a free berth
// and leave again; rowing boats ply where there is no wharf, and now and then one crosses.
// Drawn each frame over the kept picture, in the scene's own coordinates, and only while
// something moves: when all is still the loop stops and the canvas keeps the last frame.

import type { SceneInput, TimeOfDay } from './port-scene';
import { shipSprite, type ShipSprite } from './port-scene-sail';

/** Where things are in the picture just drawn (scene pixels, before the zoom). */
export interface LifeLayout {
  m: number; w: number; h: number;
  /** Waterline, and the top of the quay (or the shore line at an anchorage). */
  yW: number; top: number;
  /** Our ship: her stern's x, length in metres, deck height. */
  shipX: number; L: number; deck: number;
  /** Lying at a quay; otherwise at anchor off the beach. */
  quay: boolean;
  /** Edge berths no ship of ours takes, for visiting merchants (empty: none call here). */
  free: (-1 | 1)[];
  /** The kind of ship that calls here. */
  visitor: string;
  /** The goods piled on the quay, left and right (x). */
  stacks: [number, number];
  /** Scaffolding where the settlement builds (bottom left corner, size). */
  build?: { x: number; y: number; w: number; h: number };
  /** The transform the scene was drawn with (device pixels, zoom). */
  matrix: DOMMatrix;
  t: TimeOfDay;
  wind: number;
}

interface Visitor { side: -1 | 1; type: string; start: number; stay: number; sprite?: ShipSprite }
interface Boat { start: number; dir: 1 | -1; y: number }

const IN_MS = 26_000;
const DOCKERS_MS = 16_000;
const ease = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p * p * (3 - 2 * p));

export class HarbourLife {
  private place = '';
  private aboard = new Map<number, { port: string; tons: number }>();
  private dockers: { until: number; load: boolean } | null = null;
  private visitor: Visitor | null = null;
  private crossing: Boat | null = null;
  private nextVisit = 0;
  private nextBoat = 0;
  private sprites = new Map<string, ShipSprite>();

  /** A new picture: start the dockers when what's aboard changed since the last one. */
  observe(input: SceneInput, now: number): void {
    if (input.place !== 'quay') return;
    if (input.portId !== this.place) {
      this.place = input.portId;
      this.visitor = null; this.crossing = null;
      this.nextVisit = now + 8_000 + Math.random() * 30_000;
      this.nextBoat = now + 4_000 + Math.random() * 20_000;
    }
    const s = input.ship;
    const tons = Math.round(s.cargo.reduce((a, l) => a + l.tons, 0));
    const was = this.aboard.get(s.id);
    this.aboard.set(s.id, { port: input.portId, tons });
    if (!was) return;
    // Loaded or sold here, or unloaded on arrival (she came in fuller than she is now).
    if (tons !== was.tons && (was.port === input.portId || tons < was.tons)) {
      this.dockers = { until: now + DOCKERS_MS, load: tons > was.tons };
    }
  }

  /** How often to draw (ms), or 0 when nothing moves. Starts the next visitor or boat when due. */
  period(lay: LifeLayout, now: number): number {
    if (this.dockers && now > this.dockers.until) this.dockers = null;
    const calm = lay.wind < 0.75;
    if (!this.visitor && now >= this.nextVisit) {
      const side = lay.free[Math.floor(Math.random() * lay.free.length)];
      if (side && calm && lay.t !== 'night') this.visitor = { side, type: lay.visitor, start: now, stay: 50_000 + Math.random() * 90_000 };
      this.nextVisit = now + 70_000 + Math.random() * 120_000;
    }
    if (this.visitor && now > this.visitor.start + IN_MS * 2 + this.visitor.stay) {
      this.visitor = null;
      this.nextVisit = now + 40_000 + Math.random() * 100_000;
    }
    if (!this.crossing && now >= this.nextBoat) {
      if (calm && lay.t !== 'night') this.crossing = { start: now, dir: Math.random() < 0.5 ? 1 : -1, y: 4.5 + Math.random() * 3 };
      this.nextBoat = now + 45_000 + Math.random() * 90_000;
    }
    if (this.crossing && now - this.crossing.start > this.crossTime(lay)) this.crossing = null;
    const v = this.visitor;
    const sailing = v && (now - v.start < IN_MS || now - v.start > IN_MS + v.stay);
    if (this.dockers || sailing || this.crossing) return 70;
    if (lay.build && lay.t !== 'night') return 160;
    return 0;
  }

  /** When something is next due to move (for the idle wake-up). */
  nextAt(now: number): number {
    let at = Math.min(this.nextVisit, this.nextBoat);
    const v = this.visitor;
    if (v) at = Math.min(at, now - v.start < IN_MS + v.stay ? v.start + IN_MS + v.stay : at);
    return at;
  }

  /** Draw one frame over the kept picture. */
  draw(c: CanvasRenderingContext2D, lay: LifeLayout, now: number): void {
    c.setTransform(lay.matrix);
    const v = this.visitor;
    if (v) this.drawVisitor(c, lay, v, now);
    if (lay.build) builders(c, lay, now);
    if (this.dockers) {
      if (lay.quay) quayDockers(c, lay, now, this.dockers.load);
      else ferry(c, lay, now, this.dockers.load);
    }
    const b = this.crossing;
    if (b) {
      const p = (now - b.start) / this.crossTime(lay);
      const x = b.dir > 0 ? -8 * lay.m + p * (lay.w + 16 * lay.m) : lay.w + 8 * lay.m - p * (lay.w + 16 * lay.m);
      rowingBoat(c, x, lay.yW + b.y * lay.m, lay.m, lay.t, now, b.dir, false);
    }
  }

  private crossTime(lay: LifeLayout): number { return ((lay.w / lay.m + 16) / 1.4) * 1000; }

  private drawVisitor(c: CanvasRenderingContext2D, lay: LifeLayout, v: Visitor, now: number): void {
    const { m, w, yW } = lay;
    const scale = Math.hypot(lay.matrix.a, lay.matrix.b);
    const key = `${v.type}|${lay.t}|${m.toFixed(2)}|${scale.toFixed(2)}`;
    let sp = this.sprites.get(key);
    if (!sp) {
      if (this.sprites.size > 6) this.sprites.clear();
      sp = shipSprite(v.type, m, scale, lay.t);
      this.sprites.set(key, sp);
    }
    const len = sp.L * m;
    const berth = v.side < 0 ? -len + 14 * m : w - 14 * m;
    const off = v.side < 0 ? -len - 12 * m : w + 12 * m;
    const el = now - v.start;
    const p = el < IN_MS ? 1 - ease(el / IN_MS) : el > IN_MS + v.stay ? ease((el - IN_MS - v.stay) / IN_MS) : 0;
    const x = berth + (off - berth) * p;
    c.drawImage(sp.canvas, x + sp.dx, yW + sp.dy, sp.w, sp.h);
  }
}

// ---------------------------------------------------------------- figures

const CLOTHES = ['#2b2b33', '#5a3a2a', '#3a4a5a', '#6a2a2a', '#4a4a2a'];

/** A man walking (or standing), feet at (x, y), with a sack or cask on his shoulder. */
function man(c: CanvasRenderingContext2D, x: number, y: number, m: number, t: TimeOfDay, i: number, step: number,
  load: 'sack' | 'cask' | null, dir: number): void {
  const night = t === 'night';
  const col = night ? '#2e261e' : CLOTHES[i % CLOTHES.length];
  const bob = Math.abs(Math.sin(step)) * 0.08 * m;
  const sw = Math.sin(step) * 0.35 * m;
  c.strokeStyle = col; c.lineWidth = Math.max(1, 0.2 * m);
  c.beginPath(); c.moveTo(x, y - 0.75 * m - bob); c.lineTo(x + sw, y); c.moveTo(x, y - 0.75 * m - bob); c.lineTo(x - sw, y); c.stroke();
  c.fillStyle = col;
  c.fillRect(x - 0.27 * m, y - 1.55 * m - bob, 0.55 * m, 0.85 * m);
  c.fillStyle = night ? '#3a3024' : '#c49a72';
  c.beginPath(); c.arc(x, y - 1.8 * m - bob, 0.25 * m, 0, Math.PI * 2); c.fill();
  if (load === 'sack') {
    c.fillStyle = night ? '#5a5040' : '#d8c69a';
    c.beginPath(); c.ellipse(x - dir * 0.15 * m, y - 1.75 * m - bob, 0.55 * m, 0.32 * m, -dir * 0.3, 0, Math.PI * 2); c.fill();
  } else if (load === 'cask') {
    c.fillStyle = night ? '#4a3420' : '#8a5a2e';
    c.fillRect(x - 0.45 * m, y - 2.45 * m - bob, 0.9 * m, 0.75 * m);
    c.fillStyle = night ? '#2a2018' : '#4a3828';
    c.fillRect(x - 0.45 * m, y - 2.15 * m - bob, 0.9 * m, 0.12 * m);
  }
}

type Pt = [number, number];
function along(path: Pt[], s: number): { x: number; y: number; dir: number } {
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1], [x1, y1] = path[i];
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (s <= l || i === path.length - 1) {
      const k = l ? Math.min(1, s / l) : 0;
      return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, dir: Math.sign(x1 - x0) || 1 };
    }
    s -= l;
  }
  return { x: path[0][0], y: path[0][1], dir: 1 };
}
const lengthOf = (path: Pt[]) => path.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);

/** Dockers between the goods on the quay and the hatch, over a gangway to the ship's end nearest the goods. */
function quayDockers(c: CanvasRenderingContext2D, lay: LifeLayout, now: number, load: boolean): void {
  const { m, top, deck, shipX, L } = lay;
  const end = shipX + L * m;
  const right = lay.stacks[1] - end > 6 * m || lay.stacks[0] > shipX - 6 * m;
  const S = right ? lay.stacks[1] - 0.6 * m : lay.stacks[0] + 2.4 * m;
  const F = right ? end + 2.6 * m : shipX - 2.6 * m;
  const P = right ? end - 0.14 * L * m : shipX + 0.16 * L * m;
  const H = shipX + 0.52 * L * m;
  // The gangway: a plank from the quay up to the rail.
  c.strokeStyle = lay.t === 'night' ? '#2e2418' : '#5e4630'; c.lineWidth = Math.max(1.5, 0.35 * m);
  c.beginPath(); c.moveTo(F + (right ? 0.8 : -0.8) * m, top); c.lineTo(P, deck); c.stroke();
  const path: Pt[] = [[S, top], [F, top], [P, deck], [H, deck]];
  walkers(c, lay, path, now, load, 4);
}

/** At anchor: a boat ferries the goods between the beach and the ship, men on deck carry them to the hatch. */
function ferry(c: CanvasRenderingContext2D, lay: LifeLayout, now: number, load: boolean): void {
  const { m, yW, deck, shipX, L } = lay;
  const end = shipX + L * m;
  const far = Math.min(lay.w - 6 * m, end + 26 * m), near = end + 1.5 * m;
  const leg = ((far - near) / m / 1.6) * 1000, wait = 2500, cyc = (leg + wait) * 2;
  const k = (now % cyc);
  // Out to the ship laden (when loading), wait alongside, back, wait at the beach.
  let x: number, dir: 1 | -1, laden: boolean;
  if (k < leg) { x = far + (near - far) * ease(k / leg); dir = -1; laden = load; }
  else if (k < leg + wait) { x = near; dir = -1; laden = load && k < leg + wait / 2; }
  else if (k < leg * 2 + wait) { x = near + (far - near) * ease((k - leg - wait) / leg); dir = 1; laden = !load; }
  else { x = far; dir = 1; laden = !load && k < leg * 2 + wait * 1.5; }
  rowingBoat(c, x, yW + 1.8 * m, m, lay.t, now, dir, laden);
  walkers(c, lay, [[end - 0.1 * L * m, deck], [shipX + 0.52 * L * m, deck]], now, load, 2);
}

function walkers(c: CanvasRenderingContext2D, lay: LifeLayout, path: Pt[], now: number, load: boolean, n: number): void {
  const len = lengthOf(path), m = lay.m;
  const v = 1.3 * m; // walking pace: 1.3 m/s
  for (let i = 0; i < n; i++) {
    const s = ((now / 1000) * v + (i * 2 * len) / n) % (2 * len);
    const out = s < len;
    const at = along(path, out ? s : 2 * len - s);
    const carrying = load ? out : !out;
    const dir = out ? at.dir : -at.dir;
    man(c, at.x, at.y, m, lay.t, i, (now / 1000) * 7 + i * 1.7, carrying ? (i % 2 ? 'sack' : 'cask') : null, dir);
  }
}

/** A rowing boat with two oarsmen, heading `dir`, bales aboard when laden. */
function rowingBoat(c: CanvasRenderingContext2D, x: number, y: number, m: number, t: TimeOfDay, now: number, dir: number,
  laden: boolean): void {
  const night = t === 'night';
  const bw = 5.5 * m, bh = 1 * m;
  c.save();
  c.translate(x, y);
  c.scale(dir, 1);
  const stroke = Math.sin(now / 420);
  // Oars, then the men, then the hull in front of them.
  c.strokeStyle = night ? '#3a3024' : '#6e5434'; c.lineWidth = Math.max(1, 0.15 * m);
  for (const ox of [-0.9, 0.7]) {
    c.beginPath(); c.moveTo(ox * m, -1.1 * m); c.lineTo((ox - 1.4 + stroke * 0.9) * m, 0.5 * m); c.stroke();
  }
  for (const [i, ox] of [-0.9, 0.7].entries()) {
    const lean = stroke * 0.25 * m;
    c.fillStyle = night ? '#2e261e' : CLOTHES[(i + 1) % CLOTHES.length];
    c.fillRect(ox * m - 0.25 * m - lean, -1.85 * m, 0.5 * m, 0.9 * m);
    c.fillStyle = night ? '#3a3024' : '#c49a72';
    c.beginPath(); c.arc(ox * m - lean, -2.05 * m, 0.22 * m, 0, Math.PI * 2); c.fill();
  }
  if (laden) {
    c.fillStyle = night ? '#5a5040' : '#c9b48a';
    c.fillRect(1.4 * m, -1.7 * m, 1.1 * m, 0.8 * m); c.fillRect(-2.4 * m, -1.6 * m, 1 * m, 0.7 * m);
  }
  c.fillStyle = night ? '#2a2018' : '#5e4630';
  c.beginPath();
  c.moveTo(-bw / 2, -bh); c.lineTo(bw / 2, -bh * 1.25);
  c.quadraticCurveTo(bw * 0.4, bh * 0.4, bw * 0.1, bh * 0.4); c.lineTo(-bw * 0.38, bh * 0.4);
  c.quadraticCurveTo(-bw / 2, 0, -bw / 2, -bh);
  c.fill();
  c.strokeStyle = night ? 'rgba(200,210,225,0.2)' : 'rgba(255,255,255,0.45)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(-bw * 0.6, bh * 0.6); c.lineTo(bw * 0.6, bh * 0.6); c.stroke();
  c.restore();
}

/** Builders at the scaffolding: two hammering on its planks, one bringing timber. */
function builders(c: CanvasRenderingContext2D, lay: LifeLayout, now: number): void {
  if (lay.t === 'night') return;
  const b = lay.build!, m = lay.m;
  const s = now / 1000;
  hammerer(c, b.x + b.w * 0.25, b.y, m, lay.t, s * 5.2, 0);
  hammerer(c, b.x + b.w * 0.7, b.y - b.h * 0.5, m, lay.t, s * 4.4 + 1.3, 1);
  // A man carrying a beam to the site and back.
  const run = 7 * m, k = (s * 1.1 * m) % (2 * run), back = k > run;
  const x = b.x - run + (back ? 2 * run - k : k);
  man(c, x, b.y, m, lay.t, 2, s * 7, null, back ? -1 : 1);
  if (!back) {
    c.strokeStyle = lay.t === 'dusk' ? '#6a5034' : '#9a7444'; c.lineWidth = Math.max(1.2, 0.28 * m);
    c.beginPath(); c.moveTo(x - 1.8 * m, b.y - 1.75 * m); c.lineTo(x + 1.6 * m, b.y - 1.95 * m); c.stroke();
  }
}

function hammerer(c: CanvasRenderingContext2D, x: number, y: number, m: number, t: TimeOfDay, ph: number, i: number): void {
  man(c, x, y, m, t, i + 3, 0, null, 1);
  // The arm and hammer: up slowly, down hard.
  const k = (ph % (Math.PI * 2)) / (Math.PI * 2);
  const a = k < 0.75 ? -0.5 + (k / 0.75) * 2.4 : 1.9 - ((k - 0.75) / 0.25) * 2.4;
  const sx = x + 0.2 * m, sy = y - 1.45 * m, len = 0.8 * m;
  const hx = sx + Math.cos(a) * len, hy = sy - Math.sin(a) * len;
  c.strokeStyle = t === 'night' ? '#2e261e' : CLOTHES[(i + 3) % CLOTHES.length]; c.lineWidth = Math.max(1, 0.16 * m);
  c.beginPath(); c.moveTo(sx, sy); c.lineTo(hx, hy); c.stroke();
  c.fillStyle = '#2b2b33'; c.fillRect(hx - 0.15 * m, hy - 0.25 * m, 0.3 * m, 0.5 * m);
}
