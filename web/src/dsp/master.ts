/**
 * Offline mastering chain (pure TS):
 *   low-cut → corrective/tonal EQ → mono-bass & width (M/S) → glue compressor
 *   → [gain → soft saturation → look-ahead true-peak-aware limiter] × N
 * The bracketed stage is iterated to hit an integrated-loudness target.
 */
import { applyBiquad, designBiquad, type FilterSpec } from "./biquad";
import { integratedLoudness, truePeakLinear } from "./loudness";
import { THIRD_OCTAVES, targetCurve } from "./tonal";
import { ampDb, clamp, fromDb, percentile } from "./util";

export interface MasterSettings {
  targetLufs: number;
  ceiling: number; // dBTP
  eq: FilterSpec[];
  lowCut: number; // Hz, 0 = off
  monoBelow: number; // Hz, 0 = off
  width: number; // side gain above monoBelow (1 = unchanged)
  glue: { ratio: number; attackMs: number; releaseMs: number; aboveP: number } | null;
  saturation: number; // 0..1
  releaseMs: number; // limiter
}

export interface MasterReport {
  lufsIn: number;
  lufsOut: number;
  truePeakOut: number;
  gainDb: number;
  maxGrDb: number;
  avgGrDb: number;
  glueGrDb: number;
  reachedTarget: boolean;
  chain: string[];
}

export type PresetId = "streaming" | "balanced" | "tiktok" | "club" | "warm";

export const PRESETS: Record<PresetId, { label: string; hint: string; settings: Omit<MasterSettings, "eq"> & { tone: FilterSpec[] } }> = {
  streaming: {
    label: "Streaming",
    hint: "−14 LUFS · dynamique préservée · Spotify / Apple / YouTube",
    settings: { targetLufs: -14, ceiling: -1, lowCut: 25, monoBelow: 120, width: 1, glue: { ratio: 1.6, attackMs: 30, releaseMs: 200, aboveP: 70 }, saturation: 0.05, releaseMs: 120, tone: [] },
  },
  balanced: {
    label: "Équilibré",
    hint: "−11 LUFS · compétitif sans écraser",
    settings: { targetLufs: -11, ceiling: -1, lowCut: 25, monoBelow: 120, width: 1.05, glue: { ratio: 2, attackMs: 30, releaseMs: 180, aboveP: 65 }, saturation: 0.15, releaseMs: 90, tone: [] },
  },
  tiktok: {
    label: "TikTok / Reels",
    hint: "−9 LUFS · présence téléphone · basses en mono",
    settings: {
      targetLufs: -9, ceiling: -1, lowCut: 30, monoBelow: 150, width: 1.05,
      glue: { ratio: 2.2, attackMs: 20, releaseMs: 150, aboveP: 60 }, saturation: 0.3, releaseMs: 70,
      tone: [{ type: "peaking", freq: 3200, q: 0.9, gain: 1.2 }, { type: "peaking", freq: 180, q: 1, gain: 0.8 }],
    },
  },
  club: {
    label: "Club",
    hint: "−7.5 LUFS · sub dense · punch",
    settings: {
      targetLufs: -7.5, ceiling: -1, lowCut: 28, monoBelow: 140, width: 1.08,
      glue: { ratio: 2.5, attackMs: 25, releaseMs: 120, aboveP: 55 }, saturation: 0.4, releaseMs: 60,
      tone: [{ type: "lowshelf", freq: 70, q: 0.7, gain: 1.2 }, { type: "highshelf", freq: 11000, q: 0.7, gain: 0.8 }],
    },
  },
  warm: {
    label: "Chaleureux",
    hint: "−11 LUFS · aigus adoucis · analogique",
    settings: {
      targetLufs: -11, ceiling: -1, lowCut: 25, monoBelow: 120, width: 0.98,
      glue: { ratio: 1.8, attackMs: 40, releaseMs: 250, aboveP: 65 }, saturation: 0.35, releaseMs: 120,
      tone: [{ type: "highshelf", freq: 9000, q: 0.7, gain: -1.2 }, { type: "peaking", freq: 220, q: 0.8, gain: 0.8 }],
    },
  },
};

