import { useState } from "react";
import { useStore, type Rendered } from "../state/store";
import { useDisplayBpm } from "../state/hooks";
import { renderVersion, VERSION_SPECS, type VersionId } from "../lib/render";
import { finalize } from "../lib/finalize";
import { player } from "../lib/player";
import { usePlayer } from "../lib/usePlayer";
import { baseName, bufferToWavBlob, downloadBlob } from "../lib/download";
import { decodeFile } from "../lib/audio";
import { fileUrl, startJob, waitJob } from "../lib/api";
import { Button, Chip, PageHead, Panel, Progress } from "../ui/Bits";
import { Icon } from "../ui/Icon";
import { formatTime, NOTE_NAMES } from "../dsp/util";
import { EngineGate } from "../ui/EngineGate";

const AI_STYLES = ["Drill UK", "Afrobeats", "Amapiano", "Phonk", "Jersey club", "Acoustique guitare-voix", "Lo-fi hip-hop", "Pop-punk", "Reggaeton", "Orchestral cinématique"];

export default function Versions() {
  const track = useStore((s) => s.track)!;
  const features = useStore((s) => s.features);
  const mastered = useStore((s) => s.mastered);
  const rendered = useStore((s) => s.rendered);
  const addRendered = useStore((s) => s.addRendered);
  const removeRendered = useStore((s) => s.removeRendered);
  const bpm = useDisplayBpm() ?? features?.rhythm.bpm ?? 120;
  const snap = usePlayer();
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(VERSION_SPECS.filter((s) => s.param).map((s) => [s.id, s.param!.value])));
  const [busy, setBusy] = useState<string | null>(null);
  const [aiStyle, setAiStyle] = useState(AI_STYLES[0]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStrength, setAiStrength] = useState(0.45);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!features) return <div className="page-loading" />;
  const source = mastered?.buffer ?? track.buffer;
  const clip = features.structure.clips.tiktok;
  const key = features.key;

  const make = async (id: VersionId) => {
    setErr(null);
    setBusy(id);
    try {
      const v = values[id];
      const raw = await renderVersion(source, id, { value: v, clip: { start: clip.start, end: clip.end } });
      const target = mastered ? mastered.report.lufsOut : features.loudness.integrated;
      const buf = await finalize(raw, target);
      const spec = VERSION_SPECS.find((s) => s.id === id)!;
      const semis = id === "spedup" || id === "nightcore" || id === "slowed" ? 12 * Math.log2(v) : 0;
      const detail =
        id === "spedup" || id === "nightcore" || id === "slowed"
          ? `${Math.round(bpm * v)} BPM · ${semis >= 0 ? "+" : ""}${semis.toFixed(1)} demi-tons · ${formatTime(buf.duration)}`
          : id === "tiktok" || id === "loop"
            ? `${formatTime(clip.start)}–${formatTime(clip.end)} · ${clip.bars} mesures`
            : formatTime(buf.duration);
      const r: Rendered = { id: `v-${id}`, label: spec.label, detail, buffer: buf, createdAt: Date.now(), kind: "version" };
      player.set(r.id, buf);
      addRendered(r);
      player.use(r.id, { keepTime: false, loop: null });
      player.play(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const makeAi = async () => {
    if (!track.file && !track.demo) return;
    setErr(null);
    setAiBusy("Envoi…");
    try {
      const src = track.file ?? bufferToWavBlob(track.buffer, 16);
      const job = await startJob("generate", { audio: src }, { style: aiStyle, prompt: aiPrompt, strength: aiStrength, bpm: Math.round(bpm), key: `${NOTE_NAMES[key.tonic]} ${key.mode}`, duration: Math.min(240, Math.round(features.meta.duration)) });
      const done = await waitJob(job, (j) => setAiBusy(j.message ?? `Génération… ${Math.round(j.progress * 100)} %`));
      const files = done.result?.files ?? [];
      for (const [i, f] of files.entries()) {
        const blob = await (await fetch(fileUrl(f.url))).blob();
        const buf = await decodeFile(blob);
        const r: Rendered = { id: `ai-${job.id}-${i}`, label: `IA · ${aiStyle}`, detail: `${f.label ?? `variante ${i + 1}`} · ${formatTime(buf.duration)}`, buffer: buf, createdAt: Date.now(), kind: "ai" };
        player.set(r.id, buf);
        addRendered(r);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(null);
    }
  };

  const list = rendered.filter((r) => r.kind === "version" || r.kind === "ai");
  return (
    <div className="page">
      <PageHead kicker="05 · Versions virales" title={<>Les formats qui <span className="serif italic">tournent</span>.</>}>
        Sped up, slowed + reverb, 8D, extrait calé sur les mesures : les déclinaisons que les labels sortent désormais comme des singles. Rendu local{mastered ? " à partir de ton master" : ""}, loudness réalignée.
      </PageHead>

      <div className="versions">
        {VERSION_SPECS.map((s) => {
          const v = values[s.id];
          const speed = s.id === "spedup" || s.id === "nightcore" || s.id === "slowed";
          const semis = speed ? 12 * Math.log2(v) : 0;
          const newKey = speed ? NOTE_NAMES[(((key.tonic + Math.round(semis)) % 12) + 12) % 12] + (key.mode === "minor" ? "m" : "") : null;
          const made = rendered.find((r) => r.id === `v-${s.id}`);
          return (
            <article key={s.id} className="version">
              <header>
                <h4>{s.label}</h4>
                {made && <Chip tone="green">prêt</Chip>}
              </header>
              <p className="muted">{s.hint}</p>
              {s.param && (
                <label className="slider">
                  <span className="slider__head">
                    <span className="label">{s.param.label}</span>
                    <span className="mono">
                      {v.toFixed(s.param.step < 1 ? 2 : 0)}
                      {s.param.unit}
                    </span>
                  </span>
                  <input type="range" min={s.param.min} max={s.param.max} step={s.param.step} value={v} onChange={(e) => setValues({ ...values, [s.id]: Number(e.target.value) })} />
                </label>
              )}
              {speed && (
                <p className="mono faint version__meta">
                  {Math.round(bpm * v)} BPM · {semis >= 0 ? "+" : ""}{semis.toFixed(1)} demi-tons · ≈ {newKey}
                </p>
              )}
              {(s.id === "tiktok" || s.id === "loop") && (
                <p className="mono faint version__meta">
                  {formatTime(clip.start)}–{formatTime(clip.end)} · {clip.bars} mesures · boucle {Math.round(clip.loopScore * 100)} %
                </p>
              )}
              <div className="version__actions">
                <Button size="sm" variant={made ? "ghost" : "primary"} onClick={() => make(s.id)} disabled={!!busy}>
                  {busy === s.id ? "Rendu…" : made ? "Refaire" : "Générer"}
                </Button>
                {made && (
                  <>
                    <Button size="sm" variant="quiet" icon={snap.sourceId === made.id && snap.playing ? "pause" : "play"} onClick={() => (snap.sourceId === made.id && snap.playing ? player.pause() : (player.use(made.id, { keepTime: false, loop: null }), player.play(0)))} />
                    <Button size="sm" variant="quiet" icon="download" onClick={() => downloadBlob(bufferToWavBlob(made.buffer, 24), `${baseName(track.name)} (${s.label}).wav`)} />
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {err && <p className="error">{err}</p>}

      <Panel index="A" title="Remix IA dans un autre genre" aside={<Chip tone="violet">ACE-Step · serveur</Chip>}>
        <EngineGate engine="generate" what="La génération de versions IA utilise ACE-Step 1.5 (open source, MIT) sur le serveur Viral Cyb, avec GPU recommandé.">
          <p className="muted">Ton morceau sert de source : l'IA garde la structure et la mélodie, et réinterprète la production dans le style choisi. Plus l'intensité est basse, plus on reste proche de l'original.</p>
          <div className="stylechips" role="radiogroup" aria-label="Style">
            {AI_STYLES.map((s) => (
              <button key={s} role="radio" aria-checked={aiStyle === s} className={`stylechip${aiStyle === s ? " is-on" : ""}`} onClick={() => setAiStyle(s)}>
                {s}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="label">Précisions (optionnel)</span>
            <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="ex. basse 808 glissée, piano feutré, voix féminine aérienne" />
          </label>
          <label className="slider">
            <span className="slider__head">
              <span className="label">Intensité de la transformation</span>
              <span className="mono">{Math.round(aiStrength * 100)} %</span>
            </span>
            <input type="range" min={0.15} max={0.9} step={0.05} value={aiStrength} onChange={(e) => setAiStrength(Number(e.target.value))} />
          </label>
          <div className="actions">
            <Button variant="primary" icon="spark" onClick={makeAi} disabled={!!aiBusy}>
              Générer la version {aiStyle}
            </Button>
            {aiBusy && <Progress label={aiBusy} />}
          </div>
        </EngineGate>
      </Panel>

      {list.length > 0 && (
        <Panel index="B" title="Tes rendus" aside={<span className="label">{list.length}</span>}>
          <ul className="renders">
            {list.map((r) => {
              const on = snap.sourceId === r.id && snap.playing;
              return (
                <li key={r.id}>
                  <button className="renders__play" onClick={() => (on ? player.pause() : (player.use(r.id, { keepTime: false, loop: null }), player.play(0)))} aria-label={on ? "Pause" : "Lecture"}>
                    <Icon name={on ? "pause" : "play"} size={16} />
                  </button>
                  <div>
                    <strong>{r.label}</strong>
                    <span className="mono faint">{r.detail}</span>
                  </div>
                  <Button size="sm" variant="quiet" icon="download" onClick={() => downloadBlob(bufferToWavBlob(r.buffer, 24), `${baseName(track.name)} (${r.label}).wav`)} />
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="close"
                    onClick={() => {
                      player.remove(r.id);
                      removeRendered(r.id);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
