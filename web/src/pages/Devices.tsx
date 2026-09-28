import { useEffect, useMemo } from "react";
import { useStore } from "../state/store";
import { useGenre } from "../state/hooks";
import { DEVICES, deviceReport, deviceResponseCurve, type DeviceId } from "../engine/devices";
import { genreById } from "../engine/genres";
import { player } from "../lib/player";
import { usePlayer } from "../lib/usePlayer";
import { ResponseCurve } from "../ui/Charts";
import { Button, PageHead, Panel, Segmented, scoreTone } from "../ui/Bits";

export default function Devices() {
  const features = useStore((s) => s.features);
  const mastered = useStore((s) => s.mastered);
  const rendered = useStore((s) => s.rendered);
  const g = useGenre();
  const snap = usePlayer();
  const family = genreById(g.id).family;
  const reports = useMemo(() => (features ? DEVICES.map((d) => deviceReport(features, d, family)) : []), [features, family]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      const n = Number(e.key);
      if (n >= 1 && n <= DEVICES.length) player.setDevice(DEVICES[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!features) return <div className="page-loading" />;
  const current = DEVICES.find((d) => d.id === snap.device)!;
  const rep = reports.find((r) => r.id === snap.device)!;
  const avg = Math.round(reports.filter((r) => r.id !== "studio").reduce((a, r) => a + r.score, 0) / (reports.length - 1));
  const select = (id: DeviceId) => {
    player.setDevice(id);
    if (!snap.playing) player.play();
  };
  const sources = [
    { value: "orig", label: "Original" },
    ...(mastered ? [{ value: "master", label: "Master" }] : []),
    ...rendered.filter((r) => r.kind !== "stem").slice(0, 3).map((r) => ({ value: r.id, label: r.label })),
  ];

  return (
    <div className="page">
      <PageHead kicker="03 · Test supports" title={<>Écoute-le <span className="serif italic">partout</span>.</>}>
        Simulation en temps réel des haut-parleurs et des environnements où ton son sera vraiment écouté. Raccourcis clavier 1 à {DEVICES.length}, espace pour lecture/pause.
      </PageHead>

      <div className="devices-top">
        <div>
          <span className="label">Traduction moyenne</span>
          <p className={`devices-top__score serif tone-${scoreTone(avg)}`}>{avg}<span className="mono">/100</span></p>
        </div>
        {sources.length > 1 && <Segmented size="sm" value={snap.sourceId} onChange={(v) => player.use(v)} options={sources} ariaLabel="Source" />}
      </div>

      <div className="devices">
        {DEVICES.map((d, i) => {
          const r = reports[i];
          const on = snap.device === d.id;
          return (
            <button key={d.id} className={`device${on ? " is-on" : ""}`} onClick={() => select(d.id)} aria-pressed={on}>
              <span className="device__key mono">{i + 1}</span>
              <span className="device__name">{d.label}</span>
              <span className={`device__score mono tone-${scoreTone(r.score)}`}>{d.id === "studio" ? "réf." : r.score}</span>
              {on && snap.playing && <span className="device__live" aria-hidden="true"><i /><i /><i /></span>}
            </button>
          );
        })}
      </div>

      <Panel index="A" title={current.label} aside={<Button variant={snap.playing ? "ghost" : "primary"} icon={snap.playing ? "pause" : "play"} onClick={() => player.toggle()}>{snap.playing ? "Pause" : "Écouter"}</Button>}>
        <div className="device-detail">
          <div>
            <p className="muted">{current.description}</p>
            <ul className="device-notes">
              {rep.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {current.id !== "studio" && (
              <p className="faint device-detail__low mono">
                Part du grave (40–250 Hz) : {rep.lowRetentionDb >= 0 ? "+" : ""}{rep.lowRetentionDb.toFixed(1)} dB vs studio
              </p>
            )}
          </div>
          <div className="device-detail__curve">
            <span className="label">Réponse simulée · 20 Hz → 20 kHz</span>
            <ResponseCurve points={deviceResponseCurve(current)} />
            <div className="device-detail__compare">
              <Button
                size="sm"
                variant="quiet"
                icon="headphones"
                onClick={() => player.setDevice(current.id === "studio" ? "phone" : "studio")}
              >
                {current.id === "studio" ? "Passer au téléphone" : "Revenir au studio"}
              </Button>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
