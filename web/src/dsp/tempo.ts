/**
 * Tempo estimation (autocorrelation of the onset envelope with a log-normal
 * tempo prior and harmonic comb) and dynamic-programming beat tracking
 * (Ellis 2007), plus a 4/4 downbeat phase estimate.
 */
import { getFFT } from "./fft";
import { clamp, mean } from "./util";

export interface TempoResult {
  bpm: number;
  confidence: number; // 0..1
  pulseClarity: number; // 0..1
  alternatives: number[]; // half / double time readings
}

export function autocorrelation(x: ArrayLike<number>, maxLag: number): Float64Array {
  let size = 1;
  while (size < 2 * x.length) size <<= 1;
  const fft = getFFT(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fft.transform(re, im);
  for (let i = 0; i < size; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft.inverse(re, im);
  const out = new Float64Array(Math.min(maxLag + 1, x.length));
  for (let i = 0; i < out.length; i++) out[i] = re[i] / (x.length - i); // unbiased
  return out;
}

export function estimateTempo(env: Float32Array, hopSec: number, minBpm = 55, maxBpm = 215): TempoResult {
  const lagMin = Math.max(1, Math.floor(60 / maxBpm / hopSec));
  const lagMax = Math.ceil(60 / minBpm / hopSec);
  // too short to hold two beats at the slowest tempo: no meaningful reading
  if (env.length < 2 * lagMax + 2) return { bpm: 120, confidence: 0, pulseClarity: 0, alternatives: [] };
  const ac = autocorrelation(env, lagMax * 4 + 2);
  const r0 = ac[0] || 1;
  const score = new Float64Array(lagMax + 1);
  let best = -1, bestLag = lagMin;
  for (let lag = lagMin; lag <= lagMax && lag < ac.length; lag++) {
    let s = ac[lag];
    if (2 * lag < ac.length) s += 0.5 * ac[2 * lag];
    if (3 * lag < ac.length) s += 0.33 * ac[3 * lag];
    if (4 * lag < ac.length) s += 0.25 * ac[4 * lag];
    const bpm = 60 / (lag * hopSec);
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    score[lag] = s * prior;
    if (score[lag] > best) {
      best = score[lag];
      bestLag = lag;
    }
  }
  // parabolic interpolation for sub-frame precision
  let lag = bestLag;
  if (bestLag > lagMin && bestLag < lagMax) {
    const a = score[bestLag - 1], b = score[bestLag], c = score[bestLag + 1];
    const d = a - 2 * b + c;
    if (d < 0) lag = bestLag + clamp((0.5 * (a - c)) / d, -0.5, 0.5);
  }
  const bpm = 60 / (lag * hopSec);
  // confidence: how much the winning peak stands out from the typical score
  const vals = Array.from(score.slice(lagMin, lagMax + 1)).sort((x, y) => x - y);
  const med = vals[Math.floor(vals.length / 2)] || 0;
  const confidence = best > 0 ? clamp((best - med) / best, 0, 1) : 0;
  const pulseClarity = clamp(ac[bestLag] / r0, 0, 1);
  return { bpm, confidence, pulseClarity, alternatives: [bpm / 2, bpm * 2].filter((b) => b >= 50 && b <= 240) };
}

/** Ellis-style DP beat tracker. Returns beat frame indices. */
export function trackBeats(env: Float32Array, hopSec: number, bpm: number, tightness = 100): number[] {
  const n = env.length;
  if (n < 4) return [];
  const period = 60 / bpm / hopSec;
  // local score: onset envelope smoothed by a Gaussian of width period/32
  const sigma = Math.max(1, period / 32);
  const half = Math.ceil(3 * sigma);
  const kernel: number[] = [];
  for (let i = -half; i <= half; i++) kernel.push(Math.exp(-0.5 * (i / sigma) ** 2));
  const local = new Float64Array(n);
  const envStd = Math.sqrt(mean(Array.from(env, (v) => v * v))) || 1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) {
      const j = i + k;
      if (j >= 0 && j < n) s += env[j] * kernel[k + half];
    }
    local[i] = s / envStd;
  }
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const wMin = Math.round(period / 2);
  const wMax = Math.round(2 * period);
  for (let t = 0; t < n; t++) {
    let bestV = -Infinity, bestTau = -1;
    for (let off = wMin; off <= wMax; off++) {
      const tau = t - off;
      if (tau < 0) break;
      const pen = -tightness * Math.log(off / period) ** 2;
      const v = cum[tau] + pen;
      if (v > bestV) {
        bestV = v;
        bestTau = tau;
      }
    }
    cum[t] = local[t] + (bestTau >= 0 ? bestV : 0);
    back[t] = bestTau;
  }
  // choose the final beat within the last period
  let last = n - 1, lastV = -Infinity;
  for (let t = Math.max(0, n - Math.ceil(period)); t < n; t++) {
    if (cum[t] > lastV) {
      lastV = cum[t];
      last = t;
    }
  }
  const beats: number[] = [];
  for (let t = last; t >= 0; t = back[t]) {
    beats.push(t);
    if (back[t] < 0) break;
  }
  beats.reverse();
  // trim weak beats at the edges (silence, fade)
  const strength = beats.map((b) => local[b]);
  const thr = 0.25 * (strength.slice().sort((a, b) => a - b)[Math.floor(strength.length / 2)] || 0);
  let s = 0, e = beats.length - 1;
  while (s < e && strength[s] < thr) s++;
  while (e > s && strength[e] < thr) e--;
  return beats.slice(s, e + 1);
}

/** Refine the tempo from the tracked beats with a least-squares line fit. */
export function refineBpm(beatTimes: number[], fallback: number): number {
  const n = beatTimes.length;
  if (n < 8) return fallback;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += beatTimes[i];
    sxx += i * i;
    sxy += i * beatTimes[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (!(slope > 0)) return fallback;
  const bpm = 60 / slope;
  return Math.abs(bpm - fallback) / fallback < 0.08 ? bpm : fallback;
}

/**
 * Pick the 4/4 bar phase: downbeats tend to carry more kick energy and more
 * harmonic change.
 */
export function downbeatPhase(beatFrames: number[], lowEnv: Float32Array, harmonicChange: (frame: number) => number): number {
  if (beatFrames.length < 8) return 0;
  const scores = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < beatFrames.length; i++) {
    const f = beatFrames[i];
    let low = 0;
    for (let k = -2; k <= 2; k++) low = Math.max(low, lowEnv[f + k] ?? 0);
    scores[i % 4] += low + 0.6 * harmonicChange(f);
    counts[i % 4]++;
  }
  let best = 0;
  for (let p = 1; p < 4; p++) if (scores[p] / counts[p] > scores[best] / counts[best]) best = p;
  return best;
}

/** Danceability proxy in 0..1 from pulse clarity, beat salience and tempo. */
export function danceability(pulseClarity: number, beatSalience: number, bpm: number): number {
  const tempoFit = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 115) / 0.35, 2));
  const halfFit = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 2 / 115) / 0.35, 2)) * 0.8;
  return clamp(0.45 * clamp(pulseClarity * 1.6, 0, 1) + 0.35 * clamp((beatSalience - 1) / 2, 0, 1) + 0.2 * Math.max(tempoFit, halfFit), 0, 1);
}
