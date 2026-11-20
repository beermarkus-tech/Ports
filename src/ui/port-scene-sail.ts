// The port view for the Age of Sail: a sailing ship at a wooden quay, drawn to one
// true scale (120 m across the picture), in front of a town that fits the region
// (Dutch gables, a Spanish colonial church, a fort among palms, a pagoda). In port
// the sails are furled on the yards. The hold is cut open to show what's aboard,
// and the ship sits deeper as she loads. Careening: hauled out on the beach,
// propped on shores, with fires under the hull to burn off the weed.

import type { SceneInput, SceneShip, TimeOfDay } from './port-scene';

type Town = 'dutch' | 'iberian' | 'colonial' | 'northamerica' | 'tropic' | 'desert' | 'eastasia';

const TOWN: Record<string, Town> = {
  amsterdam: 'dutch', london: 'dutch', danzig: 'dutch', bergen: 'dutch', newamsterdam: 'dutch', zeelandia: 'dutch', cape: 'dutch',
  lisbon: 'iberian', cadiz: 'iberian', venice: 'iberian',
  havana: 'colonial', cartagena: 'colonial', veracruz: 'colonial', portobelo: 'colonial', acapulco: 'colonial', callao: 'colonial',
  bahia: 'colonial', recife: 'colonial', barbados: 'colonial', manila: 'colonial', goa: 'colonial', macau: 'colonial',
  jamestown: 'northamerica', boston: 'northamerica',
  elmina: 'tropic', mozambique: 'tropic', zanzibar: 'tropic', calicut: 'tropic', galle: 'tropic', madras: 'tropic', surat: 'tropic',
  malacca: 'tropic', bantam: 'tropic', batavia: 'tropic', banda: 'tropic', ayutthaya: 'tropic',
  mocha: 'desert', bandarabbas: 'desert',
  hoian: 'eastasia', canton: 'eastasia', amoy: 'eastasia', dejima: 'eastasia',
};

/** Length, depth amidships, light and laden draft, mainmast height above the deck: metres. */
interface Dims { L: number; D: number; d0: number; d1: number; H: number; masts: number; guns: number }
const DIMS: Record<string, Dims> = {
  jacht: { L: 20, D: 4, d0: 1, d1: 2.3, H: 19, masts: 2, guns: 0 },
  fluyt: { L: 32, D: 6, d0: 1.4, d1: 3.5, H: 30, masts: 3, guns: 0 },
  largefluyt: { L: 38, D: 7, d0: 1.6, d1: 4.1, H: 34, masts: 3, guns: 0 },
  pinas: { L: 36, D: 7.4, d0: 1.6, d1: 4, H: 35, masts: 3, guns: 7 },
  indiaman: { L: 45, D: 9.4, d0: 2, d1: 5.1, H: 41, masts: 3, guns: 10 },
  retourschip: { L: 50, D: 10.4, d0: 2.2, d1: 5.8, H: 46, masts: 3, guns: 12 },
};
function dimsFor(s: SceneShip): Dims {
  return DIMS[s.typeId] ?? { L: 30, D: 6, d0: 1.4, d1: 3.4, H: 30, masts: 3, guns: 0 };
}
/** A sailing ship's length in metres (the scale of this view). */
export function sailShipLength(typeId: string): number {
  return DIMS[typeId]?.L ?? 30;
}

/** How each good looks in the cut-open hold, and how it's packed. */
const LOOK: Record<string, [string, 'cask' | 'bale' | 'sack' | 'chest' | 'logs' | 'bars' | 'loose']> = {
  pepper: ['#4a3c2e', 'sack'], nutmeg: ['#9a6a3c', 'chest'], cloves: ['#7a4428', 'chest'], cinnamon: ['#b8743a', 'bale'],
  tea: ['#7d8a46', 'chest'], silk: ['#b84a52', 'bale'], porcelain: ['#dfe6ee', 'chest'], textiles: ['#c8682e', 'bale'],
  indigo: ['#34508a', 'chest'], saltpetre: ['#d8ccb0', 'cask'], coffee: ['#6a4428', 'sack'], sugar: ['#efe6cf', 'cask'],
  tobacco: ['#a07a34', 'cask'], silver: ['#c2c6cc', 'chest'], gold: ['#d9a441', 'chest'], copper: ['#c07440', 'bars'],
  tin: ['#a4a9ae', 'bars'], ivory: ['#f4ead2', 'logs'], furs: ['#8a5c36', 'bale'], cloth: ['#8a3a30', 'bale'],
  wine: ['#7a2a3a', 'cask'], grain: ['#d6aa4c', 'loose'], timber: ['#9a7444', 'logs'], salt: ['#f1ece2', 'loose'],
  cod: ['#cbb98a', 'bale'], rice: ['#e6dbbf', 'sack'],
};

const SKY: Record<TimeOfDay, [string, string]> = { day: ['#9cc3d8', '#efe6cf'], dusk: ['#45406a', '#f0a36b'], night: ['#070d18', '#1b2840'] };
const WATER: Record<TimeOfDay, string> = { day: '#4f7a86', dusk: '#4a4a66', night: '#0d1a28' };
const SCENE_M = 120;
const QUAY_M = 2.4;

