import { useStore } from "../state/store";
import { Icon } from "./Icon";
import { Button } from "./Bits";

const STEPS: { id: string; label: string; detail: string }[] = [
  { id: "decode", label: "Décodage", detail: "PCM stéréo" },
  { id: "loudness", label: "Loudness", detail: "ITU-R BS.1770 · true peak 4×" },
  { id: "spectrum", label: "Spectre & stéréo", detail: "STFT 4096 · mid/side" },
  { id: "rhythm", label: "Rythme", detail: "onsets · tempo · beats" },
  { id: "tonality", label: "Tonalité", detail: "chroma · profils K-K / Temperley" },
  { id: "structure", label: "Structure & hook", detail: "auto-similarité · répétitions" },
  { id: "ai", label: "Indices IA", detail: "pics spectraux · codec" },
];

export function AnalysisOverlay() {
  const stage = useStore((s) => s.stage);
  const progress = useStore((s) => s.progress);
  const track = useStore((s) => s.track);
  const error = useStore((s) => s.error);
  const reset = useStore((s) => s.reset);
  if (stage === "idle" || stage === "done") return null;
  const idx = STEPS.findIndex((s) => s.id === stage);
  return (
    <div className="overlay" role="status" aria-live="polite">
      <div className="overlay__inner">
        <span className="label">Analyse en cours</span>
        <h2 className="overlay__title serif">{track?.name ?? "Lecture du fichier…"}</h2>
        {stage === "error" ? (
          <div className="overlay__error">
            <p>{error ?? "L'analyse a échoué."}</p>
            <Button variant="primary" onClick={reset} icon="back">
              Revenir
            </Button>
          </div>
        ) : (
          <>
            <div className="overlay__bar">
              <div style={{ width: `${Math.max(3, progress * 100)}%` }} />
            </div>
            <ol className="overlay__steps">
              {STEPS.map((s, i) => (
                <li key={s.id} className={i < idx ? "is-done" : i === idx ? "is-on" : ""}>
                  <span className="overlay__mark">{i < idx ? <Icon name="check" size={14} /> : <span className="mono">{String(i + 1).padStart(2, "0")}</span>}</span>
                  <span>{s.label}</span>
                  <span className="label">{s.detail}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
