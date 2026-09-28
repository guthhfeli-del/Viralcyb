/**
 * Lyrics analysis (French & English): syllables, rhymes, repetition,
 * hook candidates, flow density, and deterministic re-structurings.
 * Creative rewrites come from the server (LLM); this module never invents
 * words.
 */
export interface LyricLine {
  text: string;
  section: string;
  syllables: number;
  rhyme: string;
  rhymeLetter: string;
  repeats: number;
  hookScore: number;
}

export interface LyricsReport {
  language: "fr" | "en";
  lines: LyricLine[];
  sections: { name: string; lines: number }[];
  words: number;
  uniqueRatio: number;
  avgSyllables: number;
  rhymeDensity: number; // 0..1
  repeatedLines: { text: string; count: number }[];
  signaturePhrases: { text: string; count: number }[];
  hookCandidates: LyricLine[];
  titleDrops: number;
  firstTitleLine: number; // -1 if never
  syllablesPerBeat: number | null;
  restructures: { title: string; why: string; text: string }[];
}

const FR_STOP = ["je", "tu", "il", "elle", "nous", "vous", "ils", "le", "la", "les", "un", "une", "des", "et", "est", "que", "qui", "pas", "dans", "pour", "sur", "mon", "ma", "mes", "ton", "ta", "tes", "moi", "toi", "avec", "c'est", "j'suis", "ça", "on"];
const EN_STOP = ["i", "you", "he", "she", "we", "they", "the", "a", "an", "and", "is", "are", "to", "of", "in", "on", "my", "your", "me", "it", "that", "with", "for", "i'm", "don't", "can't", "love", "baby"];

const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normLine = (s: string) => stripAccents(s.toLowerCase()).replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

export function detectLanguage(text: string): "fr" | "en" {
  const w = normLine(text).split(" ");
  let fr = 0, en = 0;
  for (const x of w) {
    if (FR_STOP.includes(x)) fr++;
    if (EN_STOP.includes(x)) en++;
  }
  if (/[éèêàùçœ]/i.test(text)) fr += 3;
  return fr >= en ? "fr" : "en";
}

