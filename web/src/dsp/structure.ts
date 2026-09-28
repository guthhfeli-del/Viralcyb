/**
 * Song structure analysis on beat-synchronous features:
 *  - spectral clustering of the recurrence graph → passages with the same music
 *  - near-exact repetition of the vocal band → choruses (same words, same melody)
 *  - repetition + energy → hook, which may sit in any section
 *  - intro length, first vocal, drops, best TikTok clip & micro-loop
 * Method and measurements: docs/STRUCTURE.md.
 */
import type { FrameFeatures } from "./frames";
import { TIMBRE_BANDS } from "./frames";
import { clamp, mean, percentile, pickPeaks, EPS } from "./util";
import { clusterEmbedding, laplacianEmbedding } from "./segment";

export type SectionKind = "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "outro" | "break";

export interface Section {
  start: number;
  end: number;
  label: string; // A, B, C… (same letter = same material)
  kind: SectionKind;
  name: string; // French display name
  energy: number; // 0..1 relative
  vocal: number; // 0..1 relative
  loud: number; // dB (mean power)
  edited?: boolean; // label set by the user
}

export interface Clip {
  start: number;
  end: number;
  bars: number;
  loopScore: number; // 0..1
  score: number;
}

export interface StructureResult {
  sections: Section[];
  hook: { start: number; end: number; confidence: number; occurrences: number[] };
  firstHookTime: number;
  introLength: number;
  firstVocalTime: number; // NaN if unknown
  firstFullEnergyTime: number;
  drops: number[];
  repetition: number; // 0..1 share of repeated material
  chorusLift: number; // LU, chorus vs verse (NaN if unknown)
  clips: { tiktok: Clip; micro: Clip };
  unitTimes: number[];
  hookness: number[];
  energyCurve: number[];
  vocalCurve: number[];
  barSec: number;
  beatSynchronous: boolean;
}

export interface StructureInput {
  frames: FrameFeatures;
  duration: number;
  beats: number[]; // seconds
  downbeatPhase: number; // index of first downbeat in `beats` modulo 4
  bpm: number;
  momentary: number[]; // LUFS every 100 ms
}

export const KIND_NAMES: Record<SectionKind, string> = {
  intro: "Intro",
  verse: "Couplet",
  prechorus: "Pré-refrain",
  chorus: "Refrain",
  bridge: "Pont",
  outro: "Outro",
  break: "Break",
};

interface Units {
  times: number[]; // start time of each unit (length N + 1 incl. end)
  chroma: Float64Array[];
  timbre: Float64Array[];
  rmsDb: number[];
  vocal: number[];
  isBar: boolean[]; // unit starts a bar
  perBar: number; // units per bar
}

function buildUnits(inp: StructureInput): Units {
  const { duration, beats } = inp;
  let times: number[];
  let isBar: boolean[];
  let perBar: number;
  const beatSync = beats.length >= 24;
  if (beatSync) {
    const period = 60 / inp.bpm;
    // keep units around 0.3–0.6 s: split slow beats in two
    const unitsPerBeat = period > 0.63 ? 2 : 1;
    // choose a metrical "bar" of 1.3–3 s (resolves half/double-time readings)
    let beatsPerBar = 4;
    if (beatsPerBar * period > 3.0) beatsPerBar = 2;
    else if (beatsPerBar * period < 1.3) beatsPerBar = 8;
    const grid = beats.slice();
    while (grid[0] - period > 0.05) grid.unshift(grid[0] - period);
    while (grid[grid.length - 1] + period < duration - 0.05) grid.push(grid[grid.length - 1] + period);
    // beats[b] sits at grid[b + prepended]; downbeats keep their phase modulo 4
    const prepended = grid.findIndex((t) => Math.abs(t - beats[0]) < 1e-9);
    const phase0 = (inp.downbeatPhase + prepended) % beatsPerBar;
    times = [];
    isBar = [];
    for (let b = 0; b < grid.length; b++) {
      const next = grid[b + 1] ?? Math.min(duration, grid[b] + period);
      for (let k = 0; k < unitsPerBeat; k++) {
        const t = grid[b] + ((next - grid[b]) * k) / unitsPerBeat;
        if (t >= duration) break;
        times.push(t);
        isBar.push(k === 0 && (((b - phase0) % beatsPerBar) + beatsPerBar) % beatsPerBar === 0);
      }
    }
    perBar = unitsPerBeat * beatsPerBar;
    times.push(duration);
  } else {
    const step = 0.5;
    times = [];
    for (let t = 0; t < duration; t += step) times.push(t);
    times.push(duration);
    perBar = 4; // treat 2 s as a pseudo-bar
    isBar = times.map((_, i) => i % 4 === 0);
  }
  const frames = inp.frames;
  const N = times.length - 1;
  const chroma: Float64Array[] = [];
  const timbre: Float64Array[] = [];
  const rmsDb: number[] = [];
  const vocal: number[] = [];
  const frameTime = (f: number) => (f * frames.hop + 2048) / frames.fs;
  let f = 0;
  for (let u = 0; u < N; u++) {
    const c = new Float64Array(12);
    const t = new Float64Array(TIMBRE_BANDS);
    let e = 0, v = 0, cnt = 0;
    while (f < frames.count && frameTime(f) < times[u]) f++;
    let g = f;
    while (g < frames.count && frameTime(g) < times[u + 1]) {
      for (let k = 0; k < 12; k++) c[k] += frames.chroma[g * 12 + k];
      for (let k = 0; k < TIMBRE_BANDS; k++) t[k] += frames.timbre[g * TIMBRE_BANDS + k];
      e += Math.pow(10, frames.rmsDb[g] / 10);
      v += frames.vocal[g];
      cnt++;
      g++;
    }
    if (cnt === 0) {
      // unit shorter than a frame: borrow the nearest frame
      const nf = Math.min(frames.count - 1, Math.max(0, f));
      for (let k = 0; k < 12; k++) c[k] = frames.chroma[nf * 12 + k];
      for (let k = 0; k < TIMBRE_BANDS; k++) t[k] = frames.timbre[nf * TIMBRE_BANDS + k];
      e = Math.pow(10, frames.rmsDb[nf] / 10);
      v = frames.vocal[nf];
      cnt = 1;
    }
    for (let k = 0; k < TIMBRE_BANDS; k++) t[k] /= cnt;
    chroma.push(c);
    timbre.push(t);
    rmsDb.push(10 * Math.log10(e / cnt + EPS));
    vocal.push(v / cnt);
  }
  return { times, chroma, timbre, rmsDb, vocal, isBar, perBar };
}

