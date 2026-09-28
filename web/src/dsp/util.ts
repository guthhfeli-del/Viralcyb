export const EPS = 1e-12;

export const db = (x: number): number => 10 * Math.log10(Math.max(x, EPS));
export const ampDb = (x: number): number => 20 * Math.log10(Math.max(Math.abs(x), EPS));
export const fromDb = (d: number): number => Math.pow(10, d / 20);
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function mean(xs: ArrayLike<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

export function std(xs: ArrayLike<number>): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

export function percentile(xs: ArrayLike<number>, p: number): number {
  if (xs.length === 0) return NaN;
  const a = Array.from(xs).sort((x, y) => x - y);
  const idx = clamp((p / 100) * (a.length - 1), 0, a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lerp(a[lo], a[hi], idx - lo);
}

export function median(xs: ArrayLike<number>): number {
  return percentile(xs, 50);
}

/** Symmetric moving average (window w, odd preferred). */
export function smooth(xs: ArrayLike<number>, w: number): Float64Array {
  const n = xs.length;
  const out = new Float64Array(n);
  const h = Math.max(0, Math.floor(w / 2));
  let acc = 0;
  let count = 0;
  // running window [i-h, i+h]
  for (let i = 0; i < Math.min(h, n); i++) { acc += xs[i]; count++; }
  for (let i = 0; i < n; i++) {
    const add = i + h;
    if (add < n) { acc += xs[add]; count++; }
    const rem = i - h - 1;
    if (rem >= 0) { acc -= xs[rem]; count--; }
    out[i] = acc / count;
  }
  return out;
}

/** Downmix channels to mono (average). */
export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  const g = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] * g;
  return out;
}

/** Normalise a vector to unit L2 norm (in place). */
export function l2normalize(v: Float64Array): Float64Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s);
  if (n > EPS) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / (Math.sqrt(aa * bb) + EPS);
}

export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ma = mean(a), mb = mean(b);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma, db_ = b[i] - mb;
    ab += da * db_;
    aa += da * da;
    bb += db_ * db_;
  }
  return ab / (Math.sqrt(aa * bb) + EPS);
}

/** Simple local-maximum peak picking with minimum distance. */
export function pickPeaks(xs: ArrayLike<number>, minDistance: number, threshold = -Infinity): number[] {
  const cands: number[] = [];
  for (let i = 1; i < xs.length - 1; i++) {
    if (xs[i] > threshold && xs[i] >= xs[i - 1] && xs[i] > xs[i + 1]) cands.push(i);
  }
  cands.sort((a, b) => xs[b] - xs[a]);
  const taken: number[] = [];
  for (const c of cands) {
    if (taken.every((t) => Math.abs(t - c) >= minDistance)) taken.push(c);
  }
  return taken.sort((a, b) => a - b);
}

/** Fixed-point number for display; "—" for ±Infinity/NaN (e.g. loudness of silence). */
export const fmt = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : "—");

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "–";
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_NAMES_FR = ["Do", "Do#", "Ré", "Ré#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];

export const hzToMidi = (f: number): number => 69 + 12 * Math.log2(f / 440);
export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export function midiName(m: number): string {
  const r = Math.round(m);
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}
