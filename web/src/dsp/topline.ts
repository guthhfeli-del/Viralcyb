/**
 * Topline transcription & prediction:
 *  - pitch-track → note events (median smoothing, stability, min duration)
 *  - live key estimation from sung notes
 *  - next-note prediction: the singer's own n-gram habits blended with
 *    melodic tendencies (step motion, resolution to stable degrees,
 *    gap-fill after leaps) and snapped to the key
 */
import { estimateKeyFromChroma, scaleOf, type KeyResult } from "./key";
import { hzToMidi, median, midiName } from "./util";

export interface NoteEvent {
  midi: number; // rounded pitch
  cents: number; // average deviation from the rounded pitch
  start: number; // s
  end: number; // s
  velocity: number; // 1..127
}

export interface PitchPoint {
  t: number;
  freq: number;
  clarity: number;
  rms: number;
}

/** Segment a pitch contour into notes. */
export function segmentNotes(points: PitchPoint[], opts: { minDur?: number; maxGap?: number; clarityMin?: number } = {}): NoteEvent[] {
  const minDur = opts.minDur ?? 0.09;
  const maxGap = opts.maxGap ?? 0.05;
  const clarityMin = opts.clarityMin ?? 0.6;
  const notes: NoteEvent[] = [];
  let cur: { pitches: number[]; start: number; last: number; rms: number[]; peak: number; dip: boolean } | null = null;
  const voiced = points.map((p) => (p.freq > 0 && p.clarity >= clarityMin ? hzToMidi(p.freq) : NaN));
  // 5-point median to kill octave blips
  const sm = voiced.map((_, i) => {
    const w = voiced.slice(Math.max(0, i - 2), i + 3).filter((v) => !Number.isNaN(v));
    return Number.isNaN(voiced[i]) || w.length < 2 ? voiced[i] : median(w);
  });
  const flush = () => {
    if (!cur) return;
    const dur = cur.last - cur.start;
    if (dur >= minDur) {
      const m = median(cur.pitches);
      const r = Math.round(m);
      const loud = Math.max(...cur.rms);
      notes.push({ midi: r, cents: Math.round((m - r) * 100), start: cur.start, end: cur.last, velocity: Math.max(20, Math.min(127, Math.round(40 + 600 * loud))) });
    }
    cur = null;
  };
  for (let i = 0; i < points.length; i++) {
    const p = sm[i];
    const t = points[i].t;
    const r = points[i].rms;
    // a loudness dip followed by a new rise is a re-articulation (same pitch, new syllable)
    if (cur && r < 0.4 * cur.peak) cur.dip = true;
    if (Number.isNaN(p)) {
      if (cur && t - cur.last > maxGap) flush();
      continue;
    }
    if (cur) {
      const ref = median(cur.pitches.slice(-6));
      if (Math.abs(p - ref) > 0.7 || (cur.dip && r > 0.7 * cur.peak)) flush();
    }
    if (!cur) cur = { pitches: [], start: t, last: t, rms: [], peak: 0, dip: false };
    cur.peak = Math.max(cur.peak, r);
    cur.pitches.push(p);
    cur.rms.push(points[i].rms);
    cur.last = t;
  }
  flush();
  return notes;
}

export function keyFromNotes(notes: NoteEvent[]): KeyResult | null {
  if (notes.length < 4) return null;
  const chroma = new Array(12).fill(0);
  for (const n of notes) chroma[((n.midi % 12) + 12) % 12] += Math.min(1.5, n.end - n.start);
  return estimateKeyFromChroma(chroma);
}

export interface Prediction {
  midi: number;
  name: string;
  p: number;
}

/**
 * Predict the next sung note. Mixes an order-2/order-1 model of the singer's
 * own interval habits with generic melodic priors, restricted to the key.
 */