function normalizeFeatures(u: Units): { ch: Float64Array[]; tb: Float64Array[] } {
  const N = u.chroma.length;
  // chroma: L1 → subtract the song mean → L2
  const meanC = new Float64Array(12);
  const ch = u.chroma.map((c) => {
    const s = c.reduce((a, b) => a + b, 0) || 1;
    return c.map((v) => v / s) as Float64Array;
  });
  ch.forEach((c) => c.forEach((v, k) => (meanC[k] += v / N)));
  ch.forEach((c) => {
    let n = 0;
    for (let k = 0; k < 12; k++) {
      c[k] -= meanC[k];
      n += c[k] * c[k];
    }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < 12; k++) c[k] /= n;
  });
  // timbre: z-score per band, then L2
  const mu = new Float64Array(TIMBRE_BANDS);
  const sd = new Float64Array(TIMBRE_BANDS);
  u.timbre.forEach((t) => t.forEach((v, k) => (mu[k] += v / N)));
  u.timbre.forEach((t) => t.forEach((v, k) => (sd[k] += ((v - mu[k]) ** 2) / N)));
  const tb = u.timbre.map((t) => {
    const z = new Float64Array(TIMBRE_BANDS);
    let n = 0;
    for (let k = 0; k < TIMBRE_BANDS; k++) {
      z[k] = (t[k] - mu[k]) / (Math.sqrt(sd[k]) + 1e-3);
      n += z[k] * z[k];
    }
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < TIMBRE_BANDS; k++) z[k] /= n;
    return z;
  });
  return { ch, tb };
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Self-similarity in [0, 1]. */
function ssm(ch: Float64Array[], tb: Float64Array[], wc: number): Float32Array[] {
  const N = ch.length;
  const S: Float32Array[] = [];
  for (let i = 0; i < N; i++) S.push(new Float32Array(N));
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      const v = (wc * (dot(ch[i], ch[j]) + 1)) / 2 + ((1 - wc) * (dot(tb[i], tb[j]) + 1)) / 2;
      S[i][j] = v;
      S[j][i] = v;
    }
  }
  return S;
}

/** Mean similarity along diagonals over a window of L units: D[i][j] = mean_k S[i+k][j+k]. */
function diagonalMean(S: Float32Array[], L: number): Float32Array[] {
  const N = S.length;
  const M = Math.max(0, N - L + 1);
  const D: Float32Array[] = [];
  for (let i = 0; i < M; i++) D.push(new Float32Array(M));
  for (let d = -(M - 1); d < M; d++) {
    // walk the diagonal j = i + d with a running window
    const i0 = Math.max(0, -d);
    const i1 = Math.min(N - 1, N - 1 - d);
    let acc = 0;
    const len = i1 - i0 + 1;
    const vals: number[] = new Array(len);
    for (let k = 0; k < len; k++) vals[k] = S[i0 + k][i0 + k + d];
    for (let k = 0; k < len; k++) {
      acc += vals[k];
      if (k >= L) acc -= vals[k - L];
      const start = k - L + 1;
      if (start >= 0) {
        const i = i0 + start;
        const j = i + d;
        if (i < M && j >= 0 && j < M) D[i][j] = acc / L;
      }
    }
  }
  return D;
}

function relNorm(xs: number[], lo = 10, hi = 95): number[] {
  const a = percentile(xs, lo), b = percentile(xs, hi);
  return xs.map((x) => clamp((x - a) / (b - a + EPS), 0, 1));
}