function rnd(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export interface SailDrawn { L: number; draft: number | null; d1: number }

/** Draw the whole 1650 harbour scene. Returns what the info chips need. */
export function drawSailScene(c: CanvasRenderingContext2D, input: SceneInput, w: number, h: number, zoomed: boolean): SailDrawn {
  const { ship, time: t } = input;
  const d = dimsFor(ship);
  const careen = input.place === 'dock';
  const m = Math.min(w / SCENE_M, h / 82);
  const yW = Math.min(h - 9 * m, h * 0.7);
  const shipX = (w - d.L * m) / 2;

  const sky = c.createLinearGradient(0, 0, 0, yW);
  sky.addColorStop(0, SKY[t][0]); sky.addColorStop(1, SKY[t][1]);
  c.fillStyle = sky; c.fillRect(0, 0, w, h);
  if (t === 'night') {
    const r = rnd(7);
    c.fillStyle = 'rgba(255,250,235,0.8)';
    for (let i = 0; i < 90; i++) c.fillRect(r() * w, r() * yW * 0.7, 1.2, 1.2);
  } else clouds(c, w, yW, t);

  c.save();
  if (zoomed) {
    const k = Math.max(1, Math.min((w * 0.86) / (d.L * 1.25 * m), (h * 0.8) / ((d.H + d.D + 4) * m)));
    const cx = shipX + (d.L * m) / 2;
    c.translate(w / 2, yW - (h - yW) * 0.15);
    c.scale(k, k);
    c.translate(-cx, -yW);
  }
  const top = yW - QUAY_M * m;
  town(c, TOWN[input.portId] ?? 'dutch', input.portId, w, top, m, t);

  if (careen) {
    beach(c, w, h, yW, m, t);
    // Hauled out: the keel on the sand at the waterline, shores holding her upright.
    const keelY = yW + 0.4 * m;
    shores(c, d, shipX, keelY, m);
    drawShip(c, ship, d, shipX, keelY, m, t, { faded: false, cutaway: false });
    fires(c, d, shipX, keelY, m);
  } else {
    quay(c, w, yW, top, m, t);
    const sides = [-1, 1];
    input.neighbours.slice(0, 2).forEach((n, i) => {
      const nd = dimsFor(n);
      const x = sides[i] < 0 ? -nd.L * m + 14 * m : w - 14 * m;
      drawShip(c, n, nd, x, yW + draft(n, nd) * m, m, t, { faded: true, cutaway: false });
    });
    const keelY = yW + draft(ship, d) * m;
    drawShip(c, ship, d, shipX, keelY, m, t, { faded: false, cutaway: false });
    // Water over the hull below the waterline, then the cutaway hold as a diagram.
    c.fillStyle = WATER[t]; c.globalAlpha = 0.84;
    c.fillRect(-w, yW, w * 3, h);
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,0.2)'; c.lineWidth = 1;
    const r = rnd(3);
    for (let i = 0; i < 26; i++) {
      const y = yW + 3 + r() * (h - yW - 6), x = r() * w, l = 8 + r() * 26;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l / 2, y - 1.5, x + l, y); c.stroke();
    }
    c.save();
    c.clip(hullPath(d, shipX, keelY, m));
    hold(c, ship, d, shipX, keelY, m);
    c.restore();
    c.strokeStyle = 'rgba(255,250,235,0.55)'; c.setLineDash([4, 3]);
    c.beginPath(); c.moveTo(shipX, yW); c.lineTo(shipX + d.L * m, yW); c.stroke();
    c.setLineDash([]);
  }
  c.restore();
  return { L: d.L, draft: careen ? null : draft(ship, d), d1: d.d1 };
}

/** Draft from what's aboard: cargo plus victuals against what she can carry. */
function draft(s: SceneShip, d: Dims): number {
  const tons = s.cargo.reduce((a, l) => a + l.tons, 0) + s.fuel * 0.1;
  const full = Math.max(0, Math.min(1, tons / (s.capacity + s.bunkerCapacity * 0.1)));
  return d.d0 + (d.d1 - d.d0) * full;
}

// ---------------------------------------------------------------- sky and town

function clouds(c: CanvasRenderingContext2D, w: number, yW: number, t: TimeOfDay): void {
  const r = rnd(21);
  c.fillStyle = t === 'dusk' ? 'rgba(255,200,170,0.35)' : 'rgba(255,253,245,0.55)';
  for (let i = 0; i < 6; i++) {
    const x = r() * w, y = yW * (0.12 + r() * 0.35), s = 20 + r() * 40;
    for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x + k * s * 0.5, y - (k % 2) * s * 0.18, s * 0.6, s * 0.28, 0, 0, Math.PI * 2); c.fill(); }
  }
}

