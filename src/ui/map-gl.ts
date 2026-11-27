// The world map, drawn with WebGL (PixiJS). One renderer draws the whole frame every frame at
// the exact zoom: geometry (sea, land, coasts, graticule, lanes) is built once into GPU meshes in
// map units, and zooming or panning only changes one transform. Lines keep their width on screen
// (they are widened in the vertex shader), ports, names and ships keep their size, and names are
// placed again each frame so they fade in and out instead of jumping.
//
// Knows nothing about game rules: it is handed positions, routes and highlights by the view.

import earcut from 'earcut';
import { geoCircle, geoDistance, geoEqualEarth, geoGraticule10, geoInterpolate, geoPath, geoStream, type GeoProjection, type GeoPermissibleObjects } from 'd3-geo';
import { Application, Container, Geometry, GlProgram, Graphics, GraphicsPath, Mesh, Shader, Sprite, Text, TextStyle, Texture, UniformGroup } from 'pixi.js';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import type { World } from '../sim/world';
import { currency } from './format';
import type { LonLat, PortMarker, ShipMarker, WeatherCell } from './map';
import { GlobeLines, GlobeScene, globeInvert, globePoint, lineGeometry3, toVec, type GlobeView } from './map-globe';

const W = 1000;
const H = 470;
const MAX_ZOOM = 12;
/** Ports closer than this (map units, at the whole-world view) have their dots pushed apart. */
const MIN_GAP = 12;
/** Within this distance of a pushed dot (map units), ships, routes and lanes bend towards it. */
const NUDGE_REACH = 14;
/** Size of the textures that cover the whole map (shallows, fog). */
const TEX_W = 2048;
const TEX_H = Math.round((TEX_W * H) / W);
/** Distances to the coast are stored up to this many map units. */
const DIST_MAX = 16;

type RGBA = [number, number, number, number];

// ------------------------------------------------------------------ colours

const probe = (() => {
  let c: CanvasRenderingContext2D | null = null;
  return (css: string): RGBA => {
    c ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
    if (!c) return [1, 1, 1, 1];
    c.clearRect(0, 0, 1, 1);
    c.fillStyle = '#000';
    c.fillStyle = css;
    c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  };
})();

function hexOf(c: RGBA): number {
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}

interface Palette {
  ocean1: RGBA; ocean2: RGBA; land: RGBA; landHi: RGBA; landEdge: RGBA; shallow: RGBA;
  text: RGBA; muted: RGBA; bg: RGBA; halo: RGBA; line: RGBA; accent: RGBA; accent2: RGBA;
  good: RGBA; bad: RGBA; night: RGBA; nightAlpha: number; fog: RGBA; fogInk: RGBA; superC: RGBA;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => probe(css.getPropertyValue(name).trim() || fallback);
  return {
    ocean1: v('--ocean-1', '#12304d'), ocean2: v('--ocean-2', '#0a1a2c'),
    land: v('--land', '#2b4a63'), landHi: v('--land-hi', '#36597a'), landEdge: v('--land-edge', '#3d6683'),
    shallow: v('--shallow', '#2a6f97'), text: v('--text', '#e3edf7'), muted: v('--muted', '#8ba3bb'),
    bg: v('--bg', '#08131f'), halo: v('--halo', '#0a1a2c'), line: v('--line', '#21405f'),
    accent: v('--accent', '#3ec7e0'), accent2: v('--accent-2', '#f2b84b'), good: v('--good', '#4fd18b'),
    bad: v('--bad', '#ff6b6b'), night: v('--night', '#020a14'),
    nightAlpha: Number(css.getPropertyValue('--night-alpha').trim()) || 0.16,
    fog: v('--fog', '#d8d1c0'), fogInk: v('--fog-ink', '#7a6a50'), superC: v('--super', '#e9eef3'),
  };
}

// ------------------------------------------------------------------ geometry

interface Shapes { polygons: number[][][]; lines: number[][] }

/** Project a GeoJSON object (or the sphere) into flat rings and lines, in map units. */
function project(projection: GeoProjection, obj: GeoPermissibleObjects): Shapes {
  const out: Shapes = { polygons: [], lines: [] };
  let poly: number[][] | null = null;
  let ring: number[] = [];
  geoStream(obj, projection.stream({
    point(x: number, y: number) { ring.push(x, y); },
    lineStart() { ring = []; },
    lineEnd() {
      if (poly) { if (ring.length >= 6) poly.push(ring); } else if (ring.length >= 4) out.lines.push(ring);
    },
    polygonStart() { poly = []; },
    polygonEnd() { if (poly?.length) out.polygons.push(poly); poly = null; },
    sphere() { /* not used */ },
  }));
  return out;
}

function area(r: number[]): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a / 2;
}

function inside(x: number, y: number, r: number[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  }
  return c;
}

/**
 * Triangulate projected polygons. The projection keeps d3's winding: outer rings turn the same
 * way as the sphere's outline (`outerSign`), holes the other way; each hole goes with the outer
 * ring that holds it.
 */
