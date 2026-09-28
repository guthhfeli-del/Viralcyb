/**
 * Tonal balance (1/3-octave long-term spectrum vs. genre target curves) and
 * stereo image analysis.
 */
import { applyBiquad, designBiquad } from "./biquad";
import { clamp, db, EPS } from "./util";

export const THIRD_OCTAVES = [
  25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500,
  3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000,
];

export interface BandPoint {
  f: number;
  db: number; // measured, aligned to target
  target: number;
  deviation: number;
}

export interface ToneBand {
  id: "sub" | "bass" | "lowmid" | "mid" | "highmid" | "presence" | "air";
  label: string;
  lo: number;
  hi: number;
  share: number; // % of total energy
  deviation: number; // dB vs target (band average)
}

export interface TonalBalance {
  thirds: BandPoint[];
  bands: ToneBand[];
  tiltDbPerOct: number;
  centroid: number;
  bandwidthHz: number; // highest frequency with meaningful content
}

/** Genre-independent spectral profile (raw 1/3-octave band powers etc.). */
export interface SpectrumProfile {
  thirdsRaw: number[]; // dB per THIRD_OCTAVES band
  shares: number[]; // % energy per TONE_BANDS
  tiltDbPerOct: number;
  centroid: number;
  bandwidthHz: number;
}

/**
 * Target long-term spectra (1/3-octave band power, dB relative to 1 kHz) —
 * approximations of commercial reference averages per genre family.
 */
const TARGET_ANCHORS: Record<string, [number, number][]> = {
  hiphop: [[25, 6], [40, 10], [63, 11], [100, 8], [160, 5], [250, 3], [500, 1.5], [1000, 0], [2000, -2.5], [4000, -5.5], [8000, -9], [12500, -13], [16000, -20]],
  pop: [[25, 1], [40, 6], [63, 8], [100, 6.5], [160, 4.5], [250, 3], [500, 1.5], [1000, 0], [2000, -1.5], [4000, -4], [8000, -7.5], [12500, -11], [16000, -17]],
  edm: [[25, 4], [40, 9], [63, 10.5], [100, 8], [160, 5], [250, 2.5], [500, 1], [1000, 0], [2000, -1.5], [4000, -4], [8000, -7], [12500, -10], [16000, -15]],
  rnb: [[25, 3], [40, 8], [63, 9.5], [100, 7.5], [160, 5], [250, 3], [500, 1.5], [1000, 0], [2000, -2.5], [4000, -6], [8000, -10], [12500, -14], [16000, -21]],
  rock: [[25, -2], [40, 3], [63, 6], [100, 6], [160, 5], [250, 3.5], [500, 2], [1000, 0], [2000, -1], [4000, -3], [8000, -7], [12500, -11], [16000, -18]],
};

export function targetCurve(family: string, f: number): number {
  const a = TARGET_ANCHORS[family] ?? TARGET_ANCHORS.pop;
  if (f <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) {
    if (f <= a[i][0]) {
      const t = Math.log(f / a[i - 1][0]) / Math.log(a[i][0] / a[i - 1][0]);
      return a[i - 1][1] + t * (a[i][1] - a[i - 1][1]);
    }
  }
  return a[a.length - 1][1];
}

export const TONE_BANDS: Omit<ToneBand, "share" | "deviation">[] = [
  { id: "sub", label: "Sub", lo: 20, hi: 60 },
  { id: "bass", label: "Basses", lo: 60, hi: 250 },
  { id: "lowmid", label: "Bas-médiums", lo: 250, hi: 500 },
  { id: "mid", label: "Médiums", lo: 500, hi: 2000 },
  { id: "highmid", label: "Haut-médiums", lo: 2000, hi: 4000 },
  { id: "presence", label: "Présence", lo: 4000, hi: 8000 },
  { id: "air", label: "Air", lo: 8000, hi: 20000 },
];

