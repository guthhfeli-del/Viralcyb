/**
 * Chorus / verse evaluation on JamendoLyrics (79 CC-licensed songs with
 * line-level lyric timings: https://github.com/f90/jamendolyrics).
 *
 * Ground truth: a sung line is "chorus" when it belongs to a run of at least
 * two consecutive lines that comes back later in the song, "verse" otherwise.
 * Score: on sung passages only, balanced accuracy of detected chorus vs that
 * truth (0.5 = chance), plus how often the first chorus is found and whether
 * the hook sits on repeated lyrics.
 *
 *   JAMENDO_DIR=/path/to/jamendolyrics npm run eval:structure
 *
 * Decoding uses Python + soundfile (PYTHON env var, default python3); the
 * features of each song are cached in .cache/ so later runs take seconds.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";
import { expect, it } from "vitest";
import { analyzeFrames, onsetEnvelope } from "../../src/dsp/frames";
import { measureLoudness } from "../../src/dsp/loudness";
import { analyzeStructure, type StructureInput } from "../../src/dsp/structure";
import { downbeatPhase, estimateTempo, refineBpm, trackBeats } from "../../src/dsp/tempo";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CACHE = `${HERE}.cache`;
const DATA = process.env.JAMENDO_DIR ?? "";
const PYTHON = process.env.PYTHON ?? "python3";

/** Same steps as analyzeTrack() up to the structure call. */
function structureInput(name: string): StructureInput {
  const cached = `${CACHE}/${name}.bin`;
  if (existsSync(cached)) return deserialize(readFileSync(cached));
  const raw = `${CACHE}/${name}.f32`;
  const [fsS, nS] = execFileSync(PYTHON, [`${HERE}decode.py`, `${DATA}/mp3/${name}.mp3`, raw]).toString().trim().split(" ");
  const fs = Number(fsS), n = Math.min(Number(nS), Math.round(420 * fs));
  const buf = readFileSync(raw);
  unlinkSync(raw);
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const left = new Float32Array(n), right = new Float32Array(n), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = all[2 * i];
    right[i] = all[2 * i + 1];
    mono[i] = 0.5 * (left[i] + right[i]);
  }
  const loudness = measureLoudness([left, right], fs);
  const frames = analyzeFrames(left, right, fs);
  const onset = onsetEnvelope(mono, fs);
  const tempo = estimateTempo(onset.env, onset.hopSec);
  const beatFrames = trackBeats(onset.env, onset.hopSec, tempo.bpm);
  const beats = beatFrames.map((f) => f * onset.hopSec);
  const chromaAt = (t: number) => Math.min(frames.count - 1, Math.max(0, Math.round((t * fs - 2048) / frames.hop)));
  const harmonicChange = (onsetFrame: number) => {
    const t = onsetFrame * onset.hopSec;
    const a = chromaAt(t - 0.25), b = chromaAt(t + 0.25);
    let d = 0;
    for (let c = 0; c < 12; c++) d += Math.abs(frames.chroma[a * 12 + c] - frames.chroma[b * 12 + c]);
    return d / 2;
  };
  const input: StructureInput = {
    frames,
    duration: n / fs,
    beats: tempo.confidence > 0.05 ? beats : [],
    downbeatPhase: downbeatPhase(beatFrames, onset.low, harmonicChange),
    bpm: refineBpm(beats, tempo.bpm),
    momentary: loudness.momentary,
  };
  writeFileSync(cached, serialize(input));
  return input;
}

interface Line { start: number; end: number; rep: boolean }

const words = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").split(" ").filter(Boolean);

