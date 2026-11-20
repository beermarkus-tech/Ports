// Background music for the Age of Sail: an original sarabande in D minor, the
// slow triple-time dance in fashion in the 1650s, for lute, recorder and viol.
// Everything is synthesised (a plucked-string model for the lute), so there are
// no audio files. 32 bars, about 75 seconds, looping:
//   A   lute alone, playing the tune over its chords
//   A'  the recorder takes the tune, ornamented; the lute accompanies
//   B   the viol joins on the bass
//   B'  all three, ending on a bright D major chord (a period habit) before it begins again.

type Voice = 'lute' | 'recorder' | 'viol';
interface Note { beat: number; voice: Voice; midi: number; beats: number; vel: number }

const BEAT = 0.78; // seconds per beat: a stately sarabande
const BAR = 3;

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, A: 9, Bb: 10, B: 11 };
/** "D5" → MIDI number. */
function m(name: string): number {
  const match = /^([A-G](?:#|b)?)(\d)$/.exec(name)!;
  return 12 * (Number(match[2]) + 1) + NOTE[match[1]];
}

// Chords, one per bar: bass note and the three upper notes the lute strums.
const CHORDS: Record<string, [string, string[]]> = {
  Dm: ['D3', ['A3', 'D4', 'F4']], C: ['C3', ['G3', 'C4', 'E4']], Bb: ['Bb2', ['F3', 'Bb3', 'D4']], A: ['A2', ['E3', 'A3', 'C#4']],
  Gm: ['G2', ['G3', 'Bb3', 'D4']], F: ['F2', ['F3', 'A3', 'C4']], D: ['D3', ['A3', 'D4', 'F#4']],
};
const HARMONY_A = ['Dm', 'C', 'Bb', 'A', 'Dm', 'Gm', 'A', 'Dm'];
const HARMONY_B = ['F', 'C', 'Dm', 'A', 'Bb', 'Gm', 'A', 'D'];

// The tune, bar by bar: [note, beats]. The weight on the second beat is the sarabande's mark.
const TUNE_A: [string, number][][] = [
  [['A4', 1], ['D5', 1.5], ['E5', 0.5]], [['F5', 1], ['E5', 1.5], ['D5', 0.5]], [['D5', 1], ['F5', 2]], [['E5', 1], ['C#5', 2]],
  [['D5', 1], ['A5', 1.5], ['G5', 0.5]], [['Bb4', 1], ['D5', 1.5], ['G5', 0.5]], [['F5', 0.5], ['E5', 0.5], ['D5', 1], ['C#5', 1]], [['D5', 3]],
];
const TUNE_A2: [string, number][][] = [
  [['A4', 0.5], ['C5', 0.5], ['D5', 1.5], ['E5', 0.5]], [['F5', 0.5], ['G5', 0.5], ['E5', 1.5], ['D5', 0.5]], [['D5', 1], ['F5', 1.5], ['A5', 0.5]],
  [['G5', 0.5], ['F5', 0.5], ['E5', 2]], [['D5', 1], ['A5', 1.5], ['G5', 0.5]], [['F5', 0.5], ['E5', 0.5], ['D5', 1.5], ['G5', 0.5]],
  [['E5', 1], ['D5', 1], ['C#5', 1]], [['D5', 3]],
];
const TUNE_B: [string, number][][] = [
  [['C5', 1], ['F5', 1.5], ['G5', 0.5]], [['E5', 1], ['G5', 1.5], ['F5', 0.5]], [['F5', 1], ['A5', 1.5], ['G5', 0.5]], [['E5', 1], ['A4', 2]],
  [['F5', 1], ['D5', 1.5], ['F5', 0.5]], [['G5', 1], ['Bb5', 1.5], ['A5', 0.5]], [['G5', 0.5], ['F5', 0.5], ['E5', 1], ['C#5', 1]], [['D5', 3]],
];
const TUNE_B2: [string, number][][] = [
  [['C5', 0.5], ['D5', 0.5], ['F5', 1.5], ['G5', 0.5]], [['E5', 0.5], ['F5', 0.5], ['G5', 1.5], ['F5', 0.5]], [['F5', 0.5], ['G5', 0.5], ['A5', 1.5], ['G5', 0.5]],
  [['F5', 0.5], ['E5', 0.5], ['A4', 2]], [['D5', 0.5], ['E5', 0.5], ['F5', 1.5], ['D5', 0.5]], [['G5', 0.5], ['A5', 0.5], ['Bb5', 1.5], ['A5', 0.5]],
  [['G5', 0.5], ['F5', 0.5], ['E5', 1], ['C#5', 1]], [['D5', 3]],
];

function score(): Note[] {
  const notes: Note[] = [];
  const section = (startBar: number, harmony: string[], tune: [string, number][][], tuneVoice: Voice, viol: boolean, lastBright = false) => {
    harmony.forEach((chord, i) => {
      const b0 = (startBar + i) * BAR;
      let [bass, upper] = CHORDS[chord];
      if (lastBright && i === harmony.length - 1) [bass, upper] = CHORDS.D;
      const final = i === harmony.length - 1;
      // Lute: bass on one, the chord rolled on two (the sarabande's weight), a single note on three.
      notes.push({ beat: b0, voice: 'lute', midi: m(bass), beats: 3, vel: 0.9 });
      upper.forEach((n, k) => notes.push({ beat: b0 + 1 + k * 0.04, voice: 'lute', midi: m(n), beats: 2, vel: 0.55 }));
      if (!final) notes.push({ beat: b0 + 2, voice: 'lute', midi: m(upper[1]), beats: 1, vel: 0.45 });
      if (viol) notes.push({ beat: b0, voice: 'viol', midi: m(bass), beats: final ? 3 : 2.9, vel: 0.5 });
      let t = b0;
      for (const [n, beats] of tune[i]) {
        const name = lastBright && final && n === 'D5' ? 'D5' : n;
        notes.push({ beat: t, voice: tuneVoice, midi: m(name), beats, vel: tuneVoice === 'lute' ? 0.75 : 0.6 });
        t += beats;
      }
    });
  };
  section(0, HARMONY_A, TUNE_A, 'lute', false);
  section(8, HARMONY_A, TUNE_A2, 'recorder', false);
  section(16, HARMONY_B, TUNE_B, 'recorder', true);
  section(24, HARMONY_B, TUNE_B2, 'recorder', true, true);
  return notes.sort((a, b) => a.beat - b.beat);
}

const SCORE = score();
const LOOP_BEATS = 32 * BAR;
const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class Music {
  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private timer: number | null = null;
  private loopStart = 0;
  private next = 0;
  private plucks = new Map<number, AudioBuffer>();
  playing = false;

  /** Start (or keep) playing into `dest` at a gentle level. */
  start(ctx: AudioContext, dest: AudioNode): void {
    if (this.playing && this.ctx === ctx) return;
    this.stop();
    this.connect(ctx, dest);
    this.loopStart = ctx.currentTime + 0.3;
    this.next = 0;
    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), 120);
    this.schedule();
  }

  /** Render one whole loop into an offline context (for checking the mix, or exporting it). */
  renderLoop(ctx: OfflineAudioContext): void {
    this.connect(ctx, ctx.destination);
    this.loopStart = 0.1;
    this.next = 0;
    for (const n of SCORE) this.play(n, this.loopStart + n.beat * BEAT);
  }

  /** Seconds in one pass of the piece. */
  static get loopSeconds(): number { return LOOP_BEATS * BEAT; }

  private connect(ctx: BaseAudioContext, dest: AudioNode): void {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 3); // fade in
    // A soft room: dry plus a little synthetic reverb, and the top end rolled off.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(ctx, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.out.connect(tone);
    tone.connect(dest);
    tone.connect(verb).connect(wet).connect(dest);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx && this.out) {
      const t = this.ctx.currentTime;
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
      this.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      const old = this.out;
      setTimeout(() => old.disconnect(), 1000);
    }
    this.out = null;
    this.playing = false;
  }

  /** Queue the notes due in the next second or so. */
  private schedule(): void {
    const ctx = this.ctx!;
    const horizon = ctx.currentTime + 1.2;
    for (;;) {
      if (this.next >= SCORE.length) { this.next = 0; this.loopStart += LOOP_BEATS * BEAT; }
      const n = SCORE[this.next];
      const at = this.loopStart + n.beat * BEAT;
      if (at > horizon) break;
      if (at > ctx.currentTime - 0.05) this.play(n, at);
      this.next++;
    }
  }

  private play(n: Note, at: number): void {
    // A little human looseness in time and touch.
    const t = Math.max(this.ctx!.currentTime, at + (Math.random() - 0.5) * 0.02);
    const vel = n.vel * (0.9 + Math.random() * 0.2);
    if (n.voice === 'lute') this.lute(t, n.midi, vel);
    else if (n.voice === 'recorder') this.recorder(t, n.midi, n.beats * BEAT, vel);
    else this.viol(t, n.midi, n.beats * BEAT, vel);
  }

  /** A plucked gut string (Karplus–Strong), rendered once per pitch. */
  private pluck(midi: number): AudioBuffer {
    const hit = this.plucks.get(midi);
    if (hit) return hit;
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const f = freq(midi);
    const len = Math.floor(sr * (midi < 50 ? 3.2 : 2.4));
    const buf = ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / f));
    // A soft pluck: smoothed noise, so it sounds like a finger, not a plectrum.
    let prev = 0;
    for (let i = 0; i < period; i++) { prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5; y[i] = prev; }
    const damp = midi < 50 ? 0.9965 : 0.994;
    for (let i = period; i < len; i++) y[i] = damp * 0.5 * (y[i - period] + y[i - period - 1 >= 0 ? i - period - 1 : 0]);
    this.plucks.set(midi, buf);
    return buf;
  }

  private lute(t: number, midi: number, vel: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.pluck(midi);
    const g = ctx.createGain();
    g.gain.value = 0.55 * vel;
    const body = ctx.createBiquadFilter(); // the lute's round body
    body.type = 'lowpass';
    body.frequency.value = 2200;
    src.connect(body).connect(g).connect(this.out!);
    src.start(t);
  }

  /** A recorder: a pure, breathy tone that swells in and takes a gentle vibrato. */
  private recorder(t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx!;
    const f = freq(midi);
    const g = ctx.createGain();
    const peak = 0.11 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.07);
    g.gain.setValueAtTime(peak, t + Math.max(0.08, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    const a = ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = f;
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = f * 2;
    const bg = ctx.createGain();
    bg.gain.value = 0.12;
    // Vibrato only on longer notes, arriving after the note has settled.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    if (dur > 0.6) depth.gain.linearRampToValueAtTime(f * 0.005, t + Math.min(dur, 0.5));
    lfo.connect(depth);
    depth.connect(a.frequency);
    depth.connect(b.frequency);
    a.connect(g);
    b.connect(bg).connect(g);
    g.connect(this.out!);
    for (const o of [a, b, lfo]) { o.start(t); o.stop(t + dur + 0.15); }
  }

  /** A bass viol: a bowed, reedy tone, kept low and soft. */
  private viol(t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 520;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    const peak = 0.07 * vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.25);
    g.gain.setValueAtTime(peak, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
    o.connect(f).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.4);
  }

  /** A synthetic room: decaying noise. */
  private impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    return buf;
  }
}
