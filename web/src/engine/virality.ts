/**
 * Virality score — a transparent, weighted model built on measurable
 * properties that the research associates with short-form and streaming
 * success (hook timing, repetition, groove, loudness, vocal clarity,
 * translation on small speakers, format). It is a production-readiness
 * signal, not a prediction of streams: distribution, timing and audience
 * matter at least as much.
 */
import type { Features } from "./types";
import { genreById, tempoFit, type GenreId } from "./genres";
import { clamp, formatTime } from "../dsp/util";
import { tonalBalance } from "../dsp/tonal";

export interface Criterion {
  id: "hook-timing" | "hook-strength" | "memorability" | "groove" | "energy" | "loudness" | "vocal" | "translation" | "format";
  label: string;
  weight: number;
  score: number; // 0..100
  value: string; // measured value, human readable
  detail: string;
  tip: string;
}

export interface ViralityResult {
  score: number;
  grade: string;
  summary: string;
  criteria: Criterion[];
  levers: Criterion[]; // biggest weighted gaps first
}

const bell = (x: number, lo: number, hi: number, soft: number) =>
  x >= lo && x <= hi ? 1 : Math.exp(-0.5 * ((x < lo ? lo - x : x - hi) / soft) ** 2);

export function hookTime(f: Features): number {
  const s = f.structure;
  const cands = [s.firstHookTime, s.firstFullEnergyTime];
  if (Number.isFinite(s.firstVocalTime)) cands.push(s.firstVocalTime);
  return Math.min(...cands.filter((v) => Number.isFinite(v)));
}

