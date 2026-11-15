// Ship artwork, drawn in code: a side view for the UI (fleet strip, market,
// reports) and a small top-down icon for the map. One design per ship family;
// size follows the ship's capacity. Colours come from CSS variables so the art
// follows light and dark mode.

import type { ShipTypeDef } from '../sim/types';

export type ShipFamily = 'general' | 'bulk' | 'tanker' | 'container' | 'reefer';

export function shipFamily(type: Pick<ShipTypeDef, 'id' | 'cargoClasses'>): ShipFamily {
  if (type.cargoClasses.includes('liquid')) return 'tanker';
  if (type.id === 'feeder' || type.id === 'container') return 'container';
  if (type.cargoClasses.includes('reefer')) return 'reefer';
  if (type.cargoClasses.length === 1 && type.cargoClasses[0] === 'bulk') return 'bulk';
  return 'general';
}

/** 0.62 (smallest) to 1 (largest): how long the drawing is. */
function lengthFactor(capacity: number): number {
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

/** Top-down map icon (bow pointing along +x), centred on the origin. */
export function mapIconPath(type: Pick<ShipTypeDef, 'capacity'>): { hull: string; deck: string; length: number } {
  const L = 11 + 11 * ((lengthFactor(type.capacity) - 0.62) / 0.38);
  const W = 4.2 + 2.6 * ((lengthFactor(type.capacity) - 0.62) / 0.38);
  const h = L / 2;
  const w = W / 2;
  const hull = `M${h.toFixed(1)} 0 Q${(h - 2).toFixed(1)} ${(-w).toFixed(1)} ${(h - 5).toFixed(1)} ${(-w).toFixed(1)} L${(-h).toFixed(1)} ${(-w * 0.9).toFixed(1)} L${(-h).toFixed(1)} ${(w * 0.9).toFixed(1)} L${(h - 5).toFixed(1)} ${w.toFixed(1)} Q${(h - 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} 0 Z`;
  // Bridge block near the stern.
  const deck = `M${(-h + 1.2).toFixed(1)} ${(-w * 0.7).toFixed(1)} h${(L * 0.2).toFixed(1)} v${(w * 1.4).toFixed(1)} h${(-L * 0.2).toFixed(1)} Z`;
  return { hull, deck, length: L };
}
