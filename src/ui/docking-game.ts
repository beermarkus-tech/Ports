// The docking mini game: take your ship from the harbour entrance to its berth
// yourself. Top-down, true scale; throttle in steps, rudder, and tugs to push.

import {
  HARBOUR_H, HARBOUR_W, berthStatus, groundSpeed, harbourFor, hullPoints, newBody, resolveContact, scoreDocking, step, touchesLand,
  type Controls, type DockingScore, type Harbour, type ShipBody,
} from '../sim/docking';
import type { ShipFamily } from './art';
import { sound } from './sound';

export interface DockingOptions {
  portId: string;
  portName: string;
  shipName: string;
  length: number;
  family: ShipFamily;
  /** 0..1: how hard wind and current are today. */
  strength: number;
  /** What docking yourself saves: pilot and tugs, plus the port fee for a perfect job. */
  services: number;
  portFee: number;
  money: (n: number, signed?: boolean) => string;
  /** The result, or null if you handed over to the pilot. */
  onDone: (result: DockingScore | null) => void;
}

/** Harbour seconds per real second: a manoeuvre of several minutes plays in about one. */
const TIME = 5;
/** Par time in real seconds, for scoring: longer for bigger ships. */
const par = (length: number) => 60 + length * 0.35;
const THROTTLE = ['Full astern', 'Half astern', 'Slow astern', 'Stop', 'Slow ahead', 'Half ahead', 'Full ahead'];
const HULL: Record<ShipFamily, string> = { general: '#24486e', bulk: '#7a2626', reefer: '#e8eef2', tanker: '#2a3640', container: '#1d5f4e', sail: '#6b4a2b' };

