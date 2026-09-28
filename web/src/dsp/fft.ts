/**
 * Iterative radix-2 complex FFT with cached twiddles and bit-reversal table.
 * Forward transform uses the e^{-i2πkn/N} convention (no normalisation).
 */
export class FFT {
  readonly n: number;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.n = n;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** In-place forward FFT. */
  transform(re: Float64Array, im: Float64Array): void {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tre = re[b] * cos[k] + im[b] * sin[k];
          const tim = im[b] * cos[k] - re[b] * sin[k];
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
  }

  /** In-place inverse FFT (normalised by 1/N). */
  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.transform(re, im);
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] = -im[i] / n;
    }
  }
}

const fftCache = new Map<number, FFT>();
export function getFFT(n: number): FFT {
  let f = fftCache.get(n);
  if (!f) {
    f = new FFT(n);
    fftCache.set(n, f);
  }
  return f;
}

const windowCache = new Map<string, Float64Array>();
export function hann(n: number): Float64Array {
  const key = `hann:${n}`;
  let w = windowCache.get(key);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    windowCache.set(key, w);
  }
  return w;
}

/**
 * Reusable real-signal power spectrum helper. Returns |X[k]|² for k = 0..N/2
 * of a windowed frame, written into `out`.
 */
export class Spectrum {
  readonly n: number;
  readonly bins: number;
  private readonly fft: FFT;
  private readonly win: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  /** Energy normalisation so that power values are comparable across sizes. */
  readonly norm: number;

  constructor(n: number) {
    this.n = n;
    this.bins = n / 2 + 1;
    this.fft = getFFT(n);
    this.win = hann(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) s += this.win[i] * this.win[i];
    this.norm = 1 / (s * n);
  }

  power(frame: ArrayLike<number>, offset: number, out: Float64Array): void {
    const { n, re, im, win } = this;
    const len = frame.length;
    for (let i = 0; i < n; i++) {
      const idx = offset + i;
      re[i] = idx < len && idx >= 0 ? frame[idx] * win[i] : 0;
      im[i] = 0;
    }
    this.fft.transform(re, im);
    const norm = this.norm;
    for (let k = 0; k < this.bins; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) * norm;
  }
}