/** Gentle corrective EQ from third-octave deviations vs. a genre target. */
export function autoEq(thirdsRaw: number[], family: string, strength = 0.5): FilterSpec[] {
  const targets = THIRD_OCTAVES.map((f) => targetCurve(family, f));
  const offs = THIRD_OCTAVES.map((f, i) => (f >= 100 && f <= 8000 ? thirdsRaw[i] - targets[i] : NaN)).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const off = offs[Math.floor(offs.length / 2)];
  const dev = THIRD_OCTAVES.map((f, i) => ({ f, d: thirdsRaw[i] - off - targets[i] }));
  // smooth over neighbours to target broad trends only
  const sm = dev.map((p, i) => ({ f: p.f, d: (dev[Math.max(0, i - 1)].d + 2 * p.d + dev[Math.min(dev.length - 1, i + 1)].d) / 4 }));
  const cands = sm.filter((p) => p.f >= 60 && p.f <= 12500 && Math.abs(p.d) > 2).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const picked: { f: number; d: number }[] = [];
  for (const c of cands) {
    if (picked.length >= 4) break;
    if (picked.every((p) => Math.abs(Math.log2(p.f / c.f)) > 0.9)) picked.push(c);
  }
  return picked.map((p) => ({ type: "peaking" as const, freq: p.f, q: 1.0, gain: clamp(-p.d * strength, -3, 3) }));
}

/** Match EQ towards a reference track's spectrum (third-octave graphic EQ). */
export function matchEq(ownThirds: number[], refThirds: number[], strength = 0.6): FilterSpec[] {
  const idx = THIRD_OCTAVES.map((f, i) => (f >= 100 && f <= 8000 ? i : -1)).filter((i) => i >= 0);
  const diffs = idx.map((i) => refThirds[i] - ownThirds[i]).sort((a, b) => a - b);
  const off = diffs[Math.floor(diffs.length / 2)];
  const out: FilterSpec[] = [];
  THIRD_OCTAVES.forEach((f, i) => {
    if (f < 31 || f > 16000) return;
    const d = refThirds[i] - ownThirds[i] - off;
    const g = clamp(d * strength, -4, 4);
    if (Math.abs(g) >= 0.5) out.push({ type: "peaking", freq: f, q: 2.2, gain: g });
  });
  return out;
}

function processFilters(ch: Float32Array, specs: FilterSpec[], fs: number) {
  for (const s of specs) applyBiquad(designBiquad(s, fs), ch);
}

function glueCompressor(L: Float32Array, R: Float32Array, fs: number, g: NonNullable<MasterSettings["glue"]>): number {
  // RMS detector (10 ms) → gain computer (soft knee) → attack/release in dB domain
  const n = L.length;
  const win = Math.max(1, Math.round(0.01 * fs));
  const levels = new Float32Array(Math.ceil(n / win));
  for (let b = 0; b < levels.length; b++) {
    let s = 0;
    const o = b * win;
    for (let i = 0; i < win && o + i < n; i++) s += 0.5 * (L[o + i] ** 2 + R[o + i] ** 2);
    levels[b] = 10 * Math.log10(s / win + 1e-12);
  }
  const loudBlocks = Array.from(levels).filter((v) => v > -60);
  if (!loudBlocks.length) return 0;
  const thr = percentile(loudBlocks, g.aboveP);
  const knee = 6;
  const aA = Math.exp(-1 / ((g.attackMs / 1000) * (fs / win)));
  const aR = Math.exp(-1 / ((g.releaseMs / 1000) * (fs / win)));
  const grBlocks = new Float32Array(levels.length);
  let gr = 0, grSum = 0;
  for (let b = 0; b < levels.length; b++) {
    const x = levels[b] - thr;
    let target = 0;
    if (x > knee / 2) target = x * (1 - 1 / g.ratio);
    else if (x > -knee / 2) target = ((1 - 1 / g.ratio) * (x + knee / 2) ** 2) / (2 * knee);
    gr = target > gr ? aA * gr + (1 - aA) * target : aR * gr + (1 - aR) * target;
    grBlocks[b] = gr;
    grSum += gr;
  }
  // apply with per-sample interpolation between blocks
  for (let b = 0; b < levels.length; b++) {
    const g0 = fromDb(-grBlocks[b]);
    const g1 = fromDb(-(grBlocks[b + 1] ?? grBlocks[b]));
    const o = b * win;
    for (let i = 0; i < win && o + i < n; i++) {
      const gg = g0 + ((g1 - g0) * i) / win;
      L[o + i] *= gg;
      R[o + i] *= gg;
    }
  }
  return grSum / levels.length;
}