export function analyzeStructure(inp: StructureInput): StructureResult {
  const u = buildUnits(inp);
  const N = u.chroma.length;
  const beatSync = inp.beats.length >= 24;
  const unitSec = N > 0 ? inp.duration / N : 0.5;
  const barSec = beatSync ? (u.times[u.perBar] - u.times[0]) || (4 * 60) / inp.bpm : 2;
  const { ch, tb } = normalizeFeatures(u);
  const S = ssm(ch, tb, 0.55);
  const Srep = ssm(ch, tb, 0.75);

  const energy = relNorm(u.rmsDb);
  const vocalN = relNorm(u.vocal);
  const lyrN = relNorm(repetitionCurve(inp.frames, u), 5, 95);

  // ---- repetition / hook ----
  const L = Math.max(4, Math.min(beatSync ? u.perBar * 4 : 16, Math.floor(N / 4)));
  const D = diagonalMean(Srep, L);
  const M = D.length;
  const offDiag: number[] = [];
  for (let i = 0; i < M; i += 2) for (let j = i + L; j < M; j += 2) offDiag.push(D[i][j]);
  const theta = Math.max(0.62, offDiag.length ? percentile(offDiag, 88) : 0.8);
  const repCount = new Array(M).fill(0);
  const repStrength = new Array(M).fill(0);
  const repMatches: number[][] = Array.from({ length: M }, () => []);
  for (let i = 0; i < M; i++) {
    const row = D[i];
    for (let j = 0; j < M; j++) {
      if (Math.abs(i - j) < L) continue;
      const v = row[j];
      if (v > theta && v >= (row[j - 1] ?? 0) && v >= (row[j + 1] ?? 0)) {
        repCount[i]++;
        repStrength[i] += v;
        repMatches[i].push(j);
      }
    }
    if (repCount[i]) repStrength[i] /= repCount[i];
  }
  const winMean = (arr: number[], i: number, len: number) => mean(arr.slice(i, Math.min(arr.length, i + len)));
  const hookness: number[] = new Array(N).fill(0);
  let hookIdx = 0, hookBest = -1;
  for (let i = 0; i < M; i++) {
    const rep = Math.min(1, repCount[i] / 3) * clamp((repStrength[i] - theta) / (1 - theta + EPS) * 0.5 + 0.5, 0, 1);
    const h = P.hook.rep * rep + P.hook.lyr * winMean(lyrN, i, L) + P.hook.energy * winMean(energy, i, L) + P.hook.vocal * winMean(vocalN, i, L);
    hookness[i] = h;
    const aligned = u.isBar[i] ? 1 : 0.92; // prefer bar starts
    if (h * aligned > hookBest) {
      hookBest = h * aligned;
      hookIdx = i;
    }
  }
  for (let i = M; i < N; i++) hookness[i] = hookness[Math.max(0, M - 1)] * 0.5;

  // occurrences must match harmonically *and* timbrally (a verse reusing the
  // chorus chords is not a hook repeat)
  const Ds = diagonalMean(S, L);
  const offS: number[] = [];
  for (let i = 0; i < M; i += 2) for (let j = i + L; j < M; j += 2) offS.push(Ds[i][j]);
  const thetaS = Math.max(0.6, offS.length ? percentile(offS, 85) : 0.8);
  const cands = (repMatches[hookIdx] ?? []).filter((j) => Ds[hookIdx][j] > thetaS);
  const bestDs = Math.max(0, ...cands.map((j) => Ds[hookIdx][j]));
  const bestD = Math.max(0, ...cands.map((j) => D[hookIdx][j]));
  const occ = [hookIdx, ...cands.filter((j) => Ds[hookIdx][j] >= bestDs - 0.05 && D[hookIdx][j] >= bestD - 0.05)].sort((a, b) => a - b);
  // dedupe occurrences closer than L
  const occurrences: number[] = [];
  for (const o of occ) if (!occurrences.length || o - occurrences[occurrences.length - 1] >= L) occurrences.push(o);
  const hookStart = u.times[hookIdx] ?? 0;
  const hookEnd = u.times[Math.min(N, hookIdx + L)] ?? inp.duration;
  const hookConf = clamp(hookBest * (occurrences.length >= 2 ? 1.1 : 0.6), 0, 1);

  // ---- sections: spectral clustering of the recurrence graph ----
  const { raws, labels, kinds } = sectionize(u, ch, tb, energy, vocalN, lyrN, beatSync, unitSec, barSec);
  const sectionsRaw: Section[] = raws.map((r, k) => ({
    start: k === 0 ? 0 : u.times[r.a],
    end: u.times[r.b] ?? inp.duration,
    label: labels[k],
    kind: kinds[k],
    name: KIND_NAMES[kinds[k]],
    energy: r.energy,
    vocal: r.vocal,
    loud: r.loud,
  }));
  // merge consecutive pieces of the same kind (two halves of a verse read as one verse)
  const merged: Section[] = [];
  for (const sec of sectionsRaw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === sec.kind) {
      const wa = prev.end - prev.start, wb = sec.end - sec.start;
      prev.energy = (prev.energy * wa + sec.energy * wb) / (wa + wb);
      prev.vocal = (prev.vocal * wa + sec.vocal * wb) / (wa + wb);
      prev.loud = 10 * Math.log10((Math.pow(10, prev.loud / 10) * wa + Math.pow(10, sec.loud / 10) * wb) / (wa + wb));
      prev.end = sec.end;
    } else merged.push({ ...sec });
  }
  const sections = merged;

  const chorusLift = liftOf(sections);

  // ---- timeline landmarks ----
  const chorusStarts = sections.filter((s) => s.kind === "chorus").map((s) => s.start);
  const firstHookTime = occurrences.length >= 2 ? u.times[occurrences[0]] : Math.min(hookStart, chorusStarts[0] ?? Infinity);
  const introLength = sections.length && sections[0].kind === "intro" ? sections[0].end : 0;

  const mom = inp.momentary;
  const momS: number[] = [];
  for (let i = 0; i < mom.length; i++) momS.push(mean(mom.slice(Math.max(0, i - 5), i + 5)));
  const loudRef = percentile(momS.filter((v) => v > -60), 80);
  let firstFullEnergyTime = 0;
  for (let i = 0; i < momS.length; i++) if (momS[i] >= loudRef - 3) { firstFullEnergyTime = i * 0.1; break; }

  // first vocal: frame proxy, needs contrast to be meaningful
  const fv = Array.from(inp.frames.vocal);
  const v10 = percentile(fv, 10), v90 = percentile(fv, 90);
  let firstVocalTime = NaN;
  if (v90 - v10 > 0.04) {
    // voiced for most of the following second (syllable gaps are allowed)
    const hold = Math.max(1, Math.round(1 / inp.frames.hopSec));
    const thrV = v10 + 0.5 * (v90 - v10);
    for (let f = 0; f + hold < fv.length; f++) {
      if (fv[f] < thrV) continue;
      let above = 0;
      for (let k = 0; k < hold; k++) if (fv[f + k] >= thrV) above++;
      if (above >= 0.7 * hold) {
        firstVocalTime = (f * inp.frames.hop) / inp.frames.fs;
        break;
      }
    }
  }

  // drops: sudden sustained loudness jumps
  const jump = new Float64Array(momS.length);
  for (let i = 30; i < momS.length - 25; i++) {
    const before = mean(momS.slice(i - 30, i - 5));
    const after = mean(momS.slice(i + 2, i + 25));
    if (momS[i + 5] > loudRef - 6) jump[i] = after - before;
  }
  const drops = pickPeaks(jump, 80, 6).map((i) => i * 0.1 + 0.2);

  // ---- clips ----
  const hookStarts = [...occurrences.map((o) => u.times[o]), ...sections.filter((s) => s.kind === "chorus").map((s) => s.start)];
  const clipFor = (minSec: number, maxSec: number, targetSec: number): Clip => {
    const unitsPerBar = u.perBar;
    const barCandidates = [16, 12, 8, 6, 4, 3, 2, 1];
    let bars = 4;
    let bestDiff = Infinity;
    for (const b of barCandidates) {
      const d = b * barSec;
      if (d >= minSec && d <= maxSec) {
        const pref = b % 4 === 0 ? 0 : b % 2 === 0 ? 1 : 2.5;
        const diff = Math.abs(d - targetSec) + pref;
        if (diff < bestDiff) {
          bestDiff = diff;
          bars = b;
        }
      }
    }
    if (!Number.isFinite(bestDiff)) bars = Math.max(1, Math.round(targetSec / barSec));
    const len = bars * unitsPerBar;
    let best: Clip = { start: 0, end: Math.min(inp.duration, bars * barSec), bars, loopScore: 0, score: -1 };
    for (let i = 0; i + len <= N; i++) {
      if (!u.isBar[i]) continue;
      const after = Math.min(N - 1, i + len);
      // a loop is seamless if (a) what follows the clip resembles its start,
      // (b) the bar before the clip resembles its last bar, or (c) the clip is
      // itself two repeats of one phrase
      const halfLen = Math.floor(len / 2);
      let internal = 0;
      for (let k = 0; k < halfLen; k++) internal += Srep[i + k][i + halfLen + k];
      internal /= Math.max(1, halfLen);
      const seam = Math.max(S[i][after], i > 0 ? S[i - 1][i + len - 1] : 0, internal);
      const loop = clamp((seam - 0.5) / 0.5, 0, 1);
      const hk = mean(hookness.slice(i, i + len));
      const hookEarly = hookStarts.some((h) => h >= u.times[i] - 0.05 && h - u.times[i] <= 3) ? 1 : 0;
      const e = mean(energy.slice(i, i + len));
      const score = 0.4 * hk + 0.2 * hookEarly + 0.25 * loop + 0.15 * e;
      if (score > best.score) best = { start: u.times[i], end: u.times[i + len] ?? inp.duration, bars, loopScore: loop, score };
    }
    return best;
  };
  const tiktok = clipFor(11, 17.5, 15);
  const micro = clipFor(5, 9.5, 7);

  const repeatedUnits = repCount.filter((c) => c > 0).length;
  return {
    sections,
    hook: { start: hookStart, end: hookEnd, confidence: hookConf, occurrences: occurrences.map((o) => u.times[o]) },
    firstHookTime: Number.isFinite(firstHookTime) ? firstHookTime : hookStart,
    introLength,
    firstVocalTime,
    firstFullEnergyTime,
    drops,
    repetition: M > 0 ? repeatedUnits / M : 0,
    chorusLift,
    clips: { tiktok, micro },
    unitTimes: u.times.slice(0, N),
    hookness,
    energyCurve: energy,
    vocalCurve: vocalN,
    barSec,
    beatSynchronous: beatSync,
  };
}

