// Background music for the Chinese house: an original piece in the manner of the southern
// (Fujian) ensemble music of the time, slow and lyrical, in the pentatonic zhi mode on D
// (D E G A B, ending on D). Instruments: pipa (the lute, with its tremolo on long notes),
// zheng (the zither, keeping the pulse with low fifths), xiao (the end-blown flute, sliding
// into its notes), the wooden fish and a small gong. 34 bars of four, about two minutes:
//   intro  a gong stroke and a rising sweep across the zheng
//   I      the pipa plays the tune, the zheng accompanies
//   II     the xiao takes the tune, ornamented; the pipa plays round it in heterophony
//          (the same tune, simplified, an octave below), the wooden fish keeps time.
// The tune is 16 bars: A (8 bars, ending open on A) and B (8 bars, higher, coming home to D).

import type { Note, Piece } from './music';

const BEAT = 0.85; // seconds per beat: unhurried
const BAR = 4;

const NOTE: Record<string, number> = { D: 2, E: 4, G: 7, A: 9, B: 11 };
/** "D5" → MIDI number (the mode has only D, E, G, A and B). */
function m(name: string): number {
  const match = /^([A-G])(\d)$/.exec(name)!;
  return 12 * (Number(match[2]) + 1) + NOTE[match[1]];
}

type Bar = [string, number][];
const TUNE: Bar[] = [
  // A: a question that rises to D and falls home, then answers higher and ends open on A.
  [['A4', 1], ['B4', 0.5], ['A4', 0.5], ['G4', 1], ['E4', 1]],
  [['G4', 1.5], ['A4', 0.5], ['D5', 2]],
  [['B4', 1], ['A4', 0.5], ['G4', 0.5], ['E4', 1], ['G4', 0.5], ['E4', 0.5]],
  [['D4', 4]],
  [['E4', 1], ['G4', 1], ['A4', 1.5], ['B4', 0.5]],
  [['D5', 1], ['E5', 0.5], ['D5', 0.5], ['B4', 2]],
  [['A4', 1], ['B4', 0.5], ['A4', 0.5], ['G4', 1], ['E4', 1]],
  [['G4', 0.5], ['E4', 0.5], ['G4', 1], ['A4', 2]],
  // B: up to the high G, then a long, winding way down to D.
  [['D5', 1.5], ['E5', 0.5], ['G5', 1], ['E5', 1]],
  [['D5', 1], ['B4', 0.5], ['D5', 0.5], ['E5', 2]],
  [['G5', 1], ['E5', 0.5], ['D5', 0.5], ['B4', 1], ['A4', 1]],
  [['B4', 1.5], ['D5', 0.5], ['A4', 2]],
  [['G4', 1], ['A4', 0.5], ['B4', 0.5], ['D5', 1], ['B4', 1]],
  [['A4', 1], ['G4', 0.5], ['E4', 0.5], ['G4', 2]],
  [['E4', 1], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5]],
  [['D4', 4]],
];
/** The zheng's low note under each bar of the tune (it adds the fifth above, all in the mode). */
const ROOTS = ['D', 'G', 'E', 'D', 'E', 'G', 'A', 'A', 'G', 'G', 'E', 'A', 'G', 'E', 'A', 'D'];
const LOW: Record<string, string> = { D: 'D3', G: 'G2', E: 'E3', A: 'A2' };
const SCALE = ['D', 'E', 'G', 'A', 'B'];

const up = (name: string, steps = 1): string => {
  // The note `steps` places higher in the mode.
  const [, l, o] = /^([A-G])(\d)$/.exec(name)!;
  const i = SCALE.indexOf(l) + steps;
  return `${SCALE[i % 5]}${Number(o) + Math.floor(i / 5)}`;
};
const octaveDown = (name: string): string => name.replace(/\d$/, (o) => String(Number(o) - 1));

function score(): Note[] {
  const notes: Note[] = [];
  const add = (beat: number, voice: Note['voice'], name: string | null, beats: number, vel: number, extra: Partial<Note> = {}) =>
    notes.push({ beat, voice, midi: name ? m(name) : 0, beats, vel, ...extra });

  // Intro (bars 0–1): the gong, a sweep up the zheng, then the zheng's pulse alone.
  add(0, 'gong', null, 4, 0.8);
  ['D3', 'E3', 'G3', 'A3', 'B3', 'D4', 'E4', 'G4', 'A4', 'B4', 'D5'].forEach((n, i) => add(0.5 + i * 0.075, 'zheng', n, 3, 0.35 + i * 0.03));
  add(4, 'zheng', 'D3', 2, 0.8); add(4.04, 'zheng', 'A3', 2, 0.5); add(6, 'zheng', 'D4', 2, 0.4); add(7, 'zheng', 'A3', 1, 0.3);

  const zheng = (b0: number, root: string, last: boolean) => {
    const low = LOW[root];
    add(b0, 'zheng', low, 2, 0.75);
    add(b0 + 0.04, 'zheng', up(low, 3), 2, 0.45);           // the fifth above
    if (last) { add(b0 + 1, 'zheng', up(low, 5), 3, 0.4); add(b0 + 1.06, 'zheng', up(low, 8), 3, 0.32); return; }
    add(b0 + 2, 'zheng', up(low, 5), 1, 0.38);              // the octave
    add(b0 + 3, 'zheng', up(low, 3), 1, 0.3);
  };

  const PASS1 = 2 * BAR, PASS2 = 18 * BAR;
  TUNE.forEach((bar, i) => {
    const root = ROOTS[i], last = i === TUNE.length - 1;
    // I: the pipa alone with the tune, tremolo on the long notes.
    let t = PASS1 + i * BAR;
    zheng(t, root, last);
    for (const [n, beats] of bar) { add(t, 'pipa', n, beats, 0.75, { tremolo: beats >= 2 }); t += beats; }

    // II: the xiao sings the tune; the pipa answers it underneath.
    const b0 = PASS2 + i * BAR;
    if (i === 0) add(b0, 'gong', null, 4, 0.45);
    zheng(b0, root, last);
    add(b0, 'muyu', null, 0.25, 0.5);
    if (!last) add(b0 + 2, 'muyu', null, 0.25, 0.3);
    t = b0;
    let prev = i ? TUNE[i - 1][TUNE[i - 1].length - 1][0] : 'D4';
    for (const [n, beats] of bar) {
      if (beats >= 1.5 && !last) {
        // A grace note from above before a long note.
        add(t, 'xiao', up(n), 0.15, 0.45);
        add(t + 0.15, 'xiao', n, beats - 0.15, 0.6);
      } else {
        // Slide up into a note reached by a leap from below.
        const leap = m(n) - m(prev);
        add(t, 'xiao', n, beats, 0.6, leap >= 3 && beats >= 1 ? { slide: 2 } : {});
      }
      // Heterophony: on the strong beats the pipa plucks what the tune holds, an octave down.
      if (t - b0 === 0 || t - b0 === 2) add(t, 'pipa', octaveDown(n), Math.min(beats, 2), 0.42, { tremolo: last });
      prev = n;
      t += beats;
    }
  });
  return notes.sort((a, b) => a.beat - b.beat);
}

export const NANYANG: Piece = { notes: score(), beat: BEAT, loopBeats: 34 * BAR };