export function scoreVirality(f: Features, genreId: GenreId): ViralityResult {
  const g = genreById(genreId);
  const s = f.structure;
  const L = f.loudness;
  const crit: Criterion[] = [];

  // 1. Immediate attention (first seconds)
  const t = hookTime(f);
  const hookT = s.firstHookTime;
  const tScore = t <= 3 ? 100 : t <= 5 ? 92 : t <= 10 ? 92 - (t - 5) * 6 : t <= 20 ? 62 - (t - 10) * 3 : Math.max(8, 32 - (t - 20) * 1.2);
  crit.push({
    id: "hook-timing",
    label: "Accroche immédiate",
    weight: 18,
    score: tScore,
    value: `${t.toFixed(1)} s`,
    detail: `Le morceau capte l'attention à ${formatTime(t)} (hook détecté à ${formatTime(hookT)}). Sur TikTok, tout se joue dans les 3 premières secondes ; dans le top 10, l'intro moyenne est passée d'environ 20 s à 5 s.`,
    tip: t > 5 ? `Démarre sur le hook (ou un extrait filtré du hook) : coupe ${Math.max(0, hookT - 2).toFixed(0)} s d'intro ou déplace le refrain en ouverture.` : "L'accroche est immédiate — garde ce départ.",
  });

  // 2. Hook strength: repetition of the hook, confidence, chorus lift
  const occ = s.hook.occurrences.length;
  const lift = s.chorusLift;
  const liftScore = Number.isFinite(lift) ? bell(lift, 1.5, 5, 1.5) : 0.6;
  const hsScore = 100 * (0.4 * Math.min(1, occ / 3) + 0.35 * s.hook.confidence + 0.25 * liftScore);
  crit.push({
    id: "hook-strength",
    label: "Force du hook",
    weight: 16,
    score: hsScore,
    value: `${occ}× · ${Number.isFinite(lift) ? `${lift >= 0 ? "+" : ""}${lift.toFixed(1)} LU` : "—"}`,
    detail: `Le hook revient ${occ} fois. ${Number.isFinite(lift) ? `Le refrain est ${lift >= 0 ? "plus fort" : "moins fort"} que le couplet de ${Math.abs(lift).toFixed(1)} LU (idéal : +1,5 à +5 LU).` : "Contraste couplet/refrain non mesurable."}`,
    tip: occ < 3 ? "Fais revenir le hook au moins 3 fois (et une fois dans les 30 premières secondes)." : Number.isFinite(lift) && lift < 1.5 ? "Donne de la hauteur au refrain : doubles voix, élargissement stéréo, +1 à 2 dB sur le bus, éléments en plus." : "Hook solide et bien répété.",
  });

  // 3. Memorability (repetition share)
  const rep = s.repetition;
  const memScore = 100 * bell(rep, 0.35, 0.8, 0.15);
  crit.push({
    id: "memorability",
    label: "Mémorabilité",
    weight: 10,
    score: memScore,
    value: `${Math.round(rep * 100)} % répété`,
    detail: "Part du morceau construite sur du matériau qui revient (motifs, refrains, boucles). La répétition fait mémoriser ; trop de répétition lasse.",
    tip: rep < 0.35 ? "Crée un motif signature (mélodie, gimmick vocal, ad-lib) et fais-le revenir." : rep > 0.8 ? "Casse la boucle : un pont, un break ou une variation de 4 mesures relancera l'écoute." : "Bon équilibre entre répétition et surprise.",
  });

  // 4. Groove & tempo
  const bpm = f.rhythm.bpm;
  const tf = Math.min(tempoFit(bpm, g), tempoFit(bpm * 2, g), tempoFit(bpm / 2, g));
  const tempoScore = Math.exp(-0.5 * (tf / 0.08) ** 2);
  const grooveScore = 100 * (0.6 * f.rhythm.danceability + 0.4 * tempoScore);
  const windows = g.bpmWindows.map(([a, b]) => `${a}–${b}`).join(" / ");
  crit.push({
    id: "groove",
    label: "Groove & tempo",
    weight: 12,
    score: grooveScore,
    value: `${Math.round(bpm)} BPM`,
    detail: `Dansabilité ${Math.round(f.rhythm.danceability * 100)} %, pulsation ${f.rhythm.pulseClarity > 0.3 ? "nette" : "diffuse"}. Fenêtres ${g.label} : ${windows} BPM. La majorité des sons viraux TikTok dépassent 100 BPM.`,
    tip: tempoScore < 0.5 ? `Tempo hors des fenêtres ${g.label} : teste une version à ${Math.round(nearestWindow(bpm, g))} BPM (ou une version sped-up).` : f.rhythm.danceability < 0.55 ? "Renforce la pulsation : kick/clap plus présents, groove plus régulier, moins de reverb sur les percussions." : "Groove efficace.",
  });

  // 5. Energy arc
  const energies = s.sections.map((x) => x.energy);
  const spread = energies.length > 1 ? Math.max(...energies) - Math.min(...energies) : 0;
  const energyScore = 100 * (0.7 * bell(spread, 0.3, 0.85, 0.15) + 0.3 * (s.drops.length > 0 ? 1 : 0.4));
  crit.push({
    id: "energy",
    label: "Arc d'énergie",
    weight: 8,
    score: energyScore,
    value: `${s.sections.length} sections · ${s.drops.length} drop${s.drops.length > 1 ? "s" : ""}`,
    detail: "Les morceaux qui retiennent l'écoute alternent tension et relâchement : sections contrastées, montées, drops, silences avant le refrain.",
    tip: spread < 0.3 ? "Le morceau est plat : retire des éléments dans le couplet, ajoute un break d'un temps avant le refrain, fais monter l'énergie." : s.drops.length === 0 ? "Ajoute un vrai moment de bascule (drop, mute d'un temps, filtre qui s'ouvre) avant le hook." : "Arc d'énergie bien construit.",
  });

  // 6. Loudness & punch
  const lufs = L.integrated;
  const lScore = bell(lufs, g.lufs.min, g.lufs.max, 2.2);
  const plrScore = bell(L.plr, 6, 12, 2);
  const clipPenalty = L.clippedSamples > 0 ? Math.min(0.5, L.clippedSamples / 2000) : 0;
  const tpPenalty = L.truePeak > 0 ? 0.25 : L.truePeak > -0.5 ? 0.1 : 0;
  const loudScore = 100 * clamp(0.6 * lScore + 0.4 * plrScore - clipPenalty - tpPenalty, 0, 1);
  crit.push({
    id: "loudness",
    label: "Loudness & punch",
    weight: 10,
    score: loudScore,
    value: `${lufs.toFixed(1)} LUFS · ${L.truePeak.toFixed(1)} dBTP`,
    detail: `Cible ${g.label} : ${g.lufs.min} à ${g.lufs.max} LUFS intégrés, true peak ≤ −1 dBTP. PLR ${L.plr.toFixed(1)} dB (punch préservé entre 6 et 12 dB). Les plateformes normalisent vers −14 LUFS : un master trop écrasé sonne plus petit après normalisation.`,
    tip: L.clippedSamples > 0 ? "Du clipping numérique est présent : baisse le gain avant le limiteur." : lufs < g.lufs.min ? `Monte le master vers ${g.lufs.ideal} LUFS (onglet Master).` : lufs > g.lufs.max ? "Master trop écrasé : relâche le limiteur pour retrouver du punch." : L.truePeak > -1 ? "Plafonne le limiteur à −1 dBTP pour éviter la distorsion à l'encodage (AAC/Ogg)." : "Niveau compétitif et propre.",
  });

  // 7. Vocal clarity
  const vocalKnown = f.vocal.contrast > 0.03;
  const presenceDev = bandDev(f, "highmid", g.family);
  const vScore = vocalKnown
    ? 100 * clamp(0.55 * clamp(f.vocal.chorus / 0.7, 0, 1) + 0.45 * bell(presenceDev, -1.5, 2.5, 2), 0, 1)
    : 100 * (0.5 + 0.5 * bell(presenceDev, -1.5, 2.5, 2)) * 0.9;
  crit.push({
    id: "vocal",
    label: "Clarté de la voix",
    weight: g.vocalCritical ? 10 : 5,
    score: vScore,
    value: vocalKnown ? `${Math.round(f.vocal.chorus * 100)} % présence` : "estimation",
    detail: `Estimation de la présence vocale (énergie centrée 300 Hz–3,4 kHz) et de la zone d'intelligibilité 2–4 kHz (${presenceDev >= 0 ? "+" : ""}${presenceDev.toFixed(1)} dB vs cible). Pour une mesure exacte, sépare les stems.`,
    tip: vScore < 60 ? "La voix est noyée : creuse 1,5–3 dB autour de 2–4 kHz sur l'instru (sidechain dynamique sur la voix), remonte la voix de 1–2 dB." : "La voix passe bien devant.",
  });

  // 8. Translation (phones, earbuds, car)
  const lowCorr = f.stereo.lowCorrelation;
  const midShare = f.spectrum.shares[2] + f.spectrum.shares[3] + f.spectrum.shares[4];
  const subShare = f.spectrum.shares[0];
  const phoneScore = clamp((midShare - 12) / 25, 0, 1);
  const trScore = 100 * clamp(0.45 * phoneScore + 0.3 * clamp((lowCorr - 0.5) / 0.45, 0, 1) + 0.25 * clamp(1 + f.stereo.monoLossDb / 3, 0, 1) - (subShare > 45 ? 0.15 : 0), 0, 1);
  crit.push({
    id: "translation",
    label: "Rendu multi-supports",
    weight: 10,
    score: trScore,
    value: `mono ${f.stereo.monoLossDb.toFixed(1)} dB`,
    detail: `Le short-form s'écoute surtout sur haut-parleur de téléphone et écouteurs. Énergie 250 Hz–4 kHz : ${midShare.toFixed(0)} % ; corrélation < 120 Hz : ${lowCorr.toFixed(2)} ; perte en mono : ${f.stereo.monoLossDb.toFixed(1)} dB. Teste dans l'onglet Supports.`,
    tip: lowCorr < 0.8 ? "Mets les basses en mono sous 120 Hz." : phoneScore < 0.5 ? "Sur téléphone la basse disparaît : ajoute des harmoniques (saturation) sur la 808/basse pour qu'elle s'entende entre 150 et 400 Hz." : "Bonne compatibilité téléphone/mono.",
  });

  // 9. Format
  const dur = f.meta.duration;
  const durScore = bell(dur, g.durationIdeal[0], g.durationIdeal[1], 30);
  const loop = s.clips.tiktok.loopScore;
  const fmtScore = 100 * (0.7 * durScore + 0.3 * loop);
  crit.push({
    id: "format",
    label: "Format & boucle",
    weight: 6,
    score: fmtScore,
    value: `${formatTime(dur)} · boucle ${Math.round(loop * 100)} %`,
    detail: `Durée idéale ${g.label} : ${formatTime(g.durationIdeal[0])}–${formatTime(g.durationIdeal[1])}. Le meilleur extrait de ${Math.round(s.clips.tiktok.end - s.clips.tiktok.start)} s (${formatTime(s.clips.tiktok.start)}–${formatTime(s.clips.tiktok.end)}) boucle à ${Math.round(loop * 100)} %.`,
    tip: durScore < 0.6 ? (dur > g.durationIdeal[1] ? "Raccourcis : un couplet ou une outro en moins." : "Un peu court : ajoute un refrain final ou un post-refrain.") : loop < 0.5 ? "Fais en sorte que la fin de l'extrait retombe naturellement sur son début (même accord, même énergie)." : "Format adapté au streaming et au short-form.",
  });

  const totalW = crit.reduce((a, c) => a + c.weight, 0);
  let score = crit.reduce((a, c) => a + c.weight * clamp(c.score, 0, 100), 0) / totalW;
  if (L.clippedSamples > 500) score = Math.min(score, 80);
  score = Math.round(score);
  const grade = score >= 88 ? "Potentiel viral fort" : score >= 75 ? "Prêt à sortir" : score >= 60 ? "Prometteur" : score >= 40 ? "À retravailler" : "Brouillon";
  const levers = crit
    .filter((c) => c.score < 85)
    .sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score))
    .slice(0, 3);
  const summary = levers.length
    ? `Leviers principaux : ${levers.map((l) => l.label.toLowerCase()).join(", ")}.`
    : "Tous les indicateurs sont au vert.";
  return { score, grade, summary, criteria: crit.map((c) => ({ ...c, score: Math.round(clamp(c.score, 0, 100)) })), levers };
}

function nearestWindow(bpm: number, g: ReturnType<typeof genreById>): number {
  let best = bpm, d = Infinity;
  for (const [lo, hi] of g.bpmWindows) {
    const c = bpm < lo ? lo : bpm > hi ? hi : bpm;
    const dist = Math.abs(Math.log2(c / bpm));
    if (dist < d) {
      d = dist;
      best = c;
    }
  }
  return best;
}

export function bandDev(f: Features, id: string, family: string): number {
  return tonalBalance(f.spectrum, family).bands.find((b) => b.id === id)?.deviation ?? 0;
}