function town(c: CanvasRenderingContext2D, kind: Town, portId: string, w: number, base: number, m: number, t: TimeOfDay): void {
  let seed = 0;
  for (const ch of portId) seed = seed * 31 + ch.charCodeAt(0);
  const r = rnd(seed);
  const night = t === 'night', dusk = t === 'dusk';
  const dim = (col: string) => (night ? shade(col, -0.72) : dusk ? shade(col, -0.35) : col);
  const lit = night || dusk;
  const win = (x: number, y: number, ww: number, hh: number) => {
    c.fillStyle = lit && r() < 0.55 ? '#f5c86a' : night ? '#10151d' : 'rgba(30,25,20,0.55)';
    c.fillRect(x, y, ww, hh);
  };
  // Far hills (not in flat Holland).
  if (kind !== 'dutch') {
    c.fillStyle = dim(kind === 'desert' ? '#c9b38a' : kind === 'eastasia' || kind === 'tropic' ? '#7f9a7a' : '#9aa79a');
    c.beginPath(); c.moveTo(-w, base);
    for (let x = -w; x <= w * 2; x += 18 * m) c.lineTo(x, base - (12 + r() * 16) * m);
    c.lineTo(w * 2, base); c.fill();
  }
  let x = -4 * m;
  const end = w + 4 * m;
  while (x < end) {
    const bw = (5 + r() * 4) * m;
    if (kind === 'dutch') {
      // Narrow brick houses with stepped and bell gables, a church spire and a windmill.
      const hgt = (9 + r() * 6) * m;
      const col = ['#8a4a34', '#6e3b2c', '#9a5a3c', '#5e4636', '#a06a48'][Math.floor(r() * 5)];
      c.fillStyle = dim(col);
      c.fillRect(x, base - hgt, bw, hgt);
      c.beginPath(); c.moveTo(x, base - hgt);
      if (r() < 0.5) {
        const s = bw / 6;
        c.lineTo(x, base - hgt - s); c.lineTo(x + s, base - hgt - s); c.lineTo(x + s, base - hgt - 2 * s); c.lineTo(x + 2 * s, base - hgt - 2 * s);
        c.lineTo(x + 2 * s, base - hgt - 3 * s); c.lineTo(x + 4 * s, base - hgt - 3 * s); c.lineTo(x + 4 * s, base - hgt - 2 * s); c.lineTo(x + 5 * s, base - hgt - 2 * s);
        c.lineTo(x + 5 * s, base - hgt - s); c.lineTo(x + bw, base - hgt - s); c.lineTo(x + bw, base - hgt);
      } else {
        c.quadraticCurveTo(x + bw * 0.1, base - hgt - bw * 0.35, x + bw * 0.3, base - hgt - bw * 0.45);
        c.lineTo(x + bw * 0.5, base - hgt - bw * 0.7); c.lineTo(x + bw * 0.7, base - hgt - bw * 0.45);
        c.quadraticCurveTo(x + bw * 0.9, base - hgt - bw * 0.35, x + bw, base - hgt);
      }
      c.fill();
      for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) win(x + bw * (0.2 + j * 0.4), base - hgt + (1.6 + k * 3) * m, bw * 0.22, 1.6 * m);
    } else if (kind === 'iberian' || kind === 'colonial') {
      const hgt = (6 + r() * 5) * m;
      const col = kind === 'iberian' ? ['#efe2c6', '#e6c9a0', '#f2ead8', '#d9b48a'][Math.floor(r() * 4)] : ['#f4efe2', '#efe0c0', '#e8d4a8', '#f1e6d0'][Math.floor(r() * 4)];
      c.fillStyle = dim(col); c.fillRect(x, base - hgt, bw, hgt);
      c.fillStyle = dim('#b5583a');
      c.beginPath(); c.moveTo(x - 0.4 * m, base - hgt); c.lineTo(x + bw / 2, base - hgt - 1.8 * m); c.lineTo(x + bw + 0.4 * m, base - hgt); c.fill();
      for (let j = 0; j < 2; j++) win(x + bw * (0.22 + j * 0.4), base - hgt + 2 * m, bw * 0.2, 2 * m);
    } else if (kind === 'northamerica') {
      const hgt = (5 + r() * 3) * m;
      c.fillStyle = dim(['#8a6a48', '#7a5c3c', '#9a7a52', '#6a5038'][Math.floor(r() * 4)]); c.fillRect(x, base - hgt, bw, hgt);
      c.fillStyle = dim('#4a3a2e');
      c.beginPath(); c.moveTo(x - 0.4 * m, base - hgt); c.lineTo(x + bw / 2, base - hgt - bw * 0.45); c.lineTo(x + bw + 0.4 * m, base - hgt); c.fill();
      win(x + bw * 0.35, base - hgt + 2 * m, bw * 0.3, 1.6 * m);
      if (r() < 0.25) { c.fillStyle = dim('#3f6a3a'); c.beginPath(); c.moveTo(x + bw, base); c.lineTo(x + bw + 2.5 * m, base - 10 * m); c.lineTo(x + bw + 5 * m, base); c.fill(); x += 5 * m; }
    } else if (kind === 'tropic') {
      if (r() < 0.45) palm(c, x + bw / 2, base, (9 + r() * 5) * m, dim('#3f5f34'), dim('#6a5038'));
      else {
        const hgt = (3.5 + r() * 2) * m;
        c.fillStyle = dim('#c9a06a'); c.fillRect(x, base - hgt, bw, hgt);
        c.fillStyle = dim('#8a6a3a');
        c.beginPath(); c.moveTo(x - 0.8 * m, base - hgt); c.lineTo(x + bw / 2, base - hgt - 3 * m); c.lineTo(x + bw + 0.8 * m, base - hgt); c.fill();
      }
    } else if (kind === 'desert') {
      const hgt = (5 + r() * 6) * m;
      c.fillStyle = dim(['#efe4cc', '#e2cfa8', '#f2ead6'][Math.floor(r() * 3)]); c.fillRect(x, base - hgt, bw, hgt);
      win(x + bw * 0.3, base - hgt + 1.6 * m, bw * 0.4, 1.4 * m);
    } else {
      // East Asia: low houses with sweeping, upturned roofs.
      const hgt = (4 + r() * 3) * m;
      c.fillStyle = dim(['#d9c8a8', '#c9b08a', '#e2d6bc'][Math.floor(r() * 3)]); c.fillRect(x, base - hgt, bw, hgt);
      c.fillStyle = dim('#3a3f44');
      c.beginPath(); c.moveTo(x - 1.2 * m, base - hgt - 0.6 * m); c.quadraticCurveTo(x + bw / 2, base - hgt + 0.4 * m, x + bw + 1.2 * m, base - hgt - 0.6 * m);
      c.lineTo(x + bw * 0.8, base - hgt - 2.4 * m); c.lineTo(x + bw * 0.2, base - hgt - 2.4 * m); c.closePath(); c.fill();
      win(x + bw * 0.35, base - hgt + 1.4 * m, bw * 0.3, 1.4 * m);
    }
    x += bw + (kind === 'dutch' ? 0 : (0.6 + r() * 2) * m);
  }
  // The landmark: one per town, placed by the port's own seed.
  const lx = w * (0.15 + r() * 0.2);
  c.fillStyle = dim(kind === 'dutch' ? '#5e4636' : kind === 'desert' ? '#efe4cc' : kind === 'eastasia' ? '#8a3a2a' : kind === 'tropic' ? '#a9a08a' : '#efe2c6');
  if (kind === 'dutch') {
    c.fillRect(lx, base - 22 * m, 5 * m, 22 * m);
    c.beginPath(); c.moveTo(lx - 0.5 * m, base - 22 * m); c.lineTo(lx + 2.5 * m, base - 36 * m); c.lineTo(lx + 5.5 * m, base - 22 * m); c.fill();
    windmill(c, w * 0.82, base, m, dim('#5e4636'), dim('#e9dcc0'));
  } else if (kind === 'iberian' || kind === 'colonial') {
    c.fillRect(lx, base - 16 * m, 12 * m, 16 * m);
    c.fillRect(lx + 12 * m, base - 24 * m, 4.5 * m, 24 * m);
    c.beginPath(); c.arc(lx + 6 * m, base - 16 * m, 4 * m, Math.PI, 0); c.fill();
    c.fillStyle = dim('#b5583a'); c.beginPath(); c.moveTo(lx + 11.6 * m, base - 24 * m); c.lineTo(lx + 14.25 * m, base - 28 * m); c.lineTo(lx + 16.9 * m, base - 24 * m); c.fill();
  } else if (kind === 'northamerica') {
    c.fillStyle = dim('#efe6d4'); c.fillRect(lx, base - 10 * m, 7 * m, 10 * m); c.fillRect(lx + 2.4 * m, base - 16 * m, 2.2 * m, 6 * m);
    c.beginPath(); c.moveTo(lx + 2.2 * m, base - 16 * m); c.lineTo(lx + 3.5 * m, base - 21 * m); c.lineTo(lx + 4.8 * m, base - 16 * m); c.fill();
  } else if (kind === 'tropic') {
    // A stone fort with bastions and the flag.
    c.fillRect(lx, base - 8 * m, 22 * m, 8 * m);
    c.beginPath(); c.moveTo(lx - 3 * m, base); c.lineTo(lx, base - 9 * m); c.lineTo(lx + 3 * m, base); c.fill();
    c.beginPath(); c.moveTo(lx + 19 * m, base); c.lineTo(lx + 22 * m, base - 9 * m); c.lineTo(lx + 25 * m, base); c.fill();
    c.fillStyle = dim('#8a826e');
    for (let i = 0; i < 7; i++) c.fillRect(lx + (1 + i * 3) * m, base - 9 * m, 1.6 * m, 1 * m);
    c.fillStyle = '#4a3a2a'; c.fillRect(lx + 11 * m, base - 16 * m, 0.25 * m, 8 * m);
    flag(c, lx + 11.25 * m, base - 16 * m, 4 * m, t);
  } else if (kind === 'desert') {
    c.fillRect(lx, base - 22 * m, 2.6 * m, 22 * m);
    c.beginPath(); c.arc(lx + 1.3 * m, base - 22 * m, 1.8 * m, Math.PI, 0); c.fill();
    c.beginPath(); c.arc(lx + 9 * m, base - 8 * m, 5 * m, Math.PI, 0); c.fill();
    c.fillRect(lx + 4 * m, base - 8 * m, 10 * m, 8 * m);
  } else {
    // A pagoda.
    for (let i = 0; i < 5; i++) {
      const wd = (9 - i * 1.4) * m, y = base - (i + 1) * 4.2 * m;
      c.fillStyle = dim('#c9b08a'); c.fillRect(lx - wd / 2 + 1 * m, y, wd - 2 * m, 4.2 * m);
      c.fillStyle = dim('#3a3f44');
      c.beginPath(); c.moveTo(lx - wd / 2 - 1.2 * m, y + 0.6 * m); c.quadraticCurveTo(lx, y + 1.4 * m, lx + wd / 2 + 1.2 * m, y + 0.6 * m);
      c.lineTo(lx + wd / 2 - 1 * m, y - 0.8 * m); c.lineTo(lx - wd / 2 + 1 * m, y - 0.8 * m); c.closePath(); c.fill();
    }
  }
}

