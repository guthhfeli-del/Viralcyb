export function sine(freq: number, amp: number, seconds: number, fs: number, phase = 0): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / fs + phase);
  return out;
}

/** Deterministic PRNG (mulberry32) so tests are reproducible. */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noise(seconds: number, fs: number, amp = 0.1, seed = 7): Float32Array {
  const r = rng(seed);
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * (r() * 2 - 1);
  return out;
}

/** Harmonic tone (sawtooth-like with decaying partials) — closer to real instruments than a sine. */
export function tone(freq: number, amp: number, seconds: number, fs: number, partials = 6): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  for (let h = 1; h <= partials; h++) {
    const f = freq * h;
    if (f > fs / 2) break;
    const a = amp / h;
    for (let i = 0; i < n; i++) out[i] += a * Math.sin((2 * Math.PI * f * i) / fs);
  }
  // short fade in/out to avoid clicks
  const fade = Math.min(n / 4, Math.round(fs * 0.01));
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[n - 1 - i] *= i / fade;
  }
  return out;
}

export function concat(parts: Float32Array[]): Float32Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < a.length; i++) out[i] += a[i];
  for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
}

/** Kick-like click track: decaying 60 Hz burst at each beat. */
export function clickTrack(bpm: number, seconds: number, fs: number, amp = 0.8): Float32Array {
  const n = Math.round(seconds * fs);
  const out = new Float32Array(n);
  const period = (60 / bpm) * fs;
  const len = Math.round(0.12 * fs);
  for (let b = 0; b * period < n; b++) {
    const start = Math.round(b * period);
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.exp(-i / (0.03 * fs));
      out[start + i] += amp * env * (Math.sin((2 * Math.PI * 60 * i) / fs) + 0.5 * Math.sin((2 * Math.PI * 2400 * i) / fs) * Math.exp(-i / (0.004 * fs)));
    }
  }
  return out;
}
