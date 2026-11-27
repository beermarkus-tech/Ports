// Ship artwork, drawn in code: a side view for the UI (fleet strip, market,
// reports) and a small top-down icon for the map. One design per ship family;
// size follows the ship's capacity. Colours come from CSS variables so the art
// follows light and dark mode.

import type { ShipTypeDef } from '../sim/types';

export type ShipFamily = 'general' | 'bulk' | 'tanker' | 'container' | 'reefer' | 'sail';

export function shipFamily(type: Pick<ShipTypeDef, 'id' | 'cargoClasses'> & { family?: 'sail' }): ShipFamily {
  if (type.family === 'sail') return 'sail';
  if (type.cargoClasses.includes('liquid')) return 'tanker';
  if (type.id === 'feeder' || type.id === 'container') return 'container';
  if (type.cargoClasses.includes('reefer')) return 'reefer';
  if (type.cargoClasses.length === 1 && type.cargoClasses[0] === 'bulk') return 'bulk';
  return 'general';
}

/** 0.62 (smallest) to 1 (largest): how long the drawing is. */
function lengthFactor(capacity: number, family?: 'sail'): number {
  if (family === 'sail') {
    const t = Math.log(capacity / 80) / Math.log(1100 / 80);
    return 0.62 + 0.38 * Math.max(0, Math.min(1, t));
  }
  const t = Math.log(capacity / 3000) / Math.log(45000 / 3000);
  return 0.62 + 0.38 * Math.max(0, Math.min(1, t));
}

const CONTAINER_COLOURS = ['#d9534f', '#3a87c8', '#e8a33d', '#4caf7a', '#8a6bc7', '#e07b39'];

/**
 * Side view, bow to the right, as an inline SVG string. `width` is the CSS
 * width of the whole drawing; the ship itself is shorter for small classes.
 */
