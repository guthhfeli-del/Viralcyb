/**
 * Client-side AI-generation *indicators* (heuristic, not a verdict).
 *
 * Neural audio decoders that upsample with transposed convolutions tend to
 * leave small spectral peaks at fixed frequencies — fixed by the architecture,
 * not by the music. Musical harmonics move with the notes; decoder artefacts
 * don't. We therefore measure how *stationary* the fine high-frequency peak
 * pattern is across different parts of the song, alongside codec bandwidth
 * and transient smearing. A trained model (SONICS, server side) should be
 * preferred for any real decision.
 */
import { Spectrum } from "./fft";
import { clamp, db, mean, pearson, EPS } from "./util";

export interface AiCue {
  id: "stationary-peaks" | "bandwidth" | "transient-smear";
  label: string;
  value: number; // raw measure
  score: number; // 0..1 contribution (1 = AI-like)
  note: string;
}

export interface AiReport {
  probability: number; // 0..1, heuristic
  level: "faible" | "modéré" | "élevé";
  cues: AiCue[];
  method: "heuristic";
}

const N = 16384;

function residualProfile(x: Float32Array, fs: number, start: number, len: number, lo: number, hi: number): Float64Array | null {
  const spec = new Spectrum(N);
  const acc = new Float64Array(spec.bins);
  const tmp = new Float64Array(spec.bins);
  let frames = 0;
  for (let off = start; off + N <= Math.min(x.length, start + len); off += N / 2) {
    spec.power(x, off, tmp);
    for (let k = 0; k < spec.bins; k++) acc[k] += tmp[k];
    frames++;
  }
  if (!frames) return null;
  const binHz = fs / N;
  const k0 = Math.floor(lo / binHz), k1 = Math.min(spec.bins - 1, Math.floor(hi / binHz));
  const dB = new Float64Array(k1 - k0 + 1);
  for (let k = k0; k <= k1; k++) dB[k - k0] = db(acc[k] / frames);
  // subtract a smooth baseline (± ~120 Hz) to keep only narrow peaks
  const w = Math.max(8, Math.round(120 / binHz));
  const res = new Float64Array(dB.length);
  let s = 0, c = 0;
  for (let i = 0; i < Math.min(w, dB.length); i++) { s += dB[i]; c++; }
  for (let i = 0; i < dB.length; i++) {
    if (i + w < dB.length) { s += dB[i + w]; c++; }
    if (i - w - 1 >= 0) { s -= dB[i - w - 1]; c--; }
    res[i] = Math.max(0, dB[i] - s / c);
  }
  return res;
}

export function detectAiIndicators(mono: Float32Array, fs: number, bandwidthHz: number, onsetHigh?: Float32Array): AiReport {
  const cues: AiCue[] = [];
  const hi = Math.min(16000, fs / 2 - 500);
  const lo = 5000;

  // 1) stationarity of fine peaks across chunks
  const chunkLen = Math.round(8 * fs);
  const chunks = Math.min(6, Math.floor(mono.length / chunkLen));
  const profiles: Float64Array[] = [];
  for (let c = 0; c < chunks; c++) {
    const start = Math.round(((c + 0.5) / chunks) * mono.length - chunkLen / 2);
    const p = residualProfile(mono, fs, Math.max(0, start), chunkLen, lo, hi);
    if (p && mean(p) > 0.05) profiles.push(p);
  }
  let stationarity = 0;
  if (profiles.length >= 2) {
    const rs: number[] = [];
    for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) rs.push(pearson(profiles[i], profiles[j]));
    stationarity = mean(rs);
  }
  const sScore = clamp((stationarity - 0.25) / 0.45, 0, 1);
  cues.push({
    id: "stationary-peaks",
    label: "Pics spectraux fixes (5–16 kHz)",
    value: stationarity,
    score: sScore,
    note:
      sScore > 0.6
        ? "Motif de pics identique d'une section à l'autre, typique des décodeurs neuronaux (ou d'un bruit/sifflement constant)."
        : "Le motif fin des aigus évolue avec la musique : comportement naturel.",
  });

  // 2) codec bandwidth
  // content reaching Nyquist says nothing about a codec low-pass
  const nyquistLimited = bandwidthHz >= 0.93 * (fs / 2);
  const bwScore = bandwidthHz <= 0 || nyquistLimited ? 0 : bandwidthHz < 15000 ? 0.7 : bandwidthHz < 16800 ? 0.45 : bandwidthHz < 18500 ? 0.15 : 0;
  cues.push({
    id: "bandwidth",
    label: "Bande passante effective",
    value: bandwidthHz,
    score: bwScore,
    note:
      bwScore >= 0.45
        ? `Coupure nette vers ${(bandwidthHz / 1000).toFixed(1)} kHz : codec compressé (MP3/stream) ou génération IA.`
        : "Aigus étendus, cohérent avec un export studio.",
  });

  // 3) transient smear — peakiness of high-band onsets
  if (onsetHigh && onsetHigh.length > 100) {
    const m = mean(onsetHigh);
    let m2 = 0, m4 = 0;
    for (let i = 0; i < onsetHigh.length; i++) {
      const d = onsetHigh[i] - m;
      m2 += d * d;
      m4 += d * d * d * d;
    }
    m2 /= onsetHigh.length;
    m4 /= onsetHigh.length;
    const kurt = m4 / (m2 * m2 + EPS);
    const smear = clamp((8 - kurt) / 6, 0, 1);
    cues.push({
      id: "transient-smear",
      label: "Netteté des transitoires",
      value: kurt,
      score: smear,
      note: smear > 0.6 ? "Attaques adoucies/étalées (hi-hats et snares peu définis)." : "Attaques nettes et définies.",
    });
  }

  const z = -2.2 + 3.2 * sScore + 1.1 * bwScore + 0.9 * (cues[2]?.score ?? 0);
  const probability = 1 / (1 + Math.exp(-z));
  const level = probability > 0.66 ? "élevé" : probability > 0.4 ? "modéré" : "faible";
  return { probability, level, cues, method: "heuristic" };
}

/** High-band (> 5 kHz) onset envelope over a contiguous ≤ 60 s span. */
export function highBandOnsets(mono: Float32Array, fs: number): Float32Array {
  const n = 1024;
  const hop = 512;
  const spec = new Spectrum(n);
  const p = new Float64Array(spec.bins);
  const k0 = Math.floor(5000 / (fs / n));
  const span = Math.min(mono.length, Math.round(60 * fs));
  const start = Math.max(0, Math.floor((mono.length - span) / 2));
  const count = Math.max(0, Math.floor((span - n) / hop));
  const out = new Float32Array(count);
  let prev = 0;
  for (let f = 0; f < count; f++) {
    spec.power(mono, start + f * hop, p);
    let e = 0;
    for (let k = k0; k < spec.bins; k++) e += p[k];
    const v = Math.log1p(1e5 * e);
    out[f] = f === 0 ? 0 : Math.max(0, v - prev);
    prev = v;
  }
  return out;
}
