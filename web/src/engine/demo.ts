/**
 * Deterministic synthetic song with a known structure — used as the in-app
 * demo track and to test the whole analysis chain end-to-end.
 */
import { midiToHz } from "../dsp/util";

function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthSection {
  kind: "intro" | "verse" | "chorus" | "bridge" | "outro";
  bars: number;
  chords: number[][]; // midi notes per bar (cycled)
  drums: boolean;
  lead: number[] | null; // melody motif (midi per beat, cycled), null = none
  gain: number;
}

const Am = [57, 60, 64], F = [53, 57, 60], C = [48, 52, 55], G = [55, 59, 62], Dm = [50, 53, 57], Em = [52, 55, 59];

export const SONG: SynthSection[] = [
  { kind: "intro", bars: 4, chords: [Am, F], drums: false, lead: null, gain: 0.35 },
  { kind: "verse", bars: 8, chords: [Am, F, C, G], drums: true, lead: [69, 69, 67, 64, 65, 64, 62, 60], gain: 0.55 },
  { kind: "chorus", bars: 8, chords: [F, G, C, Am], drums: true, lead: [72, 76, 74, 72, 76, 79, 76, 74], gain: 0.95 },
  { kind: "verse", bars: 8, chords: [Am, F, C, G], drums: true, lead: [69, 69, 67, 64, 65, 64, 62, 60], gain: 0.55 },
  { kind: "chorus", bars: 8, chords: [F, G, C, Am], drums: true, lead: [72, 76, 74, 72, 76, 79, 76, 74], gain: 0.95 },
  { kind: "bridge", bars: 4, chords: [Dm, Em], drums: false, lead: [74, 72, 71, 69], gain: 0.4 },
  { kind: "chorus", bars: 8, chords: [F, G, C, Am], drums: true, lead: [72, 76, 74, 72, 76, 79, 76, 74], gain: 0.95 },
  { kind: "outro", bars: 4, chords: [Am, F], drums: false, lead: null, gain: 0.3 },
];

export function synthSong(bpm = 120, fs = 22050, sections = SONG): { left: Float32Array; right: Float32Array; truth: { kind: string; start: number; end: number }[] } {
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const totalBars = sections.reduce((a, s) => a + s.bars, 0);
  const n = Math.round(totalBars * bar * fs) + fs;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const r = rng(3);
  const truth: { kind: string; start: number; end: number }[] = [];
  let t0 = 0;
  const add = (buf: Float32Array, start: number, len: number, fn: (i: number) => number) => {
    const s = Math.round(start * fs);
    for (let i = 0; i < len && s + i < buf.length; i++) buf[s + i] += fn(i);
  };
  for (const sec of sections) {
    truth.push({ kind: sec.kind, start: t0, end: t0 + sec.bars * bar });
    for (let b = 0; b < sec.bars; b++) {
      const tb = t0 + b * bar;
      const chord = sec.chords[b % sec.chords.length];
      const len = Math.round(bar * fs);
      // pad chords (stereo-spread), 4 partials
      for (const [ci, m] of chord.entries()) {
        const f = midiToHz(m);
        const pan = 0.35 + 0.3 * (ci / 2);
        const fn = (i: number) => {
          const env = Math.min(1, i / (0.02 * fs)) * Math.min(1, (len - i) / (0.02 * fs));
          let v = 0;
          for (let h = 1; h <= 4; h++) v += Math.sin((2 * Math.PI * f * h * i) / fs) / h;
          return 0.06 * sec.gain * env * v;
        };
        add(left, tb, len, (i) => fn(i) * (1 - pan) * 2);
        add(right, tb, len, (i) => fn(i) * pan * 2);
      }
      // bass root
      const fb = midiToHz(chord[0] - 12);
      add(left, tb, len, (i) => 0.18 * sec.gain * Math.sin((2 * Math.PI * fb * i) / fs) * Math.min(1, (len - i) / (0.01 * fs)));
      add(right, tb, len, (i) => 0.18 * sec.gain * Math.sin((2 * Math.PI * fb * i) / fs) * Math.min(1, (len - i) / (0.01 * fs)));
      for (let q = 0; q < 4; q++) {
        const tq = tb + q * beat;
        if (sec.drums) {
          if (q % 2 === 0) {
            const kl = Math.round(0.15 * fs);
            const kick = (i: number) => 0.6 * sec.gain * Math.exp(-i / (0.04 * fs)) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-i / (0.01 * fs))) * (i / fs));
            add(left, tq, kl, kick);
            add(right, tq, kl, kick);
          } else {
            const sl = Math.round(0.12 * fs);
            const vals = Array.from({ length: sl }, (_, i) => 0.25 * sec.gain * Math.exp(-i / (0.03 * fs)) * (r() * 2 - 1));
            add(left, tq, sl, (i) => vals[i]);
            add(right, tq, sl, (i) => vals[i]);
          }
          for (const h of [0, 0.5]) {
            const hl = Math.round(0.03 * fs);
            const hv = Array.from({ length: hl }, (_, i) => 0.05 * sec.gain * Math.exp(-i / (0.005 * fs)) * (r() * 2 - 1));
            add(left, tq + h * beat, hl, (i) => hv[i] * 0.8);
            add(right, tq + h * beat, hl, (i) => hv[i] * 1.2);
          }
        }
        if (sec.lead) {
          const m = sec.lead[(b * 4 + q) % sec.lead.length];
          const f = midiToHz(m);
          const ll = Math.round(beat * 0.9 * fs);
          const lead = (i: number) => {
            const env = Math.min(1, i / (0.01 * fs)) * Math.min(1, (ll - i) / (0.02 * fs));
            const vib = 1 + 0.004 * Math.sin((2 * Math.PI * 5.5 * i) / fs);
            let v = 0;
            for (let h = 1; h <= 8; h++) v += (Math.sin((2 * Math.PI * f * vib * h * i) / fs) / h) * (h >= 3 && h <= 6 ? 1.6 : 1);
            return 0.09 * sec.gain * env * v;
          };
          add(left, tq, ll, lead);
          add(right, tq, ll, lead);
        }
      }
    }
    t0 += sec.bars * bar;
  }
  return { left, right, truth };
}