export class DockingGame {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private h: Harbour;
  private b: ShipBody;
  private c: Controls = { throttle: 1, rudder: 0, push: 0 };
  private bumps = 0;
  private damage = 0;
  private elapsed = 0;
  private mooredFor = 0;
  private flash: { text: string; until: number } | null = null;
  private wake: [number, number][] = [];
  private raf = 0;
  private last = 0;
  private done = false;
  private keys = new Set<string>();
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(private o: DockingOptions) {
    this.h = harbourFor(o.portId, o.length, o.strength);
    this.b = newBody(this.h, o.length);
    this.el = document.createElement('div');
    this.el.className = 'dock-game';
    this.el.innerHTML = `
      <canvas aria-label="Harbour seen from above"></canvas>
      <div class="dg-top">
        <div class="dg-title"><strong>Docking at ${esc(o.portName)}</strong>
          <span>${esc(o.shipName)} · ${o.length} m · ${esc(this.h.driftNote)}</span>
          <span>Bring her alongside the yellow berth, slowly and straight. Saves ${o.money(o.services)} in pilot and tugs.</span></div>
        <button class="dg-btn" data-dg="pilot">Hand over to the pilot</button>
      </div>
      <div class="dg-hud"></div>
      <div class="dg-flash" hidden></div>
      <div class="dg-controls">
        <div class="dg-group"><span class="dg-lbl">Engine</span>
          <button class="dg-btn" data-dg="slower" aria-label="Slower">▼</button>
          <span class="dg-val" data-v="throttle"></span>
          <button class="dg-btn" data-dg="faster" aria-label="Faster">▲</button></div>
        <div class="dg-group"><span class="dg-lbl">Rudder</span>
          <button class="dg-btn" data-dg="port" aria-label="Rudder to port">◀</button>
          <span class="dg-val" data-v="rudder"></span>
          <button class="dg-btn" data-dg="stbd" aria-label="Rudder to starboard">▶</button>
          <button class="dg-btn small" data-dg="mid">Midships</button></div>
        <div class="dg-group"><span class="dg-lbl">Tugs (hold)</span>
          <button class="dg-btn" data-dg="push-port">◀ Push</button>
          <button class="dg-btn" data-dg="push-stbd">Push ▶</button></div>
      </div>
      <div class="dg-result" hidden></div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;

    this.el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-dg]')?.dataset.dg;
      if (a === 'faster') this.c.throttle = Math.min(3, this.c.throttle + 1);
      else if (a === 'slower') this.c.throttle = Math.max(-3, this.c.throttle - 1);
      else if (a === 'port') this.c.rudder = Math.max(-1, round1(this.c.rudder - 0.2));
      else if (a === 'stbd') this.c.rudder = Math.min(1, round1(this.c.rudder + 0.2));
      else if (a === 'mid') this.c.rudder = 0;
      else if (a === 'pilot') this.finish(null);
      else if (a === 'continue') this.close();
    });
    // Tugs push while held
    const hold = (dir: number) => (e: Event) => { e.preventDefault(); this.c.push = dir; };
    for (const [sel, dir] of [['push-port', -1], ['push-stbd', 1]] as const) {
      const btn = this.el.querySelector<HTMLElement>(`[data-dg="${sel}"]`)!;
      btn.addEventListener('pointerdown', hold(dir));
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, hold(0));
    }
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    sound.play('horn');
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private key(e: KeyboardEvent): void {
    if (this.done) return;
    const k = e.key.toLowerCase();
    if (e.type === 'keyup') {
      this.keys.delete(k);
      if ((k === 'q' || k === 'e') && !this.keys.has('q') && !this.keys.has('e')) this.c.push = 0;
      return;
    }
    if (this.keys.has(k)) return;
    this.keys.add(k);
    if (k === 'w' || k === 'arrowup') this.c.throttle = Math.min(3, this.c.throttle + 1);
    else if (k === 's' || k === 'arrowdown') this.c.throttle = Math.max(-3, this.c.throttle - 1);
    else if (k === 'a' || k === 'arrowleft') this.c.rudder = Math.max(-1, round1(this.c.rudder - 0.2));
    else if (k === 'd' || k === 'arrowright') this.c.rudder = Math.min(1, round1(this.c.rudder + 0.2));
    else if (k === ' ') this.c.rudder = 0;
    else if (k === 'q') this.c.push = -1;
    else if (k === 'e') this.c.push = 1;
    else if (k === 'escape') this.finish(null);
    else return;
    e.preventDefault();
  }

  private frame(t: number): void {
    const real = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    if (!this.done) {
      this.elapsed += real;
      let left = real * TIME;
      while (left > 0) {
        const dt = Math.min(0.1, left);
        left -= dt;
        this.simulate(dt);
        if (this.done) break;
      }
    }
    this.draw();
    if (!this.closed) this.raf = requestAnimationFrame((n) => this.frame(n));
  }

  private simulate(dt: number): void {
    const prev = { ...this.b };
    step(this.b, this.c, this.h, dt);
    if (touchesLand(this.b, this.h)) {
      const dmg = resolveContact(this.b, prev, this.h);
      if (dmg > 0) {
        this.bumps++;
        this.damage += dmg;
        this.flash = { text: `Bump! −${dmg}% condition`, until: this.elapsed + 1.6 };
        sound.play('clank');
      }
    }
    const s = berthStatus(this.b, this.h);
    this.mooredFor = s.moored ? this.mooredFor + dt : 0;
    if (this.mooredFor >= 4) {
      const result = scoreDocking(s.angle, this.elapsed, this.bumps, this.damage, par(this.o.length));
      this.finish(result);
    }
    if (this.wake.length === 0 || Math.hypot(this.b.x - this.wake[this.wake.length - 1][0], this.b.y - this.wake[this.wake.length - 1][1]) > 12) {
      this.wake.push([this.b.x, this.b.y]);
      if (this.wake.length > 80) this.wake.shift();
    }
  }

  private finish(result: DockingScore | null): void {
    if (this.done) return;
    this.done = true;
    if (!result) { this.close(); this.o.onDone(null); return; }
    sound.play(result.perfect ? 'fanfare' : 'bell');
    const m = this.o.money;
    this.result = result;
    const panel = this.el.querySelector<HTMLElement>('.dg-result')!;
    panel.innerHTML = `
      <h2>${result.perfect ? 'Perfect docking!' : 'Moored'}</h2>
      <p class="dg-score">Score ${result.score}${result.bumps ? ` · ${result.bumps} bump${result.bumps > 1 ? 's' : ''}` : ' · no bumps'}</p>
      <div class="dg-lines">
        <div><span>Pilot and tugs saved</span><b class="up">${m(this.o.services, true)}</b></div>
        ${result.perfect ? `<div><span>Port fee waived by the harbour master</span><b class="up">${m(this.o.portFee, true)}</b></div>` : ''}
        ${result.damage ? `<div><span>Bumps</span><b class="down">−${result.damage}% condition</b></div>` : ''}
      </div>
      ${result.perfect ? '' : `<p class="dg-tip">${result.bumps ? 'Come in slower: under 0.7 knots, fenders take the knock.' : 'Line her up straighter and quicker for a perfect score (the port fee is waived).'}</p>`}
      <button class="dg-btn primary" data-dg="continue">Continue</button>`;
    panel.hidden = false;
  }

  private result: DockingScore | null = null;
  private closed = false;

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.el.remove();
    if (this.result) this.o.onDone(this.result);
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    const w = this.el.clientWidth, hgt = this.el.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hgt * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(hgt * dpr);
    }
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The view is the screen between the title bar and the controls.
    const top = (this.el.querySelector('.dg-top') as HTMLElement).offsetHeight;
    const bottom = (this.el.querySelector('.dg-controls') as HTMLElement).offsetHeight;
    const vh = Math.max(100, hgt - top - bottom);
    const midY = top + vh / 2;
    // Camera: the whole harbour if it fits at a useful size; otherwise follow the ship.
    const fit = Math.min(w / HARBOUR_W, vh / HARBOUR_H);
    const follow = fit < 0.55;
    const scale = follow ? Math.max(fit, Math.min(w, vh * 1.4) / 700) : fit;
    let cx = HARBOUR_W / 2, cy = HARBOUR_H / 2;
    if (follow) {
      const halfW = w / 2 / scale, halfH = vh / 2 / scale;
      cx = halfW * 2 > HARBOUR_W ? HARBOUR_W / 2 : Math.max(halfW, Math.min(HARBOUR_W - halfW, this.b.x));
      // Keep the ship in view above the controls; open water may show beyond the harbour's edge.
      cy = Math.max(halfH, this.b.y - halfH * 0.1);
    }
    c.fillStyle = '#1d5a78';
    c.fillRect(0, 0, w, hgt);
    c.save();
    c.translate(w / 2, midY);
    c.scale(scale, scale);
    c.translate(-cx, -cy);

    // Water
    const sea = c.createLinearGradient(0, 0, 0, HARBOUR_H);
    sea.addColorStop(0, '#2a6f8f'); sea.addColorStop(1, '#1d5a78');
    c.fillStyle = sea;
    c.fillRect(0, 0, HARBOUR_W, HARBOUR_H);
    // Drift streaks
    c.strokeStyle = 'rgba(255,255,255,0.10)';
    c.lineWidth = 2 / scale;
    for (let x = 40; x < HARBOUR_W; x += 120) for (let y = 40; y < HARBOUR_H; y += 120) {
      const [dx, dy] = this.h.drift(x, y);
      const k = 140;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx * k, y + dy * k); c.stroke();
    }
    // Land, quays and breakwaters
    for (const poly of this.h.land) {
      c.beginPath();
      poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fillStyle = '#cdbf98';
      c.fill();
      c.strokeStyle = '#8f949a';
      c.lineWidth = 6 / scale + 2;
      c.stroke();
    }
    // The berth
    const { a, b } = this.h.berth;
    c.strokeStyle = '#f2c14e';
    c.lineWidth = 8;
    c.setLineDash([18, 10]);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#222';
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 30));
    for (let i = 0; i <= n; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / n, y = a[1] + ((b[1] - a[1]) * i) / n;
      c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = '#f2c14e';
    c.font = `600 ${Math.max(14, 13 / scale)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    const lx = (a[0] + b[0]) / 2, ly = (a[1] + b[1]) / 2;
    c.fillText('YOUR BERTH', lx + (Math.abs(a[0] - b[0]) < 1 ? -40 : 0), ly + (Math.abs(a[1] - b[1]) < 1 ? 26 : 0));

    // Wake
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = this.b.beam * 0.5;
    c.lineCap = 'round';
    c.beginPath();
    this.wake.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.lineTo(this.b.x, this.b.y);
    c.globalAlpha = 0.5; c.stroke(); c.globalAlpha = 1;

    // Ship
    const hull = hullPoints(this.b);
    c.beginPath();
    hull.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = HULL[this.o.family];
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 1.5;
    c.stroke();
    // Deck and bridge
    c.save();
    c.translate(this.b.x, this.b.y);
    c.rotate(this.b.heading);
    const L = this.b.length, B = this.b.beam;
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(-L * 0.42, -B * 0.32, L * 0.78, B * 0.64);
    c.fillStyle = '#f4f4f2';
    c.fillRect(-L * 0.47, -B * 0.42, L * 0.14, B * 0.84);
    c.restore();
    c.restore();

    // Berth off screen (when following the ship): a yellow arrow at the edge points the way.
    const bxm = (a[0] + b[0]) / 2, bym = (a[1] + b[1]) / 2;
    const sx = w / 2 + (bxm - cx) * scale, sy = midY + (bym - cy) * scale;
    if (sx < 0 || sx > w || sy < top || sy > top + vh) {
      // Keep clear of the speed and distance chips at the top of the view.
      const ox = w / 2, oy = midY + 20;
      const ang = Math.atan2(sy - oy, sx - ox);
      const k = Math.min((w / 2 - 28) / Math.max(1e-6, Math.abs(Math.cos(ang))), (vh / 2 - 60) / Math.max(1e-6, Math.abs(Math.sin(ang))));
      const px = ox + Math.cos(ang) * k, py = oy + Math.sin(ang) * k;
      c.save();
      c.translate(px, py);
      c.rotate(ang);
      c.fillStyle = '#f2c14e';
      c.beginPath(); c.moveTo(16, 0); c.lineTo(-10, -11); c.lineTo(-10, 11); c.closePath(); c.fill();
      c.restore();
    }

    // HUD
    const s = berthStatus(this.b, this.h);
    const kn = groundSpeed(this.b) * 1.944;
    const hud = this.el.querySelector<HTMLElement>('.dg-hud')!;
    const tooFast = s.distance < this.b.length * 1.5 && kn > 1.5;
    hud.innerHTML = `<span class="${tooFast ? 'warn' : ''}">${kn.toFixed(1)} kn</span>
      <span>Berth ${Math.round(Math.max(0, s.distance))} m</span>
      ${s.distance < this.b.length * 2 ? `<span class="${s.angle > 10 ? 'warn' : ''}">${Math.round(s.angle)}° off line</span><span>Gap ${Math.max(0, Math.round(s.gap))} m</span>` : ''}
      ${s.alongside && !s.moored ? '<span class="good">Alongside: stop her</span>' : ''}
      ${this.mooredFor > 0 ? '<span class="good">Making fast…</span>' : ''}
      <span>${Math.floor(this.elapsed)} s</span>`;
    (this.el.querySelector('[data-v="throttle"]') as HTMLElement).textContent = THROTTLE[this.c.throttle + 3];
    const deg = Math.round(this.c.rudder * 35);
    (this.el.querySelector('[data-v="rudder"]') as HTMLElement).textContent = deg === 0 ? 'Midships' : `${Math.abs(deg)}° ${deg < 0 ? 'port' : 'starboard'}`;
    const flash = this.el.querySelector<HTMLElement>('.dg-flash')!;
    if (this.flash && this.flash.until > this.elapsed) { flash.textContent = this.flash.text; flash.hidden = false; } else flash.hidden = true;
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}
