// The globe: an optional 3D view of the same map (map-gl.ts switches between them). The sphere is
// drawn by one shader over a disc on screen: for every pixel it finds the point of the Earth
// beneath, and colours it from the same textures the flat map uses (land, shallows, waves, fog),
// with the night as a real shadow. Lines (coasts, graticule, lanes, routes, wakes) are 3D
// polylines on the unit sphere, projected and widened on screen in the vertex shader. Rotating
// and zooming change a few uniforms only. Orthographic: the Earth seen from far away.

import { geoInterpolate } from 'd3-geo';
import { Container, Geometry, GlProgram, Mesh, Shader, type Texture, UniformGroup } from 'pixi.js';

const DEG = Math.PI / 180;
type RGBA = [number, number, number, number];

/** A point of the Earth (degrees) as a unit vector: x east, y north, z towards (0°, 0°). */
export function toVec(lon: number, lat: number): [number, number, number] {
  const l = lon * DEG, p = lat * DEG;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

/** The view: which point of the Earth faces us, and how big it is. */
export interface GlobeView {
  lon: number;
  lat: number;
  /** 1 = the whole Earth fits; up to the same maximum as the flat map. */
  zoom: number;
}

/** Rows of the rotation that turns the view's centre towards us (x right, y up, z to the viewer). */
export function viewRows(v: GlobeView): [number[], number[], number[]] {
  const l = v.lon * DEG, p = v.lat * DEG;
  const cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
  // Turn by -lon about the north axis, then by +lat about the east axis.
  return [
    [cl, 0, -sl],
    [-sp * sl, cp, -sp * cl],
    [cp * sl, sp, cp * cl],
  ];
}

const MVP = `
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
vec4 toClip(vec2 p) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  return vec4((mvp * vec3(p, 1.0)).xy, 0.0, 1.0);
}`;

const GLOBE_UNIFORMS = `
uniform vec4 uRow0;
uniform vec4 uRow1;
uniform vec4 uRow2;
uniform vec4 uGlobe;`; // centre x, centre y (CSS px), radius (px), zoom

// ---------------------------------------------------------------- lines

const LINE3_VERT = `
in vec4 aPos;
in vec4 aPrev;
in vec4 aNext;
in vec2 aSideDist;
uniform float uWidth;
${GLOBE_UNIFORMS}
out float vSide;
out float vDist;
out float vZ;
${MVP}
vec3 view(vec3 w) { return vec3(dot(uRow0.xyz, w), dot(uRow1.xyz, w), dot(uRow2.xyz, w)); }
vec2 scr(vec3 v) { return vec2(uGlobe.x + uGlobe.z * v.x, uGlobe.y - uGlobe.z * v.y); }
void main() {
  vec3 p = view(aPos.xyz);
  vec2 sp = scr(p);
  vec2 d = scr(view(aNext.xyz)) - scr(view(aPrev.xyz));
  if (dot(d, d) < 1e-8) d = vec2(1.0, 0.0);
  vec2 n = normalize(vec2(-d.y, d.x));
  float hw = uWidth * 0.5 + 1.0;
  gl_Position = toClip(sp + n * aSideDist.x * hw);
  vSide = aSideDist.x * hw;
  vDist = aSideDist.y * uGlobe.z;
  vZ = p.z;
}`;

const LINE3_FRAG = `
in float vSide;
in float vDist;
in float vZ;
uniform vec4 uInk;
uniform float uWidth;
uniform vec2 uDash;
uniform float uDashShift;
uniform vec4 uColor;
out vec4 finalColor;
void main() {
  // The far side of the Earth is hidden; lines fade out just before the rim.
  float a = clamp(uWidth * 0.5 + 0.5 - abs(vSide), 0.0, 1.0) * smoothstep(-0.005, 0.04, vZ);
  if (uDash.x > 0.0) {
    float m = mod(vDist + uDashShift, uDash.x + uDash.y);
    a *= clamp(uDash.x - m + 0.5, 0.0, 1.0);
  }
  finalColor = vec4(uInk.rgb, 1.0) * (uInk.a * a * uColor.a);
}`;

/**
 * 3D polylines from lon/lat point lists [lon, lat, lon, lat, …], cut into steps of at most `step`
 * degrees along great circles, two vertices a point.
 */
export function lineGeometry3(lines: { pts: number[]; closed?: boolean }[], step = 1.5): Geometry {
  const pos: number[] = [], prev: number[] = [], next: number[] = [], sd: number[] = [], idx: number[] = [];
  for (const { pts, closed } of lines) {
    const ll: [number, number][] = [];
    const n0 = pts.length / 2;
    const count = closed ? n0 + 1 : n0;
    for (let i = 0; i < count; i++) {
      const a: [number, number] = [pts[(i % n0) * 2], pts[(i % n0) * 2 + 1]];
      if (ll.length) {
        const b = ll[ll.length - 1];
        const dLon = Math.abs(((a[0] - b[0] + 540) % 360) - 180), dLat = Math.abs(a[1] - b[1]);
        const k = Math.ceil(Math.max(dLon, dLat) / step);
        if (k > 1) {
          const f = geoInterpolate(b, a);
          for (let j = 1; j < k; j++) ll.push(f(j / k) as [number, number]);
        }
        if (dLon < 1e-7 && dLat < 1e-7) continue;
      }
      ll.push(a);
    }
    if (ll.length < 2) continue;
    const v = ll.map(([lon, lat]) => toVec(lon, lat));
    const base = pos.length / 4;
    let d = 0;
    for (let i = 0; i < v.length; i++) {
      if (i) {
        const [x0, y0, z0] = v[i - 1], [x1, y1, z1] = v[i];
        d += Math.acos(Math.max(-1, Math.min(1, x0 * x1 + y0 * y1 + z0 * z1)));
      }
      const p = v[i], a = v[Math.max(0, i - 1)], b = v[Math.min(v.length - 1, i + 1)];
      for (const side of [-1, 1]) {
        pos.push(p[0], p[1], p[2], 0);
        prev.push(a[0], a[1], a[2], 0);
        next.push(b[0], b[1], b[2], 0);
        sd.push(side, d);
      }
      if (i) {
        const q = base + (i - 1) * 2;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
  }
  const or = (a: number[], n: number) => new Float32Array(a.length ? a : new Array(n).fill(0));
  return new Geometry({
    attributes: {
      aPos: { buffer: or(pos, 4), format: 'float32x4' },
      aPrev: { buffer: or(prev, 4), format: 'float32x4' },
      aNext: { buffer: or(next, 4), format: 'float32x4' },
      aSideDist: { buffer: or(sd, 2), format: 'float32x2' },
    },
    indexBuffer: new Uint32Array(idx.length ? idx : [0, 0, 0]),
  });
}

export interface LineStyle3 { width: number; color: RGBA; alpha: number; dash?: [number, number] }

/** A set of 3D lines in one style (the globe's counterpart of the flat map's LineLayer). */
export class GlobeLines {
  mesh: Mesh<Geometry, Shader>;
  readonly u: UniformGroup;
  constructor(globe: UniformGroup, prog: GlProgram, geometry: Geometry, style: LineStyle3) {
    this.u = new UniformGroup({
      uInk: { value: new Float32Array(4), type: 'vec4<f32>' },
      uWidth: { value: 1, type: 'f32' },
      uDash: { value: new Float32Array(2), type: 'vec2<f32>' },
      uDashShift: { value: 0, type: 'f32' },
    });
    this.mesh = new Mesh({ geometry, shader: new Shader({ glProgram: prog, resources: { globe, line: this.u } }) });
    this.style(style);
  }
  style(s: LineStyle3): void {
    (this.u.uniforms.uInk as Float32Array).set([s.color[0], s.color[1], s.color[2], s.alpha * s.color[3]]);
    this.u.uniforms.uWidth = s.width;
    (this.u.uniforms.uDash as Float32Array).set(s.dash ?? [0, 0]);
    this.u.update();
  }
  /** New lines: a new mesh in the old one's place (swapping a mesh's data trips some GPUs). */
  set geometry(g: Geometry) {
    const old = this.mesh;
    const m = new Mesh({ geometry: g, shader: old.shader! });
    m.visible = old.visible; m.alpha = old.alpha;
    const parent = old.parent;
    if (parent) { parent.addChildAt(m, parent.getChildIndex(old)); parent.removeChild(old); }
    const og = old.geometry;
    old.destroy(); og.destroy();
    this.mesh = m;
  }
  set shift(px: number) { this.u.uniforms.uDashShift = px; this.u.update(); }
}

// ---------------------------------------------------------------- the sphere

const SPHERE_VERT = `
in vec2 aPosition;
${GLOBE_UNIFORMS}
out vec2 vQ;
${MVP}
void main() {
  // A square a little bigger than the Earth's disc (room for the atmosphere).
  vQ = aPosition;
  gl_Position = toClip(vec2(uGlobe.x + uGlobe.z * aPosition.x, uGlobe.y - uGlobe.z * aPosition.y));
}`;

/** Fragment shader of the sphere. `W`, `H`: the flat map's size, whose textures it samples. */
const sphereFrag = (W: number, H: number) => `
in vec2 vQ;
${GLOBE_UNIFORMS}
uniform vec4 uProj;      // the flat map's Equal Earth scale, x offset, y offset
uniform vec4 uSea1;
uniform vec4 uSea2;
uniform vec4 uGrad;      // the sea's radial gradient: centre and radius in map units
uniform vec4 uLandHi;
uniform vec4 uLand;
uniform vec4 uLandY;     // the land gradient's top and bottom (map units)
uniform vec4 uShallow;
uniform vec4 uWave;
uniform vec4 uNight;     // colour and strength of each of the three bands
uniform vec4 uSun;       // where the sun stands overhead, as a unit vector; w: 1 = night shown
uniform vec4 uRim;
uniform vec4 uGlow;
uniform vec4 uFogOn;     // x: 1 when there's fog of war
uniform sampler2D uDist;
uniform sampler2D uWaves;
uniform sampler2D uLandMask;
uniform sampler2D uFog;
uniform vec4 uColor;
out vec4 finalColor;

const float PI = 3.14159265;
// d3's Equal Earth, as the flat map projects it.
vec2 equalEarth(float lon, float lat) {
  float M = sqrt(3.0) / 2.0;
  float t = asin(M * sin(lat));
  float t2 = t * t, t6 = t2 * t2 * t2;
  float x = lon * cos(t) / (M * (1.340264 + 3.0 * -0.081106 * t2 + t6 * (7.0 * 0.000893 + 9.0 * 0.003796 * t2)));
  float y = t * (1.340264 + -0.081106 * t2 + t6 * (0.000893 + 0.003796 * t2));
  return vec2(uProj.y + uProj.x * x, uProj.z - uProj.x * y);
}

void main() {
  float r2 = dot(vQ, vQ);
  float r = sqrt(r2);
  float px = 1.0 / uGlobe.z;   // one screen pixel, in Earth radii
  if (r > 1.0) {
    // The atmosphere: a soft glow round the rim.
    float g = exp(-(r - 1.0) / (0.025 + 6.0 * px)) * (1.0 - smoothstep(1.0, 1.12, r));
    finalColor = vec4(uGlow.rgb, 1.0) * (uGlow.a * g * uColor.a);
    return;
  }
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 w = uRow0.xyz * vQ.x + uRow1.xyz * vQ.y + uRow2.xyz * z;   // back to the Earth's frame
  float lon = atan(w.x, w.z), lat = asin(clamp(w.y, -1.0, 1.0));
  vec2 m = equalEarth(lon, lat);
  vec2 uv = m / vec2(${W}.0, ${H}.0);

  // The sea, as on the flat map: gradient, wave marks, shallows.
  vec3 c = mix(uSea1.rgb, uSea2.rgb, clamp(length(m - uGrad.xy) / uGrad.z, 0.0, 1.0));
  float wave = texture(uWaves, m * uGlobe.w / vec2(46.0, 22.0)).a;
  c = mix(c, uWave.rgb, wave * uWave.a);
  float d = texture(uDist, uv).r * 16.0;
  float t = d * sqrt(uGlobe.w) / 6.0;
  c = mix(c, uShallow.rgb, uShallow.a * 0.45 * exp(-t * t));
  // Land.
  float land = smoothstep(0.35, 0.65, texture(uLandMask, uv).a);
  vec3 lc = mix(uLandHi.rgb, uLand.rgb, clamp((m.y - uLandY.x) / (uLandY.y - uLandY.x), 0.0, 1.0));
  c = mix(c, lc, land);
  // Fog of war (premultiplied texture).
  if (uFogOn.x > 0.5) { vec4 f = texture(uFog, uv); c = c * (1.0 - f.a) + f.rgb; }
  // Night: three soft bands, as on the flat map, but following the real terminator.
  if (uSun.w > 0.5) {
    float s = dot(w, uSun.xyz);
    float b1 = smoothstep(0.125, 0.085, s), b2 = smoothstep(0.02, -0.02, s), b3 = smoothstep(-0.085, -0.125, s);
    float a = 1.0 - (1.0 - uNight.a * b1) * (1.0 - uNight.a * b2) * (1.0 - uNight.a * b3);
    c = mix(c, uNight.rgb, a);
  }
  // A little roundness: darker towards the rim, and the rim itself.
  c *= 0.86 + 0.14 * z;
  float edge = smoothstep(1.0 - 1.6 * px, 1.0, r);
  c = mix(c, uRim.rgb, edge * uRim.a);
  float alpha = 1.0 - smoothstep(1.0 - 0.6 * px, 1.0 + 0.6 * px, r);
  finalColor = vec4(c, 1.0) * (alpha * uColor.a);
}`;

export interface SphereTextures { dist: Texture; waves: Texture; land: Texture; fog: Texture }

/** Everything on the globe: the sphere, and the line layers map-gl.ts hands it. */
export class GlobeScene {
  readonly root = new Container();
  readonly u: UniformGroup;
  readonly sphereU: UniformGroup;
  readonly lineProg: GlProgram;
  private sphere: Mesh<Geometry, Shader>;
  private tex: SphereTextures;

  constructor(W: number, H: number, tex: SphereTextures) {
    this.tex = tex;
    this.u = new UniformGroup({
      uRow0: { value: new Float32Array(4), type: 'vec4<f32>' },
      uRow1: { value: new Float32Array(4), type: 'vec4<f32>' },
      uRow2: { value: new Float32Array(4), type: 'vec4<f32>' },
      uGlobe: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const v4 = () => ({ value: new Float32Array(4), type: 'vec4<f32>' as const });
    this.sphereU = new UniformGroup({
      uProj: v4(), uSea1: v4(), uSea2: v4(), uGrad: v4(), uLandHi: v4(), uLand: v4(), uLandY: v4(), uShallow: v4(),
      uWave: v4(), uNight: v4(), uSun: v4(), uRim: v4(), uGlow: v4(), uFogOn: v4(),
    });
    const prog = (name: string, vertex: string, fragment: string) =>
      GlProgram.from({ name, vertex, fragment, preferredVertexPrecision: 'highp', preferredFragmentPrecision: 'highp' });
    this.lineProg = prog('globe-line', LINE3_VERT, LINE3_FRAG);
    const S = 1.14;
    this.sphere = new Mesh({
      geometry: new Geometry({
        attributes: { aPosition: { buffer: new Float32Array([-S, -S, S, -S, S, S, -S, S]), format: 'float32x2' } },
        indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
      }),
      shader: new Shader({
        glProgram: prog('globe-sphere', SPHERE_VERT, sphereFrag(W, H)),
        resources: { globe: this.u, sphere: this.sphereU, uDist: tex.dist.source, uWaves: tex.waves.source, uLandMask: tex.land.source, uFog: tex.fog.source },
      }),
    });
    this.root.addChild(this.sphere);
  }

  /** Swap a texture the sphere samples (the detailed land, a new fog, new shallows). */
  setTexture(name: keyof SphereTextures, t: Texture): void {
    this.tex[name] = t;
    const key = { dist: 'uDist', waves: 'uWaves', land: 'uLandMask', fog: 'uFog' }[name];
    this.sphere.shader!.resources[key] = t.source;
  }

  /** Set the sphere's colours and fixed numbers (by uniform name, four floats each). */
  setSphere(values: Partial<Record<'uProj' | 'uSea1' | 'uSea2' | 'uGrad' | 'uLandHi' | 'uLand' | 'uLandY' | 'uShallow' | 'uWave' | 'uNight' | 'uSun' | 'uRim' | 'uGlow' | 'uFogOn', number[]>>): void {
    for (const [k, v] of Object.entries(values)) (this.sphereU.uniforms[k] as Float32Array).set(v);
    this.sphereU.update();
  }

  /** The view for this frame: rotation, centre and radius on screen (CSS px), zoom. */
  setView(v: GlobeView, cx: number, cy: number, radius: number): void {
    const rows = viewRows(v);
    (this.u.uniforms.uRow0 as Float32Array).set([...rows[0], 0]);
    (this.u.uniforms.uRow1 as Float32Array).set([...rows[1], 0]);
    (this.u.uniforms.uRow2 as Float32Array).set([...rows[2], 0]);
    (this.u.uniforms.uGlobe as Float32Array).set([cx, cy, radius, v.zoom]);
    this.u.update();
  }
}

/** Screen position of a point of the Earth in this view, and whether it faces us. */
export function globePoint(v: GlobeView, lon: number, lat: number, cx: number, cy: number, radius: number): { x: number; y: number; z: number } {
  const [r0, r1, r2] = viewRows(v);
  const w = toVec(lon, lat);
  const x = r0[0] * w[0] + r0[1] * w[1] + r0[2] * w[2];
  const y = r1[0] * w[0] + r1[1] * w[1] + r1[2] * w[2];
  const z = r2[0] * w[0] + r2[1] * w[1] + r2[2] * w[2];
  return { x: cx + radius * x, y: cy - radius * y, z };
}

/** The point of the Earth under a screen position, or null off the disc. */
export function globeInvert(v: GlobeView, sx: number, sy: number, cx: number, cy: number, radius: number): [number, number] | null {
  const x = (sx - cx) / radius, y = -(sy - cy) / radius;
  const r2 = x * x + y * y;
  if (r2 > 1) return null;
  const z = Math.sqrt(1 - r2);
  const [r0, r1, r2v] = viewRows(v);
  const w = [r0[0] * x + r1[0] * y + r2v[0] * z, r0[1] * x + r1[1] * y + r2v[1] * z, r0[2] * x + r1[2] * y + r2v[2] * z];
  return [Math.atan2(w[0], w[2]) / DEG, Math.asin(Math.max(-1, Math.min(1, w[1]))) / DEG];
}