export function spectrumProfile(ltasMid: Float64Array, ltasSide: Float64Array, binHz: number): SpectrumProfile {
  const bins = ltasMid.length;
  const total = new Float64Array(bins);
  for (let k = 0; k < bins; k++) total[k] = ltasMid[k] + ltasSide[k];
  const bandPower = (lo: number, hi: number) => {
    let s = 0;
    const k0 = Math.max(1, Math.floor(lo / binHz));
    const k1 = Math.min(bins - 1, Math.ceil(hi / binHz));
    for (let k = k0; k <= k1; k++) {
      const f = k * binHz;
      if (f >= lo && f < hi) s += total[k];
    }
    // very low bands may contain < 1 bin: interpolate from the nearest bin
    if (s === 0) s = total[clamp(Math.round(Math.sqrt(lo * hi) / binHz), 1, bins - 1)] * ((hi - lo) / binHz);
    return s;
  };
  const thirdsRaw = THIRD_OCTAVES.map((fc) => db(bandPower(fc / Math.pow(2, 1 / 6), fc * Math.pow(2, 1 / 6))));

  // tilt: regression of band dB vs log2(f) over 100 Hz – 10 kHz
  const xs: number[] = [], ys: number[] = [];
  THIRD_OCTAVES.forEach((f, i) => {
    if (f >= 100 && f <= 10000) {
      xs.push(Math.log2(f));
      ys.push(thirdsRaw[i]);
    }
  });
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }

  let tot = 0, wsum = 0;
  for (let k = 1; k < bins; k++) {
    tot += total[k];
    wsum += total[k] * k * binHz;
  }
  const shares = TONE_BANDS.map((b) => (bandPower(b.lo, b.hi) / (tot + EPS)) * 100);

  // effective bandwidth: highest frequency within 60 dB of the 200 Hz–5 kHz peak level
  let peakDb = -Infinity;
  const smoothDb = new Float64Array(bins);
  const w = Math.max(1, Math.round(200 / binHz));
  let acc = 0, cnt = 0;
  for (let k = 1; k <= Math.min(bins - 1, w); k++) { acc += total[k]; cnt++; }
  for (let k = 1; k < bins; k++) {
    if (k + w < bins) { acc += total[k + w]; cnt++; }
    if (k - w - 1 >= 1) { acc -= total[k - w - 1]; cnt--; }
    smoothDb[k] = db(Math.max(acc, 0) / cnt);
    if (k * binHz > 200 && k * binHz < 5000) peakDb = Math.max(peakDb, smoothDb[k]);
  }
  let bandwidthHz = 0;
  for (let k = bins - 1; k > 0; k--) {
    if (smoothDb[k] > peakDb - 60) {
      bandwidthHz = k * binHz;
      break;
    }
  }
  return { thirdsRaw, shares, tiltDbPerOct: den > 0 ? num / den : 0, centroid: tot > 0 ? wsum / tot : 0, bandwidthHz };
}

/** Compare a spectral profile with a genre-family target curve. */
export function tonalBalance(p: SpectrumProfile, family: string): TonalBalance {
  const targets = THIRD_OCTAVES.map((fc) => targetCurve(family, fc));
  // align levels on 100 Hz – 8 kHz so that only the *shape* is compared
  const offs = THIRD_OCTAVES.map((f, i) => (f >= 100 && f <= 8000 ? p.thirdsRaw[i] - targets[i] : NaN))
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
  const offset = offs[Math.floor(offs.length / 2)];
  const thirds: BandPoint[] = THIRD_OCTAVES.map((f, i) => ({
    f,
    db: p.thirdsRaw[i] - offset,
    target: targets[i],
    deviation: p.thirdsRaw[i] - offset - targets[i],
  }));
  const bands: ToneBand[] = TONE_BANDS.map((b, i) => {
    const inBand = thirds.filter((q) => q.f >= b.lo && q.f < b.hi);
    const deviation = inBand.length ? inBand.reduce((a, q) => a + q.deviation, 0) / inBand.length : 0;
    return { ...b, share: p.shares[i], deviation };
  });
  return { thirds, bands, tiltDbPerOct: p.tiltDbPerOct, centroid: p.centroid, bandwidthHz: p.bandwidthHz };
}

export interface StereoReport {
  correlation: number; // -1..1 (full band)
  lowCorrelation: number; // < 120 Hz
  width: number; // 0..1, side / (mid + side) energy
  widthByBand: { label: string; width: number }[];
  balanceDb: number; // L - R
  monoLossDb: number; // loudness change when summed to mono (≤ 0)
}

function corr(a: Float32Array | Float64Array, b: Float32Array | Float64Array): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa < EPS || bb < EPS) return 1;
  return ab / Math.sqrt(aa * bb);
}

export function stereoReport(left: Float32Array, right: Float32Array, fs: number, ltasMid: Float64Array, ltasSide: Float64Array, binHz: number): StereoReport {
  // decimate for speed: correlation is robust to it
  const step = Math.max(1, Math.floor(left.length / 2_000_000));
  const n = Math.floor(left.length / step);
  const L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = left[i * step];
    R[i] = right[i * step];
  }
  const correlation = corr(L, R);
  const lp = designBiquad({ type: "lowpass", freq: 120, q: 0.707 }, fs / step);
  const Ll = applyBiquad(lp, new Float64Array(L));
  const Rl = applyBiquad(lp, new Float64Array(R));
  const lowCorrelation = corr(Ll, Rl);
  let el = 0, er = 0, elr = 0;
  for (let i = 0; i < n; i++) {
    el += L[i] * L[i];
    er += R[i] * R[i];
    elr += L[i] * R[i];
  }
  const stereoE = el + er;
  const monoE = (el + er + 2 * elr) / 2;
  const monoLossDb = stereoE > EPS ? db(monoE / stereoE) : 0;
  const bandW = (lo: number, hi: number) => {
    let m = 0, s = 0;
    for (let k = Math.max(1, Math.floor(lo / binHz)); k < Math.min(ltasMid.length, Math.ceil(hi / binHz)); k++) {
      m += ltasMid[k];
      s += ltasSide[k];
    }
    return m + s > EPS ? s / (m + s) : 0;
  };
  return {
    correlation,
    lowCorrelation,
    width: bandW(20, 20000),
    widthByBand: [
      { label: "< 120 Hz", width: bandW(20, 120) },
      { label: "120–500", width: bandW(120, 500) },
      { label: "500–2k", width: bandW(500, 2000) },
      { label: "2k–8k", width: bandW(2000, 8000) },
      { label: "> 8k", width: bandW(8000, 20000) },
    ],
    balanceDb: db(el / Math.max(er, EPS)),
    monoLossDb: Math.min(0, monoLossDb),
  };
}
