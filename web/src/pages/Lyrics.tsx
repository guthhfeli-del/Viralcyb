import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { useDisplayBpm, useGenre } from "../state/hooks";
import { analyzeLyrics } from "../engine/lyrics";
import { postJson, startJob, waitJob } from "../lib/api";
import { channelsToWavBlob } from "../lib/download";
import { resampleBuffer } from "../lib/ml";
import { Button, Chip, PageHead, Panel, Progress, Stat } from "../ui/Bits";
import { EngineGate } from "../ui/EngineGate";
import { NOTE_NAMES } from "../dsp/util";

/** Serverless hosts cap request bodies around 4.5 MB: send speech-rate mono WAV in parts below that. */
const MAX_UPLOAD_BYTES = 3_500_000;

async function speechParts(buf: AudioBuffer): Promise<Blob[]> {
  let rate = 16000;
  let mono: Float32Array;
  try {
    [mono] = await resampleBuffer(buf, rate, 1);
  } catch {
    rate = 22050; // some engines refuse low offline sample rates
    [mono] = await resampleBuffer(buf, rate, 1);
  }
  const step = Math.floor(MAX_UPLOAD_BYTES / 2);
  const parts: Blob[] = [];
  for (let i = 0; i < mono.length; i += step) parts.push(channelsToWavBlob([mono.subarray(i, i + step)], rate, 16));
  return parts;
}

const EXAMPLE = `[Couplet 1]
J'ai garé mes rêves au bord de la ville
Les phares s'éteignent, la nuit est fragile
J'compte les secondes, j'attends ton appel
Mon cœur fait du bruit sous les néons pastel

[Refrain]
Reste encore un peu, reste encore un peu
La ville est à nous quand on ferme les yeux
Reste encore un peu, reste encore un peu
On danse sur le feu`;

const STYLES = [
  { id: "catchy", label: "Plus accrocheur" },
  { id: "tiktok", label: "Hook TikTok (15 s)" },
  { id: "emotional", label: "Plus émotionnel" },
  { id: "street", label: "Plus street / imagé" },
  { id: "clean", label: "Version radio (clean)" },
  { id: "english", label: "Version anglaise" },
  { id: "alt-chorus", label: "Refrain alternatif" },
  { id: "same-flow", label: "Même flow, autres mots" },
];

interface Variant {
  title: string;
  style: string;
  text: string;
  notes?: string;
}

const RHYME_COLORS = ["var(--green)", "var(--violet)", "var(--amber)", "#9fc3d8", "var(--rose)", "#c7b8ff", "#b7e4c7"];

