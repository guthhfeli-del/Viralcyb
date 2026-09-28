/**
 * Actionable recommendations: mix & master moves with concrete numbers,
 * structure blueprints computed from the real tempo, and creative ideas
 * derived from what was measured.
 */
import type { Features } from "./types";
import { genreById, type GenreId } from "./genres";
import { tonalBalance } from "../dsp/tonal";
import { hookTime } from "./virality";
import { fmt, formatTime, midiToHz, NOTE_NAMES } from "../dsp/util";

export type Severity = "haute" | "moyenne" | "basse";

export interface Advice {
  id: string;
  area: "mix" | "master" | "stéréo" | "voix" | "structure";
  severity: Severity;
  title: string;
  detail: string;
  action: string;
}

export interface BlueprintPart {
  name: string;
  bars: number;
  start: number;
  end: number;
  note?: string;
}

export interface Blueprint {
  id: string;
  title: string;
  why: string;
  parts: BlueprintPart[];
  duration: number;
}

export interface Idea {
  tag: string;
  title: string;
  detail: string;
}

export interface AdviceBundle {
  mix: Advice[];
  blueprints: Blueprint[];
  ideas: Idea[];
}

const sevRank: Record<Severity, number> = { haute: 0, moyenne: 1, basse: 2 };

export function buildAdvice(f: Features, genreId: GenreId): AdviceBundle {
  const g = genreById(genreId);
  const tb = tonalBalance(f.spectrum, g.family);
  const band = (id: string) => tb.bands.find((b) => b.id === id)!;
  const thirdDev = (lo: number, hi: number) => {
    const pts = tb.thirds.filter((p) => p.f >= lo && p.f <= hi);
    const worst = pts.reduce((a, p) => (Math.abs(p.deviation) > Math.abs(a.deviation) ? p : a), pts[0]);
    return worst;
  };
  const L = f.loudness;
  const mix: Advice[] = [];
  const fmtHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);

  // --- tonal balance ---
  const mud = thirdDev(160, 500);
  if (mud && mud.deviation > 2.5)
    mix.push({
      id: "mud", area: "mix", severity: mud.deviation > 4.5 ? "haute" : "moyenne",
      title: "Bas-médiums chargés (effet « boueux »)",
      detail: `+${mud.deviation.toFixed(1)} dB autour de ${fmtHz(mud.f)} par rapport à la référence ${g.label}.`,
      action: `EQ en cloche −${Math.min(4, mud.deviation * 0.6).toFixed(1)} dB, Q 1,2 à ${fmtHz(mud.f)} sur le bus instru ou les pads/guitares ; passe-haut à 100–150 Hz sur tout ce qui n'est pas kick/basse.`,
    });
  const box = thirdDev(500, 1200);
  if (box && box.deviation > 2.5)
    mix.push({
      id: "boxy", area: "mix", severity: "moyenne",
      title: "Médiums « cartonneux »",
      detail: `+${box.deviation.toFixed(1)} dB vers ${fmtHz(box.f)}.`,
      action: `Creuse de ${Math.min(3, box.deviation * 0.5).toFixed(1)} dB à ${fmtHz(box.f)} (Q 1,5), surtout sur les voix et les snares.`,
    });
  const harsh = thirdDev(2000, 5000);
  if (harsh && harsh.deviation > 2.5)
    mix.push({
      id: "harsh", area: "mix", severity: harsh.deviation > 4 ? "haute" : "moyenne",
      title: "Haut-médiums agressifs",
      detail: `+${harsh.deviation.toFixed(1)} dB vers ${fmtHz(harsh.f)} : fatigue d'écoute sur écouteurs et téléphones.`,
      action: `EQ dynamique −2 à −3 dB à ${fmtHz(harsh.f)} (déclenché seulement sur les pics), ou de-harsher léger sur le bus.`,
    });
  const sib = thirdDev(5000, 10000);
  if (sib && sib.deviation > 3)
    mix.push({
      id: "sibilance", area: "voix", severity: "moyenne",
      title: "Sibilances / aigus durs",
      detail: `+${sib.deviation.toFixed(1)} dB vers ${fmtHz(sib.f)}.`,
      action: `De-esser sur la voix lead centré sur ${fmtHz(sib.f)} (−3 à −6 dB de réduction sur les « s »), et un peu moins de saturation dans les aigus.`,
    });
  if (band("air").deviation < -4)
    mix.push({
      id: "dull", area: "mix", severity: "basse",
      title: "Manque d'air",
      detail: `Aigus ${band("air").deviation.toFixed(1)} dB sous la référence au-dessus de 8 kHz.`,
      action: "High-shelf +1,5 à +2,5 dB à 10–12 kHz sur le bus master ou exciter léger sur la voix.",
    });
  const lowEnd = (band("sub").deviation + band("bass").deviation) / 2;
  if (lowEnd < -4)
    mix.push({
      id: "thin", area: "mix", severity: "haute",
      title: "Bas du spectre trop léger",
      detail: `Sub + basses ${lowEnd.toFixed(1)} dB sous la référence ${g.label}.`,
      action: `Remonte kick/808 de 2–3 dB, low-shelf +2 dB à 60–80 Hz, vérifie la phase kick/basse.`,
    });
  else if (lowEnd > 4)
    mix.push({
      id: "boomy", area: "mix", severity: "haute",
      title: "Basses envahissantes",
      detail: `Sub + basses +${lowEnd.toFixed(1)} dB au-dessus de la référence : ça sature en voiture et écrase le reste en master.`,
      action: "Baisse la 808/basse de 2 dB, sidechain basse ← kick (3–6 dB), passe-haut 30 Hz sur la basse.",
    });

  // --- stereo ---
  if (f.stereo.lowCorrelation < 0.8)
    mix.push({
      id: "lowmono", area: "stéréo", severity: f.stereo.lowCorrelation < 0.5 ? "haute" : "moyenne",
      title: "Basses pas en mono",
      detail: `Corrélation sous 120 Hz : ${f.stereo.lowCorrelation.toFixed(2)} (idéal > 0,9). En club, en voiture et sur téléphone mono, les basses s'annulent.`,
      action: "Utilise un utilitaire « bass mono » sous 120 Hz sur le master, et évite les chorus/widener sur la basse.",
    });
  if (f.stereo.monoLossDb < -2.5)
    mix.push({
      id: "phase", area: "stéréo", severity: "haute",
      title: "Pertes en mono",
      detail: `Le morceau perd ${Math.abs(f.stereo.monoLossDb).toFixed(1)} dB en mono (enceintes Bluetooth, téléphones).`,
      action: "Réduis les wideners/haas sur les éléments principaux ; garde voix lead, kick, snare et basse au centre.",
    });
  if (f.stereo.width < 0.06)
    mix.push({
      id: "narrow", area: "stéréo", severity: "basse",
      title: "Image stéréo étroite",
      detail: `Largeur ${(f.stereo.width * 100).toFixed(0)} % : ça manque d'espace sur casque.`,
      action: "Double-tracking panoramisé (L/R) sur les backs et guitares/synthés, réverbe stéréo courte sur les éléments d'ambiance.",
    });

  // --- master ---
  if (L.clippedSamples > 0)
    mix.push({
      id: "clip", area: "master", severity: "haute",
      title: "Clipping numérique",
      detail: `${L.clippedSamples} échantillons écrêtés détectés.`,
      action: "Baisse le gain d'entrée du limiteur, vérifie que rien ne dépasse 0 dBFS avant le master.",
    });
  if (L.truePeak > -1)
    mix.push({
      id: "tp", area: "master", severity: L.truePeak > 0 ? "haute" : "moyenne",
      title: "True peak trop haut",
      detail: `${L.truePeak.toFixed(2)} dBTP : l'encodage AAC/Ogg des plateformes va distordre.`,
      action: "Plafond du limiteur à −1,0 dBTP avec détection true-peak (ou utilise l'onglet Master).",
    });
  if (L.integrated < g.lufs.min - 1)
    mix.push({
      id: "quiet", area: "master", severity: "moyenne",
      title: "Master trop faible pour le genre",
      detail: `${fmt(L.integrated)} LUFS pour une cible ${g.label} de ${g.lufs.min} à ${g.lufs.max} LUFS.`,
      action: `Vise ${g.lufs.ideal} LUFS intégrés avec un limiteur (2–4 dB de réduction max) — preset dans l'onglet Master.`,
    });
  if (L.integrated > g.lufs.max + 0.5 || L.plr < 6)
    mix.push({
      id: "crushed", area: "master", severity: "moyenne",
      title: "Master trop compressé",
      detail: `PLR ${L.plr.toFixed(1)} dB : les transitoires sont écrasées. Après normalisation à −14 LUFS, le morceau paraîtra plus petit que les concurrents.`,
      action: "Relâche le limiteur de 2 dB, ralentis l'attaque de la compression de bus (30 ms), clipper doux avant le limiteur.",
    });
  if (L.lra > 9 && g.id !== "rock")
    mix.push({
      id: "lra", area: "master", severity: "basse",
      title: "Écarts de volume importants",
      detail: `LRA ${L.lra.toFixed(1)} LU : les passages calmes risquent d'être inaudibles en voiture/transport.`,
      action: "Automation de volume sur les couplets/breaks ou compression de bus légère (ratio 2:1).",
    });

  // --- structure ---
  const t = hookTime(f);
  const s = f.structure;
  if (t > 8)
    mix.push({
      id: "late-hook", area: "structure", severity: "haute",
      title: "Le hook arrive trop tard",
      detail: `Accroche à ${formatTime(t)}. Sur les plateformes à swipe, la décision se prend en 1 à 3 s.`,
      action: `Ouvre avec 2 mesures du refrain (filtré passe-bas), ou coupe l'intro pour démarrer à ${formatTime(Math.max(0, s.firstHookTime - s.barSec))}.`,
    });
  if (s.hook.occurrences.length < 3)
    mix.push({
      id: "few-hooks", area: "structure", severity: "moyenne",
      title: "Pas assez de répétitions du hook",
      detail: `Hook entendu ${s.hook.occurrences.length} fois.`,
      action: "Ajoute un refrain supplémentaire ou un post-refrain qui reprend la phrase du hook.",
    });

  mix.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

  return { mix, blueprints: blueprints(f, genreId), ideas: ideas(f, genreId) };
}