/** Chorus vs verse level (LU), NaN when either is missing. */
function liftOf(sections: Section[]): number {
  const lvl = (k: SectionKind) => sections.filter((s) => s.kind === k).map((s) => s.loud);
  const c = lvl("chorus"), v = lvl("verse");
  return c.length && v.length ? mean(c) - mean(v) : NaN;
}

export const SECTION_KINDS: SectionKind[] = ["intro", "verse", "prechorus", "chorus", "bridge", "break", "outro"];

/** Apply a user correction to one section and refresh what depends on the labels. */
export function relabelSection(st: StructureResult, index: number, kind: SectionKind): StructureResult {
  const sections = st.sections.map((s, i) => (i === index ? { ...s, kind, name: KIND_NAMES[kind], edited: true } : s));
  const chorusStarts = sections.filter((s) => s.kind === "chorus").map((s) => s.start);
  return {
    ...st,
    sections,
    introLength: sections[0]?.kind === "intro" ? sections[0].end : 0,
    chorusLift: liftOf(sections),
    firstHookTime: st.hook.occurrences.length >= 2 ? st.hook.occurrences[0] : Math.min(st.hook.start, chorusStarts[0] ?? Infinity),
  };
}

interface Raw { a: number; b: number; c: number; energy: number; vocal: number; loud: number; lyr: number }

/**
 * "Does this moment come back almost identically later or earlier?" per unit.
 * Fine-grained (≈ 90 ms) vocal-band envelope, its change and chroma, compared
 * along every lag ≥ 6 s with a 4 s window. Repeated lyrics (same words on the
 * same melody) score high; verses re-using the music with new words score lower.
 */
