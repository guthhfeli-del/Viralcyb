/**
 * Playback-device simulations. Each profile is both a Web Audio graph recipe
 * (real-time listening) and a frequency response used to predict how the mix
 * translates (offline, from the long-term spectrum).
 */
import type { FilterSpec } from "../dsp/biquad";
import { chainResponseDb } from "../dsp/biquad";
import { THIRD_OCTAVES, targetCurve } from "../dsp/tonal";
import type { Features } from "./types";

export type DeviceId = "studio" | "phone" | "earbuds" | "laptop" | "car" | "bluetooth" | "club" | "radio" | "mono";

export interface DeviceProfile {
  id: DeviceId;
  label: string;
  short: string;
  description: string;
  filters: FilterSpec[];
  mono: boolean;
  drive: number; // 0..1 small-speaker saturation
  compressor: { threshold: number; ratio: number; attack: number; release: number; knee: number } | null;
  noise: { kind: "road" | "crowd" | "hiss"; level: number } | null; // level in dBFS
  reverb: { seconds: number; wet: number } | null;
  gainDb: number;
}

export const DEVICES: DeviceProfile[] = [
  { id: "studio", label: "Studio", short: "Réf.", description: "Écoute neutre, sans coloration.", filters: [], mono: false, drive: 0, compressor: null, noise: null, reverb: null, gainDb: 0 },
  {
    id: "phone", label: "Téléphone", short: "HP tél.", description: "Haut-parleur de smartphone : mono, rien sous ~300 Hz, résonance vers 2–3 kHz. Là où se vivent TikTok et Reels.",
    filters: [
      { type: "highpass", freq: 320, q: 0.9 }, { type: "highpass", freq: 280, q: 0.7 },
      { type: "peaking", freq: 2600, q: 1.2, gain: 5 }, { type: "peaking", freq: 900, q: 1, gain: 1.5 },
      { type: "lowpass", freq: 9500, q: 0.7 },
    ],
    mono: true, drive: 0.35, compressor: { threshold: -22, ratio: 6, attack: 0.003, release: 0.12, knee: 6 }, noise: null, reverb: null, gainDb: -2,
  },
  {
    id: "earbuds", label: "Écouteurs", short: "In-ear", description: "Écouteurs intra (type AirPods) : basses présentes, bosse 3 kHz, aigus un peu retenus.",
    filters: [{ type: "lowshelf", freq: 100, q: 0.7, gain: 3 }, { type: "peaking", freq: 3000, q: 1.4, gain: 2.5 }, { type: "highshelf", freq: 9000, q: 0.7, gain: -2.5 }],
    mono: false, drive: 0, compressor: null, noise: null, reverb: null, gainDb: -2,
  },
  {
    id: "laptop", label: "Laptop", short: "PC", description: "Haut-parleurs d'ordinateur portable : pas de grave, médiums projetés.",
    filters: [
      { type: "highpass", freq: 220, q: 0.8 }, { type: "highpass", freq: 180, q: 0.7 },
      { type: "peaking", freq: 1300, q: 1, gain: 3 }, { type: "lowpass", freq: 13000, q: 0.7 },
    ],
    mono: false, drive: 0.15, compressor: { threshold: -20, ratio: 4, attack: 0.005, release: 0.15, knee: 6 }, noise: null, reverb: null, gainDb: -2,
  },
  {
    id: "car", label: "Voiture", short: "Auto", description: "Habitacle : gain de cabine dans le grave, bruit de roulement qui masque les détails faibles.",
    filters: [{ type: "lowshelf", freq: 70, q: 0.7, gain: 6 }, { type: "peaking", freq: 250, q: 1.2, gain: -2.5 }, { type: "highshelf", freq: 8000, q: 0.7, gain: -2 }],
    mono: false, drive: 0, compressor: null, noise: { kind: "road", level: -30 }, reverb: { seconds: 0.35, wet: 0.08 }, gainDb: -4,
  },
  {
    id: "bluetooth", label: "Enceinte BT", short: "BT", description: "Petite enceinte Bluetooth : mono, bosse d'évent vers 110 Hz, limiteur DSP.",
    filters: [
      { type: "highpass", freq: 85, q: 0.9 }, { type: "peaking", freq: 115, q: 1.4, gain: 4 },
      { type: "peaking", freq: 450, q: 1, gain: -2 }, { type: "lowpass", freq: 14000, q: 0.7 },
    ],
    mono: true, drive: 0.2, compressor: { threshold: -16, ratio: 8, attack: 0.002, release: 0.1, knee: 4 }, noise: null, reverb: { seconds: 0.5, wet: 0.06 }, gainDb: -3,
  },
  {
    id: "club", label: "Club", short: "PA", description: "Système façade + subs : sub renforcé, salle réverbérante, foule.",
    filters: [{ type: "highpass", freq: 30, q: 0.7 }, { type: "lowshelf", freq: 55, q: 0.7, gain: 5 }, { type: "highshelf", freq: 10000, q: 0.7, gain: -3 }],
    mono: false, drive: 0.05, compressor: null, noise: { kind: "crowd", level: -34 }, reverb: { seconds: 1.8, wet: 0.16 }, gainDb: -4,
  },
  {
    id: "radio", label: "Radio FM", short: "FM", description: "Chaîne de diffusion FM : bande limitée à 15 kHz, compression multibande agressive.",
    filters: [{ type: "highpass", freq: 40, q: 0.7 }, { type: "lowpass", freq: 15000, q: 1.2 }, { type: "lowpass", freq: 15000, q: 0.7 }, { type: "highshelf", freq: 6000, q: 0.7, gain: 2.5 }],
    mono: false, drive: 0.1, compressor: { threshold: -28, ratio: 10, attack: 0.002, release: 0.2, knee: 8 }, noise: { kind: "hiss", level: -52 }, reverb: null, gainDb: 0,
  },
  { id: "mono", label: "Mono", short: "Mono", description: "Somme mono : révèle les problèmes de phase et les éléments qui disparaissent.", filters: [], mono: true, drive: 0, compressor: null, noise: null, reverb: null, gainDb: 0 },
];

