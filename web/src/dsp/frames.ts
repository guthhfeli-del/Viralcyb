/**
 * Frame-level spectral analysis (single STFT pass over mid & side):
 * long-term average spectra, timbre bands, chroma, centroid, flatness,
 * and a vocal-presence proxy.
 */
import { Spectrum } from "./fft";
import { EPS } from "./util";

export const FRAME_SIZE = 4096;
export const TIMBRE_BANDS = 24;

export interface FrameFeatures {
  fs: number;
  hop: number; // samples
  hopSec: number;
  count: number;
  binHz: number;
  rmsDb: Float32Array;
  lowDb: Float32Array; // 20–120 Hz energy
  timbre: Float32Array; // count × TIMBRE_BANDS (dB)
  chroma: Float32Array; // count × 12 (sum-normalised)
  centroid: Float32Array; // Hz
  flatness: Float32Array; // 0..1
  vocal: Float32Array; // raw proxy
  ltasMid: Float64Array; // mean power per bin
  ltasSide: Float64Array;
  bandEdges: number[]; // Hz, TIMBRE_BANDS + 1
}

function logBandEdges(lo: number, hi: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(lo * Math.pow(hi / lo, i / n));
  return out;
}

export function analyzeFrames(left: Float32Array, right: Float32Array, fs: number): FrameFeatures {
  const n = FRAME_SIZE;
  const hop = n / 2;
  const spec = new Spectrum(n);
  const bins = spec.bins;
  const binHz = fs / n;
  const len = left.length;
  const count = Math.max(1, Math.floor((len - n) / hop) + 1);

  const mid = new Float32Array(len);
  const side = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mid[i] = 0.5 * (left[i] + right[i]);
    side[i] = 0.5 * (left[i] - right[i]);
  }

  const edges = logBandEdges(30, Math.min(16000, fs / 2 - 1), TIMBRE_BANDS);
  const bandOf = new Int16Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    for (let b = 0; b < TIMBRE_BANDS; b++) {
      if (f >= edges[b] && f < edges[b + 1]) {
        bandOf[k] = b;
        break;
      }
    }
  }
  // chroma mapping (80 Hz – 5 kHz), soft assignment to nearest semitone
  const chromaBin = new Int8Array(bins).fill(-1);
  const chromaW = new Float32Array(bins);
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    if (f < 80 || f > 5000) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const r = Math.round(midi);
    const d = Math.abs(midi - r);
    chromaBin[k] = ((r % 12) + 12) % 12;
    chromaW[k] = Math.max(0, 1 - 2 * d); // 1 at the pitch centre, 0 at a quarter tone
  }
  const k20 = Math.round(20 / binHz), k120 = Math.round(120 / binHz);
  const k100 = Math.round(100 / binHz), k8k = Math.min(bins - 1, Math.round(8000 / binHz));
  const kv1 = Math.round(300 / binHz), kv2 = Math.round(3400 / binHz);

  const rmsDb = new Float32Array(count);
  const lowDb = new Float32Array(count);
  const timbre = new Float32Array(count * TIMBRE_BANDS);
  const chroma = new Float32Array(count * 12);
  const centroid = new Float32Array(count);
  const flatness = new Float32Array(count);
  const vocal = new Float32Array(count);
  const ltasMid = new Float64Array(bins);
  const ltasSide = new Float64Array(bins);
  const pm = new Float64Array(bins);
  const ps = new Float64Array(bins);
  const bandAcc = new Float64Array(TIMBRE_BANDS);
  const chr = new Float64Array(12);

  for (let f = 0; f < count; f++) {
    const off = f * hop;
    spec.power(mid, off, pm);
    spec.power(side, off, ps);

    let e = 0;
    for (let i = 0; i < n; i++) {
      const v = mid[off + i] ?? 0;
      e += v * v;
    }
    rmsDb[f] = 10 * Math.log10(e / n + EPS);

    bandAcc.fill(0);
    chr.fill(0);
    let tot = 0, wsum = 0, low = 0, logSum = 0, linSum = 0, flatN = 0;
    let vMid = 0, vSide = 0, vLogSum = 0, vLinSum = 0;
    for (let k = 1; k < bins; k++) {
      const p = pm[k];
      ltasMid[k] += p;
      ltasSide[k] += ps[k];
      tot += p;
      wsum += p * k * binHz;
      const b = bandOf[k];
      if (b >= 0) bandAcc[b] += p + ps[k];
      if (k >= k20 && k <= k120) low += p;
      const c = chromaBin[k];
      if (c >= 0) chr[c] += Math.sqrt(p) * chromaW[k];
      if (k >= k100 && k <= k8k) {
        logSum += Math.log(p + EPS);
        linSum += p;
        flatN++;
      }
      if (k >= kv1 && k <= kv2) {
        vMid += p;
        vSide += ps[k];
        vLogSum += Math.log(p + EPS);
        vLinSum += p;
      }
    }
    for (let b = 0; b < TIMBRE_BANDS; b++) timbre[f * TIMBRE_BANDS + b] = 10 * Math.log10(bandAcc[b] + EPS);
    let cs = 0;
    for (let c = 0; c < 12; c++) cs += chr[c];
    for (let c = 0; c < 12; c++) chroma[f * 12 + c] = cs > EPS ? chr[c] / cs : 0;
    centroid[f] = tot > EPS ? wsum / tot : 0;
    lowDb[f] = 10 * Math.log10(low + EPS);
    flatness[f] = flatN > 0 && linSum > EPS ? Math.exp(logSum / flatN) / (linSum / flatN) : 1;
    const vN = kv2 - kv1 + 1;
    const vFlat = vLinSum > EPS ? Math.exp(vLogSum / vN) / (vLinSum / vN) : 1;
    const bandFrac = tot > EPS ? vMid / tot : 0;
    const centre = vMid + vSide > EPS ? vMid / (vMid + vSide) : 0;
    // Voices are centred, harmonic (low flatness) and dominate 300–3400 Hz.
    vocal[f] = bandFrac * centre * (1 - Math.min(1, vFlat * 2));
  }
  for (let k = 0; k < bins; k++) {
    ltasMid[k] /= count;
    ltasSide[k] /= count;
  }
  return {
    fs, hop, hopSec: hop / fs, count, binHz,
    rmsDb, lowDb, timbre, chroma, centroid, flatness, vocal,
    ltasMid, ltasSide, bandEdges: edges,
  };
}

