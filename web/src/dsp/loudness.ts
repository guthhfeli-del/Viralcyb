/**
 * ITU-R BS.1770-4 / EBU R128 loudness measurement:
 *  - K-weighting (pre-filter + RLB high-pass) for any sample rate
 *  - momentary (400 ms), short-term (3 s), gated integrated loudness
 *  - loudness range (EBU Tech 3342)
 *  - 4× oversampled true-peak
 */
import type { BiquadCoeffs } from "./biquad";
import { applyBiquad } from "./biquad";
import { ampDb, clamp, percentile } from "./util";

export function kWeighting(fs: number): [BiquadCoeffs, BiquadCoeffs] {
  // High-shelf pre-filter (coefficients re-derived for arbitrary fs).
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: BiquadCoeffs = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // RLB high-pass.
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp: BiquadCoeffs = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, hp];
}

const LUFS_OFFSET = -0.691;
export const loudnessOf = (meanSquareSum: number): number =>
  meanSquareSum > 0 ? LUFS_OFFSET + 10 * Math.log10(meanSquareSum) : -Infinity;

export interface LoudnessReport {
  integrated: number;
  momentaryMax: number;
  shortTermMax: number;
  lra: number;
  truePeak: number; // dBTP
  samplePeak: number; // dBFS
  rms: number; // dBFS (mono-summed)
  crest: number; // dB, samplePeak - rms
  plr: number; // peak-to-loudness ratio (TP - integrated)
  psr: number; // TP - max short-term
  /** Short-term loudness sampled every second (LUFS). */
  shortTerm: number[];
  /** Momentary loudness every 100 ms (LUFS). */
  momentary: number[];
  clippedSamples: number;
}

/**
 * Per-100 ms block energies after K-weighting — shared by momentary,
 * short-term and integrated loudness.
 */
export function kBlockEnergies(channels: Float32Array[], fs: number): { blocks: Float64Array; blockSize: number } {
  const blockSize = Math.round(fs * 0.1);
  const n = channels[0].length;
  const nBlocks = Math.floor(n / blockSize);
  const blocks = new Float64Array(nBlocks);
  const [shelf, hp] = kWeighting(fs);
  const tmp = new Float64Array(n);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) tmp[i] = ch[i];
    applyBiquad(shelf, tmp);
    applyBiquad(hp, tmp);
    for (let b = 0; b < nBlocks; b++) {
      let s = 0;
      const off = b * blockSize;
      for (let i = 0; i < blockSize; i++) {
        const v = tmp[off + i];
        s += v * v;
      }
      blocks[b] += s; // channel weights are 1.0 for L/R/C
    }
  }
  return { blocks, blockSize };
}

/** Loudness of sliding windows of `win` blocks (100 ms each). */
export function windowLoudness(blocks: Float64Array, blockSize: number, win: number, hop = 1): number[] {
  const out: number[] = [];
  if (blocks.length < win) {
    if (blocks.length === 0) return out;
    let s = 0;
    for (let i = 0; i < blocks.length; i++) s += blocks[i];
    out.push(loudnessOf(s / (blocks.length * blockSize)));
    return out;
  }
  let acc = 0;
  for (let i = 0; i < win; i++) acc += blocks[i];
  const denom = win * blockSize;
  for (let start = 0; start + win <= blocks.length; start++) {
    if (start > 0) acc += blocks[start + win - 1] - blocks[start - 1];
    if (start % hop === 0) out.push(loudnessOf(Math.max(acc, 0) / denom));
  }
  return out;
}

export function integratedFromBlocks(blocks: Float64Array, blockSize: number): number {
  // 400 ms gating blocks with 75 % overlap == 4 × 100 ms blocks, step 1.
  const energies: number[] = [];
  for (let s = 0; s + 4 <= blocks.length; s++) {
    energies.push((blocks[s] + blocks[s + 1] + blocks[s + 2] + blocks[s + 3]) / (4 * blockSize));
  }
  if (energies.length === 0) return -Infinity;
  const absGated = energies.filter((e) => loudnessOf(e) > -70);
  if (absGated.length === 0) return -Infinity;
  const relThreshold = loudnessOf(absGated.reduce((a, b) => a + b, 0) / absGated.length) - 10;
  const relGated = absGated.filter((e) => loudnessOf(e) > relThreshold);
  if (relGated.length === 0) return -Infinity;
  return loudnessOf(relGated.reduce((a, b) => a + b, 0) / relGated.length);
}

export function loudnessRange(shortTerm100ms: number[]): number {
  const abs = shortTerm100ms.filter((l) => l > -70);
  if (abs.length < 2) return 0;
  const meanE = abs.reduce((a, l) => a + Math.pow(10, (l - LUFS_OFFSET) / 10), 0) / abs.length;
  const rel = loudnessOf(meanE) - 20;
  const gated = abs.filter((l) => l > rel);
  if (gated.length < 2) return 0;
  return percentile(gated, 95) - percentile(gated, 10);
}