export interface DeviceReport {
  id: DeviceId;
  score: number; // 0..100
  lowRetentionDb: number; // change of 40–250 Hz energy share
  notes: string[];
}

const band = (thirds: number[], lo: number, hi: number) => {
  let s = 0;
  THIRD_OCTAVES.forEach((f, i) => {
    if (f >= lo && f <= hi) s += Math.pow(10, thirds[i] / 10);
  });
  return 10 * Math.log10(s + 1e-12);
};

export function deviceReport(f: Features, d: DeviceProfile, family: string): DeviceReport {
  const fs = 48000;
  const resp = THIRD_OCTAVES.map((fr) => chainResponseDb(d.filters, fr, fs));
  const own = f.spectrum.thirdsRaw.map((v, i) => v + resp[i]);
  const target = THIRD_OCTAVES.map((fr, i) => targetCurve(family, fr) + resp[i]);
  // compare shapes in the band the device can actually reproduce
  const audible = THIRD_OCTAVES.map((_, i) => resp[i] > -12);
  const idx = THIRD_OCTAVES.map((_, i) => i).filter((i) => audible[i]);
  const diffs = idx.map((i) => own[i] - target[i]);
  const off = diffs.slice().sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  const rms = Math.sqrt(diffs.reduce((a, x) => a + (x - off) ** 2, 0) / Math.max(1, diffs.length));
  let score = 100 * Math.exp(-0.5 * (Math.max(0, rms - 2) / 4) ** 2);
  const notes: string[] = [];
  const totBefore = band(f.spectrum.thirdsRaw, 20, 20000);
  const totAfter = band(own, 20, 20000);
  const lowBefore = band(f.spectrum.thirdsRaw, 40, 250) - totBefore;
  const lowAfter = band(own, 40, 250) - totAfter;
  const lowRetentionDb = lowAfter - lowBefore;
  if (d.mono) {
    const loss = f.stereo.monoLossDb;
    if (loss < -1.5) {
      score -= Math.min(30, Math.abs(loss) * 6);
      notes.push(`Perte de ${Math.abs(loss).toFixed(1)} dB en mono : des éléments stéréo s'annulent.`);
    }
    if (f.stereo.lowCorrelation < 0.7) notes.push("Basses en opposition de phase partielle : elles s'affaiblissent en mono.");
  }
  if (d.id === "phone" || d.id === "laptop") {
    const harm = band(f.spectrum.thirdsRaw, 150, 500) - band(f.spectrum.thirdsRaw, 30, 120);
    if (harm < -12) {
      score -= 12;
      notes.push("La basse/808 n'a presque pas d'harmoniques : elle sera inaudible. Sature-la légèrement (150–500 Hz).");
    } else notes.push("Les harmoniques de la basse restent audibles.");
    const pres = band(own, 1500, 5000) - totAfter;
    if (pres > -3) notes.push("Médiums-aigus très présents : attention à l'agressivité à fort volume.");
  }
  if (d.id === "car" || d.id === "club") {
    const sub = band(f.spectrum.thirdsRaw, 25, 60) - totBefore;
    if (sub > -6) {
      score -= 10;
      notes.push("Sub déjà dense : le gain de cabine/les subs vont faire saturer le grave.");
    }
    if (f.loudness.lra > 10) notes.push("Les passages calmes seront couverts par le bruit ambiant.");
  }
  if (d.id === "radio" && f.loudness.plr < 7) notes.push("Master déjà très compressé : le traitement radio va l'aplatir encore.");
  if (d.id === "studio") return { id: d.id, score: 100, lowRetentionDb: 0, notes: ["Référence neutre : compare chaque support à cette écoute, en passant de l'un à l'autre pendant la lecture."] };
  if (!notes.length) notes.push(rms < 3 ? "Équilibre bien conservé sur ce support." : "Équilibre tonal modifié : écoute les éléments clés (voix, kick, basse).");
  return { id: d.id, score: Math.round(Math.max(0, Math.min(100, score))), lowRetentionDb, notes };
}

export function deviceResponseCurve(d: DeviceProfile, points = 64): { f: number; db: number }[] {
  const out: { f: number; db: number }[] = [];
  for (let i = 0; i < points; i++) {
    const fr = 20 * Math.pow(1000, i / (points - 1));
    out.push({ f: fr, db: chainResponseDb(d.filters, fr, 48000) });
  }
  return out;
}
