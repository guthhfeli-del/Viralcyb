import { useState } from "react";
import { useStore } from "../state/store";
import { startJob, waitJob } from "../lib/api";
import { bufferToWavBlob } from "../lib/download";
import { Bar, Button, Chip, PageHead, Panel, Progress } from "../ui/Bits";
import { EngineGate } from "../ui/EngineGate";
import { Gauge } from "../ui/Gauge";

interface ServerVerdict {
  probability: number;
  model: string;
  windows?: { start: number; p: number }[];
}

export default function AiDetect() {
  const track = useStore((s) => s.track)!;
  const features = useStore((s) => s.features);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ServerVerdict | null>(null);
  if (!features) return <div className="page-loading" />;
  const ai = features.ai;
  const pct = Math.round((verdict ? verdict.probability : ai.probability) * 100);
  const label = pct >= 66 ? "Probablement généré par IA" : pct >= 40 ? "Indices mitigés" : "Probablement humain";

  const deep = async () => {
    setErr(null);
    setBusy("Envoi…");
    try {
      const job = await startJob("detect", { audio: track.file ?? bufferToWavBlob(track.buffer, 16) });
      const done = await waitJob(job.id, (j) => setBusy(j.message ?? `Analyse… ${Math.round(j.progress * 100)} %`));
      setVerdict(done.result as unknown as ServerVerdict);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHead kicker="10 · Détecteur IA" title={<>Humain ou <span className="serif italic">généré</span> ?</>}>
        Les plateformes étiquettent désormais la musique générée (Deezer tague les titres 100 % IA, des charts dédiées comme SIQA exigent la transparence). Vérifie comment ton son sera perçu avant de le sortir.
      </PageHead>

      <section className="aihero rise">
        <Gauge value={pct} size={220} label={verdict ? verdict.model : "indice local"} />
        <div>
          <span className="label">{verdict ? "Modèle entraîné" : "Analyse heuristique locale"}</span>
          <h2 className="serif aihero__verdict">{label}</h2>
          <p className="muted">
            {verdict
              ? `Probabilité moyenne sur ${verdict.windows?.length ?? "plusieurs"} fenêtres analysées par ${verdict.model}.`
              : "Indices spectraux mesurés dans ton navigateur. Ce n'est pas un verdict : pour une vraie détection, lance l'analyse approfondie (modèle SONICS entraîné sur 97 000 titres Suno/Udio et humains)."}
          </p>
        </div>
      </section>

      <Panel index="A" title="Indices mesurés" aside={<Chip>{ai.level}</Chip>}>
        <ul className="cues">
          {ai.cues.map((c) => (
            <li key={c.id}>
              <div className="cues__head">
                <strong>{c.label}</strong>
                <span className="mono faint">{c.id === "bandwidth" ? `${(c.value / 1000).toFixed(1)} kHz` : c.value.toFixed(2)}</span>
              </div>
              <Bar value={c.score * 100} tone={c.score > 0.6 ? "violet" : "green"} />
              <p className="muted">{c.note}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel index="B" title="Analyse approfondie" aside={<Chip tone="violet">SONICS · serveur</Chip>}>
        <EngineGate engine="detect" what="L'analyse approfondie utilise SpecTTTra (SONICS, ICLR 2025, licence MIT) sur le serveur : un transformeur entraîné à distinguer les chansons Suno/Udio des chansons humaines.">
          <div className="actions">
            <Button variant="primary" icon="ai" onClick={deep} disabled={!!busy}>
              Lancer l'analyse SONICS
            </Button>
          </div>
          {busy && <Progress label={busy} />}
          {verdict?.windows && (
            <div className="aiwindows">
              <span className="label">Probabilité par fenêtre</span>
              <div className="aiwindows__bars">
                {verdict.windows.map((w, i) => (
                  <span key={i} title={`${w.start.toFixed(0)} s · ${Math.round(w.p * 100)} %`} style={{ height: `${Math.max(4, w.p * 100)}%`, background: w.p > 0.5 ? "var(--violet)" : "var(--green)" }} />
                ))}
              </div>
            </div>
          )}
        </EngineGate>
        {err && <p className="error">{err}</p>}
      </Panel>

      <Panel index="C" title="Ce qu'il faut savoir">
        <ul className="notes">
          <li>Aucun détecteur n'est infaillible : un mastering lourd, un MP3 basse qualité ou certains plugins peuvent imiter des artefacts d'IA, et inversement.</li>
          <li>Les modèles génératifs laissent souvent des pics spectraux fixes dans les aigus (liés à l'architecture des décodeurs), visibles même quand l'oreille ne les entend pas.</li>
          <li>Si tu utilises l'IA (stems, voix, génération), déclare-le : c'est exigé par plusieurs distributeurs et par les charts IA, et ça protège ta sortie.</li>
        </ul>
      </Panel>
    </div>
  );
}
