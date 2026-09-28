import { useStore } from "../state/store";
import { usePlayer } from "../lib/usePlayer";
import { player } from "../lib/player";
import { Icon } from "./Icon";
import { formatTime } from "../dsp/util";
import { DEVICES } from "../engine/devices";
import { Waveform } from "./Waveform";

export function PlayerBar() {
  const track = useStore((s) => s.track);
  const features = useStore((s) => s.features);
  const mastered = useStore((s) => s.mastered);
  const rendered = useStore((s) => s.rendered);
  const setPage = useStore((s) => s.setPage);
  const snap = usePlayer();
  if (!track) return null;
  const device = DEVICES.find((d) => d.id === snap.device)!;
  const sourceLabel =
    snap.sourceId === "orig" ? "Original" : snap.sourceId === "master" ? "Master" : rendered.find((r) => r.id === snap.sourceId)?.label ?? snap.sourceId;
  return (
    <div className="playerbar" role="region" aria-label="Lecteur">
      <button className="playerbar__play" onClick={() => player.toggle()} aria-label={snap.playing ? "Pause" : "Lecture"}>
        <Icon name={snap.playing ? "pause" : "play"} size={20} />
      </button>
      <div className="playerbar__meta">
        <span className="playerbar__title">{track.name}</span>
        <span className="label tnum">
          {formatTime(snap.time)} / {formatTime(snap.duration || track.duration)}
          {snap.loop && " · boucle"}
        </span>
      </div>
      <div className="playerbar__wave">{features && (snap.sourceId === "orig" || snap.sourceId === "master") ? <Waveform features={features} height={36} showSections={false} showHook={false} compact /> : <div className="playerbar__line" />}</div>
      <div className="playerbar__ab" role="group" aria-label="Source">
        <button className={snap.sourceId === "orig" ? "is-on" : ""} onClick={() => player.use("orig")}>A</button>
        <button className={snap.sourceId === "master" ? "is-on" : ""} onClick={() => mastered && player.use("master")} disabled={!mastered} title={mastered ? "Master" : "Aucun master pour l'instant"}>B</button>
      </div>
      <button className="playerbar__device" onClick={() => setPage("devices")} title="Changer de support d'écoute">
        <Icon name="headphones" size={16} />
        <span className="label">{device.short}</span>
      </button>
      {snap.sourceId !== "orig" && snap.sourceId !== "master" && <span className="playerbar__src label">{sourceLabel}</span>}
    </div>
  );
}