function build(parts: [string, number, string?][], barSec: number): { parts: BlueprintPart[]; duration: number } {
  let t = 0;
  const out = parts.map(([name, bars, note]) => {
    const p = { name, bars, start: t, end: t + bars * barSec, note };
    t += bars * barSec;
    return p;
  });
  return { parts: out, duration: t };
}

export function blueprints(f: Features, genreId: GenreId): Blueprint[] {
  const g = genreById(genreId);
  const barSec = (4 * 60) / (f.rhythm.bpm < 90 && (g.id === "rap" || g.id === "drill") ? f.rhythm.bpm * 2 : f.rhythm.bpm);
  const V = g.verseBars, C = g.chorusBars;
  const hookFirst = build(
    [
      ["Hook", C, "Le refrain d'entrée, sans intro"],
      ["Couplet 1", V],
      ["Hook", C],
      ["Couplet 2", Math.max(8, V / 2), "Plus court : l'attention baisse"],
      ["Pont / break", 4, "Mute d'un temps avant le dernier hook"],
      ["Hook", C],
      ["Outro", 2, "Boucle propre vers le début (pour les replays)"],
    ],
    barSec,
  );
  const radio = build(
    [
      ["Intro", 4, "Motif signature du hook, filtré"],
      ["Couplet 1", V],
      ["Pré-refrain", 4, "Montée : riser, filtre, retrait du kick"],
      ["Refrain", C],
      ["Couplet 2", V],
      ["Pré-refrain", 4],
      ["Refrain", C],
      ["Pont", 8, "Nouvelle couleur harmonique ou mélodique"],
      ["Refrain final", C * 2, "Doublé, avec ad-libs"],
      ["Outro", 4],
    ],
    barSec,
  );
  const short = build(
    [
      ["Intro", 2, "Gimmick vocal / ad-lib signature"],
      ["Refrain", C],
      ["Couplet", Math.max(8, V - 4)],
      ["Refrain", C],
      ["Post-refrain", 4, "Phrase courte, facile à reprendre en lipsync"],
      ["Refrain", C],
    ],
    barSec,
  );
  const list: Blueprint[] = [
    { id: "hook-first", title: "Hook-first (TikTok / Reels)", why: "Le hook dans les 3 premières secondes, deux couplets resserrés : optimisé pour la rétention et le replay.", ...hookFirst },
    { id: "short", title: "Court & bouclable", why: "Sous les 2 min 30 : plus de replays par écoute, idéal pour les playlists et le short-form.", ...short },
    { id: "radio", title: "Radio / streaming", why: "Structure classique avec pré-refrain et pont : meilleure progression sur écoute complète.", ...radio },
  ];
  if (g.id === "edm") {
    const edm = build(
      [
        ["Intro", 8, "Hook mélodique filtré"],
        ["Build", 8, "Snare roll, riser, filtre passe-haut"],
        ["Drop", 16],
        ["Break", 8, "Voix/topline seule"],
        ["Build", 8],
        ["Drop 2", 16, "Variation (nouveau lead ou basse)"],
        ["Outro", 8],
      ],
      barSec,
    );
    list.push({ id: "edm", title: "Build → Drop", why: "La tension/relâchement qui déclenche les partages en club et en vidéo.", ...edm });
  }
  return list;
}

