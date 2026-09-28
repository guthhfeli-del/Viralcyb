import { useEffect, useRef, useState } from "react";
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

export default function Stems() {
  const track = useStore((s) => s.track)!;
  const addRendered = useStore((s) => s.addRendered);
  const server = useStore((s) => s.server);
  const [stems, setStems] = useState<Stem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState<"htdemucs_6s" | "htdemucs_ft" | "roformer">("htdemucs_6s");
  const mixer = useStemMixer(stems);

  const quickSplit = async () => {
    setErr(null);
    setBusy("Séparation rapide (locale)…");
    try {
      const r = await dsp.centerCut(track.channels, track.sampleRate);
      const c = bufferFrom([r.center, r.center], track.sampleRate);
      const s = bufferFrom(r.sides, track.sampleRate);
      mixer.stop();
      setStems([
        { id: "center", label: STEM_LABELS.center, buffer: c },
        { id: "sides", label: STEM_LABELS.sides, buffer: s },
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const serverSplit = async () => {
    setErr(null);
    setBusy("Envoi du morceau…");
    try {
      const src = track.file ?? bufferToWavBlob(track.buffer, 16);
      const job = await startJob("stems", { audio: src }, { model });
      const done = await waitJob(job.id, (j) => setBusy(j.message ?? `Séparation… ${Math.round(j.progress * 100)} %`));
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

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
        Isole la voix, la batterie, la basse, la guitare, le piano et le reste pour remixer, refaire le mix ou préparer une version a cappella / instrumentale.
      </PageHead>

      <Panel index="A" title="Séparation IA" aside={<Chip tone="violet">Demucs · RoFormer</Chip>}>
        <EngineGate
          engine="stems"
          what="La séparation haute qualité utilise Demucs v4 (htdemucs, Meta — MIT) et BS-RoFormer via python-audio-separator (MIT) sur le serveur Viral Cyb."
          fallback={
            <div className="gate__fallback">
              <p className="muted">En attendant, la séparation rapide locale extrait le centre stéréo (voix + éléments centrés) et les côtés.</p>
              <Button icon="stems" onClick={quickSplit} disabled={!!busy}>
                Séparation rapide (locale)
              </Button>
            </div>
          }
        >
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
            <Button variant="primary" icon="stems" onClick={serverSplit} disabled={!!busy}>
              Séparer les stems
            </Button>
            <Button variant="quiet" onClick={quickSplit} disabled={!!busy}>
              Séparation rapide locale
            </Button>
          </div>
          <p className="faint">{server.engines.stems?.detail}</p>
        </EngineGate>
        {busy && <Progress label={busy} />}
        {err && <p className="error">{err}</p>}
      </Panel>

      {stems.length > 0 && (
        <Panel index="B" title="Mixeur de stems" aside={<Button size="sm" variant={mixer.playing ? "ghost" : "primary"} icon={mixer.playing ? "pause" : "play"} onClick={mixer.playing ? mixer.stop : mixer.play}>{mixer.playing ? "Pause" : "Lire ensemble"}</Button>} className="rise">
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
