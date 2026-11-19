// The docking mini game's rules, kept apart from the screen so they can be tested:
// harbour layouts (true scale, metres), ship handling, collisions and mooring.
//
// Coordinates: x to the east, y to the south, in metres; heading 0 = east,
// -π/2 = north. The harbour is HARBOUR_W × HARBOUR_H; ships arrive from the sea.

export const HARBOUR_W = 1400;
export const HARBOUR_H = 1000;

export type Pt = [number, number];
export type Layout = 'breakwater' | 'river' | 'bay' | 'dogleg' | 'jetty';

export interface Harbour {
  layout: Layout;
  /** Land, quays and breakwaters (closed polygons). */
  land: Pt[][];
  /** The berth: a quay edge from a to b; the ship lies alongside on the water side. */
  berth: { a: Pt; b: Pt };
  start: { x: number; y: number; heading: number; speed: number };
  /** Steady drift (current and wind), m/s, as a function of position. */
  drift: (x: number, y: number) => Pt;
  /** What the drift is, in words. */
  driftNote: string;
}

/** Which layout each port uses. */
export const PORT_LAYOUT: Record<string, Layout> = {
  rotterdam: 'river', genoa: 'breakwater', istanbul: 'bay', alexandria: 'breakwater', newyork: 'river', houston: 'dogleg',
  losangeles: 'breakwater', vancouver: 'bay', santos: 'dogleg', buenosaires: 'river', valparaiso: 'breakwater', lagos: 'dogleg',
  capetown: 'breakwater', mombasa: 'dogleg', dubai: 'jetty', mumbai: 'breakwater', colombo: 'breakwater', singapore: 'jetty',
  jakarta: 'dogleg', bangkok: 'river', shanghai: 'river', busan: 'breakwater', yokohama: 'bay', sydney: 'bay', auckland: 'bay',
  porthedland: 'jetty',
};

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** A small deterministic generator for per-port variety. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

/**
 * The harbour for a port. `strength` (0..1) scales wind and current with the
 * weather; `shipLength` sets how long the berth is.
 */