/**
 * Onset strength envelope: log-magnitude spectral flux over log-spaced bands.
 * Returns a full-band envelope plus a low-band (kick) envelope.
 */
export interface OnsetEnvelope {
  env: Float32Array;
  low: Float32Array;
  hopSec: number;
}

export function onsetEnvelope(mono: Float32Array, fs: number): OnsetEnvelope {
  // Work around 22 kHz to keep the hop ≈ 11.6 ms regardless of input rate.
  const n = fs > 32000 ? 1024 : 512;
  const hop = n / 2;
  const spec = new Spectrum(n);
  const bins = spec.bins;
  const binHz = fs / n;
  const count = Math.max(1, Math.floor((mono.length - n) / hop) + 1);
  const NB = 40;
  const edges = logBandEdges(30, Math.min(11000, fs / 2 - 1), NB);
  const bandOf = new Int16Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const f = k * binHz;
    for (let b = 0; b < NB; b++) if (f >= edges[b] && f < edges[b + 1]) { bandOf[k] = b; break; }
  }
  const lowBands = edges.filter((e) => e < 150).length;
  const p = new Float64Array(bins);
  const cur = new Float64Array(NB);
  const prev = new Float64Array(NB);
  const env = new Float32Array(count);
  const low = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    spec.power(mono, f * hop, p);
    cur.fill(0);
    for (let k = 1; k < bins; k++) {
      const b = bandOf[k];
      if (b >= 0) cur[b] += p[k];
    }
    let flux = 0, lflux = 0;
    for (let b = 0; b < NB; b++) {
      const v = Math.log1p(1e4 * cur[b]);
      if (f > 0) {
        const d = v - prev[b];
        if (d > 0) {
          flux += d;
          if (b < lowBands) lflux += d;
        }
      }
      prev[b] = v;
    }
    env[f] = flux;
    low[f] = lflux;
  }
  return { env: detrend(env, Math.round(0.4 / (hop / fs))), low: detrend(low, Math.round(0.4 / (hop / fs))), hopSec: hop / fs };
}

/** Subtract a local mean and half-wave rectify, then scale to unit max. */
function detrend(x: Float32Array, w: number): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const h = Math.max(1, Math.floor(w / 2));
  let acc = 0, cnt = 0;
  for (let i = 0; i < Math.min(h, n); i++) { acc += x[i]; cnt++; }
  let mx = 0;
  for (let i = 0; i < n; i++) {
    if (i + h < n) { acc += x[i + h]; cnt++; }
    if (i - h - 1 >= 0) { acc -= x[i - h - 1]; cnt--; }
    const v = Math.max(0, x[i] - acc / cnt);
    out[i] = v;
    if (v > mx) mx = v;
  }
  if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
  return out;
}
