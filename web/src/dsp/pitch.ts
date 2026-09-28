/**
 * YIN monophonic pitch detector (de Cheveigné & Kawahara, 2002), tuned for
 * the singing voice (70–1100 Hz). Cheap enough to run every animation frame
 * on a phone.
 */
export interface PitchFrame {
  freq: number; // Hz, 0 when unvoiced
  clarity: number; // 0..1
  rms: number;
}

export class Yin {
  private readonly d: Float32Array;
  private readonly cmnd: Float32Array;
  readonly tauMin: number;
  readonly tauMax: number;

  constructor(
    readonly fs: number,
    readonly minFreq = 70,
    readonly maxFreq = 1100,
    readonly threshold = 0.12,
  ) {
    this.tauMin = Math.max(2, Math.floor(fs / maxFreq));
    this.tauMax = Math.ceil(fs / minFreq);
    this.d = new Float32Array(this.tauMax + 2);
    this.cmnd = new Float32Array(this.tauMax + 2);
  }

  detect(buf: Float32Array): PitchFrame {
    const W = buf.length - this.tauMax - 1;
    let e = 0;
    for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / buf.length);
    if (W < 32 || rms < 0.004) return { freq: 0, clarity: 0, rms };
    const { d, cmnd, tauMax, tauMin } = this;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const diff = buf[j] - buf[j + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cmnd[t] < this.threshold) {
        while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      // no dip under threshold: take the global minimum but mark as weak
      let best = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
      if (cmnd[best] > 0.35) return { freq: 0, clarity: 1 - cmnd[best], rms };
      tau = best;
    }
    // parabolic interpolation
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
      const den = a - 2 * b + c;
      if (den > 0) better = tau + (a - c) / (2 * den);
    }
    return { freq: this.fs / better, clarity: Math.max(0, 1 - cmnd[tau]), rms };
  }
}

/** Decimate by an integer factor with a simple windowed-sinc low-pass. */
export function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const taps = 8 * factor + 1;
  const h = new Float32Array(taps);
  const c = (taps - 1) / 2;
  let s = 0;
  for (let i = 0; i < taps; i++) {
    const t = (i - c) / factor;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    s += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= s;
  const n = Math.floor(x.length / factor);
  const out = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    const center = o * factor;
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const idx = center + k - c;
      if (idx >= 0 && idx < x.length) acc += h[k] * x[idx];
    }
    out[o] = acc;
  }
  return out;
}

/** Offline pitch track of a mono buffer (e.g. an uploaded topline). */
export function pitchTrack(x: Float32Array, fs: number, hopSec = 0.01): { times: number[]; freqs: number[]; clarity: number[]; rms: number[] } {
  const factor = Math.max(1, Math.floor(fs / 16000));
  const y = decimate(x, factor);
  const sr = fs / factor;
  const yin = new Yin(sr);
  const win = Math.round(0.04 * sr) + yin.tauMax;
  const hop = Math.max(1, Math.round(hopSec * sr));
  const times: number[] = [], freqs: number[] = [], clarity: number[] = [], rms: number[] = [];
  for (let o = 0; o + win <= y.length; o += hop) {
    const r = yin.detect(y.subarray(o, o + win));
    times.push((o + win / 2) / sr);
    freqs.push(r.freq);
    clarity.push(r.clarity);
    rms.push(r.rms);
  }
  return { times, freqs, clarity, rms };
}