export function shipSideView(type: ShipTypeDef, width = 120): string {
  const family = shipFamily(type);
  if (family === 'sail') return sailSideView(type, width);
  const L = 150 * lengthFactor(type.capacity); // hull length in drawing units
  const x0 = (160 - L) / 2;
  const x = (f: number) => (x0 + f * L).toFixed(1); // position along the hull, 0 = stern, 1 = bow
  const deck = 26;
  const water = 38;
  const parts: string[] = [];

  // Hull: flat stern, raked bow, a little sheer.
  const hullClass = family === 'reefer' ? 'hull light' : family === 'tanker' ? 'hull red' : family === 'bulk' ? 'hull dark' : 'hull';
  parts.push(`<path class="${hullClass}" d="M${x(0)} ${deck} L${x(0.97)} ${deck - 2} L${x(1)} ${deck - 4} L${x(0.95)} ${water + 4} L${x(0.04)} ${water + 4} L${x(0)} ${deck + 8} Z"/>`);
  parts.push(`<path class="boot" d="M${x(0.03)} ${water} L${x(0.96)} ${water} L${x(0.95)} ${water + 4} L${x(0.04)} ${water + 4} Z"/>`);

  const bridgeAt = family === 'container' ? 0.16 : 0.06;
  const bw = 0.13;
  // Superstructure (accommodation + bridge) and funnel.
  parts.push(`<rect class="super" x="${x(bridgeAt)}" y="${deck - 14}" width="${(bw * L).toFixed(1)}" height="14" rx="1"/>`);
  parts.push(`<rect class="super" x="${x(bridgeAt - 0.01)}" y="${deck - 17}" width="${((bw + 0.02) * L).toFixed(1)}" height="3.5" rx="1"/>`);
  for (let i = 0; i < 4; i++) {
    parts.push(`<rect class="window" x="${(x0 + (bridgeAt + 0.015 + i * 0.028) * L).toFixed(1)}" y="${deck - 12}" width="${(0.016 * L).toFixed(1)}" height="2.2"/>`);
  }
  parts.push(`<rect class="funnel" x="${x(bridgeAt + 0.03)}" y="${deck - 25}" width="${(0.05 * L).toFixed(1)}" height="8.5" rx="1"/>`);
  parts.push(`<rect class="funnel-band" x="${x(bridgeAt + 0.03)}" y="${deck - 23}" width="${(0.05 * L).toFixed(1)}" height="2"/>`);

  const cargoFrom = bridgeAt + bw + 0.04;
  const cargoTo = 0.92;
  if (family === 'general' || family === 'reefer') {
    const holds = type.capacity >= 8000 ? 4 : type.capacity >= 5000 ? 3 : 2;
    const step = (cargoTo - cargoFrom) / holds;
    for (let i = 0; i < holds; i++) {
      const a = cargoFrom + i * step;
      parts.push(`<rect class="hatch" x="${(x0 + (a + 0.015) * L).toFixed(1)}" y="${deck - 3}" width="${((step - 0.03) * L).toFixed(1)}" height="3" rx="0.6"/>`);
      // A crane between holds.
      const cx = x0 + (a + step) * L;
      if (i < holds - 1 || holds === 2) {
        parts.push(`<line class="crane" x1="${cx.toFixed(1)}" y1="${deck}" x2="${cx.toFixed(1)}" y2="${deck - 15}"/>`);
        parts.push(`<line class="crane boom" x1="${cx.toFixed(1)}" y1="${deck - 13}" x2="${(cx - step * L * 0.6).toFixed(1)}" y2="${deck - 5}"/>`);
      }
    }
  } else if (family === 'bulk') {
    const holds = type.capacity >= 40000 ? 7 : 5;
    const step = (cargoTo - cargoFrom) / holds;
    for (let i = 0; i < holds; i++) {
      const a = cargoFrom + i * step;
      parts.push(`<rect class="hatch" x="${(x0 + (a + 0.01) * L).toFixed(1)}" y="${deck - 4}" width="${((step - 0.02) * L).toFixed(1)}" height="4" rx="1"/>`);
    }
  } else if (family === 'tanker') {
    parts.push(`<line class="pipe" x1="${x(cargoFrom)}" y1="${deck - 2.5}" x2="${x(cargoTo)}" y2="${deck - 2.5}"/>`);
    parts.push(`<line class="pipe thin" x1="${x(cargoFrom)}" y1="${deck - 5}" x2="${x(cargoTo)}" y2="${deck - 5}"/>`);
    const mid = (cargoFrom + cargoTo) / 2;
    parts.push(`<rect class="manifold" x="${x(mid - 0.02)}" y="${deck - 9}" width="${(0.04 * L).toFixed(1)}" height="7" rx="1"/>`);
    parts.push(`<line class="crane" x1="${x(0.93)}" y1="${deck - 2}" x2="${x(0.93)}" y2="${deck - 14}"/>`);
  } else {
    // Container stacks: tiers by size.
    const tiers = type.capacity >= 15000 ? 4 : 3;
    const cols = Math.max(6, Math.round((cargoTo - cargoFrom) * L / 7));
    const cw = ((cargoTo - cargoFrom) * L) / cols;
    for (let c = 0; c < cols; c++) {
      const h = tiers - ((c * 7) % 3 === 0 ? 1 : 0);
      for (let t = 0; t < h; t++) {
        const colour = CONTAINER_COLOURS[(c * 3 + t * 5) % CONTAINER_COLOURS.length];
        parts.push(`<rect x="${(x0 + cargoFrom * L + c * cw + 0.4).toFixed(1)}" y="${(deck - 4.2 * (t + 1)).toFixed(1)}" width="${(cw - 0.8).toFixed(1)}" height="3.8" fill="${colour}" rx="0.4"/>`);
      }
    }
  }
  // Mast on the forecastle.
  if (family !== 'tanker') parts.push(`<line class="mast" x1="${x(0.95)}" y1="${deck - 3}" x2="${x(0.95)}" y2="${deck - 12}"/>`);
  // Water line.
  parts.push(`<path class="sea" d="M0 ${water + 3} Q 20 ${water + 1} 40 ${water + 3} T 80 ${water + 3} T 120 ${water + 3} T 160 ${water + 3} V 48 H 0 Z"/>`);
  return `<svg class="ship-art ${family}" viewBox="0 0 160 48" width="${width}" height="${(width * 0.3).toFixed(0)}" aria-hidden="true">${parts.join('')}</svg>`;
}

/**
 * A sailing ship, bow to the right: a curved hull with a high stern castle,
 * two or three masts of square sails, a spritsail under the bowsprit and the
 * company's flag at the stern.
 */
