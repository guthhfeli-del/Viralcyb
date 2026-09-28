/**
 * RBJ "Audio EQ Cookbook" biquads — used for offline processing (mastering,
 * K-weighting, device simulation analysis) and for drawing EQ curves.
 */
export type FilterType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "peaking"
  | "lowshelf"
  | "highshelf"
  | "notch";

export interface FilterSpec {
  type: FilterType;
  freq: number;
  q?: number;
  gain?: number; // dB, for peaking/shelves
}

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export function designBiquad(spec: FilterSpec, fs: number): BiquadCoeffs {
  const f = Math.min(Math.max(spec.freq, 1), fs * 0.499);
  const q = spec.q ?? Math.SQRT1_2;
  const gain = spec.gain ?? 0;
  const A = Math.pow(10, gain / 40);
  const w0 = (2 * Math.PI * f) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (spec.type) {
    case "lowpass":
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1; b1 = -2 * cw; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
      break;
    case "lowshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - s;
      break;
    }
    case "highshelf": {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Process a buffer in place (transposed direct form II, float64 state). */
export function applyBiquad(c: BiquadCoeffs, x: Float32Array | Float64Array, out = x): typeof out {
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = c;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b0 * xi + z1;
    z1 = b1 * xi - a1 * y + z2;
    z2 = b2 * xi - a2 * y;
    out[i] = y;
  }
  return out;
}

export function applyChain(specs: FilterSpec[], x: Float32Array, fs: number): Float32Array {
  const out = new Float32Array(x);
  for (const s of specs) applyBiquad(designBiquad(s, fs), out);
  return out;
}

/** Magnitude response in dB of a coefficient set at frequency f. */
export function magnitudeDb(c: BiquadCoeffs, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  const cr1 = Math.cos(w), ci1 = -Math.sin(w);
  const cr2 = Math.cos(2 * w), ci2 = -Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cr1 + c.b2 * cr2;
  const ni = c.b1 * ci1 + c.b2 * ci2;
  const dr = 1 + c.a1 * cr1 + c.a2 * cr2;
  const di = c.a1 * ci1 + c.a2 * ci2;
  const mag2 = (nr * nr + ni * ni) / (dr * dr + di * di);
  return 10 * Math.log10(Math.max(mag2, 1e-20));
}

export function chainResponseDb(specs: FilterSpec[], f: number, fs: number): number {
  let db = 0;
  for (const s of specs) db += magnitudeDb(designBiquad(s, fs), f, fs);
  return db;
}
