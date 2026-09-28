/**
 * Quick local "stem" split by spectral centre extraction (Avendano & Jot
 * panning-similarity mask). Centre-panned content (usually the lead vocal,
 * plus kick/snare/bass) is separated from side content. A fast offline
 * approximation — real stems come from Demucs/RoFormer on the server.
 */
import { getFFT, hann } from "./fft";

export interface CenterCutResult {
  center: Float32Array; // mono
  sides: [Float32Array, Float32Array];
}

export function centerCut(L: Float32Array, R: Float32Array, fs: number, opts: { sharpness?: number; lo?: number; hi?: number } = {}): CenterCutResult {
  const N = 2048;
  const hop = N / 4;
  const fft = getFFT(N);
  const win = hann(N);
  const p = opts.sharpness ?? 6;
  const lo = opts.lo ?? 150;
  const hi = opts.hi ?? 9000;
  const n = L.length;
  const center = new Float32Array(n);
  const norm = new Float32Array(n);
  const bins = N / 2 + 1;
  const bandW = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    const f = (k * fs) / N;
    const a = f < lo ? Math.pow(f / lo, 2) : 1;
    const b = f > hi ? Math.pow(hi / f, 2) : 1;
    bandW[k] = a * b;
  }
  const lr = new Float64Array(N), li = new Float64Array(N), rr = new Float64Array(N), ri = new Float64Array(N);
  const cr = new Float64Array(N), ci = new Float64Array(N);
  for (let off = -N + hop; off < n; off += hop) {
    for (let i = 0; i < N; i++) {
      const idx = off + i;
      const w = win[i];
      lr[i] = idx >= 0 && idx < n ? L[idx] * w : 0;
      rr[i] = idx >= 0 && idx < n ? R[idx] * w : 0;
      li[i] = 0;
      ri[i] = 0;
    }
    fft.transform(lr, li);
    fft.transform(rr, ri);
    for (let k = 0; k < bins; k++) {
      const el = lr[k] * lr[k] + li[k] * li[k];
      const er = rr[k] * rr[k] + ri[k] * ri[k];
      const cross = lr[k] * rr[k] + li[k] * ri[k]; // Re(L · conj(R))
      const psi = el + er > 1e-18 ? Math.max(0, (2 * cross) / (el + er)) : 0;
      const m = Math.pow(psi, p) * bandW[k];
      cr[k] = m * 0.5 * (lr[k] + rr[k]);
      ci[k] = m * 0.5 * (li[k] + ri[k]);
      if (k > 0 && k < N / 2) {
        cr[N - k] = cr[k];
        ci[N - k] = -ci[k];
      }
    }
    fft.inverse(cr, ci);
    for (let i = 0; i < N; i++) {
      const idx = off + i;
      if (idx < 0 || idx >= n) continue;
      center[idx] += cr[i] * win[i];
      norm[idx] += win[i] * win[i];
    }
  }
  for (let i = 0; i < n; i++) if (norm[i] > 1e-6) center[i] /= norm[i];
  const sl = new Float32Array(n), sr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sl[i] = L[i] - center[i];
    sr[i] = R[i] - center[i];
  }
  return { center, sides: [sl, sr] };
}