function palm(c: CanvasRenderingContext2D, x: number, base: number, hgt: number, leaf: string, trunk: string): void {
  c.strokeStyle = trunk; c.lineWidth = Math.max(1, hgt * 0.05);
  c.beginPath(); c.moveTo(x, base); c.quadraticCurveTo(x + hgt * 0.15, base - hgt * 0.6, x + hgt * 0.08, base - hgt); c.stroke();
  c.strokeStyle = leaf; c.lineWidth = Math.max(1, hgt * 0.06);
  const tx = x + hgt * 0.08, ty = base - hgt;
  for (const a of [-2.6, -2.0, -1.2, -0.5, 0.1]) {
    c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(tx + Math.cos(a) * hgt * 0.35, ty + Math.sin(a) * hgt * 0.25 - hgt * 0.05, tx + Math.cos(a) * hgt * 0.45, ty + hgt * 0.18); c.stroke();
  }
}

function windmill(c: CanvasRenderingContext2D, x: number, base: number, m: number, body: string, sail: string): void {
  c.fillStyle = body;
  c.beginPath(); c.moveTo(x - 3 * m, base); c.lineTo(x - 2 * m, base - 14 * m); c.lineTo(x + 2 * m, base - 14 * m); c.lineTo(x + 3 * m, base); c.fill();
  c.beginPath(); c.moveTo(x - 2.4 * m, base - 14 * m); c.lineTo(x, base - 17 * m); c.lineTo(x + 2.4 * m, base - 14 * m); c.fill();
  const hx = x, hy = base - 15 * m;
  c.strokeStyle = sail; c.lineWidth = Math.max(1, 0.9 * m);
  for (const a of [0.5, 0.5 + Math.PI / 2, 0.5 + Math.PI, 0.5 + 1.5 * Math.PI]) {
    c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + Math.cos(a) * 10 * m, hy + Math.sin(a) * 10 * m); c.stroke();
  }
}

