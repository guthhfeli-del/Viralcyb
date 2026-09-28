import { useEffect, useRef, useState } from "react";
import { DEMUCS_MODEL_MB, DEMUCS_MODEL_URL, isCached, isolated, separateInBrowser, transcribeNotes, webGpuAvailable } from "../lib/ml";
import { notesToMidi } from "../dsp/midi";
import { useStore, type Rendered } from "../state/store";
import { dsp } from "../lib/dsp";
import { audioContext, bufferFrom, decodeFile } from "../lib/audio";
import { fileUrl, startJob, waitJob } from "../lib/api";
import { baseName, bufferToWavBlob, downloadBlob } from "../lib/download";
import { player } from "../lib/player";
import { Button, Chip, PageHead, Panel, Progress, Segmented } from "../ui/Bits";
import { EngineGate } from "../ui/EngineGate";
import { Icon } from "../ui/Icon";

interface Stem {
  id: string;
  label: string;
  buffer: AudioBuffer;
}

const STEM_LABELS: Record<string, string> = {
  vocals: "Voix",
  drums: "Batterie",
  bass: "Basse",
  guitar: "Guitare",
  piano: "Piano",
  other: "Autres",
  instrumental: "Instrumental",
  center: "Centre (≈ voix)",
  sides: "Côtés (≈ instru)",
};

/** Multitrack mixer: plays all stems in sync with per-stem gain/mute/solo. */
function useStemMixer(stems: Stem[]) {
  const [playing, setPlaying] = useState(false);
  const [state, setState] = useState<Record<string, { gain: number; mute: boolean; solo: boolean }>>({});
  const nodes = useRef<{ src: AudioBufferSourceNode; gain: GainNode; id: string }[]>([]);
  const started = useRef({ at: 0, offset: 0 });

  useEffect(() => {
    setState(Object.fromEntries(stems.map((s) => [s.id, { gain: 1, mute: false, solo: false }])));
  }, [stems]);

  const effective = (id: string, st = state) => {
    const anySolo = Object.values(st).some((x) => x.solo);
    const s = st[id];
    if (!s) return 1;
    if (s.mute || (anySolo && !s.solo)) return 0;
    return s.gain;
  };

  const stop = () => {
    const ctx = audioContext();
    if (nodes.current.length) started.current.offset += ctx.currentTime - started.current.at;
    for (const n of nodes.current) {
      try {
        n.src.stop();
      } catch {
        /* noop */
      }
      n.src.disconnect();
      n.gain.disconnect();
    }
    nodes.current = [];
    setPlaying(false);
  };

  const play = () => {
    player.pause();
    const ctx = audioContext();
    const off = started.current.offset % Math.max(1, stems[0]?.buffer.duration ?? 1);
    nodes.current = stems.map((s) => {
      const src = ctx.createBufferSource();
      src.buffer = s.buffer;
      const gain = ctx.createGain();
      gain.gain.value = effective(s.id);
      src.connect(gain).connect(ctx.destination);
      src.start(0, off);
      return { src, gain, id: s.id };
    });
    started.current = { at: ctx.currentTime, offset: off };
    setPlaying(true);
  };

  const update = (id: string, patch: Partial<{ gain: number; mute: boolean; solo: boolean }>) => {
    setState((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      for (const n of nodes.current) n.gain.gain.setTargetAtTime(effective(n.id, next), audioContext().currentTime, 0.015);
      return next;
    });
  };

  useEffect(() => () => stop(), []);
  return { playing, play, stop, state, update };
}

const STAGE_LABELS: Record<string, string> = {
  download: "Téléchargement du modèle",
  prepare: "Préparation",
  "init-gpu": "Initialisation (WebGPU)",
  "init-cpu": "Initialisation (CPU)",
  separate: "Séparation",
  transcribe: "Transcription MIDI",
};

