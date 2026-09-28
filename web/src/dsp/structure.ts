/**
 * Song structure analysis on beat-synchronous features:
 *  - self-similarity matrix (chroma + timbre)
 *  - Foote novelty → section boundaries snapped to bars
 *  - repetition (diagonal stripes) → hook / chorus detection
 *  - intro length, first vocal, drops, best TikTok clip & micro-loop
 */
import type { FrameFeatures } from "./frames";
import { TIMBRE_BANDS } from "./frames";
import { clamp, mean, percentile, pickPeaks, std, EPS } from "./util";

export type SectionKind = "intro" | "verse" | "prechorus" | "chorus" | "bridge" | "outro" | "break";

export interface Section {
  start: number;
  end: number;
  label: string; // A, B, C… (same letter = same material)
  kind: SectionKind;
  name: string; // French display name
  energy: number; // 0..1 relative
  vocal: number; // 0..1 relative
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

const KIND_NAMES: Record<SectionKind, string> = {
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

function novelty(S: Float32Array[], M: number): Float64Array {
  const N = S.length;
  const nov = new Float64Array(N);
  const g = (a: number) => Math.exp(-0.5 * (a / (M / 2)) ** 2);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let a = -M; a < M; a++) {
      const ia = i + a;
      if (ia < 0 || ia >= N) continue;
      for (let b = -M; b < M; b++) {
        const ib = i + b;
        if (ib < 0 || ib >= N) continue;
        const sign = (a < 0) === (b < 0) ? 1 : -1;
        s += sign * g(a + 0.5) * g(b + 0.5) * S[ia][ib];
      }
    }
    nov[i] = Math.max(0, s);
  }
  const mx = Math.max(...nov, EPS);
  for (let i = 0; i < N; i++) nov[i] /= mx;
  return nov;
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
    const h = 0.45 * rep + 0.35 * winMean(energy, i, L) + 0.2 * winMean(vocalN, i, L);
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