/** Sliding-window minimum over [i, i + w) using a monotonic deque. */
function forwardMin(x: Float32Array, w: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && x[dq[tail - 1]] >= x[i]) tail--;
    dq[tail++] = i;
    while (dq[head] >= i + w) head++;
    out[i] = x[dq[head]];
  }
  return out;
}

/**
 * Look-ahead brickwall limiter (non-causal, offline). Guarantees
 * |y| ≤ ceiling at sample level; inter-sample peaks are handled by the caller.
 */
export function limit(L: Float32Array, R: Float32Array, fs: number, ceilingLin: number, releaseMs: number): { maxGr: number; avgGr: number } {
  const n = L.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = p > ceilingLin ? ceilingLin / p : 1;
  }
  const W = Math.max(2, Math.round(0.003 * fs));
  const h = forwardMin(need, W);
  // backward box average over W keeps g ≤ need and makes the attack a smooth ramp
  const gAtt = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += h[i];
    if (i >= W) acc -= h[i - W];
    gAtt[i] = acc / Math.min(i + 1, W);
  }
  const rel = 1 - Math.exp(-1 / ((releaseMs / 1000) * fs));
  let g = 1, maxGr = 0, grSum = 0;
  for (let i = 0; i < n; i++) {
    const t = gAtt[i];
    g = t < g ? t : g + (t - g) * rel;
    L[i] *= g;
    R[i] *= g;
    const gr = -ampDb(g);
    if (gr > maxGr) maxGr = gr;
    grSum += gr;
  }
  return { maxGr, avgGr: grSum / n };
}

function saturate(x: Float32Array, amount: number) {
  if (amount <= 0) return;
  const k = 1.6;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    x[i] = (1 - amount) * v + (amount * Math.tanh(k * v)) / k;
  }
}