/** The Dutch prince's flag (orange, white, blue), `wid` wide, its hoist at (x, y). */
function flag(c: CanvasRenderingContext2D, x: number, y: number, wid: number, t: TimeOfDay): void {
  const cols = ['#d9822b', '#f4efe2', '#2f5b8a'];
  cols.forEach((col, i) => { c.fillStyle = t === 'night' ? shade(col, -0.6) : col; c.fillRect(x, y + (i * wid) / 4.5, wid, wid / 4.5); });
}

// ---------------------------------------------------------------- quay and beach

function quay(c: CanvasRenderingContext2D, w: number, yW: number, top: number, m: number, t: TimeOfDay): void {
  const night = t === 'night';
  // Piles in the water, then the plank deck.
  c.fillStyle = night ? '#2a2018' : '#4a3828';
  for (let x = 0; x < w / m; x += 3) c.fillRect(x * m, top, 0.7 * m, yW - top + 2.5 * m);
  c.fillStyle = night ? '#3c3024' : '#8a6a44'; c.fillRect(-w, top, w * 3, 0.9 * m);
  c.fillStyle = night ? '#30261c' : '#6e5434'; c.fillRect(-w, top + 0.9 * m, w * 3, 0.3 * m);
  // Bollards
  c.fillStyle = night ? '#2a2018' : '#3e2e1e';
  for (let x = 8; x < w / m; x += 22) c.fillRect(x * m, top - 1.1 * m, 0.8 * m, 1.1 * m);
  // Goods on the quay: casks and bales.
  const r = rnd(17);
  for (const gx of [6, 11, 92, 97, 103]) {
    for (let k = 0; k < 3; k++) {
      if (k && r() < 0.4) continue;
      const bx = (gx + k * 1.6) * m, by = top - (k > 1 ? 1.6 : 0) * m;
      if (r() < 0.5) { c.fillStyle = night ? '#4a3420' : '#8a5a2e'; c.beginPath(); c.ellipse(bx + 0.7 * m, by - 0.8 * m, 0.7 * m, 0.8 * m, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = night ? '#2a2018' : '#4a3828'; c.fillRect(bx, by - 1.1 * m, 1.4 * m, 0.15 * m); }
      else { c.fillStyle = night ? '#5a5040' : '#c9b48a'; c.fillRect(bx, by - 1.3 * m, 1.6 * m, 1.3 * m); }
    }
  }
  treadwheelCrane(c, w * 0.24, top, m, t);
  people(c, [18, 20.5, 60, 84, 86.4], top, m, t);
  if (t !== 'day') {
    for (const lx of [30, 75, 110]) {
      c.fillStyle = '#2a2018'; c.fillRect(lx * m, top - 5 * m, 0.25 * m, 5 * m);
      const gl = c.createRadialGradient(lx * m, top - 5.2 * m, 0, lx * m, top - 5.2 * m, 7 * m);
      gl.addColorStop(0, 'rgba(255,200,120,0.6)'); gl.addColorStop(1, 'rgba(255,200,120,0)');
      c.fillStyle = gl; c.beginPath(); c.arc(lx * m, top - 5.2 * m, 7 * m, 0, Math.PI * 2); c.fill();
    }
  }
}

/** The great wooden harbour crane: a house on the quay, men walking a treadwheel, a jib over the water. */
function treadwheelCrane(c: CanvasRenderingContext2D, x: number, top: number, m: number, t: TimeOfDay): void {
  const night = t === 'night';
  const wood = night ? '#2e2418' : '#5e4630', dark = night ? '#1e1810' : '#3e2e1e';
  c.fillStyle = wood;
  c.beginPath(); c.moveTo(x - 3.2 * m, top); c.lineTo(x - 2.6 * m, top - 9 * m); c.lineTo(x + 2.6 * m, top - 9 * m); c.lineTo(x + 3.2 * m, top); c.fill();
  c.fillStyle = dark;
  c.beginPath(); c.moveTo(x - 3.2 * m, top - 9 * m); c.lineTo(x, top - 12.5 * m); c.lineTo(x + 3.2 * m, top - 9 * m); c.fill();
  // The treadwheel on its side.
  c.strokeStyle = dark; c.lineWidth = Math.max(1, 0.35 * m);
  c.beginPath(); c.arc(x - 3.4 * m, top - 3.6 * m, 3.4 * m, 0, Math.PI * 2); c.stroke();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI; c.beginPath(); c.moveTo(x - 3.4 * m + Math.cos(a) * 3.4 * m, top - 3.6 * m + Math.sin(a) * 3.4 * m); c.lineTo(x - 3.4 * m - Math.cos(a) * 3.4 * m, top - 3.6 * m - Math.sin(a) * 3.4 * m); c.stroke(); }
  // The jib reaching out over the water, with rope and hook.
  c.strokeStyle = wood; c.lineWidth = Math.max(1.2, 0.5 * m);
  c.beginPath(); c.moveTo(x + 2 * m, top - 10.5 * m); c.lineTo(x + 9 * m, top - 12 * m); c.stroke();
  c.strokeStyle = night ? '#6a5a40' : '#2b1d0e'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(x + 9 * m, top - 12 * m); c.lineTo(x + 9 * m, top - 3.5 * m); c.stroke();
  c.fillStyle = night ? '#4a3420' : '#8a5a2e'; c.fillRect(x + 8.3 * m, top - 3.5 * m, 1.4 * m, 1.2 * m);
}