export function harbourFor(portId: string, shipLength: number, strength = 0.5): Harbour {
  const layout = PORT_LAYOUT[portId] ?? 'breakwater';
  const r = seeded(portId);
  const mirror = r() < 0.5;
  const berthLen = Math.max(shipLength * 1.25, 130);
  let h: Harbour;
  switch (layout) {
    case 'river': {
      // A channel from the sea up to a basin; the berth is the basin's east quay. Current runs seaward.
      const by = 140 + r() * Math.max(0, 550 - 140 - berthLen);
      h = {
        layout,
        land: [rect(0, 0, 330, HARBOUR_H), rect(790, 560, HARBOUR_W, HARBOUR_H), rect(330, 0, HARBOUR_W, 110), rect(1200, 110, HARBOUR_W, 560)],
        berth: { a: [1200, by], b: [1200, Math.min(550, by + berthLen)] },
        start: { x: 560, y: 960, heading: -Math.PI / 2, speed: 2 },
        drift: (_x, y) => [0, y > 560 ? 0.3 * strength : 0.06 * strength],
        driftNote: 'River current setting seaward',
      };
      break;
    }
    case 'bay': {
      // A sheltered bay with a pier; berth along the pier's east side. Wind from the west.
      const by = 250 + r() * 120;
      const coast: Pt[] = [[0, 0], [HARBOUR_W, 0], [HARBOUR_W, 420], [1300, 380], [1200, 300], [1050, 170], [900, 140], [760, 150], [700, 150],
        [700, 150], [560, 150], [420, 190], [260, 280], [130, 420], [60, 600], [0, 640]];
      h = {
        layout,
        land: [coast, rect(640, 140, 700, 640), [[HARBOUR_W, 560], [HARBOUR_W, HARBOUR_H], [1150, HARBOUR_H], [1250, 700]]],
        berth: { a: [700, by], b: [700, Math.min(630, by + berthLen)] },
        start: { x: 900, y: 960, heading: -Math.PI / 2 - 0.25, speed: 2 },
        drift: () => [0.1 * strength, 0.02 * strength],
        driftNote: 'Wind from the west, pushing you off the pier',
      };
      break;
    }
    case 'dogleg': {
      // In from the south-east, then a hard turn west into the basin; berth on the north quay.
      const bx = 140 + r() * (560 - berthLen * 0.6);
      h = {
        layout,
        land: [rect(0, 0, HARBOUR_W, 170), rect(0, 580, 860, HARBOUR_H), rect(1310, 170, HARBOUR_W, HARBOUR_H), rect(0, 170, 60, 580)],
        berth: { a: [bx, 170], b: [Math.min(1250, bx + berthLen), 170] },
        start: { x: 1085, y: 970, heading: -Math.PI / 2, speed: 2 },
        drift: (_x, y) => (y > 580 ? [0, 0.18 * strength] : [0.07 * strength, 0]),
        driftNote: 'Tidal stream setting out of the channel',
      };
      break;
    }
    case 'jetty': {
      // An exposed jetty off the shore; berth along its south side, wind blowing you off.
      const bx = 260 + r() * (820 - 260 - berthLen);
      h = {
        layout,
        land: [rect(0, 0, 150, HARBOUR_H), rect(150, 420, 860, 460)],
        berth: { a: [Math.max(170, bx), 460], b: [Math.min(850, bx + berthLen), 460] },
        start: { x: 1250, y: 900, heading: -Math.PI + 0.35, speed: 2 },
        drift: () => [0, 0.13 * strength],
        driftNote: 'Strong wind from the north, blowing you off the jetty',
      };
      break;
    }
    default: {
      // Two breakwater arms with an entrance; berth along the north quay.
      const gap0 = 560 + r() * 60;
      const bx = 200 + r() * (1000 - berthLen);
      // Big ships need room to turn: the breakwater lies further out for them.
      const arm = shipLength >= 200 ? 680 : 545;
      h = {
        layout: 'breakwater',
        land: [rect(0, 0, HARBOUR_W, 220), rect(0, arm, gap0, arm + 35), rect(gap0 + 280, arm, HARBOUR_W, arm + 35)],
        berth: { a: [bx, 220], b: [bx + berthLen, 220] },
        start: { x: gap0 + 140, y: 960, heading: -Math.PI / 2, speed: 2 },
        drift: (_x, y) => [y > arm + 35 ? 0.12 * strength : 0.03 * strength, 0],
        driftNote: 'Swell and a breeze from the west outside the breakwater',
      };
    }
  }
  // Big ships use the deep-water terminal on the channel near the mouth (like Rotterdam's
  // Maasvlakte), not the inner basin: the turn into it is too tight for them.
  if (shipLength >= 180 && (h.layout === 'river' || h.layout === 'dogleg')) {
    const x = h.layout === 'river' ? 790 : 1310;
    const y0 = 620 + r() * Math.max(0, 960 - 620 - berthLen);
    h.berth = { a: [x, y0], b: [x, Math.min(990, y0 + berthLen)] };
    h.start = { ...h.start, y: 990 - 10, x: h.layout === 'river' ? 470 : 990 };
    h.driftNote += '. Big ships berth at the deep-water terminal near the mouth';
  }
  return mirror ? mirrored(h) : h;
}

function mirrored(h: Harbour): Harbour {
  const m = ([x, y]: Pt): Pt => [HARBOUR_W - x, y];
  return {
    ...h,
    land: h.land.map((poly) => poly.map(m).reverse()),
    berth: { a: m(h.berth.b), b: m(h.berth.a) },
    start: { ...h.start, x: HARBOUR_W - h.start.x, heading: Math.PI - h.start.heading },
    drift: (x, y) => { const [dx, dy] = h.drift(HARBOUR_W - x, y); return [-dx, dy]; },
  };
}