function sameLine(a: string[], b: string[]): boolean {
  if (a.length < 2 || b.length < 2) return a.length > 0 && a.join(" ") === b.join(" ");
  const bag = new Map<string, number>();
  for (const w of a) bag.set(w, (bag.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of b) {
    const c = bag.get(w) ?? 0;
    if (c > 0) {
      common++;
      bag.set(w, c - 1);
    }
  }
  return (2 * common) / (a.length + b.length) >= 0.75;
}

function truth(name: string): Line[] {
  const rows = readFileSync(`${DATA}/annotations/lines/${name}.csv`, "utf8").trim().split("\n").slice(1);
  const parsed = rows.map((row) => row.match(/^([^,]+),([^,]+),(.*)$/)!).map((m) => ({ start: Number(m[1]), end: Number(m[2]), text: words(m[3].replace(/^"|"$/g, "")) }));
  const lines: Line[] = parsed.map((l) => ({ start: l.start, end: l.end, rep: false }));
  for (let i = 0; i < parsed.length; i++)
    for (let j = i + 1; j < parsed.length; j++) {
      let k = 0;
      while (j + k < parsed.length && i + k < j && sameLine(parsed[i + k].text, parsed[j + k].text)) k++;
      if (k >= 2) for (let q = 0; q < k; q++) lines[i + q].rep = lines[j + q].rep = true;
    }
  return lines;
}

it("scores chorus detection against repeated lyrics", () => {
  if (!DATA || !existsSync(`${DATA}/mp3`)) {
    console.warn("JAMENDO_DIR is not set: clone https://github.com/f90/jamendolyrics and point JAMENDO_DIR at it.");
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  const language = new Map(
    readFileSync(`${DATA}/JamendoLyrics.csv`, "utf8").trim().split("\n").slice(1).map((r) => {
      const c = r.split(",");
      return [c[1].replace(/\.mp3$/, ""), c[6]] as const;
    }),
  );
  const names = readdirSync(`${DATA}/mp3`).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -4)).sort();
  const rows: string[] = [];
  const agg = new Map<string, { n: number; bal: number; first: number; hook: number; hookN: number }>();
  for (const name of names) {
    const lines = truth(name);
    if (!lines.some((l) => l.rep)) continue;
    const st = analyzeStructure(structureInput(name));
    const inChorus = (t: number) => st.sections.some((s) => s.kind === "chorus" && t >= s.start && t < s.end);
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const l of lines)
      for (let t = l.start; t < l.end; t += 0.25) {
        const p = inChorus(t);
        if (p && l.rep) tp++;
        else if (p) fp++;
        else if (l.rep) fn++;
        else tn++;
      }
    const bal = 0.5 * (tp / (tp + fn || 1) + tn / (tn + fp || 1));
    // first block of repeated lines mostly inside a detected chorus?
    const i0 = lines.findIndex((l) => l.rep);
    let i1 = i0;
    while (lines[i1 + 1]?.rep) i1++;
    let hit = 0, tot = 0;
    for (const l of lines.slice(i0, i1 + 1))
      for (let t = l.start; t < l.end; t += 0.25) {
        tot++;
        if (inChorus(t)) hit++;
      }
    let hRep = 0, hTot = 0;
    for (const l of lines)
      for (let t = l.start; t < l.end; t += 0.25)
        if (t >= st.hook.start && t < st.hook.end) {
          hTot++;
          if (l.rep) hRep++;
        }
    for (const key of ["all", language.get(name) ?? "?"]) {
      const a = agg.get(key) ?? { n: 0, bal: 0, first: 0, hook: 0, hookN: 0 };
      a.n++;
      a.bal += bal;
      a.first += hit / tot >= 0.5 ? 1 : 0;
      if (hTot) {
        a.hook += hRep / hTot;
        a.hookN++;
      }
      agg.set(key, a);
    }
    rows.push(`${name.padEnd(40)} bal=${bal.toFixed(2)}  ${st.sections.map((s) => `${s.name}@${Math.round(s.start)}`).join(" ")}`);
  }
  const summary = Array.from(agg, ([k, a]) => `${k.padEnd(8)} songs=${a.n}  balanced accuracy=${(a.bal / a.n).toFixed(3)}  first chorus found=${a.first}/${a.n}  hook on repeated lyrics=${((100 * a.hook) / (a.hookN || 1)).toFixed(0)}%`);
  writeFileSync(`${CACHE}/report.txt`, [...rows, "", ...summary].join("\n") + "\n");
  console.log(summary.join("\n"));
  expect(agg.get("all")!.bal / agg.get("all")!.n).toBeGreaterThan(0.75);
});