function people(c: CanvasRenderingContext2D, xs: number[], top: number, m: number, t: TimeOfDay): void {
  const cols = t === 'night' ? ['#3a3024'] : ['#2b2b33', '#5a3a2a', '#3a4a5a', '#6a2a2a'];
  xs.forEach((x, i) => {
    c.fillStyle = cols[i % cols.length];
    c.fillRect(x * m, top - 1.4 * m, 0.55 * m, 1.4 * m);
    c.beginPath(); c.arc(x * m + 0.27 * m, top - 1.65 * m, 0.27 * m, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1e1a16'; c.fillRect(x * m - 0.12 * m, top - 1.95 * m, 0.8 * m, 0.16 * m); // a hat
  });
}

function beach(c: CanvasRenderingContext2D, w: number, h: number, yW: number, m: number, t: TimeOfDay): void {
  const night = t === 'night';
  c.fillStyle = WATER[t]; c.fillRect(-w, yW, w * 3, h);
  c.fillStyle = night ? '#4a4434' : '#d8c49a';
  c.beginPath(); c.moveTo(-w, yW + 1.2 * m); c.quadraticCurveTo(w / 2, yW - 1.6 * m, w * 2, yW + 1.2 * m); c.lineTo(w * 2, h); c.lineTo(-w, h); c.fill();
  c.fillStyle = night ? '#3a3428' : '#c2ab7c';
  const r = rnd(9);
  for (let i = 0; i < 40; i++) c.fillRect(r() * w, yW + (1 + r() * 8) * m, 0.6 * m, 0.2 * m);
  people(c, [14, 16.5, 101, 104], yW + 0.4 * m, m, t);
}

/** Shores: timbers propping the hull upright on the beach. */
function shores(c: CanvasRenderingContext2D, d: Dims, x0: number, keelY: number, m: number): void {
  c.strokeStyle = '#5e4630'; c.lineWidth = Math.max(1, 0.45 * m);
  for (const f of [0.2, 0.4, 0.6, 0.8]) {
    const x = x0 + f * d.L * m, y = keelY - d.D * 0.55 * m;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - 4 * m, keelY + 0.6 * m); c.moveTo(x, y); c.lineTo(x + 4 * m, keelY + 0.6 * m); c.stroke();
  }
}

/** Breaming: small fires under the hull to burn off weed and worm, with drifting smoke. */
function fires(c: CanvasRenderingContext2D, d: Dims, x0: number, keelY: number, m: number): void {
  const r = rnd(Math.floor(Date.now() / 140));
  for (const f of [0.3, 0.55, 0.78]) {
    const x = x0 + f * d.L * m, y = keelY + 0.3 * m;
    c.fillStyle = '#e8762a'; c.beginPath(); c.moveTo(x - 0.9 * m, y); c.quadraticCurveTo(x + (r() - 0.5) * m, y - (2 + r()) * m, x + 0.9 * m, y); c.fill();
    c.fillStyle = '#ffd36b'; c.beginPath(); c.moveTo(x - 0.45 * m, y); c.quadraticCurveTo(x, y - (1 + r() * 0.8) * m, x + 0.45 * m, y); c.fill();
    c.fillStyle = 'rgba(200,195,185,0.35)';
    for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x + (k * 0.8 + r()) * m, y - (3 + k * 1.8) * m, (0.8 + k * 0.5) * m, 0, Math.PI * 2); c.fill(); }
  }
}

// ---------------------------------------------------------------- the ship

/** The hull's outline: a high stern, a low waist, a rising bow and a beakhead. */
function hullPath(d: Dims, x0: number, keelY: number, m: number): Path2D {
  const L = d.L * m, D = d.D * m;
  const deck = keelY - D, castle = D * 0.55;
  const X = (f: number) => x0 + f * L;
  const p = new Path2D();
  p.moveTo(X(0.03), deck - castle);                                   // top of the stern
  p.quadraticCurveTo(X(0.3), deck - castle * 0.2, X(0.55), deck);       // sheer down to the waist
  p.quadraticCurveTo(X(0.82), deck - castle * 0.05, X(0.93), deck - castle * 0.45); // and up to the forecastle
  p.lineTo(X(1.02), deck - castle * 0.3);                              // the beakhead
  p.lineTo(X(0.95), deck + D * 0.2);
  p.quadraticCurveTo(X(0.93), keelY - D * 0.1, X(0.84), keelY);         // the bow's curve to the keel
  p.lineTo(X(0.12), keelY);
  p.quadraticCurveTo(X(0.04), keelY - D * 0.2, X(0.0), deck);           // the stern's tuck
  p.closePath();
  return p;
}