function sailSideView(type: ShipTypeDef, width: number): string {
  if (type.rig === 'junk') return junkSideView(type, width);
  const L = 130 * lengthFactor(type.capacity, 'sail');
  const x0 = (160 - L) / 2 - 4;
  const x = (f: number) => (x0 + f * L).toFixed(1);
  const water = 40;
  const deck = 31;
  const parts: string[] = [];
  // Hull: high, rounded stern, sweeping sheer down to a low beak at the bow.
  parts.push(`<path class="hull wood" d="M${x(0)} ${deck - 7} L${x(0.16)} ${deck - 6} Q${x(0.55)} ${deck + 1} ${x(0.92)} ${deck - 2} L${x(1.04)} ${deck - 4}
    L${x(0.97)} ${deck + 1} Q${x(0.93)} ${water + 3} ${x(0.8)} ${water + 4} L${x(0.12)} ${water + 4} Q${x(0.03)} ${water + 2} ${x(0.01)} ${deck + 2} Z"/>`);
  // A painted band along the gunwale, and the stern windows.
  parts.push(`<path class="wale" d="M${x(0.02)} ${deck - 3} L${x(0.16)} ${deck - 2.2} Q${x(0.55)} ${deck + 4.4} ${x(0.95)} ${deck + 1} L${x(0.95)} ${deck + 2.6} Q${x(0.55)} ${deck + 6} ${x(0.16)} ${deck - 0.4} L${x(0.02)} ${deck - 1.2} Z"/>`);
  for (let i = 0; i < 2; i++) parts.push(`<rect class="window" x="${(x0 + (0.035 + i * 0.045) * L).toFixed(1)}" y="${deck - 5.6}" width="${(0.025 * L).toFixed(1)}" height="1.8"/>`);
  // Bowsprit.
  parts.push(`<line class="spar" x1="${x(0.93)}" y1="${deck - 2}" x2="${x(1.16)}" y2="${deck - 11}"/>`);
  // Masts: main, fore and (on the bigger ships) mizzen, each with courses and topsails.
  const big = type.capacity >= 250;
  const masts = big
    ? [{ at: 0.22, h: 0.8, mizzen: true }, { at: 0.5, h: 1 }, { at: 0.76, h: 0.9 }]
    : [{ at: 0.38, h: 1 }, { at: 0.72, h: 0.88 }];
  const H = 34 * (0.75 + 0.25 * lengthFactor(type.capacity, 'sail'));
  for (const m of masts) {
    const mx = x0 + m.at * L;
    const top = deck - H * m.h;
    parts.push(`<line class="mast" x1="${mx.toFixed(1)}" y1="${deck}" x2="${mx.toFixed(1)}" y2="${(top - 2).toFixed(1)}"/>`);
    const w = L * (big ? 0.2 : 0.24) * m.h;
    if (m.mizzen) {
      // A lateen sail on the mizzen.
      parts.push(`<path class="sail" d="M${(mx - w * 0.55).toFixed(1)} ${(deck - 4).toFixed(1)} L${(mx + w * 0.2).toFixed(1)} ${(top + 2).toFixed(1)} L${(mx + w * 0.25).toFixed(1)} ${(deck - 4).toFixed(1)} Z"/>`);
    }
    const tiers = m.mizzen ? 1 : 2;
    const span = (deck - 6 - top) / (m.mizzen ? 2 : tiers);
    for (let t = m.mizzen ? 1 : 0; t < (m.mizzen ? 2 : tiers); t++) {
      const yb = deck - 6 - t * span;
      const yt = yb - span + 1.5;
      const ww = w * (1 - t * 0.25);
      // A square sail, bellied out by the wind.
      parts.push(`<path class="sail" d="M${(mx - ww / 2).toFixed(1)} ${yt.toFixed(1)} L${(mx + ww / 2).toFixed(1)} ${yt.toFixed(1)}
        Q${(mx + ww / 2 + 1.6).toFixed(1)} ${((yt + yb) / 2).toFixed(1)} ${(mx + ww / 2).toFixed(1)} ${yb.toFixed(1)}
        L${(mx - ww / 2).toFixed(1)} ${yb.toFixed(1)} Q${(mx - ww / 2 + 1.6).toFixed(1)} ${((yt + yb) / 2).toFixed(1)} ${(mx - ww / 2).toFixed(1)} ${yt.toFixed(1)} Z"/>`);
      parts.push(`<line class="spar" x1="${(mx - ww / 2 - 0.6).toFixed(1)}" y1="${yt.toFixed(1)}" x2="${(mx + ww / 2 + 0.6).toFixed(1)}" y2="${yt.toFixed(1)}"/>`);
    }
    // A pennant at the masthead.
    parts.push(`<path class="pennant" d="M${mx.toFixed(1)} ${(top - 2).toFixed(1)} l5 1 l-5 1 Z"/>`);
  }
  // Spritsail under the bowsprit.
  const bx = x0 + 1.06 * L;
  parts.push(`<path class="sail" d="M${(bx - 4).toFixed(1)} ${(deck - 7).toFixed(1)} L${(bx + 4).toFixed(1)} ${(deck - 9).toFixed(1)} L${(bx + 3.5).toFixed(1)} ${(deck - 3).toFixed(1)} L${(bx - 3.5).toFixed(1)} ${(deck - 1.5).toFixed(1)} Z"/>`);
  // Stays from the bowsprit to the foremast top.
  const fore = masts[masts.length - 1];
  parts.push(`<line class="rigging" x1="${x(1.16)}" y1="${deck - 11}" x2="${x(fore.at)}" y2="${(deck - H * fore.h).toFixed(1)}"/>`);
  // The flag at the stern: orange, white and blue.
  const fx = x0 + 0.01 * L, fy = deck - 15;
  parts.push(`<line class="mast" x1="${fx.toFixed(1)}" y1="${deck - 7}" x2="${fx.toFixed(1)}" y2="${fy.toFixed(1)}"/>`);
  parts.push(`<rect x="${(fx - 7).toFixed(1)}" y="${fy.toFixed(1)}" width="7" height="1.4" fill="#d9822b"/><rect x="${(fx - 7).toFixed(1)}" y="${(fy + 1.4).toFixed(1)}" width="7" height="1.4" fill="#f4efe2"/><rect x="${(fx - 7).toFixed(1)}" y="${(fy + 2.8).toFixed(1)}" width="7" height="1.4" fill="#2f5b8a"/>`);
  parts.push(`<path class="sea" d="M0 ${water + 3} Q 20 ${water + 1} 40 ${water + 3} T 80 ${water + 3} T 120 ${water + 3} T 160 ${water + 3} V 48 H 0 Z"/>`);
  return `<svg class="ship-art sail" viewBox="0 0 160 48" width="${width}" height="${(width * 0.3).toFixed(0)}" aria-hidden="true">${parts.join('')}</svg>`;
}