function repetitionCurve(frames: FrameFeatures, u: Units): number[] {
  const dec = Math.max(2, Math.ceil(frames.count / 3000));
  const n = Math.floor(frames.count / dec);
  const N = u.times.length - 1;
  if (n < 16) return new Array(N).fill(0);
  const vb: number[] = [];
  frames.bandEdges.forEach((e, b) => {
    if (b < TIMBRE_BANDS && e >= 250 && frames.bandEdges[b + 1] <= 5000) vb.push(b);
  });
  const FB = vb.length;
  const mu = new Float64Array(FB), sd = new Float64Array(FB);
  for (let f = 0; f < frames.count; f++) vb.forEach((b, q) => (mu[q] += frames.timbre[f * TIMBRE_BANDS + b] / frames.count));
  for (let f = 0; f < frames.count; f++) vb.forEach((b, q) => (sd[q] += (frames.timbre[f * TIMBRE_BANDS + b] - mu[q]) ** 2 / frames.count));
  for (let q = 0; q < FB; q++) sd[q] = Math.sqrt(sd[q]) + 1e-3;
  const dim = 2 * FB + 12;
  const cw = Math.sqrt(FB / 12);
  const F = new Float32Array(n * dim);
  const z = new Float64Array(FB), zp = new Float64Array(FB), c = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    z.fill(0);
    zp.fill(0);
    c.fill(0);
    for (let k = 0; k < dec; k++) {
      const f = i * dec + k, g = Math.max(0, i * dec - dec + k);
      for (let q = 0; q < FB; q++) {
        z[q] += (frames.timbre[f * TIMBRE_BANDS + vb[q]] - mu[q]) / sd[q] / dec;
        zp[q] += (frames.timbre[g * TIMBRE_BANDS + vb[q]] - mu[q]) / sd[q] / dec;
      }
      for (let q = 0; q < 12; q++) c[q] += frames.chroma[f * 12 + q];
    }
    const cm = c.reduce((s2, v) => s2 + v, 0) / 12;
    let cn = 0;
    for (let q = 0; q < 12; q++) cn += (c[q] - cm) ** 2;
    cn = Math.sqrt(cn) || 1;
    let nn = 0;
    const o = i * dim;
    for (let q = 0; q < FB; q++) {
      F[o + 2 * q] = z[q];
      F[o + 2 * q + 1] = z[q] - zp[q];
    }
    for (let q = 0; q < 12; q++) F[o + 2 * FB + q] = ((c[q] - cm) / cn) * cw;
    for (let q = 0; q < dim; q++) nn += F[o + q] ** 2;
    nn = Math.sqrt(nn) || 1;
    for (let q = 0; q < dim; q++) F[o + q] /= nn;
  }
  const fps = frames.fs / frames.hop / dec;
  const win = Math.max(3, Math.round(4 * fps)), h = win >> 1;
  const minLag = Math.round(6 * fps);
  const best = new Float64Array(n).fill(-1);
  const cs = new Float64Array(n + 1);
  for (let lag = minLag; lag < n; lag++) {
    const len = n - lag;
    for (let i = 0; i < len; i++) {
      let d = 0;
      const a = i * dim, b = (i + lag) * dim;
      for (let q = 0; q < dim; q++) d += F[a + q] * F[b + q];
      cs[i + 1] = cs[i] + d;
    }
    for (let i = 0; i < len; i++) {
      const lo = Math.max(0, i - h), hi = Math.min(len, i + h + 1);
      const m = (cs[hi] - cs[lo]) / (hi - lo);
      if (m > best[i]) best[i] = m;
      if (m > best[i + lag]) best[i + lag] = m;
    }
  }
  // per unit
  const out: number[] = [];
  for (let k = 0; k < N; k++) {
    const i0 = Math.min(n - 1, Math.max(0, Math.floor(((u.times[k] * frames.fs - 2048) / frames.hop) / dec)));
    const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil(((u.times[k + 1] * frames.fs - 2048) / frames.hop) / dec)));
    let acc = 0;
    for (let i = i0; i < i1; i++) acc += best[i];
    out.push(acc / (i1 - i0));
  }
  return out;
}

/** DCT-II of log band energies without c0: an MFCC-like timbre descriptor. */
function cepstrum(bandsDb: Float64Array, n = 12): Float64Array {
  const B = bandsDb.length;
  const out = new Float64Array(n);
  for (let m = 1; m <= n; m++) {
    let v = 0;
    for (let b = 0; b < B; b++) v += bandsDb[b] * Math.cos((Math.PI * m * (b + 0.5)) / B);
    out[m - 1] = v / B;
  }
  return out;
}


/**
 * Cut the song into labelled sections and name them. Same letter = same
 * material; names come from how each group behaves (loudness, voice,
 * repetition, what it precedes).
 */