export default function Stems() {
  const track = useStore((s) => s.track)!;
  const addRendered = useStore((s) => s.addRendered);
  const server = useStore((s) => s.server);
  const [stems, setStems] = useState<Stem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState<number | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState<"htdemucs_6s" | "htdemucs_ft" | "roformer">("htdemucs_6s");
  const [cached, setCached] = useState(false);
  const mixer = useStemMixer(stems);
  const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

  useEffect(() => {
    void isCached(DEMUCS_MODEL_URL).then(setCached);
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setErr(null);
    setBusy(label);
    setPct(undefined);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setPct(undefined);
    }
  };

  const browserSplit = () =>
    run("Séparation dans le navigateur…", async () => {
      const r = await separateInBrowser(track.buffer, (stage, p) => {
        setBusy(`${STAGE_LABELS[stage] ?? stage}${stage === "download" ? ` · ${Math.round(p * DEMUCS_MODEL_MB)} / ${DEMUCS_MODEL_MB} Mo` : ""}`);
        setPct(p);
      });
      mixer.stop();
      setStems(r.stems.map((st) => ({ id: st.id, label: STEM_LABELS[st.id], buffer: bufferFrom([st.left, st.right], r.sampleRate) })));
      setCached(true);
    });

  const quickSplit = () =>
    run("Séparation express…", async () => {
      const r = await dsp.centerCut(track.channels, track.sampleRate);
      const c = bufferFrom([r.center, r.center], track.sampleRate);
      const sd = bufferFrom(r.sides, track.sampleRate);
      mixer.stop();
      setStems([
        { id: "center", label: STEM_LABELS.center, buffer: c },
        { id: "sides", label: STEM_LABELS.sides, buffer: sd },
      ]);
    });

  const serverSplit = () =>
    run("Envoi du morceau…", async () => {
      const src = track.file ?? bufferToWavBlob(track.buffer, 16);
      const job = await startJob("stems", { audio: src }, { model });
      const done = await waitJob(job, (j) => {
        setBusy(j.message ?? "Séparation…");
        setPct(j.progress);
      });
      const out: Stem[] = [];
      for (const f of done.result?.files ?? []) {
        setBusy(`Téléchargement : ${f.label ?? f.name}`);
        const blob = await (await fetch(fileUrl(f.url))).blob();
        const buf = await decodeFile(blob);
        const id = (f.label ?? f.name).toLowerCase().replace(/\.[a-z0-9]+$/, "");
        out.push({ id, label: STEM_LABELS[id] ?? id, buffer: buf });
      }
      mixer.stop();
      setStems(out);
    });

  const toMidi = (s: Stem) =>
    run(`MIDI · ${s.label}…`, async () => {
      const notes = await transcribeNotes(s.buffer, (stage, p) => {
        setBusy(`${STAGE_LABELS[stage] ?? stage} · ${s.label}`);
        setPct(p);
      });
      if (!notes.length) throw new Error("Aucune note détectée sur ce stem.");
      const bpm = useStore.getState().features?.rhythm.bpm ?? 120;
      downloadBlob(new Blob([notesToMidi(notes, Math.round(bpm), `${s.label}`) as Uint8Array<ArrayBuffer>], { type: "audio/midi" }), `${baseName(track.name)} - ${s.label}.mid`);
    });

  const sendToPlayer = (s: Stem) => {
    const r: Rendered = { id: `stem-${s.id}`, label: `Stem · ${s.label}`, detail: "stem", buffer: s.buffer, createdAt: Date.now(), kind: "stem" };
    player.set(r.id, s.buffer);
    addRendered(r);
    mixer.stop();
    player.use(r.id, { keepTime: false, loop: null });
    player.play(0);
  };

  return (
    <div className="page">
      <PageHead kicker="06 · Stems" title={<>Chaque instrument, <span className="serif italic">séparé</span>.</>}>
        Isole la voix, la batterie, la basse et le reste pour remixer, refaire le mix, sortir une a cappella ou une instru — puis convertis n'importe quel stem en MIDI.
      </PageHead>

      <Panel index="A" title="Séparation IA dans ton navigateur" aside={<Chip tone="green">Demucs · sans serveur</Chip>}>
        <p className="muted">
          Le modèle HT-Demucs de Meta tourne directement sur ton appareil ({webGpuAvailable() ? "accéléré par la carte graphique (WebGPU)" : "sur le processeur"}) : rien n'est envoyé. 4 stems : voix, batterie, basse, autres.{" "}
          {cached ? "Modèle déjà en cache." : `Premier lancement : téléchargement du modèle (${DEMUCS_MODEL_MB} Mo), ensuite il reste en cache.`}
        </p>
        {mobile && <p className="warnline">Sur téléphone, la séparation est lente et gourmande en mémoire : préfère un ordinateur ou le serveur.</p>}
        <div className="actions">
          <Button variant="primary" icon="stems" onClick={browserSplit} disabled={!!busy}>
            Séparer en 4 stems
          </Button>
          <Button variant="quiet" onClick={quickSplit} disabled={!!busy}>
            Séparation express (centre / côtés)
          </Button>
        </div>
        <p className="faint footnote">
          Compte 30 s à 1 min avec WebGPU, 2 à 4 min sans, pour un titre de 3 min.{!isolated() && " Astuce : sers l'app avec les en-têtes COOP/COEP (déjà configurés) pour activer le multi-thread."}
        </p>
      </Panel>

      <Panel index="B" title="Séparation serveur" aside={<Chip tone="violet">6 stems · RoFormer</Chip>}>
        <EngineGate engine="stems" what="Pour 6 stems (guitare et piano en plus) ou la voix la plus propre (BS-RoFormer), le serveur Viral Cyb utilise python-audio-separator (Demucs v4, RoFormer — MIT). GPU recommandé.">
          <Segmented
            value={model}
            onChange={setModel}
            ariaLabel="Modèle"
            options={[
              { value: "htdemucs_6s", label: "6 stems · Demucs" },
              { value: "htdemucs_ft", label: "4 stems · Demucs fine-tuned" },
              { value: "roformer", label: "Voix / instru · RoFormer" },
            ]}
          />
          <div className="actions">
            <Button variant="primary" icon="server" onClick={serverSplit} disabled={!!busy}>
              Séparer sur le serveur
            </Button>
          </div>
          <p className="faint">{server.engines.stems?.detail}</p>
        </EngineGate>
      </Panel>

      {busy && <Progress value={pct} label={busy} />}
      {err && <p className="error">{err}</p>}

      {stems.length > 0 && (
        <Panel index="C" title="Mixeur de stems" aside={<Button size="sm" variant={mixer.playing ? "ghost" : "primary"} icon={mixer.playing ? "pause" : "play"} onClick={mixer.playing ? mixer.stop : mixer.play}>{mixer.playing ? "Pause" : "Lire ensemble"}</Button>} className="rise">
          <ul className="stems">
            {stems.map((s) => {
              const st = mixer.state[s.id] ?? { gain: 1, mute: false, solo: false };
              return (
                <li key={s.id} className="stem">
                  <span className="stem__name">{s.label}</span>
                  <input type="range" min={0} max={1.5} step={0.01} value={st.gain} onChange={(e) => mixer.update(s.id, { gain: Number(e.target.value) })} aria-label={`Volume ${s.label}`} />
                  <button className={`stem__btn${st.mute ? " is-on" : ""}`} onClick={() => mixer.update(s.id, { mute: !st.mute })} aria-pressed={st.mute}>M</button>
                  <button className={`stem__btn stem__btn--solo${st.solo ? " is-on" : ""}`} onClick={() => mixer.update(s.id, { solo: !st.solo })} aria-pressed={st.solo}>S</button>
                  <button className="iconbtn" onClick={() => sendToPlayer(s)} title="Écouter seul dans le lecteur (et tester sur les supports)">
                    <Icon name="headphones" size={16} />
                  </button>
                  <button className="iconbtn stem__midi" onClick={() => void toMidi(s)} disabled={!!busy} title="Convertir en MIDI (Basic Pitch, dans le navigateur)">
                    MIDI
                  </button>
                  <button className="iconbtn" onClick={() => downloadBlob(bufferToWavBlob(s.buffer, 24), `${baseName(track.name)} - ${s.label}.wav`)} title="Télécharger">
                    <Icon name="download" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