/**
 * A junk, bow to the right: a high, overhanging stern with its great rudder, a flat transom bow
 * with an eye painted on it, and battened lug sails of matting, peaked high at the back.
 */
function junkSideView(type: ShipTypeDef, width: number): string {
  const lf = lengthFactor(type.capacity, 'sail');
  const L = 128 * lf;
  const x0 = (160 - L) / 2 + 2;
  const X = (f: number) => x0 + f * L;
  const x = (f: number) => X(f).toFixed(1);
  const water = 40;
  const deck = 31;
  const parts: string[] = [];
  const big = type.capacity >= 250;
  const H = 34 * (0.75 + 0.25 * lf);
  // Masts and sails first: the hull's high stern overlaps the mizzen's foot.
  const masts = big
    ? [{ at: 0.15, h: 0.55, rake: -0.02 }, { at: 0.5, h: 1, rake: 0 }, { at: 0.8, h: 0.72, rake: 0.05 }]
    : [{ at: 0.48, h: 1, rake: 0 }, { at: 0.8, h: 0.74, rake: 0.05 }];
  for (const m of masts) {
    const mx = X(m.at), top = deck - H * m.h, tx = mx + m.rake * L;
    parts.push(`<line class="mast" x1="${mx.toFixed(1)}" y1="${deck}" x2="${tx.toFixed(1)}" y2="${(top - 2).toFixed(1)}"/>`);
    const w = L * (big ? 0.27 : 0.33) * m.h;
    // The sail hangs mostly abaft the mast: a boom along the foot, a yard peaked up aft, a fanned leech.
    const fb: [number, number] = [mx + w * 0.28, deck - 4], ab: [number, number] = [mx - w * 0.68, deck - 4.5];
    const ft: [number, number] = [tx + w * 0.22, top + 2.5], at: [number, number] = [tx - w * 0.62, top - 2.5];
    parts.push(`<path class="junk-sail" d="M${fb[0].toFixed(1)} ${fb[1]} L${ft[0].toFixed(1)} ${ft[1].toFixed(1)} L${at[0].toFixed(1)} ${at[1].toFixed(1)}
      Q${(Math.min(at[0], ab[0]) - w * 0.16).toFixed(1)} ${((at[1] + ab[1]) / 2).toFixed(1)} ${ab[0].toFixed(1)} ${ab[1]} Z"/>`);
    // Battens across the sail.
    const n = big ? 6 : 5;
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const lx = fb[0] + (ft[0] - fb[0]) * u, ly = fb[1] + (ft[1] - fb[1]) * u;
      const bulge = Math.sin(u * Math.PI) * w * 0.15;
      const rx = ab[0] + (at[0] - ab[0]) * u - bulge, ry = ab[1] + (at[1] - ab[1]) * u;
      parts.push(`<line class="batten" x1="${lx.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${rx.toFixed(1)}" y2="${ry.toFixed(1)}"/>`);
    }
    parts.push(`<line class="spar" x1="${fb[0].toFixed(1)}" y1="${fb[1]}" x2="${ab[0].toFixed(1)}" y2="${ab[1]}"/>`);
    parts.push(`<line class="spar" x1="${ft[0].toFixed(1)}" y1="${ft[1].toFixed(1)}" x2="${at[0].toFixed(1)}" y2="${at[1].toFixed(1)}"/>`);
    // A long pennant at the masthead.
    parts.push(`<path class="junk-flag" d="M${tx.toFixed(1)} ${(top - 2).toFixed(1)} l-7 1 l7 1.2 Z"/>`);
  }
  // Hull: overhanging stern, deep sheer, flat bow leaning forward.
  parts.push(`<path class="hull junk" d="M${x(-0.03)} ${deck - 9} L${x(0.12)} ${deck - 7.5} Q${x(0.5)} ${deck + 1.5} ${x(0.93)} ${deck - 4}
    L${x(1.02)} ${deck - 5} L${x(0.95)} ${deck + 2.5} Q${x(0.9)} ${water + 4} ${x(0.76)} ${water + 4} L${x(0.12)} ${water + 4}
    Q${x(0.04)} ${water + 2} ${x(0.03)} ${deck + 1} Z"/>`);
  // A red band along the rail, the painted stern and bow, and the eye that finds the way.
  parts.push(`<path class="junk-red" d="M${x(-0.02)} ${deck - 7} L${x(0.12)} ${deck - 5.6} Q${x(0.5)} ${deck + 3.4} ${x(0.93)} ${deck - 2}
    L${x(0.93)} ${deck - 0.6} Q${x(0.5)} ${deck + 4.8} ${x(0.12)} ${deck - 4.2} L${x(-0.02)} ${deck - 5.6} Z"/>`);
  parts.push(`<path class="junk-red" d="M${x(-0.03)} ${deck - 9} L${x(0.02)} ${deck - 8.6} L${x(0.04)} ${deck + 1} L${x(0.03)} ${deck + 1} Z"/>`);
  parts.push(`<circle class="eye" cx="${x(0.93)}" cy="${(deck + 0.6).toFixed(1)}" r="1.5"/><circle class="pupil" cx="${(X(0.93) + 0.4).toFixed(1)}" cy="${(deck + 0.6).toFixed(1)}" r="0.7"/>`);
  // The great rudder, hung from the stern.
  parts.push(`<path class="hull junk" d="M${x(0.0)} ${deck - 2} L${x(0.05)} ${deck - 1} L${x(0.06)} ${water + 5} L${x(-0.02)} ${water + 5} Z"/>`);
  // A red banner at the stern.
  const fx = X(-0.02), fy = deck - 18;
  parts.push(`<line class="mast" x1="${fx.toFixed(1)}" y1="${deck - 9}" x2="${fx.toFixed(1)}" y2="${fy.toFixed(1)}"/>`);
  parts.push(`<path class="junk-flag" d="M${fx.toFixed(1)} ${fy.toFixed(1)} l-7 0 l-1.5 2 l1.5 2 l7 0 Z"/>`);
  parts.push(`<path class="sea" d="M0 ${water + 3} Q 20 ${water + 1} 40 ${water + 3} T 80 ${water + 3} T 120 ${water + 3} T 160 ${water + 3} V 48 H 0 Z"/>`);
  return `<svg class="ship-art sail junk" viewBox="0 0 160 48" width="${width}" height="${(width * 0.3).toFixed(0)}" aria-hidden="true">${parts.join('')}</svg>`;
}