function sectionize(
  u: Units,
  ch: Float64Array[],
  tb: Float64Array[],
  energy: number[],
  vocalN: number[],
  lyrN: number[],
  beatSync: boolean,
  unitSec: number,
  barSec: number,
): { raws: Raw[]; labels: string[]; kinds: SectionKind[] } {
  const N = ch.length;
  if (N < 8) {
    const r: Raw = { a: 0, b: N, c: 0, energy: mean(energy), vocal: mean(vocalN), loud: mean(u.rmsDb), lyr: 0 };
    return { raws: [r], labels: ["A"], kinds: ["chorus"] };
  }
  // graph on (pooled) units
  const pool = Math.ceil(N / P.maxGraphUnits);
  const G = Math.ceil(N / pool);
  const rep: Float64Array[] = [];
  const path: Float64Array[] = [];
  for (let g = 0; g < G; g++) {
    const a = g * pool, b = Math.min(N, a + pool);
    const f = new Float64Array(12 + TIMBRE_BANDS);
    const bands = new Float64Array(TIMBRE_BANDS);
    for (let i = a; i < b; i++) {
      for (let q = 0; q < 12; q++) f[q] += ch[i][q];
      for (let q = 0; q < TIMBRE_BANDS; q++) {
        f[12 + q] += P.timbreWeight * tb[i][q];
        bands[q] += u.timbre[i][q] / (b - a);
      }
    }
    rep.push(f);
    path.push(cepstrum(bands));
  }
  const barG = Math.max(1, Math.round((beatSync ? u.perBar : 4) / pool));
  const emb = laplacianEmbedding(rep, path, 10, Math.max(2, Math.round(P.embeddingBars * barG)), Math.max(3, Math.round(P.smoothingBars * barG)));
  // as many groups as the song supports without shattering sections into sub-bar-pairs
  const fragmentation = (l: Int32Array) => {
    let short = 0, a = 0;
    for (let i = 1; i <= G; i++)
      if (i === G || l[i] !== l[a]) {
        if (i - a < 2 * barG) short += i - a;
        a = i;
      }
    return short / G;
  };
  let lab = clusterEmbedding(emb, Math.min(3, G - 1));
  for (let k = Math.min(P.clusters, G - 1); k > 3; k--) {
    const l = clusterEmbedding(emb, k);
    if (fragmentation(l) <= P.maxFragmentation) {
      lab = l;
      break;
    }
  }
  const unitLab = Array.from({ length: N }, (_, i) => lab[Math.floor(i / pool)]);

  // runs → segments; absorb fragments shorter than two bars
  const perBar = u.perBar;
  const minLen = beatSync ? perBar * P.minBars : 4 * P.minBars;
  let runs: { a: number; b: number; c: number }[] = [];
  for (let i = 0; i < N; i++) {
    const last = runs[runs.length - 1];
    if (last && last.c === unitLab[i]) last.b = i + 1;
    else runs.push({ a: i, b: i + 1, c: unitLab[i] });
  }
  for (;;) {
    let idx = -1, shortest = Infinity;
    runs.forEach((r, k) => {
      const len = r.b - r.a;
      if (len < minLen && len < shortest && runs.length > 1) {
        shortest = len;
        idx = k;
      }
    });
    if (idx < 0) break;
    const r = runs[idx], prev = runs[idx - 1], next = runs[idx + 1];
    const into = !prev ? next : !next ? prev : prev.c === next.c ? prev : prev.b - prev.a >= next.b - next.a ? prev : next;
    into.a = Math.min(into.a, r.a);
    into.b = Math.max(into.b, r.b);
    runs.splice(idx, 1);
    // join neighbours that now carry the same label
    runs = runs.reduce<typeof runs>((acc, x) => {
      const last = acc[acc.length - 1];
      if (last && last.c === x.c) last.b = x.b;
      else acc.push({ ...x });
      return acc;
    }, []);
  }
  // refine each boundary to the bar line (± two bars) where the arrangement changes most
  if (beatSync) {
    // timbre only: chords change every bar, arrangements change at section borders
    const F = tb;
    const change = (c: number) => {
      const a = Math.max(0, c - perBar), b = Math.min(N, c + perBar);
      if (c - a < 1 || b - c < 1) return 0;
      const m1 = new Float64Array(F[0].length), m2 = new Float64Array(F[0].length);
      for (let i = a; i < c; i++) F[i].forEach((v, q) => (m1[q] += v / (c - a)));
      for (let i = c; i < b; i++) F[i].forEach((v, q) => (m2[q] += v / (b - c)));
      let d = 0;
      for (let q = 0; q < m1.length; q++) d += (m1[q] - m2[q]) ** 2;
      return d + 4 * (mean(energy.slice(a, c)) - mean(energy.slice(c, b))) ** 2;
    };
    for (let k = 1; k < runs.length; k++) {
      const b0 = runs[k].a;
      let best = b0, bestScore = -1;
      for (let c = Math.max(runs[k - 1].a + 1, b0 - P.refineBars * perBar); c <= Math.min(runs[k].b - 1, b0 + P.refineBars * perBar); c++) {
        if (!u.isBar[c]) continue;
        const sc = change(c);
        if (sc > bestScore) {
          bestScore = sc;
          best = c;
        }
      }
      runs[k - 1].b = best;
      runs[k].a = best;
    }
  }
  const bar = beatSync ? perBar : 4;
  const piece = (a: number, b: number, c: number): Raw => ({
    a,
    b,
    c,
    energy: mean(energy.slice(a, b)),
    vocal: mean(vocalN.slice(a, b)),
    loud: 10 * Math.log10(mean(u.rmsDb.slice(a, b).map((d) => Math.pow(10, d / 10))) + EPS),
    lyr: mean(lyrN.slice(a, b)),
  });
  const segs = runs.map((r) => piece(r.a, r.b, r.c));
  const snap = (i: number, lo: number, hi: number) => {
    if (!beatSync) return i;
    for (let d = 0; d <= bar / 2; d++) {
      if (i - d > lo && u.isBar[i - d]) return i - d;
      if (i + d < hi && u.isBar[i + d]) return i + d;
    }
    return i;
  };

  // ---- choruses: where the song comes back almost identically ----
  const win = Math.max(1, Math.round(P.chorusSmoothSec / unitSec)) | 1;
  const sm = movingAverage(lyrN, win);
  const thr = otsuThreshold(sm);
  const on = sm.map((v) => v > thr);
  const contrast = mean(sm.filter((_, i) => on[i])) - mean(sm.filter((_, i) => !on[i]));
  let chorusRuns = contrast >= P.minContrast ? runsOf(on) : [];
  // close gaps shorter than two bars, drop runs shorter than four
  chorusRuns = chorusRuns.reduce<{ a: number; b: number }[]>((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r.a - last.b < 2 * bar) last.b = r.b;
    else acc.push({ ...r });
    return acc;
  }, []);
  chorusRuns = chorusRuns.filter((r) => r.b - r.a >= 4 * bar);
  if (!chorusRuns.length) {
    // no clear repetition: the most repeated, loudest group of sections
    const groups = Array.from(new Set(segs.map((r) => r.c)));
    const score = (c: number) => {
      const rs = segs.filter((r) => r.c === c);
      return mean(rs.map((r) => r.lyr)) + 0.5 * mean(rs.map((r) => r.energy)) + (rs.length >= 2 ? 0.3 : 0);
    };
    const best = groups.reduce((x, c) => (score(c) > score(x) ? c : x), groups[0]);
    chorusRuns = segs.filter((r) => r.c === best).map((r) => ({ a: r.a, b: r.b }));
  }
  // edges: the bar line (± two bars) where the repetition curve steps up (start) or down (end)
  const step = (c: number, w: number) => mean(lyrN.slice(c, Math.min(N, c + w))) - mean(lyrN.slice(Math.max(0, c - w), c));
  const edge = (i: number, lo: number, hi: number, dir: 1 | -1) => {
    if (i <= 0 || i >= N) return i;
    let best = snap(i, lo, hi), bestScore = -Infinity;
    for (let c = Math.max(lo + 1, i - 2 * bar); c <= Math.min(hi - 1, i + 2 * bar); c++) {
      if (beatSync && !u.isBar[c]) continue;
      const sc = dir * step(c, 2 * bar);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    return best;
  };
  for (const r of chorusRuns) {
    r.a = edge(r.a, 0, r.b, 1);
    r.b = edge(r.b, r.a, N + 1, -1);
  }
  // quieter material that also repeats word for word (a verse sung twice the
  // same way, an intro/outro pair) is not the chorus
  {
    const sub: { a: number; b: number; e: number }[] = [];
    for (const r of chorusRuns) {
      const inner = segs.map((x) => x.a).filter((x) => x > r.a && x < r.b);
      [r.a, ...inner, r.b].forEach((x, k, arr) => {
        if (k < arr.length - 1) sub.push({ a: x, b: arr[k + 1], e: mean(energy.slice(x, arr[k + 1])) });
      });
    }
    const big = sub.filter((x) => x.b - x.a >= 4 * bar);
    const eMax = Math.max(...(big.length ? big : sub).map((x) => x.e));
    const kept = sub.filter((x) => x.e >= eMax - P.chorusEnergyGap || x.b - x.a < 2 * bar);
    const rebuilt = kept.reduce<{ a: number; b: number }[]>((acc, x) => {
      const last = acc[acc.length - 1];
      if (last && last.b === x.a) last.b = x.b;
      else acc.push({ a: x.a, b: x.b });
      return acc;
    }, []).filter((r) => r.b - r.a >= 4 * bar);
    if (rebuilt.length) chorusRuns = rebuilt;
  }
  // an opening "repeat" is almost always an instrumental intro re-using later music:
  // keep it as a chorus only when it is as loud as the other choruses
  if (chorusRuns.length > 1 && chorusRuns[0].a === 0) {
    const r0 = chorusRuns[0];
    const eOthers = mean(chorusRuns.slice(1).flatMap((r) => energy.slice(r.a, r.b)));
    const cut = segs.find((x) => x.a > r0.a + 2 * bar && x.a < r0.b && (x.a - r0.a) * unitSec <= P.introMaxSec)?.a;
    const loudStart = mean(energy.slice(r0.a, r0.b)) >= eOthers - P.introEnergyGap;
    if (!loudStart) {
      if ((r0.b - r0.a) * unitSec <= P.introMaxSec) chorusRuns.shift();
      else if (cut !== undefined) r0.a = cut;
    }
  }
  const insideChorus = (i: number) => chorusRuns.some((r) => i > r.a && i < r.b);

  // ---- pieces: chorus runs + the clustering's boundaries elsewhere ----
  const cuts = new Set<number>([0, N]);
  for (const r of chorusRuns) {
    cuts.add(r.a);
    cuts.add(r.b);
  }
  for (const r of segs) if (r.a > 0 && !insideChorus(r.a)) cuts.add(r.a);
  const sorted = Array.from(cuts).sort((x, y) => x - y);
  const majority = (a: number, b: number) => {
    const cnt = new Map<number, number>();
    for (let i = a; i < b; i++) cnt.set(unitLab[i], (cnt.get(unitLab[i]) ?? 0) + 1);
    return Array.from(cnt).reduce((x, y) => (y[1] > x[1] ? y : x), [-1, -1])[0];
  };
  let parts = sorted.slice(0, -1).map((a, k) => ({ a, b: sorted[k + 1], chorus: chorusRuns.some((r) => a >= r.a && sorted[k + 1] <= r.b) }));
  // absorb non-chorus slivers shorter than two bars
  for (;;) {
    const k = parts.findIndex((x) => !x.chorus && x.b - x.a < 2 * bar && parts.length > 1);
    if (k < 0) break;
    const prev = parts[k - 1], next = parts[k + 1];
    const into = prev && !prev.chorus ? prev : next && !next.chorus ? next : prev ?? next;
    into.a = Math.min(into.a, parts[k].a);
    into.b = Math.max(into.b, parts[k].b);
    parts.splice(k, 1);
  }
  parts = parts.reduce<typeof parts>((acc, x) => {
    const last = acc[acc.length - 1];
    if (last && last.chorus && x.chorus) last.b = x.b;
    else acc.push({ ...x });
    return acc;
  }, []);
  const raws: Raw[] = parts.map((x) => piece(x.a, x.b, majority(x.a, x.b)));
  const isChorus = parts.map((x) => x.chorus);

  // ---- naming ----
  const dur = (r: Raw) => (r.b - r.a) * unitSec;
  const medE = percentile(raws.map((r) => r.energy), 50);
  const count = (c: number) => raws.filter((r, k) => !isChorus[k] && r.c === c).length;
  const firstChorus = isChorus.indexOf(true);
  const kinds: SectionKind[] = raws.map((r, k) => {
    const d = dur(r);
    if (isChorus[k]) return "chorus";
    if (k === 0 && k < firstChorus && (d <= 12 || (d <= 40 && (r.energy < medE - 0.1 || r.vocal < 0.3)))) return "intro";
    if (k === raws.length - 1 && raws.length > 2 && (d <= 16 || r.energy < medE - 0.1)) return "outro";
    const prev = raws[k - 1];
    if (isChorus[k + 1] && d >= barSec * 3.5 && d <= barSec * 10.5 && prev && !isChorus[k - 1] && prev.c !== r.c && k - 1 > 0) return "prechorus";
    if (r.energy < medE - 0.3 && r.vocal < 0.4) return "break";
    if (firstChorus >= 0 && k > firstChorus && count(r.c) === 1 && k < raws.length - 1 && !raws.slice(0, firstChorus).some((x) => x.c === r.c)) return "bridge";
    return "verse";
  });
  // a short low-energy lead-in glued to a chorus is its pre-chorus
  raws.forEach((r, k) => {
    if (!isChorus[k] || !kinds[k - 1] || kinds[k - 1] === "prechorus") return;
    const inner = segs.filter((x) => x.a > r.a && x.a < r.b).map((x) => x.a);
    for (const p of inner) {
      const head = p - r.a, tail = r.b - p;
      if (head >= 4 * bar && head <= 10 * bar && tail >= 4 * bar && mean(energy.slice(r.a, p)) < mean(energy.slice(p, r.b)) - P.preEnergyGap) {
        raws.splice(k, 1, piece(r.a, p, majority(r.a, p)), piece(p, r.b, majority(p, r.b)));
        kinds.splice(k, 1, "prechorus", "chorus");
        isChorus.splice(k, 1, false, true);
        break;
      }
    }
  });
  debugHook?.({ lyrN, sm, thr, times: u.times, raws, kinds, unitSec, segs, unitLab, chorusRuns });
  // letters: same material → same letter
  const letter = new Map<string, string>();
  const labels = raws.map((r, k) => {
    const key = kinds[k] === "chorus" || kinds[k] === "prechorus" ? kinds[k] : `c${r.c}`;
    if (!letter.has(key)) letter.set(key, String.fromCharCode(65 + Math.min(25, letter.size)));
    return letter.get(key)!;
  });
  return { raws, labels, kinds };
}

