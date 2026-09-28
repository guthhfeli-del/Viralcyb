import { useRef, useState } from "react";
import { useStore, type Rendered } from "../state/store";
import { decodeFile } from "../lib/audio";
import { fileUrl, startJob, waitJob } from "../lib/api";
import { bufferToWavBlob, downloadBlob } from "../lib/download";
import { player } from "../lib/player";
import { micSupported } from "../lib/liveMic";
import { Button, Chip, PageHead, Panel, Progress, Segmented } from "../ui/Bits";
import { Dropzone } from "../ui/Dropzone";
import { EngineGate } from "../ui/EngineGate";
import { formatTime } from "../dsp/util";

type Clip = { name: string; blob: Blob; duration: number };

async function toClip(blob: Blob, name: string): Promise<Clip> {
  const buf = await decodeFile(blob);
  return { name, blob, duration: buf.duration };
}

export default function Voice() {
  const take = useStore((s) => s.take);
  const rendered = useStore((s) => s.rendered);
  const addRendered = useStore((s) => s.addRendered);
  const [consent, setConsent] = useState(false);
  const [ref, setRef] = useState<Clip | null>(null);
  const [src, setSrc] = useState<Clip | null>(null);
  const [srcKind, setSrcKind] = useState<"take" | "stem" | "file">(take?.buffer ? "take" : "file");
  const [pitch, setPitch] = useState(0);
  const [quality, setQuality] = useState(30);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ buffer: AudioBuffer; blob: Blob } | null>(null);
  const rec = useRef<{ stop: () => void } | null>(null);
  const vocalStem = rendered.find((r) => r.id === "stem-vocals" || r.id === "stem-center");

  const record = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        setRef(await toClip(blob, "Enregistrement micro"));
        setRecording(false);
      };
      mr.start(250);
      setRecording(true);
      const timer = setTimeout(() => mr.state !== "inactive" && mr.stop(), 30000);
      rec.current = { stop: () => { clearTimeout(timer); if (mr.state !== "inactive") mr.stop(); } };
    } catch {
      setErr("Micro inaccessible.");
    }
  };

  const sourceBlob = (): Blob | null => {
    if (srcKind === "take" && take?.buffer) return bufferToWavBlob(take.buffer, 16);
    if (srcKind === "stem" && vocalStem) return bufferToWavBlob(vocalStem.buffer, 16);
    return src?.blob ?? null;
  };

  const convert = async () => {
    const s = sourceBlob();
    if (!ref || !s || !consent) return;
    setErr(null);
    setBusy("Envoi…");
    try {
      const job = await startJob("voice", { reference: ref.blob, source: s }, { pitch, steps: quality, consent: true, f0: true });
      const done = await waitJob(job, (j) => setBusy(j.message ?? `Conversion… ${Math.round(j.progress * 100)} %`));
      const f = done.result?.files?.[0];
      if (!f) throw new Error("Aucun fichier renvoyé");
      const blob = await (await fetch(fileUrl(f.url))).blob();
      const buffer = await decodeFile(blob);
      setResult({ buffer, blob });
      const r: Rendered = { id: `voice-${job.id}`, label: "Voix convertie", detail: formatTime(buffer.duration), buffer, createdAt: Date.now(), kind: "voice" };
      player.set(r.id, buffer);
      addRendered(r);
      player.use(r.id, { keepTime: false, loop: null });
      player.play(0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const refOk = ref && ref.duration >= 3 && ref.duration <= 35;
  return (
    <div className="page">
      <PageHead kicker="09 · Clone de voix" title={<>Ta voix, <span className="serif italic">sur tout</span>.</>}>
        Enregistre 10 à 30 secondes de ta voix : n'importe quelle topline (ta prise du micro prédictif, un stem voix, une démo chantée par quelqu'un d'autre avec son accord) est rechantée avec ton timbre, en gardant la mélodie.
      </PageHead>

      <Panel index="A" title="Consentement" aside={<Chip tone={consent ? "green" : "warn"}>{consent ? "confirmé" : "requis"}</Chip>}>
        <label className="toggle consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Je confirme que la voix de référence est la mienne, ou que j'ai l'autorisation explicite de la personne. Cloner la voix d'un artiste ou d'une personne sans son accord est interdit — et les plateformes (et les charts IA comme SIQA) excluent les voix clonées non autorisées.
        </label>
      </Panel>

      <EngineGate engine="voice" what="La conversion de voix utilise Seed-VC (zéro-shot, voix chantée 44,1 kHz) sur le serveur Viral Cyb — GPU recommandé.">
        <Panel index="B" title="Voix de référence" aside={ref && <span className={`mono ${refOk ? "tone-good" : "tone-warn"}`}>{ref.duration.toFixed(1)} s</span>}>
          <p className="muted">Voix seule, sans musique ni reverb, dans une pièce calme. Chanter est mieux que parler si tu veux convertir du chant.</p>
          <div className="actions">
            {!recording ? (
              <Button icon="record" onClick={record} disabled={!micSupported() || !consent}>
                Enregistrer (30 s max)
              </Button>
            ) : (
              <Button variant="primary" icon="stop" onClick={() => rec.current?.stop()}>
                Arrêter
              </Button>
            )}
            {ref && <span className="mono faint">{ref.name}</span>}
          </div>
          <Dropzone compact label="…ou déposer un fichier de ta voix" sub="10 à 30 s idéalement" onFile={async (f) => setRef(await toClip(f, f.name))} />
          {ref && !refOk && <p className="warnline">Idéalement entre 3 et 30 secondes.</p>}
        </Panel>

        <Panel index="C" title="Topline à convertir">
          <Segmented
            value={srcKind}
            onChange={setSrcKind}
            ariaLabel="Source"
            options={[
              { value: "take", label: `Prise du micro${take?.buffer ? "" : " (vide)"}` },
              { value: "stem", label: `Stem voix${vocalStem ? "" : " (vide)"}` },
              { value: "file", label: "Fichier" },
            ]}
          />
          {srcKind === "file" && <Dropzone compact label="Déposer la voix à convertir" sub="a cappella de préférence" onFile={async (f) => setSrc(await toClip(f, f.name))} />}
          {srcKind === "file" && src && <p className="mono faint">{src.name} · {src.duration.toFixed(1)} s</p>}
          <div className="controls">
            <label className="control slider">
              <span className="slider__head">
                <span className="label">Transposition</span>
                <span className="mono">{pitch > 0 ? "+" : ""}{pitch} demi-tons</span>
              </span>
              <input type="range" min={-12} max={12} step={1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
            </label>
            <label className="control slider">
              <span className="slider__head">
                <span className="label">Qualité (étapes de diffusion)</span>
                <span className="mono">{quality}</span>
              </span>
              <input type="range" min={10} max={50} step={5} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            </label>
          </div>
          <div className="actions">
            <Button variant="primary" icon="voice" onClick={convert} disabled={!consent || !refOk || !sourceBlob() || !!busy}>
              Convertir avec ma voix
            </Button>
            {result && (
              <Button icon="download" onClick={() => downloadBlob(result.blob, "voix-convertie-viralcyb.wav")}>
                Télécharger
              </Button>
            )}
          </div>
          {busy && <Progress label={busy} />}
        </Panel>
      </EngineGate>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