export function master(channels: Float32Array[], fs: number, s: MasterSettings): { channels: [Float32Array, Float32Array]; report: MasterReport } {
  const L0 = new Float32Array(channels[0]);
  const R0 = new Float32Array(channels[1] ?? channels[0]);
  const lufsIn = integratedLoudness([L0, R0], fs);
  const chain: string[] = [];

  if (s.lowCut > 0) {
    const hp: FilterSpec = { type: "highpass", freq: s.lowCut, q: 0.707 };
    processFilters(L0, [hp], fs);
    processFilters(R0, [hp], fs);
    chain.push(`Passe-haut ${s.lowCut} Hz`);
  }
  if (s.eq.length) {
    processFilters(L0, s.eq, fs);
    processFilters(R0, s.eq, fs);
    for (const e of s.eq) {
      const kind = e.type === "peaking" ? "Cloche" : e.type === "lowshelf" ? "Low-shelf" : e.type === "highshelf" ? "High-shelf" : e.type;
      chain.push(`${kind} ${e.gain && e.gain > 0 ? "+" : ""}${(e.gain ?? 0).toFixed(1)} dB @ ${e.freq >= 1000 ? (e.freq / 1000).toFixed(1) + " kHz" : Math.round(e.freq) + " Hz"}`);
    }
  }
  if (s.monoBelow > 0 || s.width !== 1) {
    const n = L0.length;
    const side = new Float32Array(n);
    for (let i = 0; i < n; i++) side[i] = 0.5 * (L0[i] - R0[i]);
    if (s.monoBelow > 0) {
      const hp: FilterSpec = { type: "highpass", freq: s.monoBelow, q: 0.707 };
      processFilters(side, [hp, hp], fs);
      chain.push(`Basses mono < ${s.monoBelow} Hz`);
    }
    if (s.width !== 1) chain.push(`Largeur ${Math.round(s.width * 100)} %`);
    for (let i = 0; i < n; i++) {
      const m = 0.5 * (L0[i] + R0[i]);
      const sd = side[i] * s.width;
      L0[i] = m + sd;
      R0[i] = m - sd;
    }
  }
  let glueGr = 0;
  if (s.glue) {
    glueGr = glueCompressor(L0, R0, fs, s.glue);
    chain.push(`Compression de bus ${s.glue.ratio}:1 (≈ ${glueGr.toFixed(1)} dB)`);
  }
  if (s.saturation > 0) chain.push(`Saturation douce ${Math.round(s.saturation * 100)} %`);

  const pre = integratedLoudness([L0, R0], fs);
  let gainDb = Number.isFinite(pre) ? s.targetLufs - pre : 0;
  gainDb = clamp(gainDb, -24, 18);
  let outL = L0, outR = R0;
  let lufsOut = pre, maxGr = 0, avgGr = 0;
  const ceilLinTarget = fromDb(s.ceiling);
  let sampleCeil = fromDb(s.ceiling - 0.3);
  let prevGain = NaN, prevLufs = NaN;
  for (let iter = 0; iter < 7; iter++) {
    outL = new Float32Array(L0);
    outR = new Float32Array(R0);
    const g = fromDb(gainDb);
    for (let i = 0; i < outL.length; i++) {
      outL[i] *= g;
      outR[i] *= g;
    }
    saturate(outL, s.saturation);
    saturate(outR, s.saturation);
    ({ maxGr, avgGr } = limit(outL, outR, fs, sampleCeil, s.releaseMs));
    // true-peak safety: tighten the sample ceiling if inter-sample overs remain
    const tp = Math.max(truePeakLinear(outL), truePeakLinear(outR));
    if (tp > ceilLinTarget) {
      const scale = ceilLinTarget / tp;
      for (let i = 0; i < outL.length; i++) {
        outL[i] *= scale;
        outR[i] *= scale;
      }
      sampleCeil *= scale;
    }
    lufsOut = integratedLoudness([outL, outR], fs);
    const err = s.targetLufs - lufsOut;
    if (Math.abs(err) < 0.15 || !Number.isFinite(lufsOut)) break;
    // secant step (limiting makes loudness grow slower than gain)
    let step = err;
    if (Number.isFinite(prevLufs) && Math.abs(lufsOut - prevLufs) > 1e-3) {
      const slope = (lufsOut - prevLufs) / (gainDb - prevGain);
      step = err / clamp(slope, 0.2, 1.2);
    }
    prevGain = gainDb;
    prevLufs = lufsOut;
    gainDb = clamp(gainDb + step, -24, 24);
    if (maxGr > 14 && err > 0) break; // pushing further would wreck the mix
  }
  const truePeakOut = ampDb(Math.max(truePeakLinear(outL), truePeakLinear(outR)));
  chain.push(`Gain ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB`);
  chain.push(`Limiteur ${s.ceiling.toFixed(1)} dBTP (réduction max ${maxGr.toFixed(1)} dB)`);
  return {
    channels: [outL, outR],
    report: {
      lufsIn,
      lufsOut,
      truePeakOut,
      gainDb,
      maxGrDb: maxGr,
      avgGrDb: avgGr,
      glueGrDb: glueGr,
      reachedTarget: Math.abs(lufsOut - s.targetLufs) < 0.5,
      chain,
    },
  };
}