/** Integrated loudness only (fast path for mastering iterations). */
export function integratedLoudness(channels: Float32Array[], fs: number): number {
  const { blocks, blockSize } = kBlockEnergies(channels, fs);
  return integratedFromBlocks(blocks, blockSize);
}

// ---------- true peak ----------

const TP_PHASES = 4;
const TP_TAPS = 16; // per phase
let tpKernel: Float64Array[] | null = null;

function truePeakKernel(): Float64Array[] {
  if (tpKernel) return tpKernel;
  const N = TP_PHASES * TP_TAPS;
  const h = new Float64Array(N);
  const center = (N - 1) / 2;
  for (let i = 0; i < N; i++) {
    const t = (i - center) / TP_PHASES;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    // Blackman window
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
    h[i] = sinc * w;
  }
  const phases: Float64Array[] = [];
  for (let p = 0; p < TP_PHASES; p++) {
    const ph = new Float64Array(TP_TAPS);
    let s = 0;
    for (let k = 0; k < TP_TAPS; k++) {
      ph[k] = h[k * TP_PHASES + p];
      s += ph[k];
    }
    for (let k = 0; k < TP_TAPS; k++) ph[k] /= s; // unity DC gain per phase
    phases.push(ph);
  }
  tpKernel = phases;
  return phases;
}

/**
 * 4× oversampled true peak (linear). Only evaluates the interpolator near
 * loud samples: an inter-sample overshoot can only occur next to them.
 */
export function truePeakLinear(ch: Float32Array, samplePeak?: number): number {
  const phases = truePeakKernel();
  let sp = samplePeak ?? 0;
  if (samplePeak === undefined) for (let i = 0; i < ch.length; i++) sp = Math.max(sp, Math.abs(ch[i]));
  const gate = sp * 0.5;
  let peak = sp;
  const n = ch.length;
  const half = TP_TAPS / 2;
  for (let m = 0; m < n; m++) {
    if (Math.abs(ch[m]) < gate) continue;
    for (let p = 0; p < TP_PHASES; p++) {
      const ph = phases[p];
      let acc = 0;
      for (let k = 0; k < TP_TAPS; k++) {
        const idx = m + half - k;
        if (idx >= 0 && idx < n) acc += ph[k] * ch[idx];
      }
      const a = Math.abs(acc);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

export function measureLoudness(channels: Float32Array[], fs: number): LoudnessReport {
  const { blocks, blockSize } = kBlockEnergies(channels, fs);
  const momentary = windowLoudness(blocks, blockSize, 4, 1);
  const short100 = windowLoudness(blocks, blockSize, 30, 1);
  const shortTerm = windowLoudness(blocks, blockSize, 30, 10);
  const integrated = integratedFromBlocks(blocks, blockSize);
  const lra = loudnessRange(short100);

  let samplePeak = 0;
  let clipped = 0;
  let sumSq = 0;
  const n = channels[0].length;
  const perChannelPeak: number[] = [];
  for (const ch of channels) {
    let p = 0;
    let run = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(ch[i]);
      if (a > p) p = a;
      if (a >= 0.9995) {
        run++;
        if (run === 3) clipped += 3;
        else if (run > 3) clipped++;
      } else run = 0;
    }
    perChannelPeak.push(p);
    samplePeak = Math.max(samplePeak, p);
  }
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const ch of channels) m += ch[i];
    m /= channels.length;
    sumSq += m * m;
  }
  let tp = 0;
  channels.forEach((ch, i) => (tp = Math.max(tp, truePeakLinear(ch, perChannelPeak[i]))));
  const truePeak = ampDb(tp);
  const rms = ampDb(Math.sqrt(sumSq / Math.max(1, n)));
  const finiteMax = (xs: number[]) => xs.reduce((a, b) => (Number.isFinite(b) && b > a ? b : a), -Infinity);
  const momentaryMax = finiteMax(momentary);
  const shortTermMax = finiteMax(short100);
  return {
    integrated,
    momentaryMax,
    shortTermMax,
    lra,
    truePeak,
    samplePeak: ampDb(samplePeak),
    rms,
    crest: ampDb(samplePeak) - rms,
    plr: truePeak - integrated,
    psr: truePeak - shortTermMax,
    shortTerm: shortTerm.map((l) => (Number.isFinite(l) ? l : -70)),
    momentary: momentary.map((l) => (Number.isFinite(l) ? clamp(l, -70, 10) : -70)),
    clippedSamples: clipped,
  };
}