export function predictNext(notes: NoteEvent[], key: KeyResult | null, top = 3): Prediction[] {
  if (!notes.length) return [];
  const last = notes[notes.length - 1].midi;
  const prev = notes.length > 1 ? notes[notes.length - 2].midi : null;
  const scale = key ? scaleOf(key.mode).map((d) => (d + key.tonic) % 12) : null;
  const inKey = (m: number) => !scale || scale.includes(((m % 12) + 12) % 12);
  const cands: number[] = [];
  for (let m = last - 12; m <= last + 12; m++) if (inKey(m)) cands.push(m);

  // user n-gram over intervals
  const ivs = notes.slice(1).map((n, i) => n.midi - notes[i].midi);
  const lastIv = prev !== null ? last - prev : null;
  const uni = new Map<number, number>();
  const bi = new Map<number, number>();
  ivs.forEach((iv, i) => {
    uni.set(iv, (uni.get(iv) ?? 0) + 1);
    if (i > 0 && lastIv !== null && ivs[i - 1] === lastIv) bi.set(iv, (bi.get(iv) ?? 0) + 1);
  });
  const biTotal = [...bi.values()].reduce((a, b) => a + b, 0);
  const uniTotal = [...uni.values()].reduce((a, b) => a + b, 0);
  // recency: exact phrase continuation (motif repetition) is very likely in hooks
  const motif = new Map<number, number>();
  if (notes.length >= 3) {
    const a = notes[notes.length - 2].midi, b = last;
    for (let i = 0; i + 2 < notes.length - 1; i++) {
      if (notes[i].midi === a && notes[i + 1].midi === b) motif.set(notes[i + 2].midi, (motif.get(notes[i + 2].midi) ?? 0) + 1 + i / notes.length);
    }
  }
  const motifTotal = [...motif.values()].reduce((a, b) => a + b, 0);

  const scores = cands.map((m) => {
    const iv = m - last;
    const aiv = Math.abs(iv);
    // melodic priors: repeats and steps dominate, leaps are rarer
    let prior = aiv === 0 ? 0.9 : aiv <= 2 ? 1 : aiv <= 4 ? 0.55 : aiv <= 7 ? 0.3 : 0.1;
    // gap fill: after a leap, move back by step in the opposite direction
    if (lastIv !== null && Math.abs(lastIv) >= 5 && Math.sign(iv) === -Math.sign(lastIv) && aiv <= 2) prior *= 1.8;
    // stable degrees (tonic, third, fifth) attract, especially the tonic
    if (key) {
      const deg = (((m - key.tonic) % 12) + 12) % 12;
      const third = key.mode === "major" ? 4 : 3;
      if (deg === 0) prior *= 1.35;
      else if (deg === 7 || deg === third) prior *= 1.15;
    }
    // stay in the singer's comfortable register
    const center = median(notes.slice(-12).map((n) => n.midi));
    prior *= Math.exp(-0.5 * ((m - center) / 6) ** 2);
    const pBi = biTotal ? (bi.get(iv) ?? 0) / biTotal : 0;
    const pUni = uniTotal ? (uni.get(iv) ?? 0) / uniTotal : 0;
    const pMotif = motifTotal ? (motif.get(m) ?? 0) / motifTotal : 0;
    const user = 0.5 * pMotif + 0.3 * pBi + 0.2 * pUni;
    const wUser = Math.min(0.7, notes.length / 24);
    return { m, s: (1 - wUser) * prior + wUser * user * 3 };
  });
  const total = scores.reduce((a, b) => a + b.s, 0) || 1;
  return scores
    .map((x) => ({ midi: x.m, name: midiName(x.m), p: x.s / total }))
    .sort((a, b) => b.p - a.p)
    .slice(0, top);
}

/** Snap notes to the key (fix out-of-scale notes to the nearest degree). */
export function quantizeToKey(notes: NoteEvent[], key: KeyResult): NoteEvent[] {
  const scale = scaleOf(key.mode).map((d) => (d + key.tonic) % 12);
  return notes.map((n) => {
    const pc = ((n.midi % 12) + 12) % 12;
    if (scale.includes(pc)) return n;
    const up = scale.includes((pc + 1) % 12);
    const down = scale.includes((pc + 11) % 12);
    const delta = n.cents >= 0 ? (up ? 1 : -1) : down ? -1 : 1;
    return { ...n, midi: n.midi + delta, cents: 0 };
  });
}

/** Simple melodic variations of a phrase, for hook ideas. */
export function variations(notes: NoteEvent[], key: KeyResult | null): { title: string; notes: NoteEvent[] }[] {
  if (notes.length < 3) return [];
  const scale = key ? scaleOf(key.mode).map((d) => (d + key.tonic) % 12) : [0, 2, 4, 5, 7, 9, 11];
  const stepInScale = (m: number, steps: number) => {
    let x = m;
    let s = steps;
    while (s !== 0) {
      x += Math.sign(s);
      if (scale.includes(((x % 12) + 12) % 12)) s -= Math.sign(s);
    }
    return x;
  };
  const dur = notes[notes.length - 1].end - notes[0].start;
  const shift = (ns: NoteEvent[], dt: number) => ns.map((n) => ({ ...n, start: n.start + dt, end: n.end + dt }));
  const base = shift(notes, -notes[0].start);
  return [
    { title: "Séquence (+1 degré)", notes: base.map((n) => ({ ...n, midi: stepInScale(n.midi, 1) })) },
    { title: "Question → réponse", notes: [...base, ...shift(base.map((n, i) => (i === base.length - 1 ? { ...n, midi: key ? nearestTonic(n.midi, key.tonic) : n.midi } : n)), dur + 0.1)] },
    { title: "Inversion", notes: base.map((n) => ({ ...n, midi: base[0].midi - (n.midi - base[0].midi) })) },
    { title: "Décalage rythmique (½ temps)", notes: shift(base, 0.25) },
  ];
}

function nearestTonic(m: number, tonic: number): number {
  let best = m, d = Infinity;
  for (let x = m - 6; x <= m + 6; x++) if (((x - tonic) % 12 + 12) % 12 === 0 && Math.abs(x - m) < d) { d = Math.abs(x - m); best = x; }
  return best;
}