/** Top-down map icon (bow pointing along +x), centred on the origin. */
export function mapIconPath(type: Pick<ShipTypeDef, 'capacity'> & { family?: 'sail'; rig?: 'junk' }): { hull: string; deck: string; length: number } {
  const f = (lengthFactor(type.capacity, type.family) - 0.62) / 0.38;
  if (type.rig === 'junk') {
    // Beamy, with a square bow and a broad, square stern; the battened sails seen from above, sheeted out.
    const L = 10 + 8 * f, W = 4.6 + 2.4 * f, h = L / 2, w = W / 2;
    const n = (v: number) => v.toFixed(1);
    const hull = `M${n(h)} ${n(-w * 0.5)} Q${n(h - 2)} ${n(-w)} ${n(h - 4)} ${n(-w)} L${n(-h + 1.2)} ${n(-w)} Q${n(-h)} ${n(-w)} ${n(-h)} ${n(-w * 0.8)}
      L${n(-h)} ${n(w * 0.8)} Q${n(-h)} ${n(w)} ${n(-h + 1.2)} ${n(w)} L${n(h - 4)} ${n(w)} Q${n(h - 2)} ${n(w)} ${n(h)} ${n(w * 0.5)} Z`;
    const sail = (at: number, span: number) => `M${n(at - 0.8 - span * 0.35)} ${n(-span)} h1.6 L${n(at + 0.8 + span * 0.35)} ${n(span)} h-1.6 Z`;
    const deck = [sail(-h * 0.1, w * 1.45), sail(h * 0.5, w * 1.1)].join(' ');
    return { hull, deck, length: L };
  }
  if (type.family === 'sail') {
    // A round-bottomed hull seen from above, with the yards of her sails across it.
    const L = 10 + 8 * f, W = 4 + 2 * f, h = L / 2, w = W / 2;
    const hull = `M${(h + 1.5).toFixed(1)} 0 Q${(h - 1).toFixed(1)} ${(-w).toFixed(1)} ${(h - 4).toFixed(1)} ${(-w).toFixed(1)} L${(-h + 1.5).toFixed(1)} ${(-w * 0.95).toFixed(1)} Q${(-h).toFixed(1)} 0 ${(-h + 1.5).toFixed(1)} ${(w * 0.95).toFixed(1)} L${(h - 4).toFixed(1)} ${w.toFixed(1)} Q${(h - 1).toFixed(1)} ${w.toFixed(1)} ${(h + 1.5).toFixed(1)} 0 Z`;
    const yard = (at: number, span: number) => `M${(at - 0.9).toFixed(1)} ${(-span).toFixed(1)} h1.8 v${(span * 2).toFixed(1)} h-1.8 Z`;
    const deck = [yard(-h * 0.35, w * 1.6), yard(h * 0.3, w * 1.5)].join(' ');
    return { hull, deck, length: L };
  }
  const L = 11 + 11 * f;
  const W = 4.2 + 2.6 * f;
  const h = L / 2;
  const w = W / 2;
  const hull = `M${h.toFixed(1)} 0 Q${(h - 2).toFixed(1)} ${(-w).toFixed(1)} ${(h - 5).toFixed(1)} ${(-w).toFixed(1)} L${(-h).toFixed(1)} ${(-w * 0.9).toFixed(1)} L${(-h).toFixed(1)} ${(w * 0.9).toFixed(1)} L${(h - 5).toFixed(1)} ${w.toFixed(1)} Q${(h - 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} 0 Z`;
  // Bridge block near the stern.
  const deck = `M${(-h + 1.2).toFixed(1)} ${(-w * 0.7).toFixed(1)} h${(L * 0.2).toFixed(1)} v${(w * 1.4).toFixed(1)} h${(-L * 0.2).toFixed(1)} Z`;
  return { hull, deck, length: L };
}