function movingAverage(xs: number[], w: number): number[] {
  const h = w >> 1;
  const cs = [0];
  for (const x of xs) cs.push(cs[cs.length - 1] + x);
  return xs.map((_, i) => {
    const a = Math.max(0, i - h), b = Math.min(xs.length, i + h + 1);
    return (cs[b] - cs[a]) / (b - a);
  });
}

/** Threshold maximising the between-class variance (Otsu). */
function otsuThreshold(xs: number[]): number {
  const sortedX = xs.slice().sort((a, b) => a - b);
  let best = -1, thr = sortedX[sortedX.length >> 1] ?? 0.5;
  for (let q = 1; q < 60; q++) {
    const t = sortedX[Math.floor((q / 60) * (sortedX.length - 1))];
    let n1 = 0, n2 = 0, s1 = 0, s2 = 0;
    for (const x of xs) {
      if (x <= t) {
        n1++;
        s1 += x;
      } else {
        n2++;
        s2 += x;
      }
    }
    if (!n1 || !n2) continue;
    const v = (n1 / xs.length) * (n2 / xs.length) * (s1 / n1 - s2 / n2) ** 2;
    if (v > best) {
      best = v;
      thr = t;
    }
  }
  return thr;
}

function runsOf(mask: boolean[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  mask.forEach((m, i) => {
    if (!m) return;
    const last = out[out.length - 1];
    if (last && last.b === i) last.b = i + 1;
    else out.push({ a: i, b: i + 1 });
  });
  return out;
}

/**
 * Tuning, measured on JamendoLyrics (79 CC-licensed songs, chorus = repeated
 * lyric lines): chorus/verse agreement on sung passages 0.64 → 0.82.
 */
const P = {
  clusters: 6, // upper bound; fewer when sections would shatter
  maxFragmentation: 0.08,
  embeddingBars: 2,
  smoothingBars: 2.25,
  maxGraphUnits: 300,
  minBars: 4,
  timbreWeight: 0.8,
  refineBars: 2,
  chorusSmoothSec: 6,
  minContrast: 0.15,
  chorusEnergyGap: 0.4,
  introMaxSec: 30,
  introEnergyGap: 0,
  preEnergyGap: 0.1,
  hook: { rep: 0.2, lyr: 0.5, energy: 0.3, vocal: 0 },
};
export type StructureParams = typeof P;
let debugHook: ((info: unknown) => void) | null = null;

/** Override tuning parameters (offline evaluation). */
export function setStructureParams(p: Partial<Omit<StructureParams, "hook">> & { hook?: Partial<StructureParams["hook"]>; debug?: (info: unknown) => void }) {
  const { hook, debug, ...rest } = p;
  Object.assign(P, rest);
  if (hook) Object.assign(P.hook, hook);
  if (debug) debugHook = debug;
}