function drawShip(c: CanvasRenderingContext2D, s: SceneShip, d: Dims, x0: number, keelY: number, m: number, t: TimeOfDay,
  o: { faded: boolean; cutaway: boolean }): void {
  const L = d.L * m, D = d.D * m, deck = keelY - D;
  const X = (f: number) => x0 + f * L;
  const night = t === 'night';
  const wear = Math.max(0, Math.min(1, (70 - s.condition) / 50));
  c.save();
  if (o.faded) c.globalAlpha = 0.55;
  // Masts first (behind the hull's top edge), then the hull.
  const masts = d.masts === 2 ? [{ f: 0.42, h: 1 }, { f: 0.76, h: 0.86 }] : [{ f: 0.2, h: 0.68, mizzen: true }, { f: 0.5, h: 1 }, { f: 0.77, h: 0.88 }];
  const ink = night ? '#1a140e' : '#2b1d0e';
  for (const mast of masts) {
    const mx = X(mast.f), H = d.H * mast.h * m, baseY = deck + D * 0.2;
    c.strokeStyle = ink; c.lineWidth = Math.max(1, 0.5 * m * (mast.h + 0.2));
    c.beginPath(); c.moveTo(mx, baseY); c.lineTo(mx, deck - H); c.stroke();
    // Tops (platforms) and the furled sails on their yards.
    const yards = 'mizzen' in mast ? [0.55] : [0.42, 0.72, 0.92];
    c.fillStyle = ink; c.fillRect(mx - 1.1 * m, deck - H * 0.55, 2.2 * m, 0.35 * m);
    for (const yf of yards) {
      const yy = deck - H * yf, half = (d.L * (0.2 - (yf - 0.4) * 0.12)) * m * (mast.h);
      c.strokeStyle = ink; c.lineWidth = Math.max(1, 0.32 * m);
      c.beginPath(); c.moveTo(mx - half, yy); c.lineTo(mx + half, yy); c.stroke();
      c.fillStyle = night ? '#6a6252' : shade('#efe3c4', -0.08 * wear);
      c.beginPath(); c.roundRect(mx - half * 0.9, yy - 0.15 * m, half * 1.8, 0.75 * m, 0.35 * m); c.fill();
    }
    if ('mizzen' in mast) {
      // A lateen yard on the mizzen, its sail furled along it.
      c.strokeStyle = ink; c.lineWidth = Math.max(1, 0.3 * m);
      c.beginPath(); c.moveTo(mx - 0.22 * L, deck - H * 0.25); c.lineTo(mx + 0.08 * L, deck - H * 0.95); c.stroke();
    }
    // Shrouds: a fan of lines from the top to the ship's side.
    c.strokeStyle = night ? 'rgba(40,32,24,0.7)' : 'rgba(43,29,14,0.55)'; c.lineWidth = 0.8;
    for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(mx, deck - H * 0.55); c.lineTo(mx + k * 0.7 * m, deck + 0.2 * m); c.stroke(); }
    // Pennant at the masthead.
    c.fillStyle = '#c0532a'; c.beginPath(); c.moveTo(mx, deck - H); c.lineTo(mx + 4 * m, deck - H + 0.4 * m); c.lineTo(mx, deck - H + 0.8 * m); c.fill();
  }
  // Stays from mast to mast and down to the bowsprit.
  c.strokeStyle = night ? 'rgba(40,32,24,0.7)' : 'rgba(43,29,14,0.6)'; c.lineWidth = 0.8;
  const tops = masts.map((mm) => [X(mm.f), deck - d.H * mm.h * m * 0.92] as const);
  const sprit = [X(1.16), deck - D * 0.9] as const;
  c.beginPath();
  for (let i = 0; i < tops.length - 1; i++) { c.moveTo(tops[i][0], tops[i][1]); c.lineTo(tops[i + 1][0], deck - D * 0.1); }
  c.moveTo(tops[tops.length - 1][0], tops[tops.length - 1][1]); c.lineTo(sprit[0], sprit[1]);
  c.stroke();
  c.strokeStyle = ink; c.lineWidth = Math.max(1, 0.45 * m);
  c.beginPath(); c.moveTo(X(0.92), deck - D * 0.3); c.lineTo(sprit[0], sprit[1]); c.stroke();

  // The hull: oiled wood above, pale "white stuff" below the waterline, a darker wale.
  const hull = hullPath(d, x0, keelY, m);
  const wood = night ? '#3a2a1c' : shade('#6b4a2b', -0.12 * wear);
  c.fillStyle = wood; c.fill(hull);
  c.save(); c.clip(hull);
  c.fillStyle = night ? '#4a463c' : shade('#d8cfb4', -0.25 * wear);
  c.fillRect(x0 - 2 * m, keelY - D * 0.42, L + 6 * m, D);
  // Wales: two dark bands following the sheer, and the painted band between them.
  const band = (off: number, col: string, hh: number) => {
    c.strokeStyle = col; c.lineWidth = hh;
    c.beginPath(); c.moveTo(X(0.0), deck - D * 0.42 + off); c.quadraticCurveTo(X(0.3), deck + D * 0.02 + off, X(0.55), deck + D * 0.18 + off);
    c.quadraticCurveTo(X(0.82), deck + D * 0.12 + off, X(1.0), deck - D * 0.1 + off); c.stroke();
  };
  band(D * 0.15, night ? '#1e160e' : '#3a2616', 0.5 * m);
  band(D * 0.3, night ? '#5a4a2a' : '#c9a24a', 0.35 * m);
  band(D * 0.42, night ? '#1e160e' : '#3a2616', 0.5 * m);
  // Gunports with red lids on the armed ships.
  for (let i = 0; i < d.guns; i++) {
    const gx = X(0.2 + (i / Math.max(1, d.guns - 1)) * 0.62), gy = deck + D * 0.27;
    c.fillStyle = night ? '#4a1e18' : '#9a3424'; c.fillRect(gx, gy - 0.4 * m, 0.9 * m, 0.8 * m);
  }
  // Weed and wear along the waterline when she's worn.
  if (wear > 0.05) {
    c.fillStyle = `rgba(70,90,50,${0.35 * wear})`;
    c.fillRect(x0, keelY - D * 0.42, L, D * 0.12);
  }
  c.restore();
  // The carved and gilded stern, with its lantern.
  c.fillStyle = night ? '#5a4a2a' : '#c9a24a';
  c.fillRect(X(0.0), deck - D * 0.5, 0.8 * m, D * 0.35);
  c.fillStyle = night ? '#f5c86a' : '#e9dcc0'; c.fillRect(X(0.01) - 0.2 * m, deck - D * 0.6 - 1.4 * m, 0.7 * m, 0.9 * m);
  // Flagstaff and the flag at the stern.
  c.strokeStyle = ink; c.lineWidth = Math.max(1, 0.25 * m);
  // A flag in proportion to the ship (about a ninth of her length).
  const fw = Math.max(1.6, d.L / 9) * m;
  c.beginPath(); c.moveTo(X(0.02), deck - D * 0.55); c.lineTo(X(0.02) - 0.3 * fw, deck - D * 0.55 - 1.5 * fw); c.stroke();
  flag(c, X(0.02) - 0.3 * fw - fw, deck - D * 0.55 - 1.5 * fw, fw, t);
  if (o.faded) c.globalAlpha = 1;
  c.restore();
}