export function countSyllables(line: string, lang: "fr" | "en"): number {
  const words = line.toLowerCase().replace(/[^a-zà-ÿœæ' -]/g, " ").split(/[\s-]+/).filter(Boolean);
  let total = 0;
  for (let w of words) {
    w = w.replace(/^[a-z]'/, ""); // élision (l', j', d'…)
    const groups = w.match(lang === "fr" ? /[aeiouyàâäéèêëîïôöùûüœæ]+/g : /[aeiouy]+/g) ?? [];
    let n = groups.length;
    if (lang === "fr") {
      // e muet final (sung lyrics often drop it)
      if (n > 1 && /[^aeiouy]e?s?$/.test(w) && /e$|es$/.test(w)) n--;
      if (n > 1 && /[^aeiouy]ent$/.test(w) && w.length > 4) n--; // -ent (3e pers. plur.)
    } else {
      if (n > 1 && /[^aeiouy]e$/.test(w) && !/le$/.test(w)) n--;
      if (/[^aeiouy]ed$/.test(w) && !/[td]ed$/.test(w) && n > 1) n--;
    }
    total += Math.max(1, n);
  }
  return total;
}

const FR_VOWELS: [RegExp, string][] = [
  [/(eaux|eau|aux|au|ô|o)$/, "O"],
  [/(ain|ein|in|ïn|im|un|yn)$/, "IN"],
  [/(an|en|am|em)$/, "AN"],
  [/(on|om)$/, "ON"],
  [/(où|ou)$/, "OU"],
  [/(oi|oî)$/, "WA"],
  [/(ai|ei|è|ê|ë|e)$/, "È"],
  [/(é)$/, "É"],
  [/(û|u)$/, "U"],
  [/(î|ï|i|y)$/, "I"],
  [/(â|à|a)$/, "A"],
];

/** Approximate phonetic rhyme key of the last word. */
export function rhymeKey(line: string, lang: "fr" | "en"): string {
  const last = line.toLowerCase().replace(/[^a-zà-ÿœæ' ]+/g, " ").trim().split(/\s+/).pop() ?? "";
  if (!last) return "";
  if (lang === "fr") {
    let w = last.replace(/^[a-z]'/, "").replace(/œ/g, "e");
    if (/(ée?s?|er|ez)$/.test(w)) return "É";
    if (/ai[st]?$/.test(w)) return "È";
    w = w.replace(/(es|ent)$/, "").replace(/e$/, "").replace(/[stxdzp]+$/, "");
    const cons = (w.match(/[^aeiouyàâäéèêëîïôöùûü]+$/) ?? [""])[0];
    let stem = w.slice(0, w.length - cons.length);
    let code = "";
    // nasal vowels end in n/m: treat "an", "on"… before splitting consonants
    for (const [re, c] of FR_VOWELS) {
      if (re.test(w) && /[nm]$/.test(w)) { code = c; stem = ""; break; }
    }
    if (!code) {
      for (const [re, c] of FR_VOWELS) if (re.test(stem)) { code = c; break; }
      code += cons.replace(/(.)\1+/g, "$1").toUpperCase();
    }
    return code || w.slice(-2).toUpperCase();
  }
  const w = stripAccents(last).replace(/'/g, "");
  const m = w.match(/[aeiouy]+[^aeiouy]*$/);
  let k = m ? m[0] : w.slice(-2);
  k = k.replace(/e$/, "").replace(/ies$|y$/, "i").replace(/s$/, "");
  return k.toUpperCase();
}

export function analyzeLyrics(text: string, opts: { title?: string; bpm?: number; durationSec?: number } = {}): LyricsReport {
  const lang = detectLanguage(text);
  const rawLines = text.split(/\r?\n/);
  const lines: LyricLine[] = [];
  const sections: { name: string; lines: number }[] = [];
  let section = "Texte";
  for (const raw of rawLines) {
    const t = raw.trim();
    if (!t) continue;
    const header = t.match(/^[[(]\s*([^\])]+)\s*[\])]\s*:?$/) ?? t.match(/^(refrain|couplet|hook|chorus|verse|pont|bridge|intro|outro|pré-refrain|pre-chorus)\s*\d*\s*:?$/i);
    if (header) {
      section = header[1].trim();
      sections.push({ name: section, lines: 0 });
      continue;
    }
    if (!sections.length) sections.push({ name: section, lines: 0 });
    sections[sections.length - 1].lines++;
    lines.push({ text: t, section, syllables: countSyllables(t, lang), rhyme: rhymeKey(t, lang), rhymeLetter: "", repeats: 0, hookScore: 0 });
  }
  // repetition
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(normLine(l.text), (counts.get(normLine(l.text)) ?? 0) + 1);
  lines.forEach((l) => (l.repeats = counts.get(normLine(l.text)) ?? 1));
  // rhyme letters per section
  let rhymed = 0;
  const bySection = new Map<string, LyricLine[]>();
  lines.forEach((l) => bySection.set(l.section, [...(bySection.get(l.section) ?? []), l]));
  for (const ls of bySection.values()) {
    const map = new Map<string, string>();
    let next = 0;
    ls.forEach((l, i) => {
      const key = l.rhyme;
      if (!map.has(key)) map.set(key, String.fromCharCode(65 + (next++ % 26)));
      l.rhymeLetter = map.get(key)!;
      const neighbours = ls.slice(Math.max(0, i - 2), i).concat(ls.slice(i + 1, i + 3));
      if (key && neighbours.some((n) => n.rhyme === key)) rhymed++;
    });
  }
  // signature phrases (3–6 word n-grams repeated)
  const words = lines.flatMap((l) => normLine(l.text).split(" ").filter(Boolean));
  const grams = new Map<string, number>();
  for (let n = 6; n >= 3; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n).join(" ");
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
  }
  const signature = [...grams.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)
    .filter(([g], i, arr) => !arr.slice(0, i).some(([h]) => h.includes(g)))
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  const title = opts.title ? normLine(opts.title) : "";
  let titleDrops = 0, firstTitleLine = -1;
  lines.forEach((l, i) => {
    if (title && normLine(l.text).includes(title)) {
      titleDrops++;
      if (firstTitleLine < 0) firstTitleLine = i;
    }
  });
  // hook score per line
  for (const l of lines) {
    const short = l.syllables >= 4 && l.syllables <= 11 ? 1 : l.syllables <= 14 ? 0.5 : 0.1;
    const rep = Math.min(1, (l.repeats - 1) / 2);
    const address = /\b(tu|toi|te|t'|you|your|we|nous|on)\b/i.test(l.text) ? 1 : 0;
    const sectionBonus = /refrain|hook|chorus/i.test(l.section) ? 1 : 0;
    const simple = (() => {
      const ws = normLine(l.text).split(" ").filter(Boolean);
      const avg = ws.reduce((a, w) => a + w.length, 0) / Math.max(1, ws.length);
      return avg <= 5 ? 1 : avg <= 6.5 ? 0.6 : 0.3;
    })();
    l.hookScore = Math.round(100 * (0.3 * short + 0.3 * rep + 0.15 * address + 0.15 * sectionBonus + 0.1 * simple));
  }
  const uniq = new Map<string, LyricLine>();
  for (const l of [...lines].sort((a, b) => b.hookScore - a.hookScore)) if (!uniq.has(normLine(l.text))) uniq.set(normLine(l.text), l);
  const hookCandidates = [...uniq.values()].slice(0, 4);

  const totalSyl = lines.reduce((a, l) => a + l.syllables, 0);
  let syllablesPerBeat: number | null = null;
  if (opts.bpm && opts.durationSec) {
    const beats = (opts.durationSec * opts.bpm) / 60;
    syllablesPerBeat = totalSyl / Math.max(1, beats * 0.75); // ~75 % of the song carries vocals
  }

  const repeatedLines = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([k, c]) => ({ text: lines.find((l) => normLine(l.text) === k)!.text, count: c }))
    .sort((a, b) => b.count - a.count);

  return {
    language: lang,
    lines,
    sections,
    words: words.length,
    uniqueRatio: new Set(words).size / Math.max(1, words.length),
    avgSyllables: totalSyl / Math.max(1, lines.length),
    rhymeDensity: lines.length ? rhymed / lines.length : 0,
    repeatedLines,
    signaturePhrases: signature,
    hookCandidates,
    titleDrops,
    firstTitleLine,
    syllablesPerBeat,
    restructures: restructure(lines, hookCandidates),
  };
}

function restructure(lines: LyricLine[], hooks: LyricLine[]): { title: string; why: string; text: string }[] {
  if (lines.length < 2 || !hooks.length) return [];
  const h = hooks[0];
  const h2 = hooks[1] ?? hooks[0];
  const echo = (t: string) => {
    const ws = t.replace(/[.,!?…]+$/, "").split(/\s+/);
    return `(${ws.slice(-2).join(" ")})`;
  };
  // best consecutive window of 2–4 lines for a 15-second cut
  let best = 0, bestI = 0;
  for (let i = 0; i < lines.length; i++) {
    for (let n = 2; n <= 4 && i + n <= lines.length; n++) {
      const win = lines.slice(i, i + n);
      const syl = win.reduce((a, l) => a + l.syllables, 0);
      const fits = syl <= 44 ? 1 : 0.5;
      const s = (win.reduce((a, l) => a + l.hookScore, 0) / n) * fits + n * 2;
      if (s > best) { best = s; bestI = i; }
    }
  }
  const cut = lines.slice(bestI, bestI + 4).filter((l, i, arr) => i < 2 || l.section === arr[0].section);
  return [
    {
      title: "Hook condensé (A-A-B-A)",
      why: "La phrase la plus « chantable » répétée, avec une ligne de contraste : la forme la plus mémorisable.",
      text: [h.text, h.text, h2.text, h.text].join("\n"),
    },
    {
      title: "Extrait TikTok (≈ 15 s)",
      why: "Les lignes consécutives au meilleur potentiel de hook, dans un volume de syllabes qui tient en 15 secondes.",
      text: cut.map((l) => l.text).join("\n"),
    },
    {
      title: "Call & response",
      why: "Des échos en ad-lib après chaque ligne du hook : ça donne des repères aux gens pour reprendre le son.",
      text: [h, h2, h, h2].map((l) => `${l.text} ${echo(l.text)}`).join("\n"),
    },
    {
      title: "Ouverture hook-first",
      why: "Le texte réordonné pour démarrer sur le hook avant le premier couplet.",
      text: [h.text, h2.text, "", ...lines.filter((l) => normLine(l.text) !== normLine(h.text)).slice(0, 8).map((l) => l.text)].join("\n"),
    },
  ];
}