// ---------------------------------------------------------------- the ship

export interface ShipBody {
  x: number; y: number;
  heading: number;
  /** Forward speed (m/s, negative astern), sideways speed (m/s, + to starboard), turn rate (rad/s). */
  u: number; v: number; r: number;
  length: number; beam: number;
}

export interface Controls {
  /** -3 (full astern) .. 0 (stop) .. +3 (full ahead). */
  throttle: number;
  /** Rudder angle, -1 (hard to port) .. +1 (hard to starboard). */
  rudder: number;
  /** Tug / thruster push: -1 to port, +1 to starboard. */
  push: number;
}

/** Handling for a ship of a given length: big ships accelerate, stop and turn slowly. */
export function handling(length: number) {
  const s = Math.max(0.8, length / 80);
  return {
    accel: 0.11 / s,
    /** Top speed in the harbour at full ahead, m/s (about 7 knots). */
    vmax: 3.6,
    turn: 0.016 / s ** 0.8,
    turnDamping: 0.55,
    /** Tugs: enough to beat the wind at the berth (about 0.3 m/s sideways for a coaster, 0.17 for the biggest). */
    pushAccel: 0.18 / Math.sqrt(s),
    sideDamping: 0.6,
  };
}

export function newBody(h: Harbour, length: number): ShipBody {
  return { x: h.start.x, y: h.start.y, heading: h.start.heading, u: h.start.speed, v: 0, r: 0, length, beam: Math.max(10, length / 6.5) };
}

/** Advance the ship by `dt` seconds of harbour time. */
export function step(b: ShipBody, c: Controls, h: Harbour, dt: number): void {
  const k = handling(b.length);
  const target = (c.throttle / 3) * k.vmax * (c.throttle < 0 ? 0.6 : 1);
  // Engine: approach the ordered speed at the ship's acceleration (astern is weaker).
  const du = Math.max(-k.accel * dt, Math.min(k.accel * dt, target - b.u));
  b.u += du;
  // Rudder needs water flowing past it: steering grows with speed (and the propeller wash when the engine works).
  const flow = Math.abs(b.u) + Math.abs(c.throttle) * 0.25;
  b.r += (c.rudder * flow * Math.sign(b.u || 1) * k.turn - b.r * k.turnDamping) * dt;
  b.v += (c.push * k.pushAccel - b.v * k.sideDamping) * dt;
  const cos = Math.cos(b.heading), sin = Math.sin(b.heading);
  let [dx, dy] = h.drift(b.x, b.y);
  // Alongside, slow and lined up, the crew gets lines ashore: they hold her against wind and current.
  const st = berthStatus(b, h);
  if (st.alongside && groundSpeed(b) < 0.5) { dx *= 0.1; dy *= 0.1; }
  b.x += (b.u * cos - b.v * sin + dx) * dt;
  b.y += (b.u * sin + b.v * cos + dy) * dt;
  b.heading += b.r * dt;
}

/** The hull outline: stern corners, sides, and a pointed bow. */
export function hullPoints(b: ShipBody): Pt[] {
  const L = b.length / 2, B = b.beam / 2;
  const local: Pt[] = [[-L, -B], [L * 0.7, -B], [L, 0], [L * 0.7, B], [-L, B]];
  const cos = Math.cos(b.heading), sin = Math.sin(b.heading);
  return local.map(([lx, ly]) => [b.x + lx * cos - ly * sin, b.y + lx * sin + ly * cos]);
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Does the hull touch land, a quay or a breakwater (or leave the harbour)? */
export function touchesLand(b: ShipBody, h: Harbour): boolean {
  const hull = hullPoints(b);
  if (hull.some(([x, y]) => x < 0 || x > HARBOUR_W || y < 0)) return true;
  for (const poly of h.land) {
    if (hull.some((p) => inside(p, poly))) return true;
    if (poly.some((p) => inside(p, hull))) return true;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], c = hull[(i + 1) % hull.length];
      for (let j = 0; j < poly.length; j++) if (segmentsCross(a, c, poly[j], poly[(j + 1) % poly.length])) return true;
    }
  }
  return false;
}

