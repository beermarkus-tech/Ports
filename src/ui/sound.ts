// Sound effects, synthesised with the Web Audio API (no audio files to load,
// so they work offline). Off until the first tap, as browsers require; the
// mute setting is remembered on the device.

export type SoundName = 'horn' | 'bell' | 'coins' | 'thunder' | 'clank' | 'fanfare' | 'click';

const KEY = 'deadweight.sound';

class SoundBoard {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean;

  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
    this.enabled = saved !== 'off';
  }

  /** Must be called from a user gesture before the first sound. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  }

  play(name: SoundName): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    ({ horn: () => this.horn(t), bell: () => this.bell(t), coins: () => this.coins(t), thunder: () => this.thunder(t),
      clank: () => this.clank(t), fanfare: () => this.fanfare(t), click: () => this.tone(t, 900, 0.03, 'square', 0.03) })[name]();
  }

  private env(gain: GainNode, t: number, attack: number, peak: number, release: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, peak: number, at = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const gain = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    this.env(gain, t + at, 0.005, peak, dur);
    o.connect(gain).connect(this.master!);
    o.start(t + at);
    o.stop(t + at + dur + 0.05);
  }

  private noise(t: number, dur: number, filterFreq: number, peak: number, at = 0): void {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; // brown-ish noise
      data[i] = last * 6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    this.env(gain, t + at, 0.05, peak, dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t + at);
  }

  /** A ship's horn: two low, slightly detuned sawtooths through a low-pass filter. */
  private horn(t: number): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.12);
    gain.gain.setValueAtTime(0.22, t + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    filter.connect(gain).connect(this.master!);
    for (const f of [110, 110 * 1.5, 111]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start(t);
      o.stop(t + 1.6);
    }
  }

  private bell(t: number): void {
    for (const [f, p] of [[880, 0.12], [1760, 0.05], [2637, 0.025]] as const) {
      const ctx = this.ctx!;
      const o = ctx.createOscillator();
      const gain = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      this.env(gain, t, 0.004, p, 1.6);
      o.connect(gain).connect(this.master!);
      o.start(t);
      o.stop(t + 1.8);
    }
  }

  private coins(t: number): void {
    [1318, 1568, 2093, 1760, 2349].forEach((f, i) => this.tone(t, f, 0.12, 'triangle', 0.07, i * 0.06));
  }

  private thunder(t: number): void {
    this.noise(t, 2.2, 260, 0.5);
    this.noise(t, 0.5, 900, 0.18, 0.05);
  }

  private clank(t: number): void {
    this.tone(t, 180, 0.25, 'square', 0.06);
    this.tone(t, 247, 0.2, 'square', 0.04, 0.12);
    this.noise(t, 0.25, 1800, 0.12, 0.02);
  }

  private fanfare(t: number): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(t, f, i === 3 ? 0.6 : 0.16, 'triangle', 0.09, i * 0.12));
  }
}

export const sound = new SoundBoard();
