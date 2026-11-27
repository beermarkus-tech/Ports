// Sound effects, synthesised with the Web Audio API (no audio files to load,
// so they work offline). Off until the first tap, as browsers require; the
// mute setting is remembered on the device.

import { Ambience, type AmbientScene } from './ambience';
import { Music, type Piece } from './music';

export type SoundName = 'horn' | 'sails' | 'bell' | 'coins' | 'thunder' | 'clank' | 'fanfare' | 'click';

const KEY = 'deadweight.sound';
const MUSIC_KEY = 'deadweight.music';
const AMBIENT_KEY = 'deadweight.ambient';

class SoundBoard {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled: boolean;
  /** Background music on (the player's choice; it only plays where the era has some). */
  musicOn: boolean;
  /** Whether the current game has music (the Age of Sail does). */
  private musicWanted = false;
  private music = new Music();
  /** The harbour's own sound (the player's choice, on unless turned off), and the harbour shown. */
  ambientOn: boolean;
  private ambience = new Ambience();
  private ambientScene: AmbientScene | null = null;

  constructor() {
    let saved: string | null = null, music: string | null = null, ambient: string | null = null;
    try { saved = localStorage.getItem(KEY); music = localStorage.getItem(MUSIC_KEY); ambient = localStorage.getItem(AMBIENT_KEY); } catch { /* private mode */ }
    this.enabled = saved !== 'off';
    this.musicOn = music !== 'off';
    this.ambientOn = ambient !== 'off';
  }

  /** Play or stop the background music to match the settings and the game. */
  private syncMusic(): void {
    const ctx = this.ctx;
    if (ctx && this.master && ctx.state === 'running' && this.enabled && this.musicOn && this.musicWanted) this.music.start(ctx, this.master);
    else this.music.stop();
    if (ctx && this.master && ctx.state === 'running' && this.enabled && this.ambientOn && this.ambientScene) {
      this.ambience.start(ctx, this.master);
      this.ambience.set(this.ambientScene);
    } else if (this.ambience.running) this.ambience.stop();
  }

  /** The harbour being shown (its sound plays), or null (the map: no harbour sound). */
  setAmbience(scene: AmbientScene | null): void {
    const same = JSON.stringify(scene) === JSON.stringify(this.ambientScene);
    this.ambientScene = scene;
    if (!same) this.syncMusic();
  }

  setAmbientOn(on: boolean): void {
    this.ambientOn = on;
    try { localStorage.setItem(AMBIENT_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
    this.syncMusic();
  }

  /** Whether the game has music, and which piece (the Age of Sail: one per merchant house). */
  setMusicWanted(on: boolean, piece?: Piece): void {
    this.musicWanted = on;
    if (piece) this.music.setPiece(piece);
    this.syncMusic();
  }

  setMusicOn(on: boolean): void {
    this.musicOn = on;
    try { localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
    this.syncMusic();
  }

  /** Must be called from a user gesture before the first sound. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.syncMusic());
      else this.syncMusic();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    if (this.ctx.state === 'running') this.syncMusic();
    else void this.ctx.resume().then(() => this.syncMusic());
  }

  /**
   * The app went to the background (another app, the screen off) or came back: all sound is
   * suspended while it's hidden, and the music picks up where it was on return.
   */
  setHidden(hidden: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) { if (ctx.state === 'running') void ctx.suspend(); }
    else if (ctx.state === 'suspended') void ctx.resume().then(() => this.syncMusic()).catch(() => { /* needs a tap: unlock() */ });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
    this.syncMusic();
  }

  play(name: SoundName): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    ({ horn: () => this.horn(t), sails: () => this.sails(t), bell: () => this.bell(t), coins: () => this.coins(t), thunder: () => this.thunder(t),
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

  /**
   * Sails filling with wind as a sailing ship gets under way: a soft gust of
   * filtered noise swelling and fading, with a dull flap of canvas in it.
   */
  private sails(t: number): void {
    const ctx = this.ctx!;
    const dur = 1.8;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // The gust: band-passed noise whose pitch rises a little as the wind takes the sails.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    band.frequency.setValueAtTime(380, t);
    band.frequency.linearRampToValueAtTime(700, t + 0.9);
    band.frequency.linearRampToValueAtTime(450, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + dur);
    // Two soft flaps of canvas as the sails fill.
    for (const at of [0.35, 0.62]) this.noise(t, 0.12, 300, 0.12, at);
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