export function ideas(f: Features, genreId: GenreId): Idea[] {
  const g = genreById(genreId);
  const out: Idea[] = [];
  const k = f.key;
  const tonic = NOTE_NAMES[k.tonic];
  const subHz = midiToHz(24 + k.tonic); // octave 1
  const s = f.structure;
  const bpm = f.rhythm.bpm;
  if (g.family === "hiphop" || g.id === "edm")
    out.push({ tag: "Basse", title: `Accorde la 808 sur ${tonic}`, detail: `Fondamentale ${tonic}1 ≈ ${subHz.toFixed(1)} Hz (tonalité ${k.nameFr}). Glides d'une quinte (${NOTE_NAMES[(k.tonic + 7) % 12]}) sur les fins de phrases du hook.` });
  out.push({ tag: "Hook", title: "Doubles et octaves sur le hook", detail: "Double la voix du refrain (±10 cents, panoramique 70 % L/R) et ajoute une octave basse à −12 dB : le hook paraît plus grand sans monter le volume." });
  if (s.drops.length === 0 || (Number.isFinite(s.chorusLift) && s.chorusLift < 2))
    out.push({ tag: "Énergie", title: "Silence d'un temps avant le refrain", detail: "Coupe tout (ou tout sauf la voix) sur le dernier temps avant le hook : le retour du beat crée le moment « drop » qui fait réagir." });
  out.push({ tag: "Transition", title: "Filtre qui s'ouvre sur le pré-refrain", detail: `Passe-haut automatisé de 20 Hz à 400 Hz sur 2 mesures (${(2 * s.barSec).toFixed(1)} s) + riser blanc, relâché pile sur le refrain.` });
  out.push({ tag: "Gimmick", title: "Ad-lib signature", detail: "Un son vocal court et reconnaissable (cri, rire, mot) placé à la même position à chaque hook : c'est ce que les gens reprennent dans leurs vidéos." });
  if (f.stereo.width < 0.12)
    out.push({ tag: "Espace", title: "Contraste de largeur couplet → refrain", detail: "Couplet plus étroit (mono sur les éléments principaux), refrain large (doubles, pads stéréo) : l'ouverture se ressent même au téléphone." });
  const up = Math.round(bpm * 1.2), down = Math.round(bpm * 0.84);
  out.push({ tag: "Version", title: `Version sped-up à ${up} BPM`, detail: `+${(12 * Math.log2(1.2)).toFixed(1)} demi-tons. Les versions sped-up/nightcore sont devenues un format de sortie à part entière. Génère-la dans l'onglet Versions.` });
  out.push({ tag: "Version", title: `Version slowed + reverb à ${down} BPM`, detail: "Pour les montages lents/émotionnels et les edits. Même onglet." });
  out.push({ tag: "TikTok", title: `Extrait à pousser : ${formatTime(s.clips.tiktok.start)}–${formatTime(s.clips.tiktok.end)}`, detail: `${s.clips.tiktok.bars} mesures, boucle ${Math.round(s.clips.tiktok.loopScore * 100)} %. Poste ce passage comme son officiel sur TikTok/Reels.` });
  if (k.mode === "minor")
    out.push({ tag: "Harmonie", title: `Emprunt au relatif majeur (${NOTE_NAMES[(k.tonic + 3) % 12]})`, detail: "Passer le refrain sur le relatif majeur donne un effet « lumière » qui fait ressortir le hook." });
  else
    out.push({ tag: "Harmonie", title: `Accord emprunté au mineur (${NOTE_NAMES[(k.tonic + 5) % 12]}m)`, detail: "Un iv mineur avant le retour au I sur la fin du pré-refrain : tension émotionnelle très utilisée en pop." });
  return out;
}