export default function Lyrics() {
  const lyrics = useStore((s) => s.lyrics);
  const setLyrics = useStore((s) => s.setLyrics);
  const title = useStore((s) => s.songTitle);
  const setTitle = useStore((s) => s.setSongTitle);
  const track = useStore((s) => s.track);
  const features = useStore((s) => s.features);
  const g = useGenre();
  const bpm = useDisplayBpm();
  const [styles, setStyles] = useState<string[]>(["catchy", "tiktok", "emotional"]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const report = useMemo(
    () => (lyrics.trim().length > 10 ? analyzeLyrics(lyrics, { title, bpm: bpm ?? undefined, durationSec: features?.meta.duration }) : null),
    [lyrics, title, bpm, features],
  );

  const transcribe = async () => {
    if (!track) return;
    setErr(null);
    setBusy("Envoi du morceau…");
    try {
      const parts = await speechParts(track.buffer);
      const texts: string[] = [];
      for (const [i, audio] of parts.entries()) {
        const step = parts.length > 1 ? ` (${i + 1}/${parts.length})` : "";
        const job = await startJob("transcribe", { audio });
        const done = await waitJob(job, (j) => setBusy(`${j.message ?? `Transcription… ${Math.round(j.progress * 100)} %`}${step}`));
        texts.push(String(done.result?.text ?? "").trim());
      }
      const text = texts.filter(Boolean).join("\n");
      if (!text) throw new Error("Aucune parole détectée.");
      setLyrics(text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setErr(null);
    setBusy("Écriture des variantes…");
    try {
      const r = await postJson<{ variants: Variant[] }>("/api/lyrics/variants", {
        lyrics,
        title,
        language: report?.language ?? "fr",
        genre: g.label,
        bpm: bpm ? Math.round(bpm) : null,
        key: features ? `${NOTE_NAMES[features.key.tonic]} ${features.key.mode}` : null,
        styles,
        hook: report?.hookCandidates[0]?.text ?? null,
      });
      setVariants(r.variants);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="page">
      <PageHead kicker="07 · Paroles" title={<>Des mots qui <span className="serif italic">restent</span>.</>}>
        Colle ton texte (ou transcris-le depuis le son) : syllabes, rimes, répétitions et lignes les plus « hook » sont analysées en direct. L'IA propose ensuite plusieurs réécritures basées sur ton texte.
      </PageHead>

      <Panel index="A" title="Texte" aside={<button className="linkbtn" onClick={() => setLyrics(EXAMPLE)}>Exemple</button>}>
        <div className="lyrics-input">
          <label className="field">
            <span className="label">Titre du morceau</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre (sert à mesurer le title-drop)" />
          </label>
          <label className="field">
            <span className="label">Paroles — [Couplet], [Refrain]… optionnels</span>
            <textarea rows={12} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Colle tes paroles ici…" spellCheck={false} />
          </label>
          {track && (
            <div className="actions">
              <EngineGate engine="transcribe" what="La transcription des paroles utilise Whisper : via OpenRouter (OPENROUTER_API_KEY sur le serveur) ou en local avec faster-whisper. Idéalement sur le stem voix.">
                <Button icon="topline" onClick={transcribe} disabled={!!busy}>
                  Transcrire depuis le son
                </Button>
              </EngineGate>
            </div>
          )}
        </div>
      </Panel>

      {report && (
        <>
          <div className="statgrid statgrid--6 rise">
            <Stat label="Langue" value={report.language.toUpperCase()} />
            <Stat label="Lignes" value={report.lines.length} />
            <Stat label="Syll. / ligne" value={report.avgSyllables.toFixed(1)} />
            <Stat label="Rimes" value={Math.round(report.rhymeDensity * 100)} unit="%" tone={report.rhymeDensity > 0.6 ? "good" : "warn"} />
            <Stat label="Vocabulaire" value={Math.round(report.uniqueRatio * 100)} unit="% unique" />
            <Stat
              label={report.syllablesPerBeat ? "Syll. / temps" : "Title-drop"}
              value={report.syllablesPerBeat ? report.syllablesPerBeat.toFixed(1) : report.titleDrops}
              hint={report.syllablesPerBeat ? "débit estimé" : title ? `${report.titleDrops}× le titre` : "renseigne le titre"}
            />
          </div>

          <Panel index="B" title="Lignes les plus « hook »">
            <ol className="hooks">
              {report.hookCandidates.map((l, i) => (
                <li key={i}>
                  <span className="mono hooks__n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="hooks__text serif">{l.text}</span>
                  <span className="mono faint">{l.syllables} syll. · ×{l.repeats}</span>
                  <span className="mono hooks__score">{l.hookScore}</span>
                </li>
              ))}
            </ol>
            {report.signaturePhrases.length > 0 && (
              <div className="phrases">
                <span className="label">Phrases signature</span>
                {report.signaturePhrases.map((p) => (
                  <Chip key={p.text} tone="violet">
                    « {p.text} » ×{p.count}
                  </Chip>
                ))}
              </div>
            )}
            {title && report.firstTitleLine < 0 && <p className="warnline">Le titre n'apparaît jamais dans le texte : les hits le placent tôt et souvent (title-drop).</p>}
          </Panel>

          <Panel index="C" title="Rimes & syllabes" aside={<span className="label">schéma par section</span>}>
            <ul className="lyric-lines">
              {report.lines.map((l, i) => {
                const col = RHYME_COLORS[(l.rhymeLetter.charCodeAt(0) - 65) % RHYME_COLORS.length];
                const newSection = i === 0 || report.lines[i - 1].section !== l.section;
                return (
                  <li key={i} className={newSection ? "is-first" : ""}>
                    {newSection && <span className="label lyric-lines__section">{l.section}</span>}
                    <span className="lyric-lines__rhyme mono" style={{ color: col }}>{l.rhymeLetter}</span>
                    <span className="lyric-lines__text">{l.text}</span>
                    <span className="lyric-lines__syl mono faint">{l.syllables}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel index="D" title="Restructurations" aside={<span className="label">sans réécriture</span>}>
            <div className="variants">
              {report.restructures.map((r) => (
                <article key={r.title} className="variant">
                  <header>
                    <h4>{r.title}</h4>
                    <button className="linkbtn" onClick={() => copy(r.title, r.text)}>{copied === r.title ? "Copié" : "Copier"}</button>
                  </header>
                  <p className="faint variant__why">{r.why}</p>
                  <pre className="variant__text">{r.text}</pre>
                </article>
              ))}
            </div>
          </Panel>

          <Panel index="E" title="Variantes écrites par l'IA" aside={<Chip tone="violet">OpenRouter · serveur</Chip>}>
            <EngineGate engine="lyrics" what="Les réécritures passent par OpenRouter (Claude par défaut) côté serveur : ajoute OPENROUTER_API_KEY dans l'environnement du serveur Viral Cyb (ou ANTHROPIC_API_KEY pour l'API Anthropic en direct).">
              <div className="stylechips" role="group" aria-label="Styles de variantes">
                {STYLES.map((s) => {
                  const on = styles.includes(s.id);
                  return (
                    <button key={s.id} className={`stylechip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => setStyles(on ? styles.filter((x) => x !== s.id) : [...styles, s.id].slice(-5))}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <div className="actions">
                <Button variant="primary" icon="spark" onClick={generate} disabled={!!busy || styles.length === 0}>
                  Générer {styles.length} variante{styles.length > 1 ? "s" : ""}
                </Button>
              </div>
              {variants.length > 0 && (
                <div className="variants">
                  {variants.map((v, i) => (
                    <article key={i} className="variant">
                      <header>
                        <h4>{v.title}</h4>
                        <button className="linkbtn" onClick={() => copy(`v${i}`, v.text)}>{copied === `v${i}` ? "Copié" : "Copier"}</button>
                      </header>
                      <span className="label">{v.style}</span>
                      <pre className="variant__text">{v.text}</pre>
                      {v.notes && <p className="faint variant__why">{v.notes}</p>}
                    </article>
                  ))}
                </div>
              )}
            </EngineGate>
          </Panel>
        </>
      )}
      {busy && <Progress label={busy} />}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
