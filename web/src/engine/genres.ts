/**
 * Genre profiles: tempo sweet spots, competitive loudness, target spectrum
 * family and structural conventions. Values summarise common industry
 * practice (see docs/RESEARCH.md) — they are guides, not rules.
 */
import type { Features } from "./types";

export type GenreId = "rap" | "drill" | "pop" | "afro" | "latin" | "rnb" | "edm" | "rock";

export interface GenreProfile {
  id: GenreId;
  label: string;
  family: "hiphop" | "pop" | "edm" | "rnb" | "rock";
  bpmWindows: [number, number][];
  lufs: { min: number; max: number; ideal: number };
  verseBars: number;
  chorusBars: number;
  durationIdeal: [number, number]; // seconds
  vocalCritical: boolean;
}

export const GENRES: GenreProfile[] = [
  { id: "rap", label: "Rap / Trap", family: "hiphop", bpmWindows: [[130, 165], [65, 82], [85, 100]], lufs: { min: -10, max: -6.5, ideal: -8 }, verseBars: 16, chorusBars: 8, durationIdeal: [120, 200], vocalCritical: true },
  { id: "drill", label: "Drill", family: "hiphop", bpmWindows: [[138, 148], [69, 74]], lufs: { min: -9.5, max: -6.5, ideal: -8 }, verseBars: 16, chorusBars: 8, durationIdeal: [120, 190], vocalCritical: true },
  { id: "pop", label: "Pop", family: "pop", bpmWindows: [[95, 130]], lufs: { min: -11, max: -7.5, ideal: -9 }, verseBars: 8, chorusBars: 8, durationIdeal: [140, 210], vocalCritical: true },
  { id: "afro", label: "Afro / Amapiano", family: "pop", bpmWindows: [[98, 120]], lufs: { min: -10.5, max: -7.5, ideal: -9 }, verseBars: 8, chorusBars: 8, durationIdeal: [140, 220], vocalCritical: true },
  { id: "latin", label: "Reggaeton / Dancehall", family: "hiphop", bpmWindows: [[88, 102]], lufs: { min: -9.5, max: -6.5, ideal: -8 }, verseBars: 8, chorusBars: 8, durationIdeal: [150, 220], vocalCritical: true },
  { id: "rnb", label: "R&B", family: "rnb", bpmWindows: [[60, 100]], lufs: { min: -12, max: -8, ideal: -10 }, verseBars: 8, chorusBars: 8, durationIdeal: [150, 230], vocalCritical: true },
  { id: "edm", label: "House / EDM", family: "edm", bpmWindows: [[118, 132], [140, 150], [170, 176]], lufs: { min: -9, max: -5.5, ideal: -7.5 }, verseBars: 16, chorusBars: 16, durationIdeal: [150, 240], vocalCritical: false },
  { id: "rock", label: "Rock / Indé", family: "rock", bpmWindows: [[100, 170]], lufs: { min: -11, max: -7.5, ideal: -9 }, verseBars: 8, chorusBars: 8, durationIdeal: [150, 240], vocalCritical: true },
];

export const genreById = (id: GenreId): GenreProfile => GENRES.find((g) => g.id === id) ?? GENRES[2];

/** Distance (in log-tempo octaves) from the closest sweet-spot window; 0 = inside. */
export function tempoFit(bpm: number, g: GenreProfile): number {
  let best = Infinity;
  for (const [lo, hi] of g.bpmWindows) {
    if (bpm >= lo && bpm <= hi) return 0;
    best = Math.min(best, Math.abs(Math.log2(bpm / (bpm < lo ? lo : hi))));
  }
  return best;
}

/** Best guess of the genre family from tempo, low end and pulse. */
export function guessGenre(f: Features): GenreId {
  const bpm = f.rhythm.bpm;
  const sub = f.spectrum.shares[0] + f.spectrum.shares[1];
  const scores: Record<GenreId, number> = { rap: 0, drill: 0, pop: 0, afro: 0, latin: 0, rnb: 0, edm: 0, rock: 0 };
  for (const g of GENRES) scores[g.id] = -tempoFit(bpm, g) * 4;
  if (sub > 55) {
    scores.rap += 1.2;
    scores.drill += 0.8;
    scores.latin += 0.4;
    scores.edm += 0.3;
  } else {
    scores.pop += 0.5;
    scores.rock += 0.4;
  }
  if (f.rhythm.pulseClarity > 0.35 && bpm >= 118 && bpm <= 132) scores.edm += 0.8;
  if (f.spectrum.tiltDbPerOct > -3.2) scores.rock += 0.3;
  if (f.vocal.contrast < 0.03) scores.edm += 0.5;
  scores.drill -= 0.3; // narrow window: only choose when clearly inside
  return (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as GenreId) ?? "pop";
}
