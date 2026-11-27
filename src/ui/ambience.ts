// The sound of a harbour (Age of Sail): surf on the shore, wind and rain with the weather, gulls by
// day, crickets on warm nights, ropes and timbers creaking, a temple bell or a church bell now and
// then, hammering where your settlement is building. All synthesised with the Web Audio API (no
// files, so it works offline), quiet under the music.

export interface AmbientScene {
  /** What rings: a temple bell (China, Japan, your Chinese settlement), a church bell, or none. */
  bell: 'temple' | 'church' | 'none';
  time: 'day' | 'dusk' | 'night';
  weather: { kind: string; wind: number };
  /** Warm nights have crickets. */
  warm: boolean;
  /** Your settlement is building something. */
  building: boolean;
}

/** How loud the whole of it is, under the sound board's master. */
const LEVEL = 0.55;

export class Ambience {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private surf: GainNode | null = null;
  private wind: GainNode | null = null;
  private windBand: BiquadFilterNode | null = null;
  private rain: GainNode | null = null;
  private scene: AmbientScene | null = null;
  private timer = 0;
  /** When each occasional sound is next due (AudioContext time). */
  private due = { swell: 0, gull: 0, bell: 0, creak: 0, cricket: 0, hammer: 0 };

  get running(): boolean { return this.timer !== 0; }

  start(ctx: AudioContext, dest: AudioNode): void {
    if (this.timer && this.ctx === ctx) return;
    this.stop();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.out.gain.setTargetAtTime(LEVEL, ctx.currentTime, 1.2);
    this.out.connect(dest);
    if (!this.noise) {
      // Four seconds of noise, looped: the raw stuff of surf, wind and rain.
      const b = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    }
    const layer = (type: BiquadFilterType, freq: number, q = 0.7): [GainNode, BiquadFilterNode] => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      src.loopStart = Math.random() * 2; src.loopEnd = 4;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.out!);
      src.start(ctx.currentTime, Math.random() * 3);
      this.sources.push(src);
      return [g, f];
    };
    [this.surf] = layer('lowpass', 420);
    [this.wind, this.windBand] = layer('bandpass', 600, 1.2);
    [this.rain] = layer('highpass', 1800);
    const now = ctx.currentTime;
    this.due = { swell: now, gull: now + 3, bell: now + 20 + Math.random() * 40, creak: now + 6, cricket: now + 1, hammer: now + 2 };
    this.timer = window.setInterval(() => this.tick(), 250);
    if (this.scene) this.set(this.scene);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    const ctx = this.ctx, out = this.out;
    if (ctx && out) {
      out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
      const srcs = this.sources;
      setTimeout(() => { for (const s of srcs) { try { s.stop(); } catch { /* already stopped */ } } out.disconnect(); }, 1500);
    }
    this.sources = [];
    this.out = this.surf = this.wind = this.windBand = this.rain = null;
  }

  /** What the harbour sounds like now (or null for silence). */
  set(scene: AmbientScene | null): void {
    this.scene = scene;
    const ctx = this.ctx;
    if (!ctx || !this.surf || !this.wind || !this.rain || !this.windBand) return;
    const t = ctx.currentTime;
    const w = scene?.weather.wind ?? 0;
    const kind = scene?.weather.kind ?? 'clear';
    this.wind.gain.setTargetAtTime(scene ? 0.02 + w * w * 0.35 : 0, t, 1.5);
    this.windBand.frequency.setTargetAtTime(350 + w * 700, t, 2);
    this.rain.gain.setTargetAtTime(kind === 'storm' ? 0.22 : kind === 'rain' ? 0.12 : 0, t, 1.5);
  }

  private tick(): void {
    const ctx = this.ctx, s = this.scene;
    if (!ctx || !s || !this.surf) return;
    const now = ctx.currentTime;
    const kind = s.weather.kind;
    const wet = kind === 'rain' || kind === 'storm';
    // Waves on the shore: a swell every few seconds, bigger in wind.
    if (now >= this.due.swell) {
      const peak = 0.06 + s.weather.wind * 0.18, len = 3 + Math.random() * 3;
      const g = this.surf.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(peak, now, len * 0.25);
      g.setTargetAtTime(0.02 + s.weather.wind * 0.04, now + len * 0.45, len * 0.3);
      this.due.swell = now + len;
    }
    if (now >= this.due.gull) {
      if (s.time === 'day' && !wet && kind !== 'fog' && kind !== 'snow') this.gull(now);
      this.due.gull = now + 7 + Math.random() * 16;
    }
    if (now >= this.due.creak) {
      this.creak(now, s.weather.wind);
      this.due.creak = now + 9 + Math.random() * 18 - s.weather.wind * 6;
    }
    if (now >= this.due.bell) {
      if (s.bell !== 'none' && kind !== 'storm') this.bell(now, s.bell);
      this.due.bell = now + 70 + Math.random() * 80;
    }
    if (now >= this.due.cricket) {
      if (s.time === 'night' && s.warm && !wet) this.crickets(now);
      this.due.cricket = now + 1.2 + Math.random() * 1.5;
    }
    if (now >= this.due.hammer) {
      if (s.building && s.time !== 'night' && kind !== 'storm') this.hammer(now);
      this.due.hammer = now + 1.4 + Math.random() * 2.5;
    }
  }

  private gull(t: number): void {
    const ctx = this.ctx!;
    const calls = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < calls; i++) {
      const at = t + i * (0.32 + Math.random() * 0.1);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const base = 1300 + Math.random() * 300;
      o.frequency.setValueAtTime(base, at);
      o.frequency.linearRampToValueAtTime(base * 1.45, at + 0.07);
      o.frequency.exponentialRampToValueAtTime(base * 0.75, at + 0.28);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 2.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.028, at + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      o.connect(f).connect(g).connect(this.out!);
      o.start(at); o.stop(at + 0.35);
    }
  }

  /** Ropes and timbers working: a low, wavering groan. */
  private creak(t: number, wind: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 50, len = 0.6 + Math.random() * 0.6;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (1.2 + Math.random() * 0.3), t + len);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.012 + wind * 0.02, t + len * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(this.out!);
    o.start(t); o.stop(t + len + 0.05);
  }

  /** A temple bell (low, long, a little out of tune with itself) or a church bell rung three times. */
  private bell(t: number, kind: 'temple' | 'church'): void {
    const ctx = this.ctx!;
    const strike = (at: number, f0: number, partials: number[], decay: number, peak: number) => {
      for (const [i, p] of partials.entries()) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * p;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak / (i + 1), at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + decay / (1 + i * 0.4));
        o.connect(g).connect(this.out!);
        o.start(at); o.stop(at + decay + 0.1);
      }
    };
    if (kind === 'temple') strike(t, 110 + Math.random() * 20, [1, 2.76, 5.4, 8.9], 7, 0.05);
    else for (let k = 0; k < 3; k++) strike(t + k * 1.6, 392, [0.5, 1, 1.2, 1.5, 2, 2.6], 3.5, 0.02);
  }

  private crickets(t: number): void {
    const ctx = this.ctx!;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.06;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4300 + Math.random() * 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.006, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      o.connect(g).connect(this.out!);
      o.start(at); o.stop(at + 0.05);
    }
  }

  /** Two or three blows of a mallet on timber, far off. */
  private hammer(t: number): void {
    const ctx = this.ctx!;
    const blows = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < blows; i++) {
      const at = t + i * 0.42;
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 200; f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.05, at + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      src.connect(f).connect(g).connect(this.out!);
      src.start(at, Math.random() * 3); src.stop(at + 0.12);
    }
  }
}
