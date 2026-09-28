import { useState } from "react";
import { useStore } from "../state/store";
import { useDisplayBpm, useGenre, useVirality } from "../state/hooks";
import { Gauge } from "../ui/Gauge";
import { Waveform } from "../ui/Waveform";
import { TimbreMap } from "../ui/Charts";
import { Bar, Button, Panel, Stat, scoreTone } from "../ui/Bits";
import { player } from "../lib/player";
import { usePlayer } from "../lib/usePlayer";
import { fmt, formatTime } from "../dsp/util";
import { hookTime } from "../engine/virality";

export default function Score() {
  const features = useStore((s) => s.features);
  const setPage = useStore((s) => s.setPage);
  const v = useVirality();
  const g = useGenre();
  const bpm = useDisplayBpm();
  const snap = usePlayer();
  const [open, setOpen] = useState<string | null>(null);
  if (!features || !v) return <div className="page-loading" />;
  const s = features.structure;
  const clip = s.clips.tiktok;
  const playRegion = (start: number, end: number) => {
    player.use("orig", { loop: { start, end } });
    player.play(start);
  };
  const loopOn = snap.loop && Math.abs(snap.loop.start - clip.start) < 0.01;
  return (
    <div className="page page--score">
      <section className="scorehero rise">
        <div className="scorehero__dial">
          <Gauge value={v.score} size={272} label="/ 100" />
        </div>
        <div className="scorehero__text">
          <span className="label">Score viral · référence {g.label}</span>
          <h1 className="scorehero__grade serif">
            <span className="italic">{v.grade}</span>
          </h1>
          <p className="muted scorehero__summary">{v.summary}</p>
          <ol className="levers">
            {v.levers.map((l, i) => (
              <li key={l.id}>
                <span className="mono levers__n">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{l.label}</strong>
                  <p className="muted">{l.tip}</p>
                </div>
                <span className="levers__gain mono">+{Math.round((l.weight * (100 - l.score)) / 100)} pts</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="facts rise" style={{ animationDelay: "80ms" }}>
        <Stat label="Accroche" value={hookTime(features).toFixed(1)} unit="s" tone={hookTime(features) <= 5 ? "good" : hookTime(features) <= 10 ? "warn" : "bad"} />
        <Stat label="Tempo" value={Math.round(bpm ?? features.rhythm.bpm)} unit="BPM" hint={features.rhythm.confidence < 0.2 ? "incertain" : undefined} />
        <Stat label="Tonalité" value={features.key.short} hint={`${features.key.nameFr} · ${features.key.camelot}`} />
        <Stat label="Loudness" value={fmt(features.loudness.integrated)} unit="LUFS" />
        <Stat label="Hook" value={`${s.hook.occurrences.length}×`} hint={`dès ${formatTime(s.firstHookTime)}`} tone="accent" />
        <Stat label="Durée" value={formatTime(features.meta.duration)} />
      </div>

      <Panel index="A" title="Timeline" aside={<span className="label">{s.sections.length} sections · hook ▲</span>} className="rise">
        <div className="timeline">
          <Waveform features={features} height={150} clip={clip} />
          <TimbreMap map={features.timbreMap} height={36} />
        </div>
        <div className="timeline__actions">
          <Button variant="accent" icon={loopOn && snap.playing ? "pause" : "loop"} onClick={() => (loopOn && snap.playing ? player.pause() : playRegion(clip.start, clip.end))}>
            Extrait TikTok {formatTime(clip.start)}–{formatTime(clip.end)}
          </Button>
          <Button icon="play" onClick={() => playRegion(s.hook.start, s.hook.end)}>
            Hook {formatTime(s.hook.start)}
          </Button>
          <Button icon="play" onClick={() => playRegion(s.clips.micro.start, s.clips.micro.end)}>
            Boucle 7 s
          </Button>
          {snap.loop && (
            <Button variant="quiet" onClick={() => player.setLoop(null)}>
              Sortir de la boucle
            </Button>
          )}
        </div>
        <ul className="landmarks">
          <li><span className="label">Intro</span><span className="mono">{s.introLength > 0 ? `${s.introLength.toFixed(1)} s` : "aucune"}</span></li>
          <li><span className="label">1re voix</span><span className="mono">{Number.isFinite(s.firstVocalTime) ? formatTime(s.firstVocalTime) : "—"}</span></li>
          <li><span className="label">Plein régime</span><span className="mono">{formatTime(s.firstFullEnergyTime)}</span></li>
          <li><span className="label">Drops</span><span className="mono">{s.drops.length ? s.drops.map(formatTime).join(" · ") : "—"}</span></li>
          <li><span className="label">Lift refrain</span><span className="mono">{Number.isFinite(s.chorusLift) ? `${s.chorusLift >= 0 ? "+" : ""}${s.chorusLift.toFixed(1)} LU` : "—"}</span></li>
          <li><span className="label">Répétition</span><span className="mono">{Math.round(s.repetition * 100)} %</span></li>
        </ul>
      </Panel>

      <Panel index="B" title="Les 9 critères" aside={<span className="label">pondération</span>} className="rise">
        <ul className="criteria">
          {v.criteria.map((c) => {
            const isOpen = open === c.id;
            const tone = scoreTone(c.score);
            return (
              <li key={c.id} className={`criteria__row${isOpen ? " is-open" : ""}`}>
                <button className="criteria__head" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                  <span className="criteria__name">{c.label}</span>
                  <span className="criteria__value mono faint">{c.value}</span>
                  <span className="criteria__bar">
                    <Bar value={c.score} tone={tone === "good" ? "green" : tone === "warn" ? "warn" : "bad"} />
                  </span>
                  <span className={`criteria__score mono tone-${tone}`}>{c.score}</span>
                  <span className="criteria__w label">×{c.weight}</span>
                </button>
                {isOpen && (
                  <div className="criteria__body">
                    <p className="muted">{c.detail}</p>
                    <p className="criteria__tip">
                      <span className="label">À faire</span> {c.tip}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="footnote faint">
          Le score mesure la préparation du son aux usages viraux (accroche, répétition, rendu téléphone…). Il ne prédit pas les streams : la sortie, le timing et la communauté comptent autant.
        </p>
      </Panel>

      <div className="nextsteps rise">
        <button onClick={() => setPage("mix")}><span className="label">Suite</span><span>Conseils de mix & structure →</span></button>
        <button onClick={() => setPage("devices")}><span className="label">Suite</span><span>Tester sur téléphone, voiture, club →</span></button>
        <button onClick={() => setPage("master")}><span className="label">Suite</span><span>Masteriser pour TikTok →</span></button>
      </div>
    </div>
  );
}