/** Speed over the ground, m/s. */
export function groundSpeed(b: ShipBody): number {
  return Math.hypot(b.u, b.v);
}

/** Impacts slower than this are fenders doing their job, not damage. */
export const SAFE_CONTACT = 0.35;

/** Condition lost hitting something at this speed (%). */
export function bumpDamage(speed: number): number {
  return speed <= SAFE_CONTACT ? 0 : Math.min(12, Math.max(1, Math.round((speed - SAFE_CONTACT) * 6)));
}

/**
 * The hull touched something: put her back where she was, take the way off her,
 * and return the damage (0 for a gentle touch). A gentle touch at the berth lets
 * the fenders swing her flat against the quay.
 */
export function resolveContact(b: ShipBody, prev: ShipBody, h: Harbour): number {
  const dmg = bumpDamage(groundSpeed(prev));
  Object.assign(b, { x: prev.x, y: prev.y, heading: prev.heading, u: prev.u * -0.1, v: 0, r: 0 });
  const st = berthStatus(b, h);
  if (dmg === 0 && st.gap < 25 && st.angle < 35) {
    const [ax, ay] = h.berth.a, [bx, by] = h.berth.b;
    const quay = Math.atan2(by - ay, bx - ax);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const e1 = wrap(quay - b.heading), e2 = wrap(quay + Math.PI - b.heading);
    const err = Math.abs(e1) < Math.abs(e2) ? e1 : e2;
    const before = b.heading;
    b.heading += Math.max(-0.02, Math.min(0.02, err));
    if (touchesLand(b, h)) b.heading = before;
  }
  return dmg;
}

/** Where the ship stands against its berth: how far off, how well lined up, and whether it lies alongside. */
export function berthStatus(b: ShipBody, h: Harbour) {
  const [ax, ay] = h.berth.a, [bx, by] = h.berth.b;
  const len = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  // Along the quay and out from it (the water side is to the left of a→b... whichever side the ship is on).
  const along = (b.x - ax) * ux + (b.y - ay) * uy;
  const off = Math.abs((b.x - ax) * -uy + (b.y - ay) * ux);
  const quayAngle = Math.atan2(uy, ux);
  let diff = Math.abs(((b.heading - quayAngle) % Math.PI + Math.PI) % Math.PI);
  diff = Math.min(diff, Math.PI - diff);
  const halfShip = b.length / 2;
  // The ship may overhang the berth's ends a little (15% of its length).
  const spare = Math.max(15, b.length * 0.15);
  const withinLength = along - halfShip >= -spare && along + halfShip <= len + spare;
  const gap = off - b.beam / 2;
  const alongside = withinLength && gap < 12 && diff < (10 * Math.PI) / 180;
  return {
    /** Distance from the ship to the middle of the berth. */
    distance: Math.hypot(b.x - (ax + bx) / 2, b.y - (ay + by) / 2),
    /** Gap between the hull and the quay, m. */
    gap,
    /** How far off parallel, degrees. */
    angle: (diff * 180) / Math.PI,
    alongside,
    /** Lying alongside and (almost) stopped: moored. */
    moored: alongside && groundSpeed(b) < 0.2 && Math.abs(b.r) < 0.01,
  };
}

export interface DockingScore {
  score: number;
  bumps: number;
  damage: number;
  perfect: boolean;
}

/** Score a finished docking: lined up, gentle, quick, and no bumps. */
export function scoreDocking(angle: number, seconds: number, bumps: number, damage: number, parSeconds: number): DockingScore {
  let score = 100 - angle * 3 - bumps * 20 - Math.max(0, seconds - parSeconds) * 0.15;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, bumps, damage, perfect: bumps === 0 && score >= 85 };
}