/** The cut-open hold: lots stacked from the keel, each packed as it would be; victuals aft. */
function hold(c: CanvasRenderingContext2D, s: SceneShip, d: Dims, x0: number, keelY: number, m: number): void {
  const L = d.L * m, D = d.D * m;
  const x1 = x0 + 0.22 * L, x2 = x0 + 0.84 * L;
  const bottom = keelY - 0.5 * m, topY = keelY - D * 0.92;
  c.fillStyle = 'rgba(25,18,10,0.62)'; c.fillRect(x1, topY, x2 - x1, bottom - topY);
  let y = bottom;
  const per = (bottom - topY) / Math.max(1, s.capacity);
  let seed = 1;
  for (const lot of s.cargo) {
    const hgt = lot.tons * per;
    if (hgt < 0.4) continue;
    const [col, pack] = LOOK[lot.good] ?? ['#a0763f', 'bale'];
    packed(c, col, pack, x1, y - hgt, x2 - x1, hgt, m, seed++);
    y -= hgt;
  }
  c.strokeStyle = 'rgba(255,250,235,0.45)'; c.lineWidth = 1; c.strokeRect(x1, topY, x2 - x1, bottom - topY);
  // The bread room: casks of victuals, aft.
  const vx = x0 + 0.06 * L, vw = 0.13 * L, vt = keelY - D * 0.7;
  c.fillStyle = 'rgba(25,18,10,0.62)'; c.fillRect(vx, vt, vw, bottom - vt);
  const share = Math.max(0, Math.min(1, s.fuel / s.bunkerCapacity));
  const n = Math.round(share * 12);
  const cw = vw / 3, ch = (bottom - vt) / 4;
  for (let i = 0; i < n; i++) {
    const cx = vx + (i % 3) * cw, cy = bottom - (Math.floor(i / 3) + 1) * ch;
    c.fillStyle = share < 0.15 ? '#c0532a' : '#8a5a2e';
    c.beginPath(); c.ellipse(cx + cw / 2, cy + ch / 2, cw * 0.42, ch * 0.42, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#4a3828'; c.fillRect(cx + cw * 0.12, cy + ch * 0.45, cw * 0.76, Math.max(0.6, ch * 0.08));
  }
  c.strokeStyle = 'rgba(255,250,235,0.45)'; c.strokeRect(vx, vt, vw, bottom - vt);
}

function packed(c: CanvasRenderingContext2D, col: string, pack: string, x: number, y: number, wid: number, hgt: number, m: number, seed: number): void {
  const r = rnd(seed * 97);
  if (pack === 'loose') {
    c.fillStyle = col; c.fillRect(x, y, wid, hgt);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < wid * hgt / (2 * m * m); i++) c.fillRect(x + r() * wid, y + r() * hgt, 0.3 * m, 0.2 * m);
    return;
  }
  const uw = pack === 'logs' || pack === 'bars' ? 3.2 * m : 1.5 * m, uh = pack === 'bars' ? 0.5 * m : pack === 'logs' ? 0.8 * m : 1.2 * m;
  for (let yy = y + hgt - uh; yy > y - uh * 0.5; yy -= uh) {
    const ty = Math.max(yy, y), th = yy + uh - ty;
    for (let xx = x; xx < x + wid - 0.1; xx += uw) {
      const ww = Math.min(uw, x + wid - xx);
      c.fillStyle = shade(col, (r() - 0.5) * 0.18);
      if (pack === 'cask') { c.beginPath(); c.ellipse(xx + ww / 2, ty + th / 2, ww * 0.46, th * 0.48, 0, 0, Math.PI * 2); c.fill(); }
      else if (pack === 'sack' || pack === 'bale') { c.beginPath(); c.roundRect(xx + 0.08 * m, ty + 0.06 * m, ww - 0.16 * m, th - 0.12 * m, pack === 'sack' ? 0.4 * m : 0.15 * m); c.fill(); }
      else { c.fillRect(xx + 0.06 * m, ty + 0.06 * m, ww - 0.12 * m, th - 0.12 * m); }
    }
  }
}