  // ---- sections ----
  const Mk = beatSync ? u.perBar * 2 : 8;
  const novS = novelty(S, Mk);
  // loudness novelty: modern arrangements change level at section borders
  const novE = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = mean(u.rmsDb.slice(Math.max(0, i - Mk), i));
    const b = mean(u.rmsDb.slice(i, Math.min(N, i + Mk)));
    novE[i] = i >= 2 && i <= N - 2 ? Math.abs(b - a) : 0;
  }
  const mxE = Math.max(...novE, EPS);
  const nov = novS.map((v, i) => 0.6 * v + 0.4 * (novE[i] / mxE));
  const minDist = beatSync ? u.perBar * 4 : 16;
  const thr = mean(Array.from(nov)) + 0.25 * std(Array.from(nov));
  let peaks = pickPeaks(nov, minDist, thr);
  // snap to bar starts
  const barIdx = u.isBar.map((b, i) => (b ? i : -1)).filter((i) => i >= 0 && i < N);
  peaks = peaks.map((p) => barIdx.reduce((best, b) => (Math.abs(b - p) < Math.abs(best - p) ? b : best), barIdx[0] ?? p));
  // repetition-driven segmentation: contiguous hook repeats form chorus spans
  const spans: [number, number][] = [];
  if (occurrences.length >= 2) {
    for (const o of occurrences) {
      const end = Math.min(N, o + L);
      const last = spans[spans.length - 1];
      if (last && o <= last[1] + 1) last[1] = Math.max(last[1], end);
      else spans.push([o, end]);
    }
  }
  const nearSpanEdge = (b: number) => spans.some(([a, e]) => (b > a && b < e) || Math.abs(b - a) < L / 2 || Math.abs(b - e) < L / 2);
  const spanEdges = spans.flatMap(([a, e]) => [a, e]).filter((b) => b > 0 && b < N);
  const bounds = Array.from(new Set([0, ...peaks.filter((p) => p > 0 && p < N && !nearSpanEdge(p)), ...spanEdges, N])).sort((a, b) => a - b);
  // merge tiny sections (< 2 bars)
  const minLen = beatSync ? u.perBar * 2 : 8;
  for (let k = bounds.length - 2; k > 0; k--) {
    if (spanEdges.includes(bounds[k])) continue;
    if (bounds[k + 1] - bounds[k] < minLen || bounds[k] - bounds[k - 1] < minLen) bounds.splice(k, 1);
  }

  interface Raw { a: number; b: number; ch: Float64Array; tb: Float64Array; energy: number; vocal: number; loud: number }
  const raws: Raw[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1];
    const c = new Float64Array(12), t = new Float64Array(TIMBRE_BANDS);
    for (let i = a; i < b; i++) {
      for (let q = 0; q < 12; q++) c[q] += ch[i][q];
      for (let q = 0; q < TIMBRE_BANDS; q++) t[q] += tb[i][q];
    }
    const nc = Math.sqrt(dot(c, c)) || 1, nt = Math.sqrt(dot(t, t)) || 1;
    for (let q = 0; q < 12; q++) c[q] /= nc;
    for (let q = 0; q < TIMBRE_BANDS; q++) t[q] /= nt;
    raws.push({
      a, b, ch: c, tb: t,
      energy: mean(energy.slice(a, b)),
      vocal: mean(vocalN.slice(a, b)),
      loud: 10 * Math.log10(mean(u.rmsDb.slice(a, b).map((d) => Math.pow(10, d / 10))) + EPS),
    });
  }
  // repetition link between sections: fraction of units whose matches fall in the other section
  const link = (x: Raw, y: Raw) => {
    let hit = 0, tot = 0;
    for (let i = x.a; i < Math.min(x.b, M); i++) {
      tot++;
      if (repMatches[i].some((j) => j >= y.a - 1 && j < y.b + 1)) hit++;
    }
    return tot ? hit / tot : 0;
  };
  const sim = (x: Raw, y: Raw) => {
    const f = 0.5 * ((dot(x.ch, y.ch) + 1) / 2) + 0.5 * ((dot(x.tb, y.tb) + 1) / 2);
    const r = Math.max(link(x, y), link(y, x));
    return 0.55 * f + 0.45 * r;
  };
  const inSpan = (r: Raw) => spans.some(([a, e]) => r.a >= a && r.b <= e);
  const labels: string[] = [];
  let next = 0;
  for (let k = 0; k < raws.length; k++) {
    let best = -1, bestK = -1;
    for (let q = 0; q < k; q++) {
      if (spans.length && inSpan(raws[k]) !== inSpan(raws[q])) continue;
      const lenRatio = (raws[k].b - raws[k].a) / (raws[q].b - raws[q].a);
      if (lenRatio < 0.4 || lenRatio > 2.5) continue;
      const s = sim(raws[k], raws[q]);
      if (s > best) {
        best = s;
        bestK = q;
      }
    }
    if (bestK >= 0 && best > 0.74) labels.push(labels[bestK]);
    else labels.push(String.fromCharCode(65 + Math.min(25, next++)));
  }

  // ---- naming ----
  const count = (l: string) => labels.filter((x) => x === l).length;
  const labelEnergy = (l: string) => mean(raws.filter((_, k) => labels[k] === l).map((r) => r.energy));
  const hookSec = raws.findIndex((r) => hookIdx >= r.a && hookIdx < r.b);
  const repeated = Array.from(new Set(labels)).filter((l) => count(l) >= 2);
  let chorusLabel = hookSec >= 0 && count(labels[hookSec]) >= 2 ? labels[hookSec] : "";
  if (!chorusLabel && repeated.length) chorusLabel = repeated.sort((a, b) => labelEnergy(b) - labelEnergy(a))[0];
  const verseLabel =
    repeated
      .filter((l) => l !== chorusLabel)
      .sort((a, b) => {
        const dur = (l: string) => raws.filter((_, k) => labels[k] === l).reduce((s, r) => s + r.b - r.a, 0);
        return dur(b) - dur(a);
      })[0] ?? "";
  const medE = percentile(raws.map((r) => r.energy), 50);
  const firstChorus = labels.indexOf(chorusLabel);
  const kinds: SectionKind[] = raws.map((r, k) => {
    const l = labels[k];
    if (l === chorusLabel && chorusLabel) return "chorus";
    if (l === verseLabel && verseLabel) return "verse";
    const durSec = (r.b - r.a) * unitSec;
    if (k === 0 && (r.energy < medE - 0.1 || durSec <= 20)) return "intro";
    if (k === raws.length - 1 && raws.length > 2 && r.energy < medE) return "outro";
    const beforeChorus = labels[k + 1] === chorusLabel || (k + 1 < raws.length && spans.some(([a]) => a === raws[k + 1].a));
    if (beforeChorus && durSec <= barSec * 8.5 && (count(l) >= 2 || firstChorus < 0 || k < firstChorus)) return "prechorus";
    if (r.energy < medE - 0.25) return "break";
    if (firstChorus >= 0 && k > firstChorus) return "bridge";
    return k < raws.length / 2 ? "verse" : "bridge";
  });
  raws.forEach((r, k) => {
    if (inSpan(r)) kinds[k] = "chorus";
  });
  if (!chorusLabel && !kinds.includes("chorus") && raws.length) {
    // no repetition found: call the loudest section the hook section
    let best = 0;
    raws.forEach((r, k) => (r.energy > raws[best].energy ? (best = k) : 0));
    kinds[best] = "chorus";
  }
  const merged: Section[] = [];
  const sectionsRaw: Section[] = raws.map((r, k) => ({
    start: k === 0 ? 0 : u.times[r.a],
    end: u.times[r.b] ?? inp.duration,
    label: labels[k],
    kind: kinds[k],
    name: KIND_NAMES[kinds[k]],
    energy: r.energy,
    vocal: r.vocal,
  }));
  // merge consecutive pieces of the same material
  for (const sec of sectionsRaw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.label === sec.label && prev.kind === sec.kind) {
      const wa = prev.end - prev.start, wb = sec.end - sec.start;
      prev.energy = (prev.energy * wa + sec.energy * wb) / (wa + wb);
      prev.vocal = (prev.vocal * wa + sec.vocal * wb) / (wa + wb);
      prev.end = sec.end;
    } else merged.push({ ...sec });
  }
  const sections = merged;

  const chorusLoud = raws.filter((_, k) => kinds[k] === "chorus").map((r) => r.loud);
  const verseLoud = raws.filter((_, k) => kinds[k] === "verse").map((r) => r.loud);
  const chorusLift = chorusLoud.length && verseLoud.length ? mean(chorusLoud) - mean(verseLoud) : NaN;

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
    const hold = Math.max(1, Math.round(1 / inp.frames.hopSec));
    const thrV = v10 + 0.5 * (v90 - v10);
    for (let f = 0; f + hold < fv.length; f++) {
      let ok = true;
      for (let k = 0; k < hold; k += 2) if (fv[f + k] < thrV) { ok = false; break; }
      if (ok) {
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