function triangulate(polys: number[][][], outerSign: number): { pos: Float32Array; idx: Uint32Array } {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const rings of polys) {
    const outers = rings.filter((r) => Math.sign(area(r)) === outerSign);
    const holes = rings.filter((r) => Math.sign(area(r)) !== outerSign);
    const groups = (outers.length ? outers : holes).map((o) => [o]);
    if (outers.length) {
      for (const h of holes) {
        const g = groups.find((gr) => inside(h[0], h[1], gr[0]));
        g?.push(h);
      }
    }
    for (const g of groups) {
      const flat: number[] = [];
      const holeIdx: number[] = [];
      for (let i = 0; i < g.length; i++) {
        if (i) holeIdx.push(flat.length / 2);
        for (const v of g[i]) flat.push(v);
      }
      const base = pos.length / 2;
      for (const t of earcut(flat, holeIdx)) idx.push(base + t);
      for (const v of flat) pos.push(v);
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

/**
 * Line geometry for the line shader: two vertices per point, pushed apart on screen by the shader.
 * Points share mitred normals, so translucent lines don't darken at their joints.
 */
function lineGeometry(lines: { pts: number[]; closed?: boolean }[], nudge?: Nudger): Geometry {
  const pos: number[] = [], nrm: number[] = [], side: number[] = [], idx: number[] = [], ndg: number[] = [];
  for (const { pts: raw, closed } of lines) {
    // Drop repeated points.
    const p: number[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      const n = p.length;
      if (n && Math.abs(p[n - 2] - raw[i]) < 1e-6 && Math.abs(p[n - 1] - raw[i + 1]) < 1e-6) continue;
      p.push(raw[i], raw[i + 1]);
    }
    if (closed && p.length > 4 && Math.abs(p[0] - p[p.length - 2]) < 1e-6 && Math.abs(p[1] - p[p.length - 1]) < 1e-6) p.length -= 2;
    const n = p.length / 2;
    if (n < 2) continue;
    const base = pos.length / 2;
    const count = closed ? n + 1 : n;
    let d = 0;
    for (let s = 0; s < count; s++) {
      const i = s % n;
      const x = p[i * 2], y = p[i * 2 + 1];
      if (s > 0) {
        const j = (s - 1) % n;
        d += Math.hypot(x - p[j * 2], y - p[j * 2 + 1]);
      }
      const hasPrev = closed || s > 0, hasNext = closed || s < n - 1;
      const pi = (i - 1 + n) % n, ni = (i + 1) % n;
      let nx = 0, ny = 0;
      let n0x = 0, n0y = 0, n1x = 0, n1y = 0;
      if (hasPrev) {
        const dx = x - p[pi * 2], dy = y - p[pi * 2 + 1], l = Math.hypot(dx, dy) || 1;
        n0x = -dy / l; n0y = dx / l;
      }
      if (hasNext) {
        const dx = p[ni * 2] - x, dy = p[ni * 2 + 1] - y, l = Math.hypot(dx, dy) || 1;
        n1x = -dy / l; n1y = dx / l;
      }
      if (hasPrev && hasNext) {
        let mx = n0x + n1x, my = n0y + n1y;
        const ml = Math.hypot(mx, my);
        if (ml < 1e-3) { nx = n1x; ny = n1y; } else {
          mx /= ml; my /= ml;
          const cos = mx * n1x + my * n1y;
          const len = Math.min(3, 1 / Math.max(cos, 1e-3));
          nx = mx * len; ny = my * len;
        }
      } else if (hasPrev) { nx = n0x; ny = n0y; } else { nx = n1x; ny = n1y; }
      pos.push(x, y, x, y);
      const [ux, uy, d0] = nudge?.(x, y) ?? [0, 0, 1];
      // Four floats a vertex (not three): Apple's graphics layer mishandles three-float vertex attributes.
      ndg.push(ux, uy, d0, 0, ux, uy, d0, 0);
      nrm.push(nx, ny, nx, ny);
      // Side (-1 or 1) and distance along the line, packed in pairs (single-float attributes trouble some drivers).
      side.push(-1, d, 1, d);
      if (s > 0) {
        const a = base + (s - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  return new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array(pos.length ? pos : [0, 0]), format: 'float32x2' },
      aNormal: { buffer: new Float32Array(nrm.length ? nrm : [0, 0]), format: 'float32x2' },
      aSideDist: { buffer: new Float32Array(side.length ? side : [0, 0]), format: 'float32x2' },
      aNudge: { buffer: new Float32Array(ndg.length ? ndg : [0, 0, 1, 0]), format: 'float32x4' },
    },
    indexBuffer: new Uint32Array(idx.length ? idx : [0, 0, 0]),
  });
}

/** How far a point is pushed towards a nearby pushed port dot (map units, at the world view), and the ports' true gap. */
type Nudger = (x: number, y: number) => [number, number, number];

/** How much of the push remains at zoom k: all of it at the world view, none once the true gap is MIN_GAP on screen. */
function nudgeShare(d0: number, k: number): number {
  return Math.max(0, Math.min(1, (MIN_GAP - d0 * k) / (MIN_GAP - d0)));
}

function fillGeometry(t: { pos: Float32Array; idx: Uint32Array }): Geometry {
  return new Geometry({
    attributes: { aPosition: { buffer: t.pos.length ? t.pos : new Float32Array(6), format: 'float32x2' } },
    indexBuffer: t.idx.length ? t.idx : new Uint32Array([0, 1, 2]),
  });
}

// ------------------------------------------------------------------ shaders

const VIEW_UNIFORMS = (): UniformGroup => new UniformGroup({
  uPxPerUnit: { value: 1, type: 'f32' },
  uK: { value: 1, type: 'f32' },
});

const MVP = `
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
vec4 toClip(vec2 p) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  return vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
}`;

const LINE_VERT = `
in vec2 aPosition;
in vec2 aNormal;
in vec2 aSideDist;
in vec4 aNudge;
uniform float uPxPerUnit;
uniform float uK;
uniform float uWidth;
out float vSide;
out float vDist;
${MVP}
void main() {
  float hw = uWidth * 0.5 + 1.0;
  // Near ports whose dots are pushed apart, lines bend to the dot (less as the zoom separates them).
  // (aNudge.z is the ports' true gap, under MIN_GAP; the max() keeps the division safe whatever a driver reads.)
  float share = clamp((${MIN_GAP.toFixed(1)} - aNudge.z * uK) / max(0.5, ${MIN_GAP.toFixed(1)} - aNudge.z), 0.0, 1.0);
  gl_Position = toClip(aPosition + aNudge.xy * share + aNormal * aSideDist.x * hw / uPxPerUnit);
  vSide = aSideDist.x * hw;
  vDist = aSideDist.y * uPxPerUnit;
}`;

const LINE_FRAG = `
in float vSide;
in float vDist;
uniform vec4 uInk;
uniform float uWidth;
uniform vec2 uDash;
uniform float uDashShift;
uniform vec4 uColor;
out vec4 finalColor;
void main() {
  float a = clamp(uWidth * 0.5 + 0.5 - abs(vSide), 0.0, 1.0);
  if (uDash.x > 0.0) {
    float m = mod(vDist + uDashShift, uDash.x + uDash.y);
    a *= clamp(uDash.x - m + 0.5, 0.0, 1.0);
  }
  finalColor = vec4(uInk.rgb, 1.0) * (uInk.a * a * uColor.a);
}`;

const FILL_VERT = `
in vec2 aPosition;
out vec2 vPos;
${MVP}
void main() {
  gl_Position = toClip(aPosition);
  vPos = aPosition;
}`;

const FILL_FRAG = `
in vec2 vPos;
uniform vec4 uTop;
uniform vec4 uBottom;
uniform vec2 uY;
uniform vec4 uColor;
out vec4 finalColor;
void main() {
  vec4 c = mix(uTop, uBottom, clamp((vPos.y - uY.x) / (uY.y - uY.x), 0.0, 1.0));
  finalColor = vec4(c.rgb, 1.0) * (c.a * uColor.a);
}`;

const SEA_FRAG = `
in vec2 vPos;
uniform vec4 uSea1;
uniform vec4 uSea2;
uniform vec4 uGrad;
uniform vec4 uWave;
uniform vec4 uShallow;
uniform float uK;
uniform sampler2D uDist;
uniform sampler2D uWaves;
uniform vec4 uColor;
out vec4 finalColor;
void main() {
  vec3 c = mix(uSea1.rgb, uSea2.rgb, clamp(length(vPos - uGrad.xy) / uGrad.z, 0.0, 1.0));
  // Wave marks: the same size on screen at any zoom.
  float w = texture(uWaves, vPos * uK / vec2(46.0, 22.0)).a;
  c = mix(c, uWave.rgb, w * uWave.a);
  // Shallows: lighter water near every coast, from the distance to the nearest land.
  float d = texture(uDist, vPos / vec2(${W}.0, ${H}.0)).r * ${DIST_MAX}.0;
  float t = d * sqrt(uK) / 6.0;
  c = mix(c, uShallow.rgb, uShallow.a * 0.45 * exp(-t * t));
  finalColor = vec4(c, 1.0) * uColor.a;
}`;

function program(name: string, vertex: string, fragment: string): GlProgram {
  return GlProgram.from({ name, vertex, fragment, preferredVertexPrecision: 'highp', preferredFragmentPrecision: 'highp' });
}

interface LineStyle { width: number; color: RGBA; alpha: number; dash?: [number, number] }

/**
 * Replace a mesh's geometry by building a new mesh in its place (same shader, same place among its
 * siblings, same visibility and alpha). Setting `mesh.geometry` to a geometry of another size left
 * some phones' GPUs drawing with the old buffers: lanes of uncharted ports, run off to a corner.
 */
function swapMesh(old: Mesh<Geometry, Shader>, g: Geometry): Mesh<Geometry, Shader> {
  const m = new Mesh({ geometry: g, shader: old.shader! });
  m.visible = old.visible;
  m.alpha = old.alpha;
  const parent = old.parent;
  if (parent) {
    parent.addChildAt(m, parent.getChildIndex(old));
    parent.removeChild(old);
  }
  const oldGeometry = old.geometry;
  old.destroy();
  oldGeometry.destroy();
  return m;
}

class LineLayer {
  mesh: Mesh<Geometry, Shader>;
  readonly u: UniformGroup;
  constructor(view: UniformGroup, prog: GlProgram, geometry: Geometry, style: LineStyle) {
    this.u = new UniformGroup({
      uInk: { value: new Float32Array(4), type: 'vec4<f32>' },
      uWidth: { value: 1, type: 'f32' },
      uDash: { value: new Float32Array(2), type: 'vec2<f32>' },
      uDashShift: { value: 0, type: 'f32' },
    });
    this.mesh = new Mesh({ geometry, shader: new Shader({ glProgram: prog, resources: { view, line: this.u } }) });
    this.style(style);
  }
  style(s: LineStyle): void {
    const ink = this.u.uniforms.uInk as Float32Array;
    ink.set([s.color[0], s.color[1], s.color[2], s.alpha * s.color[3]]);
    this.u.uniforms.uWidth = s.width;
    (this.u.uniforms.uDash as Float32Array).set(s.dash ?? [0, 0]);
    this.u.update();
  }
  /** New line data: a new mesh in the old one's place (see swapMesh). */
  set geometry(g: Geometry) { this.mesh = swapMesh(this.mesh, g); }
  set shift(px: number) { this.u.uniforms.uDashShift = px; this.u.update(); }
}

class FillLayer {
  mesh: Mesh<Geometry, Shader>;
  readonly u: UniformGroup;
  constructor(prog: GlProgram, geometry: Geometry, top: RGBA, bottom: RGBA, y0: number, y1: number) {
    this.u = new UniformGroup({
      uTop: { value: new Float32Array(4), type: 'vec4<f32>' },
      uBottom: { value: new Float32Array(4), type: 'vec4<f32>' },
      uY: { value: new Float32Array(2), type: 'vec2<f32>' },
    });
    this.mesh = new Mesh({ geometry, shader: new Shader({ glProgram: prog, resources: { fill: this.u } }) });
    this.colors(top, bottom, y0, y1);
  }
  colors(top: RGBA, bottom: RGBA, y0: number, y1: number): void {
    (this.u.uniforms.uTop as Float32Array).set(top);
    (this.u.uniforms.uBottom as Float32Array).set(bottom);
    (this.u.uniforms.uY as Float32Array).set([y0, y1 === y0 ? y0 + 1 : y1]);
    this.u.update();
  }
  set geometry(g: Geometry) { this.mesh = swapMesh(this.mesh, g); }
}

// ------------------------------------------------------------------ labels

type NearKey = 'right' | 'left' | 'above' | 'below' | 'ne' | 'se' | 'nw' | 'sw';
/** The eight spots round a dot, and the same eight a little further out (for crowded clusters). */
type LabelKey = NearKey | `${NearKey}2`;
interface LabelSpot { x: number; y: number; fy: number; anchor: 'start' | 'end' | 'middle' }
/** Where a port's name (baseline y) and note (baseline fy) can sit round its dot, in label units. */
const NEAR_SPOTS: Record<NearKey, LabelSpot> = {
  right: { x: 10, y: -6, fy: 8, anchor: 'start' },
  left: { x: -10, y: -6, fy: 8, anchor: 'end' },
  above: { x: 0, y: -21, fy: -9, anchor: 'middle' },
  below: { x: 0, y: 18, fy: 29, anchor: 'middle' },
  ne: { x: 6, y: -16, fy: -4, anchor: 'start' },
  se: { x: 6, y: 15, fy: 27, anchor: 'start' },
  nw: { x: -6, y: -16, fy: -4, anchor: 'end' },
  sw: { x: -6, y: 15, fy: 27, anchor: 'end' },
};
const LABEL_SPOTS = { ...NEAR_SPOTS } as Record<LabelKey, LabelSpot>;
for (const [k, v] of Object.entries(NEAR_SPOTS)) {
  const dy = v.y * 0.7;
  LABEL_SPOTS[`${k}2` as LabelKey] = { x: v.x * 2.4, y: v.y + dy, fy: v.fy + dy, anchor: v.anchor };
}
const SPOT_KEYS = Object.keys(NEAR_SPOTS) as LabelKey[];
const FAR_KEYS = SPOT_KEYS.map((k) => `${k}2` as LabelKey);
/** How long a name takes to fade in or out. */
const FADE_MS = 150;

type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

interface PortView {
  id: string;
  name: string;
  /** True position in map units (dots a few units apart are pushed apart on screen: see disp()). */
  x: number;
  y: number;
  /** Where it is on the Earth (for the globe). */
  lon: number;
  lat: number;
  dataSpot: LabelKey;
  g: Graphics;
  label: Text;
  note: Text;
  /** Container for name and note, faded as one. */
  tag: Container;
  /** A settlement site not founded (yet): not drawn, not tappable. */
  hidden: boolean;
  marker: PortMarker | null;
  rumour: boolean;
  night: boolean;
  styleKey: string;
  spot: LabelKey;
  wantSpot: LabelKey;
  showNote: boolean;
  wantNote: boolean;
  /** A thin line from the dot to the name, where a crowded cluster leaves no unambiguous spot. */
  leader: boolean;
  wantLeader: boolean;
  leaderG: Graphics;
  leaderKey: string;
  visible: boolean;
  alpha: number;
  button: HTMLButtonElement;
}

interface ShipView {
  marker: ShipMarker;
  root: Container;
  halo: Graphics;
  body: Graphics;
  key: string;
}

interface CloudView { sprite: Container; inner: Sprite; bolt: Graphics | null; cell: WeatherCell }

interface Effect { t0: number; dur: number; at: LonLat; obj: Container; kind: 'pulse' | 'flash'; color: number }

// ------------------------------------------------------------------ the map

export class GlMapView {
  private projection: GeoProjection;
  private path: ReturnType<typeof geoPath>;
  private stack: HTMLDivElement;
  private app: Application | null = null;
  private ready = false;
  private failed = false;
  private pal!: Palette;
  private sail: boolean;

  // View: k is the zoom, (tx, ty) the offset in unzoomed map units on screen, as the zoom code has always used it).
  private k = 1;
  private tx = 0;
  private ty = 0;
  /** CSS pixels per map unit at the whole-world view. */
  private s0 = 1;
  /** Size of names (1 = their design size). */
  private ui = 1;
  /** Size of port dots and ships. */
  private dot = 1;
  private cssW = W;
  private cssH = H;

  // Scene.
  private worldLayer = new Container();
  private overlay = new Container();
  private view = VIEW_UNIFORMS();
  private progLine!: GlProgram;
  private progFill!: GlProgram;
  private sea: Mesh<Geometry, Shader> | null = null;
  private seaU!: UniformGroup;
  private distTex: Texture | null = null;
  private wavesTex: Texture | null = null;
  private landCoarse: FillLayer | null = null;
  private landDetail: FillLayer | null = null;
  private coastCoarse: LineLayer | null = null;
  private coastDetail: LineLayer | null = null;
  private graticule: LineLayer | null = null;
  private lanes: LineLayer | null = null;
  private canals: LineLayer | null = null;
  private closedLanes: LineLayer | null = null;
  private rim: LineLayer | null = null;
  private night: FillLayer | null = null;
  private fogSprite: Sprite | null = null;
  private weatherLayer = new Container();
  private sphereMask: Graphics | null = null;
  private routeGlow: LineLayer | null = null;
  private routePrimary: LineLayer | null = null;
  private routeSecondary: LineLayer | null = null;
  private wakes: LineLayer | null = null;
  private fogTextLayer = new Container();
  private portLayer = new Container();
  private tagLayer = new Container();
  private shipLayer = new Container();
  private effectLayer = new Container();

  // Geometry kept for rebuilding.
  private sphere!: Shapes;
  private sphereSign = 1;
  private sphereBox!: [[number, number], [number, number]];
  private landBox!: [[number, number], [number, number]];
  private coarseLand: Shapes;
  private detailWanted = false;
  /** 0: coarse coastline, 1: detailed (cross-faded by zoom once the detail is loaded). */
  private detailMix = 0;
  private laneData: { a: string; b: string; pts: number[]; canal?: string; uncharted: boolean; closed: boolean }[] = [];

  // Game state handed in.
  private ports: PortView[] = [];
  private portById: Record<string, PortView> = {};
  private markers: PortMarker[] = [];
  private charted: Set<string> | null = null;
  private chartKey = '';
  private closed: string[] = [];
  private routes: { primary: string[][]; secondary: string[][] } = { primary: [], secondary: [] };
  private shipMarkers: ShipMarker[] = [];
  private shipViews = new Map<number, ShipView>();
  private cells: WeatherCell[] = [];
  private clouds = new Map<string, CloudView>();
  private cloudTex = new Map<string, Texture>();
  private sun: LonLat | null = null;
  private sunDrawn: LonLat | null = null;
  private fogTexts: { lon: number; lat: number; text: string; size: number; obj: Text | null; hidden: boolean }[] = [];
  private effects: Effect[] = [];

  // Frame loop.
  private dirty = true;
  private labelsDirty = true;
  private lastFrame = 0;
  private lastPaint = 0;
  private hover: string | null = null;
  private focusPort: string | null = null;
  private inertia: { vx: number; vy: number; t: number } | null = null;
  private glide: { k0: number; k1: number; mx: number; my: number; x: number; y: number; t0: number; dur: number } | null = null;
  private suppressTap = false;
  private a11y: HTMLDivElement;
  // The globe (optional 3D view): its scene, lines, view and gestures.
  private globeMode = false;
  private gv: GlobeView = { lon: 60, lat: 20, zoom: 1 };
  private globe: GlobeScene | null = null;
  private gCoastCoarse: GlobeLines | null = null;
  private gCoastDetail: GlobeLines | null = null;
  private gGrat: GlobeLines | null = null;
  private gLanes: GlobeLines | null = null;
  private gCanals: GlobeLines | null = null;
  private gClosed: GlobeLines | null = null;
  private gRouteSec: GlobeLines | null = null;
  private gRouteGlow: GlobeLines | null = null;
  private gRoutePrim: GlobeLines | null = null;
  private gWakes: GlobeLines | null = null;
  private landMaskTex: Texture | null = null;
  private glide3: { from: GlobeView; to: GlobeView; t0: number; dur: number } | null = null;
  private spin: { vx: number; vy: number } | null = null;
  /** Clouds on the globe: the same sprites, moved here (screen pixels) while the globe shows. */
  private globeClouds = new Container();
  private globeBtn: HTMLButtonElement | null = null;
  private nudges: { x: number; y: number; nx: number; ny: number; d0: number }[] = [];
  /** The push towards a pushed port dot for a point near it (for line geometry). */
  private nudger: Nudger = (x, y) => {
    let best: [number, number, number] = [0, 0, 1], bestD = NUDGE_REACH;
    for (const n of this.nudges) {
      const d = Math.hypot(x - n.x, y - n.y);
      if (d >= bestD) continue;
      const u = 1 - d / NUDGE_REACH, w = u * u * (3 - 2 * u);
      best = [n.nx * w, n.ny * w, n.d0]; bestD = d;
    }
    return best;
  };
  /** Where a point of the map (map units) is drawn at the current zoom, after the push near crowded ports. */
  private disp(x: number, y: number): [number, number] {
    const [nx, ny, d0] = this.nudger(x, y);
    const f = nx || ny ? nudgeShare(d0, this.k) : 0;
    return [x + nx * f, y + ny * f];
  }
  private portXY(p: { x: number; y: number }): [number, number] { return this.disp(p.x, p.y); }
  private tools: HTMLDivElement | null = null;

  constructor(
    container: HTMLElement,
    private world: World,
    private onPortClick: (id: string) => void,
    private onPortHover: (id: string | null) => void,
    private onShipClick: (id: number) => void = () => {},
  ) {
    this.sail = !!world.era.wind;
    this.stack = document.createElement('div');
    this.stack.className = 'map-stack gl';
    container.appendChild(this.stack);
    this.a11y = document.createElement('div');
    this.a11y.className = 'map-a11y';

    this.projection = geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], {
      type: 'MultiPoint',
      coordinates: [[-180, -50], [180, 66], [0, -50], [0, 66], [-180, 0], [180, 0]],
    });
    this.path = geoPath(this.projection);
    this.sphere = project(this.projection, { type: 'Sphere' });
    this.sphereSign = Math.sign(area(this.sphere.polygons[0]?.[0] ?? [0, 0, 1, 0, 0, 1]));
    this.sphereBox = this.path.bounds({ type: 'Sphere' });
    const topo = landTopo as unknown as Topology;
    const land = feature(topo, topo.objects.land);
    this.coarseLand = project(this.projection, land);
    this.landBox = this.path.bounds(land);
    for (const e of world.edges) {
      const ln = project(this.projection, this.line([e.a, e.b]));
      this.laneData.push({ a: e.a, b: e.b, pts: ln.lines.flat(), canal: e.canal, uncharted: false, closed: false });
    }

    // Ports a few miles apart (Canton and Macau, Bantam and Batavia) would sit on one dot:
    // nudge such dots apart on the chart, a few map units at most.
    const at: Record<string, [number, number]> = {};
    for (const p of [...world.portList, ...world.siteList.filter((x) => !world.portList.includes(x))]) at[p.id] = this.projection([p.lon, p.lat])! as [number, number];
    const truePos: Record<string, [number, number]> = {};
    for (const p of [...world.portList, ...world.siteList.filter((x) => !world.portList.includes(x))]) truePos[p.id] = [...at[p.id]] as [number, number];
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < world.portList.length; i++) for (let j = i + 1; j < world.portList.length; j++) {
        const a = at[world.portList[i].id], b = at[world.portList[j].id];
        let dx = b[0] - a[0], dy = b[1] - a[1];
        let d = Math.hypot(dx, dy);
        if (d >= MIN_GAP) continue;
        if (d < 0.01) { dx = 1; dy = 0; d = 1; }
        const push = (MIN_GAP - d) / 2;
        a[0] -= (dx / d) * push; a[1] -= (dy / d) * push;
        b[0] += (dx / d) * push; b[1] += (dy / d) * push;
      }
    }
    // Remember each push (and the true gap it closes), to apply it at any zoom.
    for (const p of world.portList) {
      const [tx, ty] = truePos[p.id];
      const nx = at[p.id][0] - tx, ny = at[p.id][1] - ty;
      if (Math.hypot(nx, ny) < 0.01) continue;
      let d0 = Infinity;
      for (const q of world.portList) if (q !== p) d0 = Math.min(d0, Math.hypot(truePos[q.id][0] - tx, truePos[q.id][1] - ty));
      this.nudges.push({ x: tx, y: ty, nx, ny, d0: Math.min(d0, MIN_GAP * 0.9) });
    }
    for (const p of [...world.portList, ...world.siteList.filter((x) => !world.portList.includes(x))]) {
      // Keyboard and screen readers: an invisible button over every port (the map itself is one canvas).
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-port-btn';
      button.setAttribute('aria-label', p.name);
      button.addEventListener('click', () => this.onPortClick(p.id));
      button.addEventListener('focus', () => { this.focusPort = p.id; this.dirty = true; });
      button.addEventListener('blur', () => { if (this.focusPort === p.id) this.focusPort = null; this.dirty = true; });
      this.a11y.appendChild(button);
      const tag = new Container();
      const view: PortView = {
        id: p.id, name: p.name, x: truePos[p.id][0], y: truePos[p.id][1], lon: p.lon, lat: p.lat, dataSpot: (p.label ?? 'right') as LabelKey,
        g: new Graphics(), label: new Text({ text: p.name }), note: new Text({ text: '' }), tag,
        marker: null, rumour: false, night: false, styleKey: '', spot: (p.label ?? 'right') as LabelKey,
        wantSpot: (p.label ?? 'right') as LabelKey, showNote: true, wantNote: true, hidden: !!p.site, leader: false, wantLeader: false, leaderG: new Graphics(), leaderKey: '', visible: false, alpha: 0, button,
      };
      tag.addChild(view.leaderG, view.label, view.note);
      tag.alpha = 0;
      this.ports.push(view);
      this.portById[p.id] = view;
    }

    // Names on the unknown water: the house's own, or those a Dutch chartmaker would write.
    const fogNames = world.era.charts?.names ?? [[-150, 5, 'Mare Incognitum', 22], [-120, -30, 'Mare del Sur', 18], [-140, 40, 'Here be dragons', 15],
      [50, -8, 'Zanguebar', 14], [140, -58, 'Terra Australis Incognita', 16], [175, 20, 'Mare Pacificum', 16]];
    for (const [lon, lat, text, size] of fogNames) {
      this.fogTexts.push({ lon, lat, text, size, obj: null, hidden: true });
    }

    this.setupInput();
    // For browser checks (Playwright scripts read the view and time frames through it).
    (window as unknown as { __map: unknown }).__map = this;
    void this.init();
  }

  // ------------------------------------------------------------ set-up

  private async init(): Promise<void> {
    const app = new Application();
    try {
      await app.init({
        width: Math.max(1, this.stack.clientWidth),
        height: Math.max(1, this.stack.clientHeight),
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
        preference: 'webgl',
        autoStart: false,
        sharedTicker: false,
      });
    } catch (err) {
      this.failed = true;
      console.error('WebGL map failed to start', err);
      const note = document.createElement('p');
      note.className = 'map-failed';
      note.textContent = 'This browser can’t draw the map (WebGL is switched off or not available).';
      this.stack.appendChild(note);
      return;
    }
    this.app = app;
    const canvas = app.canvas as HTMLCanvasElement;
    canvas.className = 'map map-gl';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'World map');
    this.stack.appendChild(canvas);
    this.stack.appendChild(this.a11y);
    this.attachCanvasInput(canvas);
    canvas.addEventListener('webglcontextlost', (ev) => ev.preventDefault());

    this.progLine = program('map-line', LINE_VERT, LINE_FRAG);
    this.progFill = program('map-fill', FILL_VERT, FILL_FRAG);
    this.pal = readPalette();
    this.buildScene();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.stack);
    // Colours follow light and dark mode.
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.restyle());
    // Once the web fonts are in, names have their final shapes.
    document.fonts?.ready.then(() => { this.restyleTexts(); this.labelsDirty = true; this.dirty = true; });
    // The detailed coastline loads in the background; it fades in when zoomed in.
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    const later = () => this.loadDetail();
    if (idle) idle(later, { timeout: 2500 }); else setTimeout(later, 1500);
    const loop = (now: number) => { this.frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  private buildScene(): void {
    const app = this.app!;
    const pal = this.pal;
    const stage = app.stage;
    stage.addChild(this.worldLayer, this.overlay);

    // The sea: radial gradient, wave marks and shallows in one shader.
    this.wavesTex = this.makeWavesTexture();
    this.distTex = this.makeDistTexture(this.coarseLand);
    const [[sx0, sy0], [sx1, sy1]] = this.sphereBox;
    const sw = sx1 - sx0, sh = sy1 - sy0;
    this.seaU = new UniformGroup({
      uSea1: { value: new Float32Array(4), type: 'vec4<f32>' },
      uSea2: { value: new Float32Array(4), type: 'vec4<f32>' },
      uGrad: { value: new Float32Array([sx0 + sw * 0.5, sy0 + sh * 0.45, (Math.hypot(sw, sh) * 0.75) / Math.SQRT2, 0]), type: 'vec4<f32>' },
      uWave: { value: new Float32Array(4), type: 'vec4<f32>' },
      uShallow: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const seaProg = program('map-sea', FILL_VERT, SEA_FRAG);
    this.sea = new Mesh({
      geometry: fillGeometry(triangulate(this.sphere.polygons, this.sphereSign)),
      shader: new Shader({ glProgram: seaProg, resources: { view: this.view, sea: this.seaU, uDist: this.distTex.source, uWaves: this.wavesTex.source } }),
    });
    this.worldLayer.addChild(this.sea);

    this.graticule = new LineLayer(this.view, this.progLine, lineGeometry(project(this.projection, geoGraticule10()).lines.map((pts) => ({ pts }))), this.graticuleStyle());
    this.worldLayer.addChild(this.graticule.mesh);

    const [[, ly0], [, ly1]] = this.landBox;
    this.landCoarse = new FillLayer(this.progFill, fillGeometry(triangulate(this.coarseLand.polygons, this.sphereSign)), pal.landHi, pal.land, ly0, ly1);
    this.coastCoarse = new LineLayer(this.view, this.progLine, this.coastGeometry(this.coarseLand), this.coastStyle());
    this.worldLayer.addChild(this.landCoarse.mesh, this.coastCoarse.mesh);

    const empty = () => lineGeometry([]);
    this.lanes = new LineLayer(this.view, this.progLine, empty(), this.laneStyle('lane'));
    this.canals = new LineLayer(this.view, this.progLine, empty(), this.laneStyle('canal'));
    this.closedLanes = new LineLayer(this.view, this.progLine, empty(), this.laneStyle('closed'));
    this.rim = new LineLayer(this.view, this.progLine, lineGeometry(this.sphere.polygons.flat().map((pts) => ({ pts, closed: true }))), { width: 1, color: pal.line, alpha: 1 });
    this.worldLayer.addChild(this.lanes.mesh, this.canals.mesh, this.closedLanes.mesh, this.rim.mesh);
    this.rebuildLanes();

    // Fog of war, night, weather.
    this.fogSprite = new Sprite(Texture.EMPTY);
    this.fogSprite.visible = false;
    this.fogSprite.width = W; this.fogSprite.height = H;
    this.night = new FillLayer(this.progFill, fillGeometry({ pos: new Float32Array(0), idx: new Uint32Array(0) }), pal.night, pal.night, 0, 1);
    this.night.mesh.visible = false;
    this.sphereMask = new Graphics();
    for (const ring of this.sphere.polygons.flat()) this.sphereMask.poly(ring).fill(0xffffff);
    this.weatherLayer.mask = this.sphereMask;
    this.worldLayer.addChild(this.fogSprite, this.night.mesh, this.sphereMask, this.weatherLayer);

    // Routes and wakes.
    this.routeSecondary = new LineLayer(this.view, this.progLine, empty(), { width: 1.4, color: pal.text, alpha: 0.45, dash: [3, 4] });
    this.routeGlow = new LineLayer(this.view, this.progLine, empty(), { width: 7, color: pal.accent, alpha: 0.18 });
    this.routePrimary = new LineLayer(this.view, this.progLine, empty(), { width: 2.2, color: pal.accent, alpha: 1, dash: [6, 5] });
    this.wakes = new LineLayer(this.view, this.progLine, empty(), { width: 1.6, color: probe('#e8f4ff'), alpha: 0.45, dash: [2, 3] });
    this.worldLayer.addChild(this.routeSecondary.mesh, this.routeGlow.mesh, this.routePrimary.mesh, this.wakes.mesh);

    // Screen-sized things on top: fog names, ports, names, ships, effects.
    this.overlay.addChild(this.fogTextLayer, this.portLayer, this.tagLayer, this.shipLayer, this.effectLayer);
    for (const p of this.ports) { this.portLayer.addChild(p.g); this.tagLayer.addChild(p.tag); }
    this.buildGlobe();
    this.ready = true;
    this.restyleTexts();
    this.applyColors();
    // Anything handed in before WebGL was ready.
    this.applyCharted();
    this.applyRoutes();
    if (this.markers.length) this.updatePorts(this.markers);
    if (this.sun) this.setSun(this.sun);
    this.updateWeather(this.cells);
    this.updateShips(this.shipMarkers);
  }

  /** The globe's scene: the sphere and its lines, behind the overlay; shown when the globe is chosen. */
  private buildGlobe(): void {
    try {
      this.landMaskTex = this.makeLandMask(this.coarseLand);
      this.globe = new GlobeScene(W, H, { dist: this.distTex!, waves: this.wavesTex!, land: this.landMaskTex, fog: Texture.WHITE });
    } catch (err) {
      console.error('The globe could not be built', err);
      this.globe = null;
      return;
    }
    const g = this.globe, prog = g.lineProg, empty = () => lineGeometry3([]);
    const topo = landTopo as unknown as Topology;
    this.gGrat = new GlobeLines(g.u, prog, lineGeometry3((geoGraticule10().coordinates as number[][][]).map((l) => ({ pts: l.flat() }))), this.graticuleStyle());
    this.gCoastCoarse = new GlobeLines(g.u, prog, lineGeometry3(coastLines(feature(topo, topo.objects.land))), this.coastStyle());
    this.gLanes = new GlobeLines(g.u, prog, empty(), this.laneStyle('lane'));
    this.gCanals = new GlobeLines(g.u, prog, empty(), this.laneStyle('canal'));
    this.gClosed = new GlobeLines(g.u, prog, empty(), this.laneStyle('closed'));
    const pal = this.pal;
    this.gRouteSec = new GlobeLines(g.u, prog, empty(), { width: 1.4, color: pal.text, alpha: 0.45, dash: [3, 4] });
    this.gRouteGlow = new GlobeLines(g.u, prog, empty(), { width: 7, color: pal.accent, alpha: 0.18 });
    this.gRoutePrim = new GlobeLines(g.u, prog, empty(), { width: 2.2, color: pal.accent, alpha: 1, dash: [6, 5] });
    this.gWakes = new GlobeLines(g.u, prog, empty(), { width: 1.6, color: probe('#e8f4ff'), alpha: 0.45, dash: [2, 3] });
    g.root.addChild(this.gGrat.mesh, this.gCoastCoarse.mesh, this.gLanes.mesh, this.gCanals.mesh, this.gClosed.mesh,
      this.gRouteSec.mesh, this.gRouteGlow.mesh, this.gRoutePrim.mesh, this.gWakes.mesh);
    g.root.visible = false;
    this.app!.stage.addChildAt(g.root, this.app!.stage.getChildIndex(this.overlay));
    this.app!.stage.addChildAt(this.globeClouds, this.app!.stage.getChildIndex(this.overlay));
    if (this.globeBtn) this.globeBtn.hidden = false;
    let saved: string | null = null;
    try { saved = localStorage.getItem('deadweight.mapMode'); } catch { /* private mode */ }
    if (saved === 'globe') queueMicrotask(() => this.setGlobe(true));
  }

  /** Where there is land, at twice the shallows' resolution (the globe draws land from it). */
  private makeLandMask(land: Shapes): Texture {
    const w = TEX_W * 2, h = TEX_H * 2;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d')!;
    c.setTransform(w / W, 0, 0, h / H, 0, 0);
    c.fillStyle = '#fff';
    const p = new Path2D();
    for (const ring of land.polygons.flat()) {
      p.moveTo(ring[0], ring[1]);
      for (let i = 2; i < ring.length; i += 2) p.lineTo(ring[i], ring[i + 1]);
      p.closePath();
    }
    c.fill(p);
    return Texture.from(cv);
  }

  /** The globe's colours and fixed numbers, from the palette and the flat map's sea. */
  private applyGlobeColors(): void {
    if (!this.globe) return;
    const pal = this.pal;
    const [[, ly0], [, ly1]] = this.landBox;
    const grad = this.seaU.uniforms.uGrad as Float32Array;
    const t = this.projection.translate();
    this.globe.setSphere({
      uProj: [this.projection.scale(), t[0], t[1], 0],
      uSea1: pal.ocean1, uSea2: pal.ocean2, uGrad: [...grad],
      uLandHi: pal.landHi, uLand: pal.land, uLandY: [ly0, ly1, 0, 0],
      uShallow: [pal.shallow[0], pal.shallow[1], pal.shallow[2], 1],
      uWave: [pal.text[0], pal.text[1], pal.text[2], 0.09],
      uNight: [pal.night[0], pal.night[1], pal.night[2], pal.nightAlpha],
      uRim: [pal.line[0], pal.line[1], pal.line[2], 1],
      uGlow: [pal.shallow[0], pal.shallow[1], pal.shallow[2], 0.55],
      uFogOn: [this.charted ? 1 : 0, 0, 0, 0],
      uSun: this.sunVec(),
    });
    this.gGrat?.style(this.graticuleStyle());
    this.gCoastCoarse?.style(this.coastStyle());
    this.gCoastDetail?.style(this.coastStyle());
    this.gLanes?.style(this.laneStyle('lane'));
    this.gCanals?.style(this.laneStyle('canal'));
    this.gClosed?.style(this.laneStyle('closed'));
    this.gRouteSec?.style({ width: 1.4, color: pal.text, alpha: 0.45, dash: [3, 4] });
    this.gRouteGlow?.style({ width: 7, color: pal.accent, alpha: 0.18 });
    this.gRoutePrim?.style({ width: 2.2, color: pal.accent, alpha: 1, dash: [6, 5] });
  }

  private graticuleStyle(): LineStyle {
    return { width: 0.6, color: this.pal.text, alpha: this.sail ? 0.12 : 0.05, dash: this.sail ? [1, 2] : undefined };
  }

  private coastStyle(): LineStyle {
    return { width: this.sail ? 0.9 : 0.6, color: this.pal.landEdge, alpha: 1 };
  }

  private laneStyle(kind: 'lane' | 'canal' | 'closed'): LineStyle {
    const pal = this.pal;
    if (kind === 'canal') return { width: 1.6, color: pal.accent2, alpha: 0.7 };
    if (kind === 'closed') return { width: 2.2, color: pal.bad, alpha: 1, dash: [3, 3] };
    return { width: 0.8, color: pal.accent, alpha: this.sail ? 0.22 : 0.14, dash: [2, 3] };
  }

  private coastGeometry(s: Shapes): Geometry {
    // The coast follows the land's rings, but not where the projection cut them at the edge of the world.
    const lines: { pts: number[]; closed?: boolean }[] = [];
    const edge = (x: number, y: number) => {
      const [[x0, y0], [x1, y1]] = this.sphereBox;
      return x < x0 + 0.6 || x > x1 - 0.6 || y < y0 + 0.6 || y > y1 - 0.6 || !inside(x, y, this.sphereShrunk());
    };
    for (const ring of s.polygons.flat()) {
      let cur: number[] = [];
      let cut = false;
      const n = ring.length / 2;
      for (let i = 0; i <= n; i++) {
        const x = ring[(i % n) * 2], y = ring[(i % n) * 2 + 1];
        if (edge(x, y)) {
          cut = true;
          if (cur.length >= 4) lines.push({ pts: cur });
          cur = [];
        } else cur.push(x, y);
      }
      if (!cut) lines.push({ pts: ring, closed: true });
      else if (cur.length >= 4) lines.push({ pts: cur });
    }
    return lineGeometry(lines);
  }

  private shrunk: number[] | null = null;
  /** The world's outline pulled in by half a unit, to tell cut edges from real coast. */
  private sphereShrunk(): number[] {
    if (this.shrunk) return this.shrunk;
    const ring = this.sphere.polygons[0][0];
    const [[x0, y0], [x1, y1]] = this.sphereBox;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.shrunk = ring.map((v, i) => {
      const c = i % 2 ? cy : cx;
      const half = i % 2 ? (y1 - y0) / 2 : (x1 - x0) / 2;
      return c + (v - c) * (1 - 0.6 / half);
    });
    return this.shrunk;
  }

  /** The tile of wave marks (white, drawn into the alpha channel). */
  private makeWavesTexture(): Texture {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const c = cv.getContext('2d')!;
    c.scale(256 / 46, 128 / 22);
    c.strokeStyle = '#fff'; c.lineWidth = 1; c.lineCap = 'round';
    c.stroke(new Path2D('M2 8 q5 -4 10 0 t10 0'));
    c.stroke(new Path2D('M25 18 q5 -4 10 0 t10 0'));
    const tex = Texture.from(cv);
    tex.source.style.addressMode = 'repeat';
    tex.source.style.update();
    return tex;
  }

  /** Distance from every point of the sea to the nearest land, as a texture (red channel). */
  private makeDistTexture(land: Shapes): Texture {
    const cv = document.createElement('canvas');
    cv.width = TEX_W; cv.height = TEX_H;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    const sc = TEX_W / W;
    c.setTransform(sc, 0, 0, TEX_H / H, 0, 0);
    c.fillStyle = '#fff';
    const p = new Path2D();
    for (const ring of land.polygons.flat()) {
      p.moveTo(ring[0], ring[1]);
      for (let i = 2; i < ring.length; i += 2) p.lineTo(ring[i], ring[i + 1]);
      p.closePath();
    }
    c.fill(p);
    const img = c.getImageData(0, 0, TEX_W, TEX_H);
    const d = edt(img.data, TEX_W, TEX_H);
    const perUnit = 255 / (DIST_MAX * sc);
    for (let i = 0, n = TEX_W * TEX_H; i < n; i++) {
      const v = Math.min(255, Math.round(d[i] * perUnit));
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.putImageData(img, 0, 0);
    return Texture.from(cv);
  }

  /** Load the detailed coastline and build its meshes, then let the zoom fade it in. */
  private loadDetail(): void {
    if (this.detailWanted) return;
    this.detailWanted = true;
    void import('world-atlas/land-50m.json').then((mod) => {
      const topo = (mod.default ?? mod) as unknown as Topology;
      const land = project(this.projection, feature(topo, topo.objects.land));
      const [[, ly0], [, ly1]] = this.landBox;
      this.landDetail = new FillLayer(this.progFill, fillGeometry(triangulate(land.polygons, this.sphereSign)), this.pal.landHi, this.pal.land, ly0, ly1);
      this.coastDetail = new LineLayer(this.view, this.progLine, this.coastGeometry(land), this.coastStyle());
      this.landDetail.mesh.alpha = 0;
      this.coastDetail.mesh.alpha = 0;
      const i = this.worldLayer.getChildIndex(this.coastCoarse!.mesh) + 1;
      this.worldLayer.addChildAt(this.landDetail.mesh, i);
      this.worldLayer.addChildAt(this.coastDetail.mesh, i + 1);
      // The globe's detailed coast and land.
      if (this.globe && this.gCoastCoarse) {
        this.gCoastDetail = new GlobeLines(this.globe.u, this.globe.lineProg, lineGeometry3(coastLines(feature(topo, topo.objects.land))), this.coastStyle());
        this.gCoastDetail.mesh.alpha = 0;
        this.globe.root.addChildAt(this.gCoastDetail.mesh, this.globe.root.getChildIndex(this.gCoastCoarse.mesh) + 1);
        const oldMask = this.landMaskTex;
        this.landMaskTex = this.makeLandMask(land);
        this.globe.setTexture('land', this.landMaskTex);
        oldMask?.destroy(true);
      }
      // The shallows follow the detailed coast too.
      setTimeout(() => {
        const old = this.distTex;
        this.distTex = this.makeDistTexture(land);
        this.sea!.shader!.resources.uDist = this.distTex.source;
        this.globe?.setTexture('dist', this.distTex);
        old?.destroy(true);
        this.dirty = true;
      }, 50);
      this.dirty = true;
    });
  }

  private applyColors(): void {
    const pal = this.pal;
    const u = this.seaU.uniforms;
    (u.uSea1 as Float32Array).set(pal.ocean1);
    (u.uSea2 as Float32Array).set(pal.ocean2);
    (u.uWave as Float32Array).set([pal.text[0], pal.text[1], pal.text[2], 0.09]);
    (u.uShallow as Float32Array).set([pal.shallow[0], pal.shallow[1], pal.shallow[2], 1]);
    this.seaU.update();
    const [[, ly0], [, ly1]] = this.landBox;
    this.landCoarse?.colors(pal.landHi, pal.land, ly0, ly1);
    this.landDetail?.colors(pal.landHi, pal.land, ly0, ly1);
    this.coastCoarse?.style(this.coastStyle());
    this.coastDetail?.style(this.coastStyle());
    this.graticule?.style(this.graticuleStyle());
    this.lanes?.style(this.laneStyle('lane'));
    this.canals?.style(this.laneStyle('canal'));
    this.closedLanes?.style(this.laneStyle('closed'));
    this.rim?.style({ width: 1, color: pal.line, alpha: 1 });
    this.night?.colors([...pal.night.slice(0, 3), pal.nightAlpha] as RGBA, [...pal.night.slice(0, 3), pal.nightAlpha] as RGBA, 0, 1);
    this.routeSecondary?.style({ width: 1.4, color: pal.text, alpha: 0.45, dash: [3, 4] });
    this.routeGlow?.style({ width: 7, color: pal.accent, alpha: 0.18 });
    this.routePrimary?.style({ width: 2.2, color: pal.accent, alpha: 1, dash: [6, 5] });
    this.applyGlobeColors();
  }

  private restyle(): void {
    if (!this.ready) return;
    this.pal = readPalette();
    this.applyColors();
    this.restyleTexts();
    for (const p of this.ports) p.styleKey = '';
    for (const s of this.shipViews.values()) s.key = '';
    this.chartKey = '';
    this.applyCharted();
    this.updateShips(this.shipMarkers);
    this.dirty = true;
  }

  /** Text styles for names, notes and fog names, at the current size. */
  private restyleTexts(): void {
    if (!this.ready) return;
    const pal = this.pal;
    const ui = this.ui;
    const family = this.sail ? '"EB Garamond", Georgia, serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const stroke = { color: hexOf(pal.halo), alpha: pal.halo[3], width: 3 * ui, join: 'round' as const };
    for (const p of this.ports) {
      p.label.style = new TextStyle({
        fontFamily: family, fontSize: (this.sail ? 11 : 12) * ui, fontWeight: '600', fill: hexOf(pal.text),
        fontStyle: p.rumour ? 'italic' : 'normal', letterSpacing: this.sail ? -0.1 : 0, stroke,
      });
      p.note.style = new TextStyle({
        fontFamily: family, fontSize: 9.5 * ui, fill: hexOf(pal.muted), fontStyle: p.rumour ? 'italic' : 'normal', stroke,
      });
      p.label.alpha = p.rumour ? 0.8 : 1;
      // Re-render with the (possibly new) font.
      const t = p.label.text; p.label.text = ''; p.label.text = t;
      const n = p.note.text; p.note.text = ''; p.note.text = n;
    }
    for (const f of this.fogTexts) {
      if (!f.obj) { f.obj = new Text({ text: f.text }); f.obj.anchor.set(0.5, 0.75); this.fogTextLayer.addChild(f.obj); }
      f.obj.style = new TextStyle({ fontFamily: '"IM Fell English", Georgia, serif', fontStyle: 'italic', fontSize: f.size * this.s0 * 1, fill: hexOf(pal.fogInk) });
      f.obj.alpha = 0.85;
      const t = f.obj.text; f.obj.text = ''; f.obj.text = t;
    }
    this.labelsDirty = true;
  }

  private resize(): void {
    if (!this.app) return;
    const w = this.stack.clientWidth, h = this.stack.clientHeight;
    if (w < 2 || h < 2) return;
    this.cssW = w; this.cssH = h;
    this.app.renderer.resize(w, h);
    this.s0 = w / W;
    // Ports, names and ships: their design size on a big screen, a little smaller on a phone,
    // never so small they can't be read (the names make way for each other instead).
    const ui = Math.max(0.8, Math.min(1.15, this.s0));
    const dot = Math.max(0.62, Math.min(1.15, this.s0));
    if (Math.abs(ui - this.ui) > 0.01 || Math.abs(dot - this.dot) > 0.01) {
      this.ui = ui; this.dot = dot;
      this.restyleTexts();
      for (const p of this.ports) p.styleKey = '';
      for (const s of this.shipViews.values()) s.key = '';
      this.updateShips(this.shipMarkers);
    }
    this.labelsDirty = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------ input and zoom

  /** Map point under a pointer, in unzoomed screen units, before zoom. */
  private toUnits(clientX: number, clientY: number): [number, number] {
    const r = this.stack.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * W, ((clientY - r.top) / r.height) * H];
  }

  private setupInput(): void {
    const tools = document.createElement('div');
    tools.className = 'map-zoom';
    this.tools = tools;
    tools.innerHTML = `<button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="world" aria-label="Whole world">World</button><button type="button" data-z="globe" aria-label="Show the globe" hidden>Globe</button>`;
    this.globeBtn = tools.querySelector<HTMLButtonElement>('[data-z="globe"]');
    tools.addEventListener('click', (ev) => {
      const z = (ev.target as HTMLElement).closest<HTMLElement>('[data-z]')?.dataset.z;
      if (z === 'globe') { this.setGlobe(!this.globeMode); return; }
      if (this.globeMode) {
        if (z === 'in') this.glideGlobe({ ...this.gv, zoom: this.gv.zoom * 2 });
        else if (z === 'out') this.glideGlobe({ ...this.gv, zoom: this.gv.zoom / 2 });
        else if (z === 'world') this.glideGlobe({ ...this.gv, zoom: 1 });
        return;
      }
      if (z === 'in') this.glideZoom(W / 2, H / 2, 2);
      else if (z === 'out') this.glideZoom(W / 2, H / 2, 0.5);
      else if (z === 'world') this.glideZoom(0, 0, 1 / this.k);
    });
    this.stack.appendChild(tools);
  }

  private attachCanvasInput(cv: HTMLCanvasElement): void {
    cv.style.touchAction = 'none';
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.glide = null; this.inertia = null; this.glide3 = null; this.spin = null;
      const factor = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0018));
      if (this.globeMode) { this.zoomGlobe(factor); return; }
      const [x, y] = this.toUnits(ev.clientX, ev.clientY);
      this.zoomAt(x, y, factor);
    }, { passive: false });
    cv.addEventListener('gesturestart', (ev) => ev.preventDefault()); // Safari: no page zoom over the map
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch: { d: number; mx: number; my: number } | null = null;
    let lastTap = { t: 0, x: 0, y: 0 };
    let track: { t: number; x: number; y: number }[] = [];
    cv.addEventListener('pointerdown', (ev) => {
      cv.setPointerCapture?.(ev.pointerId);
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this.glide = null; this.inertia = null; this.glide3 = null; this.spin = null;
      if (pts.size === 1) { moved = 0; track = [{ t: ev.timeStamp, x: ev.clientX, y: ev.clientY }]; }
      if (pts.size === 2) pinch = null;
    });
    cv.addEventListener('pointermove', (ev) => {
      const prev = pts.get(ev.pointerId);
      if (!prev) {
        if (ev.pointerType === 'mouse') this.hoverAt(ev.clientX, ev.clientY);
        return;
      }
      const now = { x: ev.clientX, y: ev.clientY };
      const u = W / this.cssW; // unzoomed units per CSS pixel
      if (pts.size === 1) {
        moved += Math.hypot(now.x - prev.x, now.y - prev.y);
        if (moved > 6 && this.globeMode) this.rotateBy(now.x - prev.x, now.y - prev.y);
        else if (moved > 6 && this.k > 1) this.panBy((now.x - prev.x) * u, (now.y - prev.y) * u);
        track.push({ t: ev.timeStamp, x: now.x, y: now.y });
        if (track.length > 8) track.shift();
      } else if (pts.size === 2) {
        moved = 99;
        pts.set(ev.pointerId, now);
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinch && this.globeMode) {
          this.rotateBy(mx - pinch.mx, my - pinch.my);
          this.zoomGlobe(d / pinch.d);
        } else if (pinch) {
          this.panBy((mx - pinch.mx) * u, (my - pinch.my) * u);
          const [x, y] = this.toUnits(mx, my);
          this.zoomAt(x, y, d / pinch.d);
        }
        pinch = { d, mx, my };
        track = [];
        return;
      }
      pts.set(ev.pointerId, now);
    });
    const up = (ev: PointerEvent) => {
      if (!pts.has(ev.pointerId)) return;
      pts.delete(ev.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) { track = []; return; }
      if (moved > 6) {
        this.suppressTap = true;
        setTimeout(() => { this.suppressTap = false; }, 350);
        // Let the map coast on after a flick.
        const last = track[track.length - 1];
        const first = track.find((p) => last && last.t - p.t < 90);
        if (last && first && last.t > first.t && ev.timeStamp - last.t < 60 && this.globeMode) {
          this.spin = { vx: (last.x - first.x) / (last.t - first.t), vy: (last.y - first.y) / (last.t - first.t) };
        } else if (last && first && last.t > first.t && ev.timeStamp - last.t < 60 && this.k > 1) {
          const u = W / this.cssW;
          this.inertia = { vx: ((last.x - first.x) / (last.t - first.t)) * u, vy: ((last.y - first.y) / (last.t - first.t)) * u, t: performance.now() };
        }
        return;
      }
      if (ev.type === 'pointercancel') return;
      // A tap: double-tap zooms in (touch), otherwise pick a ship or a port.
      if (ev.pointerType !== 'mouse' && ev.timeStamp - lastTap.t < 320 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 30) {
        if (this.globeMode) { this.globeZoomAt(ev.clientX, ev.clientY, 2); lastTap = { t: 0, x: 0, y: 0 }; return; }
        const [x, y] = this.toUnits(ev.clientX, ev.clientY);
        this.glideZoom(x, y, 2);
        lastTap = { t: 0, x: 0, y: 0 };
        return;
      }
      lastTap = { t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
      if (!this.suppressTap) this.tapAt(ev.clientX, ev.clientY);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !pts.size) this.setHover(null); });
    cv.addEventListener('dblclick', (ev) => {
      if (this.globeMode) { this.globeZoomAt(ev.clientX, ev.clientY, 2); return; }
      const [x, y] = this.toUnits(ev.clientX, ev.clientY);
      this.glideZoom(x, y, 2);
    });
  }

  /** Screen position (CSS pixels in the map box) of a point in map units. */
  private screenOf(x: number, y: number): [number, number] {
    return [(x * this.k + this.tx) * this.s0, (y * this.k + this.ty) * this.s0];
  }

  /** Where the globe sits in the map box, and its radius on screen. */
  private globeFrame(): { cx: number; cy: number; r: number } {
    return { cx: this.cssW / 2, cy: this.cssH / 2, r: Math.min(this.cssH, this.cssW) * 0.45 * this.gv.zoom };
  }

  /** Screen position of a point of the Earth in the current view, and whether it can be seen. */
  private lonlatScreen(at: LonLat): [number, number, boolean] {
    if (this.globeMode) {
      const { cx, cy, r } = this.globeFrame();
      const q = globePoint(this.gv, at[0], at[1], cx, cy, r);
      return [q.x, q.y, q.z > 0.03];
    }
    const xy = this.projection(at);
    if (!xy) return [-999, -999, false];
    const [x, y] = this.screenOf(...this.disp(xy[0], xy[1]));
    return [x, y, true];
  }

  /** How squarely a point faces us on the globe (1 in the middle, 0 at the rim); 1 on the flat map. */
  private facing(at: LonLat): number {
    if (!this.globeMode) return 1;
    const { cx, cy, r } = this.globeFrame();
    return globePoint(this.gv, at[0], at[1], cx, cy, r).z;
  }

  /** Screen position of a port's dot (pushed apart from close neighbours on the flat map). */
  private portScreen(p: PortView): [number, number, boolean] {
    if (this.globeMode) { const q = this.lonlatScreen([p.lon, p.lat]); return [q[0], q[1], q[2] && !p.hidden]; }
    const [x, y] = this.screenOf(...this.portXY(p));
    return [x, y, !p.hidden];
  }

  /** The sun as a unit vector for the globe's night (w: 1 when there's a sun to show). */
  private sunVec(): number[] {
    return this.sun ? [...toVec(this.sun[0], this.sun[1]), 1] : [0, 0, 1, 0];
  }

  // ------------------------------------------------------------ the globe

  /** Switch between the flat map and the globe, looking at the same place. */
  setGlobe(on: boolean): void {
    if (on === this.globeMode || !this.globe) return;
    this.glide = null; this.inertia = null; this.glide3 = null; this.spin = null;
    if (on) {
      // Face the middle of what the flat map shows, at about the same zoom; from the whole world,
      // face the selected ship (or home).
      const sel = this.shipMarkers.find((m) => m.selected)?.at ?? this.portPosition(this.world.era.start.port);
      const mid = this.k > 1.05 ? this.projection.invert?.([(W / 2 - this.tx) / this.k, (H / 2 - this.ty) / this.k]) : sel;
      if (mid) this.gv = { lon: mid[0], lat: Math.max(-60, Math.min(60, mid[1] * 0.8)), zoom: this.k };
    } else {
      const xy = this.projection([this.gv.lon, this.gv.lat]);
      this.k = Math.max(1, Math.min(MAX_ZOOM, this.gv.zoom));
      if (xy) { this.tx = W / 2 - xy[0] * this.k; this.ty = H / 2 - xy[1] * this.k; }
    }
    this.globeMode = on;
    // The clouds go with the view: on the globe they're placed on screen each frame.
    for (const c of this.clouds.values()) (on ? this.globeClouds : this.weatherLayer).addChild(c.sprite);
    if (!on) this.updateWeather(this.cells);
    try { localStorage.setItem('deadweight.mapMode', on ? 'globe' : 'map'); } catch { /* private mode */ }
    if (this.globeBtn) { this.globeBtn.textContent = on ? 'Map' : 'Globe'; this.globeBtn.setAttribute('aria-label', on ? 'Show the flat map' : 'Show the globe'); }
    this.clampView();
  }

  /** Turn the globe by a drag of (dx, dy) screen pixels. */
  private rotateBy(dx: number, dy: number): void {
    const { r } = this.globeFrame();
    const deg = 180 / Math.PI;
    this.gv.lon = ((this.gv.lon - (dx / r) * deg + 540) % 360) - 180;
    this.gv.lat = Math.max(-80, Math.min(80, this.gv.lat + (dy / r) * deg));
    this.dirty = true;
    this.labelsDirty = true;
  }

  private zoomGlobe(factor: number): void {
    this.gv.zoom = Math.max(1, Math.min(MAX_ZOOM, this.gv.zoom * factor));
    this.dirty = true;
    this.labelsDirty = true;
  }

  /** Glide the globe to face a point (lon, lat) at a zoom. */
  private glideGlobe(to: GlobeView): void {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.spin = null;
    this.glide3 = { from: { ...this.gv }, to: { ...to, zoom: Math.max(1, Math.min(MAX_ZOOM, to.zoom)) }, t0: performance.now(), dur: reduce ? 1 : 420 };
    this.dirty = true;
  }

  /** A double tap or double click on the globe: turn that point to the middle and zoom in. */
  private globeZoomAt(clientX: number, clientY: number, factor: number): void {
    const b = this.stack.getBoundingClientRect();
    const { cx, cy, r } = this.globeFrame();
    const at = globeInvert(this.gv, clientX - b.left, clientY - b.top, cx, cy, r);
    this.glideGlobe(at ? { lon: at[0], lat: Math.max(-80, Math.min(80, at[1])), zoom: this.gv.zoom * factor } : { ...this.gv, zoom: this.gv.zoom * factor });
  }

  private hit(clientX: number, clientY: number): { ship?: number; port?: string } {
    const r = this.stack.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    let best: { d: number; ship?: number; port?: string } = { d: Infinity };
    for (const s of this.shipViews.values()) {
      const rad = Math.max(12, s.marker.icon.length * 0.7) * this.dot + 4;
      const d = Math.hypot(s.root.x - x, s.root.y - y);
      if (d < rad && d < best.d) best = { d, ship: s.marker.id };
    }
    if (best.ship !== undefined) return best;
    for (const p of this.ports) {
      const [px, py, vis] = this.portScreen(p);
      if (!vis) continue;
      const d = Math.hypot(px - x, py - y);
      if (d < 14 * this.dot + 4 && d < best.d) best = { d, port: p.id };
    }
    // A name counts as its port too.
    if (!best.port) {
      for (const p of this.ports) {
        if (p.alpha < 0.5) continue;
        const b = p.tag.getBounds();
        if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return { port: p.id };
      }
    }
    return best;
  }

  private tapAt(clientX: number, clientY: number): void {
    const h = this.hit(clientX, clientY);
    if (h.ship !== undefined) this.onShipClick(h.ship);
    else if (h.port) this.onPortClick(h.port);
  }

  private hoverAt(clientX: number, clientY: number): void {
    const h = this.hit(clientX, clientY);
    const cv = this.app?.canvas as HTMLCanvasElement | undefined;
    if (cv) cv.style.cursor = h.ship !== undefined || h.port ? 'pointer' : this.k > 1.01 || this.globeMode ? 'grab' : '';
    this.setHover(h.port ?? null);
  }

  private setHover(id: string | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.dirty = true;
    this.onPortHover(id);
  }

  /** Zoom by `factor` keeping the point (x, y) (unzoomed units on screen) under the finger. */
  private zoomAt(x: number, y: number, factor: number): void {
    const k = Math.max(1, Math.min(MAX_ZOOM, this.k * factor));
    if (k === this.k) return;
    const mx = (x - this.tx) / this.k, my = (y - this.ty) / this.k;
    this.tx = x - mx * k;
    this.ty = y - my * k;
    this.k = k;
    this.clampView();
  }

  private panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
    this.clampView();
  }

  private clampView(): void {
    const k = this.k;
    this.tx = Math.min(0, Math.max(W * (1 - k), this.tx));
    this.ty = Math.min(0, Math.max(H * (1 - k), this.ty));
    this.dirty = true;
    this.labelsDirty = true;
  }

  /** Glide to a zoom around (x, y) (unzoomed units on screen). */
  private glideZoom(x: number, y: number, factor: number): void {
    const k0 = this.k;
    const k1 = Math.max(1, Math.min(MAX_ZOOM, k0 * factor));
    if (k1 === k0) return;
    this.inertia = null;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.glide = { k0, k1, mx: (x - this.tx) / k0, my: (y - this.ty) / k0, x, y, t0: performance.now(), dur: reduce ? 1 : 280 };
    this.dirty = true;
  }

  /** Back to the whole world. */
  resetZoom(): void {
    this.glide = null; this.inertia = null; this.glide3 = null; this.spin = null;
    this.gv.zoom = 1;
    this.k = 1; this.tx = 0; this.ty = 0;
    this.clampView();
  }

  // ------------------------------------------------------------ the frame

  private frame(now: number): void {
    if (!this.app || this.failed) return;
    const dt = Math.min(64, now - (this.lastFrame || now));
    this.lastFrame = now;
    if (this.glide) {
      const g = this.glide;
      const u = Math.min(1, (now - g.t0) / g.dur);
      const e = 1 - (1 - u) ** 3;
      this.k = g.k0 * (g.k1 / g.k0) ** e;
      this.tx = g.x - g.mx * this.k; this.ty = g.y - g.my * this.k;
      this.clampView();
      if (u >= 1) this.glide = null;
    }
    if (this.inertia) {
      const f = this.inertia;
      this.panBy(f.vx * dt, f.vy * dt);
      const decay = Math.exp(-dt / 260);
      f.vx *= decay; f.vy *= decay;
      if (Math.hypot(f.vx, f.vy) < 0.004) this.inertia = null;
    }
    if (this.glide3) {
      const g = this.glide3;
      const u = Math.min(1, (now - g.t0) / g.dur);
      const e = 1 - (1 - u) ** 3;
      const dLon = ((g.to.lon - g.from.lon + 540) % 360) - 180;
      this.gv = { lon: ((g.from.lon + dLon * e + 540) % 360) - 180, lat: g.from.lat + (g.to.lat - g.from.lat) * e, zoom: g.from.zoom * (g.to.zoom / g.from.zoom) ** e };
      this.dirty = true; this.labelsDirty = true;
      if (u >= 1) this.glide3 = null;
    }
    if (this.spin) {
      // The globe keeps turning a little after a flick.
      this.rotateBy(this.spin.vx * dt, this.spin.vy * dt);
      const decay = Math.exp(-dt / 320);
      this.spin.vx *= decay; this.spin.vy *= decay;
      if (Math.hypot(this.spin.vx, this.spin.vy) < 0.01) this.spin = null;
    }
    // Cross-fade to the detailed coastline from about 2.2x.
    if (this.landDetail) {
      const want = Math.max(0, Math.min(1, ((this.globeMode ? this.gv.zoom : this.k) - 2.0) / 0.8));
      if (Math.abs(want - this.detailMix) > 0.001) {
        this.detailMix += Math.sign(want - this.detailMix) * Math.min(Math.abs(want - this.detailMix), dt / 250);
        this.dirty = true;
      }
    }
    const fading = this.ports.some((p) => Math.abs(p.alpha - (p.visible ? 1 : 0)) > 0.001 || p.spot !== p.wantSpot || p.showNote !== p.wantNote || p.leader !== p.wantLeader);
    // Things that move by themselves: marching route, pulsing ready ships, storms, effects.
    const ambient = this.routes.primary.length > 0 || this.shipMarkers.some((m) => m.state === 'ready') || this.clouds.size > 0 || this.effects.length > 0;
    if (!this.dirty && !fading && !this.labelsDirty && !(ambient && now - this.lastPaint > 32)) return;
    this.lastPaint = now;
    this.dirty = false;
    this.draw(now, dt);
  }

  private draw(now: number, dt: number): void {
    const k = this.k, s0 = this.s0;
    // The globe or the flat map: the same overlay (ports, names, ships) on top of either.
    this.worldLayer.visible = !this.globeMode;
    if (this.globe) {
      this.globe.root.visible = this.globeMode;
      if (this.globeMode) {
        const { cx, cy, r } = this.globeFrame();
        this.globe.setView(this.gv, cx, cy, r);
        this.globe.setSphere({ uSun: this.sunVec() });
        const gm = this.gCoastDetail ? this.detailMix : 0;
        if (this.gCoastCoarse) this.gCoastCoarse.mesh.alpha = 1 - gm;
        if (this.gCoastDetail) { this.gCoastDetail.mesh.alpha = gm; this.gCoastDetail.mesh.visible = gm > 0; }
        if (this.gRoutePrim && this.routes.primary.length) this.gRoutePrim.shift = -((now / 1000) * 11) % 11;
      }
    }
    const pxPerUnit = s0 * k;
    this.worldLayer.scale.set(pxPerUnit);
    this.worldLayer.position.set(this.tx * s0, this.ty * s0);
    this.view.uniforms.uPxPerUnit = pxPerUnit;
    this.view.uniforms.uK = k;
    this.view.update();

    const mix = this.landDetail ? this.detailMix : 0;
    if (this.landCoarse && this.coastCoarse) {
      this.landCoarse.mesh.visible = this.coastCoarse.mesh.visible = mix < 1;
      // The detailed land is drawn over the coarse one: keep the coarse land solid underneath.
      this.coastCoarse.mesh.alpha = 1 - mix;
    }
    if (this.landDetail && this.coastDetail) {
      this.landDetail.mesh.visible = this.coastDetail.mesh.visible = mix > 0;
      this.landDetail.mesh.alpha = mix;
      this.coastDetail.mesh.alpha = mix;
    }

    // The marching dashes of the selected route: 11 px a second, as before.
    if (this.routePrimary && this.routes.primary.length) this.routePrimary.shift = -((now / 1000) * 11) % 11;

    // Ports and names keep their size on screen.
    const ui = this.ui;
    for (const p of this.ports) {
      const [x, y, vis] = this.portScreen(p);
      p.g.position.set(x, y);
      p.g.visible = vis;
      this.styleSpot(p);
    }
    if (this.labelsDirty) { this.labelsDirty = false; this.placeLabels(); }
    const step = dt / FADE_MS;
    for (const p of this.ports) {
      // A name that has to move fades out first, then comes back in its new place.
      const moving = p.spot !== p.wantSpot || p.showNote !== p.wantNote || p.leader !== p.wantLeader;
      const target = p.visible && !moving ? 1 : 0;
      if (moving && p.alpha <= 0.001) { p.spot = p.wantSpot; p.showNote = p.wantNote; p.leader = p.wantLeader; this.styleSpot(p); }
      p.alpha = target > p.alpha ? Math.min(target, p.alpha + step) : Math.max(target, p.alpha - step);
      p.tag.alpha = p.alpha;
      p.tag.visible = p.alpha > 0.001;
      const [x, y, vis] = this.portScreen(p);
      p.tag.position.set(x, y);
      // The keyboard button sits on the dot.
      p.button.style.transform = `translate(${(x - 14).toFixed(1)}px, ${(y - 14).toFixed(1)}px)`;
      p.button.hidden = !vis || x < -20 || y < -20 || x > this.cssW + 20 || y > this.cssH + 20;
    }
    for (const f of this.fogTexts) {
      if (!f.obj) continue;
      const [x, y, vis] = this.lonlatScreen([f.lon, f.lat]);
      f.obj.visible = !!this.charted && !f.hidden && vis && this.facing([f.lon, f.lat]) > 0.45;
      f.obj.position.set(x, y);
    }

    // Ships keep their size; ships fanned out in port keep their spacing on screen.
    for (const s of this.shipViews.values()) {
      const m = s.marker;
      const [x, y, vis] = this.lonlatScreen(m.at);
      s.root.visible = vis;
      const [dx, dy] = m.offset ?? [0, 0];
      s.root.position.set(x + dx * this.dot, y + dy * this.dot);
      let angle = (m.angle * Math.PI) / 180;
      if (this.globeMode && m.wake && m.wake.length > 1) {
        // On the globe the heading is what the screen shows: from the wake to the ship.
        const [bx, by] = this.lonlatScreen(m.wake[1]);
        if (Math.hypot(x - bx, y - by) > 0.5) angle = Math.atan2(y - by, x - bx);
      }
      s.root.rotation = angle;
      if (m.state === 'ready') {
        // Halo pulse (1.8 s).
        const ph = (Math.sin((now / 1800) * Math.PI * 2) + 1) / 2;
        s.halo.alpha = m.selected ? 1 : 0.3 + 0.7 * ph;
      } else s.halo.alpha = 1;
    }

    // On the globe, clouds sit where they are on the Earth, sized like the map's, flattened towards the rim.
    if (this.globeMode) {
      const { r } = this.globeFrame();
      const pxPerUnit = r / this.projection.scale();
      for (const c of this.clouds.values()) {
        const [x, y, vis] = this.lonlatScreen(c.cell.at);
        const f = this.facing(c.cell.at);
        c.sprite.visible = vis && f > 0.05;
        c.sprite.position.set(x, y);
        c.sprite.scale.set(c.cell.scale * pxPerUnit, c.cell.scale * pxPerUnit * Math.max(0.2, f));
      }
    }
    // Storms turn and flash.
    for (const c of this.clouds.values()) {
      if (c.cell.kind !== 'storm') continue;
      c.inner.rotation = ((now / 9000) % 1) * Math.PI * 2;
      if (c.bolt) {
        const ph = ((now + c.cell.seed * 2300) % 2300) / 2300;
        c.bolt.visible = ph >= 0.72 && ph < 0.76;
      }
    }

    // Pulses and floating notes.
    this.effects = this.effects.filter((e) => {
      const u = (now - e.t0) / e.dur;
      if (u >= 1) { e.obj.destroy({ children: true }); return false; }
      const [x, y, vis] = this.lonlatScreen(e.at);
      e.obj.visible = vis;
      if (e.kind === 'pulse') {
        const g = e.obj as Graphics;
        const r = (6 + 36 * (1 - (1 - u) ** 2)) * ui;
        g.clear().circle(0, 0, r).stroke({ width: 2.5 * ui, color: e.color, alpha: 1 - u });
        g.position.set(x, y);
      } else {
        const ease = 1 - (1 - u) ** 2;
        e.obj.position.set(x, y + (4 - 22 * ease) * ui - 16 * ui);
        e.obj.alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
      }
      return true;
    });

    this.app!.renderer.render(this.app!.stage);
  }

  // ------------------------------------------------------------ ports and names

  private portStyleKey(p: PortView): string {
    const m = p.marker;
    return `${m?.role ?? 'normal'}|${m?.strike ? 1 : 0}|${m?.boom ? 1 : 0}|${p.rumour ? 1 : 0}|${p.night ? 1 : 0}|${this.hover === p.id || this.focusPort === p.id ? 1 : 0}|${this.dot}`;
  }

  /** Redraw a port's dot when its look changed. */
  private styleSpot(p: PortView): void {
    const key = this.portStyleKey(p);
    if (key !== p.styleKey) {
      p.styleKey = key;
      const pal = this.pal, ui = this.dot, g = p.g;
      const role = p.marker?.role ?? 'normal';
      const hover = this.hover === p.id || this.focusPort === p.id;
      g.clear();
      if (p.rumour) {
        // A rumour: a dashed ring, solid when it's where you're going.
        if (role === 'dest') g.circle(0, 0, 4.5 * ui).stroke({ width: 1.6 * ui, color: hexOf(pal.accent) });
        else for (let i = 0; i < 8; i++) {
          const a0 = (i / 8) * Math.PI * 2;
          g.arc(0, 0, 4.5 * ui, a0, a0 + Math.PI / 8).stroke({ width: 1 * ui, color: hexOf(pal.muted) });
        }
      } else {
        let haloC = pal.accent, haloA = hover ? 0.25 : 0;
        if (role === 'here') { haloC = pal.good; haloA = 0.25; }
        if (role === 'dest') haloA = 0.35;
        if (p.marker?.strike) { haloC = pal.bad; haloA = 0.3; }
        if (p.marker?.boom) { haloC = pal.good; haloA = 0.25; }
        if (haloA) g.circle(0, 0, 9 * ui).fill({ color: hexOf(haloC), alpha: haloA });
        // A stop on the way: an amber ring.
        if (role === 'via') g.circle(0, 0, 9 * ui).stroke({ width: 2.5 * ui, color: hexOf(pal.accent2) });
        if (p.night) g.circle(0, 0, 7 * ui).fill({ color: 0xffd27a, alpha: 0.35 });
        const dot = role === 'here' ? pal.good : role === 'dest' ? pal.accent : role === 'cargo' || role === 'via' ? pal.accent2 : pal.text;
        g.circle(0, 0, 4.5 * ui).fill(hexOf(dot)).stroke({ width: 1.5 * ui, color: hexOf(pal.bg) });
        g.circle(0, 0, 1.8 * ui).fill(p.night ? 0xffe39b : hexOf(pal.bg));
      }
    }
    // Name and note at their spot (label units are scaled by ui).
    const spot = LABEL_SPOTS[p.spot];
    const ui = this.ui;
    const ax = spot.anchor === 'start' ? 0 : spot.anchor === 'end' ? 1 : 0.5;
    p.label.anchor.set(ax, 0);
    p.note.anchor.set(ax, 0);
    const lm = this.metrics(p.label), nm = this.metrics(p.note);
    p.label.position.set(spot.x * ui, spot.y * ui - lm.ascent);
    p.note.position.set(spot.x * ui, spot.fy * ui - nm.ascent);
    p.note.visible = p.showNote && !!p.note.text;
    // The leader line: from just outside the dot to the nearest point of the name.
    // Start outside a ship lying in this port, so the line isn't hidden under it.
    const [px, py] = this.portScreen(p);
    let shipR = 0;
    for (const v of this.shipViews.values()) {
      if (v.marker.state !== 'sea' && Math.hypot(v.root.x - px, v.root.y - py) < 3) shipR = Math.max(shipR, Math.max(8, v.marker.icon.length * 0.55) * this.dot);
    }
    const lk = p.leader ? `${p.spot}|${p.label.width.toFixed(1)}|${this.dot}|${this.ui}|${shipR.toFixed(1)}` : '';
    if (lk === p.leaderKey) return;
    p.leaderKey = lk;
    p.leaderG.clear();
    if (p.leader) {
      const w = p.label.width, h = p.label.height;
      const x0 = p.label.x - p.label.anchor.x * w, y0 = p.label.y;
      const tx = Math.max(x0, Math.min(0, x0 + w)), ty = Math.max(y0 + h * 0.2, Math.min(0, y0 + h * 0.8));
      const len = Math.hypot(tx, ty);
      const r0 = Math.max(6 * this.dot, shipR + 1.5);
      if (len > r0 + 2) {
        const ux = tx / len, uy = ty / len;
        // A pale outline under the line, as the names have, so it stands out over coasts.
        const pal = this.pal;
        p.leaderG.moveTo(ux * r0, uy * r0).lineTo(tx - ux * 1.5, ty - uy * 1.5)
          .stroke({ width: 3.2 * this.ui, color: hexOf(pal.halo), alpha: Math.min(1, pal.halo[3] + 0.1), cap: 'round' });
        p.leaderG.moveTo(ux * r0, uy * r0).lineTo(tx - ux * 1.5, ty - uy * 1.5)
          .stroke({ width: Math.max(1, 1.1 * this.ui), color: hexOf(pal.text), alpha: 0.85, cap: 'round' });
      }
    }
  }

  /** Ascent of a text's font above its baseline (texts are positioned by their top edge). */
  private metrics(t: Text): { ascent: number } {
    const size = Number(t.style.fontSize) || 12;
    const stroke = (t.style.stroke as { width?: number } | null)?.width ?? 0;
    return { ascent: size * 0.92 + stroke / 2 };
  }

  /**
   * Choose where every name goes, on screen, at the current zoom: ports that matter now (here,
   * destination, stops, cargo) first, then the others; each takes the first of its eight spots
   * that is clear of names already placed and of other ports' dots, keeping its current spot when
   * it can. A name with no room is hidden (it fades out) and comes back when there's room again.
   */
  private placeLabels(): void {
    const ui = this.ui;
    const rank = (p: PortView) => {
      const r = p.marker?.role;
      return r === 'here' ? 0 : r === 'dest' ? 1 : r === 'via' ? 2 : r === 'cargo' ? 3 : p.marker?.strike || p.marker?.boom ? 4 : 5;
    };
    // On the globe, names near the rim are left out (squeezed there); turn the globe to read them.
    const vis = this.ports.map((p) => { const [x, y, front] = this.portScreen(p); return { p, xy: [x, y] as [number, number], front: front && this.facing([p.lon, p.lat]) > 0.2 }; });
    const onScreen = vis.filter(({ xy: [x, y], front }) => front && x > -40 && y > -40 && x < this.cssW + 40 && y < this.cssH + 40);
    const dr = 7 * this.dot;
    const dots: Box[] = onScreen.map(({ xy: [x, y] }) => [x - dr, y - dr, x + dr, y + dr]);
    const order = [...onScreen].sort((a, b) => rank(a.p) - rank(b.p) || (b.p.visible ? 1 : 0) - (a.p.visible ? 1 : 0) || this.ports.indexOf(a.p) - this.ports.indexOf(b.p));
    const placed: Box[] = [];
    // Names stay clear of the buttons over the map (zoom, port view).
    const sb = this.stack.getBoundingClientRect();
    for (const el of [this.tools, this.stack.parentElement?.querySelector<HTMLElement>(':scope > .port-open')]) {
      const r = el && !el.hidden ? el.getBoundingClientRect() : null;
      if (r?.width) placed.push([r.left - sb.left - 4, r.top - sb.top - 4, r.right - sb.left + 4, r.bottom - sb.top + 4]);
    }
    for (const v of vis) if (!onScreen.includes(v)) v.p.visible = false;
    const boxes = (p: PortView, [px, py]: [number, number], key: LabelKey, note: boolean): Box[] => {
      const spot = LABEL_SPOTS[key];
      const out: Box[] = [];
      const add = (t: Text, base: number) => {
        const w = t.width, h = Number(t.style.fontSize) * 1.15;
        const x0 = spot.anchor === 'start' ? spot.x * ui : spot.anchor === 'end' ? spot.x * ui - w : spot.x * ui - w / 2;
        const top = base * ui - Number(t.style.fontSize) * 0.92;
        out.push([px + x0, py + top, px + x0 + w, py + top + h]);
      };
      add(p.label, spot.y);
      if (note && p.note.text) add(p.note, spot.fy);
      return out;
    };
    // Ships lying in port are in the way too (a name beside a ship reads as that port's).
    for (const v of this.shipViews.values()) {
      if (v.marker.state === 'sea') continue;
      const r = Math.max(8, v.marker.icon.length * 0.55) * this.dot;
      placed.push([v.root.x - r, v.root.y - r, v.root.x + r, v.root.y + r]);
    }
    // Distance from a point to a box.
    const gap = (b: Box, x: number, y: number) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
    const fits = (bs: Box[], self: number) => {
      for (const b of bs) {
        if (b[0] < 2 || b[1] < 2 || b[2] > this.cssW - 2 || b[3] > this.cssH - 2) return false;
        for (const q of placed) if (overlaps(b, q)) return false;
        for (let i = 0; i < dots.length; i++) if (i !== self && overlaps(b, dots[i])) return false;
      }
      // The name must sit nearer its own dot than any other, or it reads as the other port's.
      const [ox, oy] = onScreen[self].xy, own = gap(bs[0], ox, oy);
      for (let i = 0; i < onScreen.length; i++) {
        if (i !== self && gap(bs[0], onScreen[i].xy[0], onScreen[i].xy[1]) < own + 3) return false;
      }
      return true;
    };
    for (const { p, xy } of order) {
      const self = onScreen.findIndex((v) => v.p === p);
      const prefs: LabelKey[] = [];
      if (p.visible) prefs.push(p.wantSpot);
      prefs.push(p.dataSpot);
      for (const s of SPOT_KEYS) if (!prefs.includes(s)) prefs.push(s);
      let done = false;
      // With its note first; without it if there is no room for both.
      for (const note of p.note.text ? [true, false] : [false]) {
        for (const key of prefs) {
          const bs = boxes(p, xy, key, note);
          if (fits(bs, self)) {
            placed.push(...bs);
            p.wantSpot = key; p.wantNote = note; p.wantLeader = false; p.visible = true; done = true;
            break;
          }
        }
        if (done) break;
      }
      if (!done && rank(p) <= 3) {
        // Ports that matter now always show their name: in the least bad spot, or where the cluster
        // leaves none that reads as theirs, a little further out with a line to the dot.
        let best = p.dataSpot, bestCost = Infinity, leader = false;
        const keys = [...prefs, ...FAR_KEYS];
        const cost = (key: LabelKey, strict: boolean) => {
          const bs = boxes(p, xy, key, false);
          const area = (b: Box, q: Box) => Math.max(0, Math.min(b[2], q[2]) - Math.max(b[0], q[0])) * Math.max(0, Math.min(b[3], q[3]) - Math.max(b[1], q[1]));
          let c = 0;
          for (const b of bs) {
            for (const q of placed) c += area(b, q);
            // Covering another port's dot is worse than covering a name.
            for (let i = 0; i < dots.length; i++) if (i !== self) c += 4 * area(b, dots[i]);
            // Off the edge of the map.
            c += 40 * (Math.max(0, 2 - b[0]) + Math.max(0, 2 - b[1]) + Math.max(0, b[2] - this.cssW + 2) + Math.max(0, b[3] - this.cssH + 2));
          }
          // Worst of all: a name nearer another port's dot, which reads as that port's name.
          if (strict) {
            const own = gap(bs[0], xy[0], xy[1]);
            for (let i = 0; i < onScreen.length; i++) {
              if (i !== self) c += 10_000 * Math.max(0, own + 3 - gap(bs[0], onScreen[i].xy[0], onScreen[i].xy[1]));
            }
          }
          return c;
        };
        for (const key of keys) { const c = cost(key, true); if (c < bestCost) { bestCost = c; best = key; } }
        if (bestCost >= 10_000) {
          // No spot reads as this port's: the far spot that covers least, and a leader line.
          bestCost = Infinity; leader = true;
          for (const key of FAR_KEYS) { const c = cost(key, false); if (c < bestCost) { bestCost = c; best = key; } }
        }
        placed.push(...boxes(p, xy, best, false));
        p.wantSpot = best; p.wantNote = false; p.wantLeader = leader; p.visible = true; done = true;
      }
      if (!done) p.visible = false;
    }
    // A name that isn't showing yet can take its new spot at once.
    for (const p of this.ports) if (p.alpha <= 0.001) { p.spot = p.wantSpot; p.showNote = p.wantNote; p.leader = p.wantLeader; }
  }

  updatePorts(markers: PortMarker[]): void {
    this.markers = markers;
    if (!this.ready) return;
    // A settlement site shows once the view hands it in (founded); others stay hidden.
    const given = new Set(markers.map((m) => m.id));
    for (const p of this.ports) if (this.world.ports[p.id]?.site) p.hidden = !given.has(p.id);
    for (const m of markers) {
      const p = this.portById[m.id];
      if (!p) continue;
      p.marker = m;
      const note = p.rumour ? 'uncharted'
        // The 1650 chart is crowded: no victual prices on it, only what's news (they're in the Ship tab).
        : this.sail ? [m.strike ? '☠ quarantine' : '', m.boom ? '▲ boom' : ''].filter(Boolean).join(' · ')
          : `⛽ ${currency()}${m.fuelPrice}${m.strike ? ' · ✊ strike' : ''}${m.boom ? ' · ▲ boom' : ''}`;
      if (p.note.text !== note) { p.note.text = note; this.labelsDirty = true; }
    }
    this.labelsDirty = true;
    this.dirty = true;
  }

  // ------------------------------------------------------------ fog, lanes, canals

  /**
   * Fog of war: `known` is the set of charted ports and waypoints (null: no fog,
   * everything shows). Uncharted lanes disappear, uncharted ports become rumours.
   */
  setCharted(known: Set<string> | null): void {
    const key = known ? `${known.size}:${[...known].sort().join(',')}` : '';
    if (key === this.chartKey && this.ready) return;
    this.charted = known;
    if (!this.ready) return;
    this.chartKey = key;
    this.applyCharted();
  }

  private applyCharted(): void {
    const known = this.charted;
    const lit = (id: string) => !known || known.has(id);
    for (const l of this.laneData) l.uncharted = !(lit(l.a) && lit(l.b));
    this.rebuildLanes();
    let restyle = false;
    for (const p of this.ports) {
      const r = !lit(p.id);
      if (r !== p.rumour) { p.rumour = r; restyle = true; }
    }
    if (restyle) { this.restyleTexts(); if (this.markers.length) this.updatePorts(this.markers); }
    for (const t of this.fogTexts) {
      t.hidden = !known || [...known].some((id) => {
        const pt = this.world.points[id];
        return pt && geoDistance([pt.lon, pt.lat], [t.lon, t.lat]) < 0.22;
      });
    }
    this.fogSprite!.visible = !!known;
    this.globe?.setSphere({ uFogOn: [known ? 1 : 0, 0, 0, 0] });
    if (known) this.renderFog(known);
    this.dirty = true;
  }

  /** Draw the fog once, for the whole world, into a texture that the GPU then scales. */
  private renderFog(known: Set<string>): void {
    const lit = (id: string) => known.has(id);
    const parts: string[] = [];
    for (const [w, so, e, n] of this.world.era.charts?.known ?? []) {
      const ring: [number, number][] = [];
      for (let lat = so; lat <= n; lat += 2) ring.push([w, lat]);
      for (let lon = w; lon <= e; lon += 2) ring.push([lon, n]);
      for (let lat = n; lat >= so; lat -= 2) ring.push([e, lat]);
      for (let lon = e; lon >= w; lon -= 2) ring.push([lon, so]);
      ring.push(ring[0]);
      parts.push(`<path d="${this.path({ type: 'Polygon', coordinates: [ring] }) ?? ''}" stroke="none"/>`);
    }
    for (const id of known) {
      const pt = this.world.points[id];
      if (!pt) continue;
      parts.push(`<path d="${this.path(geoCircle().center([pt.lon, pt.lat]).radius(5.5).precision(12)()) ?? ''}" stroke="none"/>`);
    }
    for (const e of this.world.edges) {
      if (lit(e.a) && lit(e.b)) parts.push(`<path d="${this.path(this.line([e.a, e.b])) ?? ''}" fill="none" stroke-width="34" stroke-linecap="round"/>`);
    }
    const fog = this.fogColorCss();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${TEX_W}" height="${TEX_H}">
      <defs>
        <filter id="s" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="9"/></filter>
        <filter id="t" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="3" seed="7"/>
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0.55 0"/>
        </filter>
        <mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
          <rect width="${W}" height="${H}" fill="white"/><g fill="black" stroke="black" filter="url(#s)">${parts.join('')}</g>
        </mask>
        <clipPath id="c"><path d="${this.path({ type: 'Sphere' })}"/></clipPath>
      </defs>
      <g mask="url(#m)" clip-path="url(#c)">
        <rect width="${W}" height="${H}" fill="${fog}" opacity="0.88"/>
        <rect width="${W}" height="${H}" filter="url(#t)" opacity="0.5"/>
      </g></svg>`;
    const img = new Image();
    const stamp = this.chartKey;
    img.onload = () => {
      if (stamp !== this.chartKey) return;
      const cv = document.createElement('canvas');
      cv.width = TEX_W; cv.height = TEX_H;
      cv.getContext('2d')?.drawImage(img, 0, 0, TEX_W, TEX_H);
      const old = this.fogSprite!.texture;
      this.fogSprite!.texture = Texture.from(cv);
      this.globe?.setTexture('fog', this.fogSprite!.texture);
      this.fogSprite!.width = W; this.fogSprite!.height = H;
      if (old !== Texture.EMPTY) old.destroy(true);
      this.dirty = true;
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  private fogColorCss(): string {
    const c = this.pal.fog;
    return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  }

  /** Draw closed canals as blocked. */
  setClosedCanals(closed: string[]): void {
    const key = closed.join(',');
    if (key === this.closed.join(',')) return;
    this.closed = [...closed];
    for (const l of this.laneData) l.closed = !!l.canal && closed.includes(l.canal);
    if (this.ready) this.rebuildLanes();
  }

  private rebuildLanes(): void {
    if (!this.lanes) return;
    const show = this.laneData.filter((l) => !l.uncharted);
    this.lanes.geometry = lineGeometry(show.filter((l) => !l.canal).map((l) => ({ pts: l.pts })), this.nudger);
    this.canals!.geometry = lineGeometry(show.filter((l) => l.canal && !l.closed).map((l) => ({ pts: l.pts })), this.nudger);
    this.closedLanes!.geometry = lineGeometry(show.filter((l) => l.closed).map((l) => ({ pts: l.pts })), this.nudger);
    if (this.gLanes) {
      const ends = (l: { a: string; b: string }) => {
        const a = this.world.points[l.a], b = this.world.points[l.b];
        return { pts: [a.lon, a.lat, b.lon, b.lat] };
      };
      this.gLanes.geometry = lineGeometry3(show.filter((l) => !l.canal).map(ends));
      this.gCanals!.geometry = lineGeometry3(show.filter((l) => l.canal && !l.closed).map(ends));
      this.gClosed!.geometry = lineGeometry3(show.filter((l) => l.closed).map(ends));
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------ scenery

  /**
   * Night side of the world and port lights. `sun` is the point where the sun
   * stands overhead; everything more than 90° from it is in darkness.
   */
  setSun(sun: LonLat): void {
    this.sun = sun;
    if (!this.ready || !this.night) return;
    const d = this.sunDrawn;
    if (d && Math.abs(d[0] - sun[0]) < 0.25 && Math.abs(d[1] - sun[1]) < 0.25) return;
    this.sunDrawn = [...sun] as LonLat;
    const anti: LonLat = [((sun[0] + 360) % 360) - 180, -sun[1]];
    const polys: number[][][] = [];
    for (const r of [84, 90, 96]) polys.push(...project(this.projection, geoCircle().center(anti).radius(r).precision(3)()).polygons);
    this.night.geometry = fillGeometry(triangulate(polys, this.sphereSign));
    this.night.mesh.visible = true;
    for (const p of this.ports) {
      const pt = this.world.points[p.id];
      p.night = geoDistance([pt.lon, pt.lat], sun) > Math.PI / 2 + 0.05;
    }
    this.dirty = true;
  }

  /** Kept for callers; the sea's wave marks are part of the still background. */
  setWaves(_offset: number): void { /* still */ }

  /** Clouds and storm cells. Created, moved and removed to match the list. */
  updateWeather(cells: WeatherCell[]): void {
    this.cells = cells;
    if (!this.ready) return;
    const keep = new Set<string>();
    for (const c of cells) {
      keep.add(c.id);
      let v = this.clouds.get(c.id);
      if (!v) {
        const sprite = new Container();
        const inner = new Sprite(this.cloudTexture(c));
        inner.anchor.set(0.5);
        inner.scale.set(1 / 4);
        sprite.addChild(inner);
        let bolt: Graphics | null = null;
        if (c.kind === 'storm') {
          bolt = new Graphics().path(new GraphicsPath('M1 -4 L-3 3 L0 3 L-2 9 L4 0 L1 0 L3 -4 Z')).fill(0xffd34d);
          bolt.visible = false;
          sprite.addChild(bolt);
        }
        (this.globeMode ? this.globeClouds : this.weatherLayer).addChild(sprite);
        v = { sprite, inner, bolt, cell: c };
        this.clouds.set(c.id, v);
      }
      v.cell = c;
      const xy = this.projection(c.at);
      if (!xy) continue;
      if (!this.globeMode) {
        v.sprite.position.set(xy[0], xy[1]);
        v.sprite.scale.set(c.scale);
      }
      v.sprite.alpha = c.opacity;
    }
    for (const [id, v] of this.clouds) {
      if (!keep.has(id)) { v.sprite.destroy({ children: true }); this.clouds.delete(id); }
    }
    this.dirty = true;
  }

  /** A soft cloud of puffs (4 pixels per map unit), shaped by the cell's seed. */
  private cloudTexture(c: WeatherCell): Texture {
    const key = `${c.kind}:${c.seed.toFixed(3)}`;
    const have = this.cloudTex.get(key);
    if (have) return have;
    const S = 4, R = 34;
    const cv = document.createElement('canvas');
    cv.width = cv.height = R * 2 * S;
    const g = cv.getContext('2d')!;
    g.translate(R * S, R * S);
    g.scale(S, S);
    const puffs = c.kind === 'storm' ? 7 : 5;
    const [col, alpha] = c.kind === 'storm' ? ['91,102,117', 0.75] : ['244,248,251', 0.22];
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + (c.seed % 1);
      const d = i === 0 ? 0 : 6 + ((c.seed * (i + 3)) % 5);
      const cx = Math.cos(a) * d, cy = Math.sin(a) * d * 0.6;
      const rx = 9 + (i % 3) * 3, ry = 6 + (i % 2) * 2;
      // An ellipse blurred by about 4 units: a radial fade, squashed.
      g.save();
      g.translate(cx, cy);
      g.scale(1, ry / rx);
      const rr = rx + 8;
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, rr);
      grad.addColorStop(0, `rgba(${col},${alpha})`);
      grad.addColorStop(Math.max(0.05, (rx - 4) / rr), `rgba(${col},${alpha})`);
      grad.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    const tex = Texture.from(cv);
    this.cloudTex.set(key, tex);
    return tex;
  }

  /** A ring that spreads out from a point: payments, purchases. */
  pulseAt(at: LonLat, kind: 'good' | 'info'): void {
    const xy = this.projection(at);
    if (!xy || !this.ready) return;
    const g = new Graphics();
    this.effectLayer.addChild(g);
    this.effects.push({ t0: performance.now(), dur: 1500, at, obj: g, kind: 'pulse', color: hexOf(kind === 'good' ? this.pal.good : this.pal.accent) });
    this.dirty = true;
  }

  /** Brief floating label at a point on the map (events, payments). */
  flashAt(at: LonLat, text: string, kind: 'good' | 'bad' | 'info'): void {
    const xy = this.projection(at);
    if (!xy || !this.ready) return;
    const pal = this.pal;
    const t = new Text({
      text,
      style: new TextStyle({
        fontFamily: this.sail ? '"EB Garamond", Georgia, serif' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 13 * this.ui, fontWeight: '700', fill: hexOf(kind === 'good' ? pal.good : kind === 'bad' ? pal.bad : pal.text),
        stroke: { color: hexOf(pal.bg), width: 3 * this.ui, join: 'round' },
      }),
    });
    t.anchor.set(0.5, 1);
    t.alpha = 0;
    this.effectLayer.addChild(t);
    this.effects.push({ t0: performance.now(), dur: 2200, at, obj: t, kind: 'flash', color: 0 });
    this.dirty = true;
  }

  private line(ids: string[]): GeoJSON.LineString {
    return { type: 'LineString', coordinates: ids.map((id) => [this.world.points[id].lon, this.world.points[id].lat]) };
  }

  // ------------------------------------------------------------ routes and ships

  /** Draw highlighted routes. `primary` is the selected leg; `secondary` are faint previews. */
  showRoutes(primary: string[] | string[][] | null, secondary: string[][] = []): void {
    const bold = !primary ? [] : typeof primary[0] === 'string' ? [primary as string[]] : (primary as string[][]);
    this.routes = { primary: bold, secondary };
    if (this.ready) this.applyRoutes();
  }

  private applyRoutes(): void {
    const lines = (rs: string[][]) => rs.flatMap((r) => project(this.projection, this.line(r)).lines.map((pts) => ({ pts })));
    const bold = lines(this.routes.primary);
    this.routeSecondary!.geometry = lineGeometry(lines(this.routes.secondary), this.nudger);
    this.routeGlow!.geometry = lineGeometry(bold, this.nudger);
    this.routePrimary!.geometry = lineGeometry(bold, this.nudger);
    if (this.gRouteSec) {
      const ll = (rs: string[][]) => rs.map((r) => ({ pts: r.flatMap((id) => [this.world.points[id].lon, this.world.points[id].lat]) }));
      const b3 = ll(this.routes.primary);
      this.gRouteSec.geometry = lineGeometry3(ll(this.routes.secondary));
      this.gRouteGlow!.geometry = lineGeometry3(b3);
      this.gRoutePrim!.geometry = lineGeometry3(b3);
    }
    this.dirty = true;
  }

  /** Where a ship is `t` (0..1) of the way along a route, by distance, and its heading on screen. */
  positionAlong(path: string[], t: number): { at: LonLat; angle: number } {
    const pts = path.map((id) => [this.world.points[id].lon, this.world.points[id].lat] as LonLat);
    if (pts.length < 2) return { at: pts[0], angle: 0 };
    const segs = pts.slice(1).map((b, i) => {
      const a = pts[i];
      const dLon = ((b[0] - a[0] + 540) % 360) - 180;
      const len = Math.hypot(dLon * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), b[1] - a[1]);
      return { interp: geoInterpolate(a, b), len };
    });
    const total = segs.reduce((s, x) => s + x.len, 0) || 1;
    let d = Math.max(0, Math.min(1, t)) * total;
    let seg = segs[segs.length - 1];
    let local = 1;
    for (const x of segs) {
      if (d <= x.len) { seg = x; local = x.len ? d / x.len : 1; break; }
      d -= x.len;
    }
    const here = seg.interp(local);
    const ahead = seg.interp(Math.min(1, local + 0.02));
    const [x0, y0] = this.projection(here)!;
    const [x1, y1] = this.projection(ahead)!;
    const angle = x1 !== x0 || y1 !== y0 ? (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI : 0;
    return { at: here, angle };
  }

  portPosition(portId: string): LonLat {
    const p = this.world.points[portId];
    return [p.lon, p.lat];
  }

  /** Draw the fleet. Markers are created, moved and removed to match `markers`. */
  updateShips(markers: ShipMarker[]): void {
    this.shipMarkers = markers;
    if (!this.ready) return;
    const pal = this.pal, ui = this.dot;
    const keep = new Set<number>();
    const wakeLines: { pts: number[] }[] = [];
    for (const m of markers) {
      keep.add(m.id);
      let v = this.shipViews.get(m.id);
      if (!v) {
        const root = new Container();
        const halo = new Graphics(), body = new Graphics();
        root.addChild(halo, body);
        this.shipLayer.addChild(root);
        v = { marker: m, root, halo, body, key: '' };
        this.shipViews.set(m.id, v);
      }
      v.marker = m;
      const key = `${m.icon.hull}|${m.icon.deck}|${m.state}|${m.family}|${m.selected}|${ui}`;
      if (key !== v.key) {
        v.key = key;
        const hullC = m.state === 'ready' ? pal.accent : m.state === 'busy' ? pal.muted
          : m.family === 'sail' ? probe('#8a5d33') : m.family === 'bulk' ? probe('#9aa4b2') : m.family === 'tanker' ? probe('#d0625a')
            : m.family === 'container' ? probe('#4f9fe0') : m.family === 'reefer' ? probe('#f2f6fa') : pal.accent2;
        const deckC = m.family === 'sail' ? probe(getComputedStyle(document.documentElement).getPropertyValue('--sail-cloth').trim() || '#efe3c4')
          : m.family === 'reefer' ? probe('#4f9fe0') : pal.superC;
        const haloC = m.state === 'ready' ? pal.accent : pal.accent2;
        const haloA = m.selected ? 0.45 : m.state === 'ready' ? 0.28 : 0.15;
        v.halo.clear().circle(0, 0, Math.max(8, m.icon.length * 0.55) * ui).fill({ color: hexOf(haloC), alpha: haloA });
        if (m.selected) v.halo.stroke({ width: 1.2 * ui, color: hexOf(pal.text) });
        v.body.clear();
        v.body.scale.set(ui);
        v.body.path(new GraphicsPath(m.icon.hull)).fill(hexOf(hullC)).stroke({ width: 0.8, color: hexOf(pal.bg) });
        v.body.path(new GraphicsPath(m.icon.deck)).fill({ color: hexOf(deckC), alpha: m.family === 'sail' ? 1 : 0.9 });
        v.root.alpha = m.state === 'busy' ? 0.6 : 1;
      }
      if (m.wake && m.wake.length > 1) wakeLines.push(...project(this.projection, { type: 'LineString', coordinates: m.wake }).lines.map((pts) => ({ pts })));
    }
    for (const [id, v] of this.shipViews) {
      if (!keep.has(id)) { v.root.destroy({ children: true }); this.shipViews.delete(id); }
    }
    // The selected ship on top.
    for (const v of this.shipViews.values()) if (v.marker.selected) this.shipLayer.addChild(v.root);
    this.wakes!.geometry = lineGeometry(wakeLines, this.nudger);
    if (this.gWakes) this.gWakes.geometry = lineGeometry3(markers.filter((m) => m.wake && m.wake.length > 1).map((m) => ({ pts: m.wake!.flat() })));
    this.dirty = true;
  }
}

/**
 * The land's coastlines as lon/lat polylines for the globe. The data cuts land at the date line and
 * runs edges along it (and along the poles): those are not coast, so the lines break there.
 */
function coastLines(geo: GeoJSON.Feature | GeoJSON.FeatureCollection): { pts: number[] }[] {
  const rings: number[][][] = [];
  const walk = (g: GeoJSON.Geometry) => {
    if (g.type === 'Polygon') rings.push(...(g.coordinates as number[][][]));
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates as number[][][][]) rings.push(...p);
    else if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
  };
  if (geo.type === 'FeatureCollection') geo.features.forEach((f) => f.geometry && walk(f.geometry));
  else if (geo.geometry) walk(geo.geometry);
  const out: { pts: number[] }[] = [];
  const cut = (a: number[], b: number[]) => (Math.abs(a[0]) > 179.99 && Math.abs(b[0]) > 179.99) || (Math.abs(a[1]) > 89.99 && Math.abs(b[1]) > 89.99) || Math.abs(a[0] - b[0]) > 180;
  for (const ring of rings) {
    let cur: number[] = [];
    for (let i = 0; i < ring.length; i++) {
      if (i && cut(ring[i - 1], ring[i])) { if (cur.length >= 4) out.push({ pts: cur }); cur = []; }
      cur.push(ring[i][0], ring[i][1]);
    }
    if (cur.length >= 4) out.push({ pts: cur });
  }
  return out;
}

/** Euclidean distance (in pixels) from every pixel to the nearest pixel with alpha > 127. */
function edt(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const INF = 1e20;
  const grid = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = rgba[i * 4 + 3] > 127 ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) grid[y * w + x] = Math.sqrt(d[x]);
  }
  return grid;
}
