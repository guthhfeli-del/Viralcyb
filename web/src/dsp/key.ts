/**
 * Key estimation: correlation of an energy-weighted chroma profile with the
 * Krumhansl–Kessler and Temperley major/minor key profiles (24 rotations).
 */
import { NOTE_NAMES, NOTE_NAMES_FR, pearson } from "./util";

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// Temperley (1999) profiles — stronger 4th/leading-tone contrast, less dominant bias.
const T_MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0];
const T_MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0];

// Camelot wheel: index by pitch class
const CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

export interface KeyResult {
  tonic: number; // pitch class 0..11
  mode: "major" | "minor";
  name: string; // e.g. "A minor"
  nameFr: string; // e.g. "La mineur"
  short: string; // e.g. "Am"
  camelot: string;
  confidence: number; // 0..1
  chroma: number[]; // 12, max-normalised
  scores: { key: string; r: number }[];
}

function rotate(profile: number[], k: number): number[] {
  return profile.map((_, i) => profile[(i - k + 12) % 12]);
}

export function keyName(tonic: number, mode: "major" | "minor") {
  const n = NOTE_NAMES[tonic];
  return {
    name: `${n} ${mode}`,
    nameFr: `${NOTE_NAMES_FR[tonic]} ${mode === "major" ? "majeur" : "mineur"}`,
    short: mode === "major" ? n : `${n}m`,
    camelot: mode === "major" ? CAMELOT_MAJOR[tonic] : CAMELOT_MINOR[tonic],
  };
}

export function estimateKeyFromChroma(chroma: ArrayLike<number>): KeyResult {
  const c = Array.from(chroma);
  const scores: { key: string; tonic: number; mode: "major" | "minor"; r: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const rMaj = 0.5 * pearson(c, rotate(KK_MAJOR, k)) + 0.5 * pearson(c, rotate(T_MAJOR, k));
    const rMin = 0.5 * pearson(c, rotate(KK_MINOR, k)) + 0.5 * pearson(c, rotate(T_MINOR, k));
    scores.push({ key: `${NOTE_NAMES[k]}`, tonic: k, mode: "major", r: rMaj });
    scores.push({ key: `${NOTE_NAMES[k]}m`, tonic: k, mode: "minor", r: rMin });
  }
  scores.sort((a, b) => b.r - a.r);
  const best = scores[0];
  const second = scores[1];
  const mx = Math.max(...c, 1e-9);
  const confidence = Math.max(0, Math.min(1, (best.r - second.r) * 4 + Math.max(0, best.r - 0.5)));
  return {
    tonic: best.tonic,
    mode: best.mode,
    ...keyName(best.tonic, best.mode),
    confidence,
    chroma: c.map((v) => v / mx),
    scores: scores.slice(0, 5).map((s) => ({ key: s.key, r: s.r })),
  };
}

/** Aggregate frame chroma (count × 12) weighted by frame energy. */
export function aggregateChroma(chroma: Float32Array, rmsDb: Float32Array, count: number): Float64Array {
  const out = new Float64Array(12);
  let maxDb = -Infinity;
  for (let f = 0; f < count; f++) maxDb = Math.max(maxDb, rmsDb[f]);
  for (let f = 0; f < count; f++) {
    if (rmsDb[f] < maxDb - 30) continue; // skip near-silence
    const w = Math.pow(10, (rmsDb[f] - maxDb) / 20);
    for (let c = 0; c < 12; c++) out[c] += chroma[f * 12 + c] * w;
  }
  return out;
}

/** Scale degrees (semitones from tonic) for the mode. */
export function scaleOf(mode: "major" | "minor"): number[] {
  return mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
}
