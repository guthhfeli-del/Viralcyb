import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { useAdvice, useGenre } from "../state/hooks";
import { tonalBalance } from "../dsp/tonal";
import { genreById } from "../engine/genres";
import { ToneChart } from "../ui/Charts";
import { Bar, Chip, PageHead, Panel, Segmented, Stat } from "../ui/Bits";
import { BlueprintStrip, Sparkline, StructureStrip } from "../ui/Structure";
import { fmt, formatTime } from "../dsp/util";

export default function Mix() {
  const features = useStore((s) => s.features);
  const advice = useAdvice();
  const g = useGenre();
  const [area, setArea] = useState<"all" | "mix" | "master" | "stéréo" | "voix" | "structure">("all");
  const profile = genreById(g.id);
  const tb = useMemo(() => (features ? tonalBalance(features.spectrum, profile.family) : null), [features, profile.family]);
  if (!features || !advice || !tb) return <div className="page-loading" />;
  const L = features.loudness;
  const st = features.stereo;
  const items = advice.mix.filter((a) => area === "all" || a.area === area);
  const maxBp = Math.max(features.meta.duration, ...advice.blueprints.map((b) => b.duration));
  const lufsTone = L.integrated >= profile.lufs.min && L.integrated <= profile.lufs.max ? "good" : "warn";

  return (
    <div className="page">
      <PageHead kicker={`02 · Mix & structure · référence ${g.label}`} title={<>Ce qu'il faut <span className="serif italic">toucher</span>.</>}>
        Chaque conseil est chiffré : fréquence, gain, réglage. Les cibles viennent des moyennes de productions commerciales du genre choisi en haut de page.
      </PageHead>

      <Panel index="A" title="Actions prioritaires" aside={<span className="label">{advice.mix.length} points</span>}>
        <div className="filters">
          <Segmented
            size="sm"
            value={area}
            onChange={setArea}
            ariaLabel="Filtrer"
            options={[
              { value: "all", label: "Tout" },
              { value: "mix", label: "Mix" },
              { value: "voix", label: "Voix" },
              { value: "stéréo", label: "Stéréo" },
              { value: "master", label: "Master" },
              { value: "structure", label: "Structure" },
            ]}
          />
        </div>
        {items.length === 0 ? (
          <p className="muted">Rien à signaler dans cette catégorie.</p>
        ) : (
          <ul className="advice">
            {items.map((a) => (
              <li key={a.id} className={`advice__item sev-${a.severity}`}>
                <span className="advice__sev" aria-label={`priorité ${a.severity}`} />
                <div className="advice__main">
                  <div className="advice__title">
                    <strong>{a.title}</strong>
                    <Chip>{a.area}</Chip>
                  </div>
                  <p className="muted">{a.detail}</p>
                  <p className="advice__action">
                    <span className="mono">→</span> {a.action}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel index="B" title="Équilibre tonal" aside={<span className="label">pente {tb.tiltDbPerOct.toFixed(1)} dB/oct</span>}>
        <ToneChart tb={tb} />
        <div className="legend">
          <span><i className="legend__line" /> ton son</span>
          <span><i className="legend__band" /> cible {g.label} ±3 dB</span>
          <span><i className="legend__dot legend__dot--warn" /> excès</span>
          <span><i className="legend__dot legend__dot--violet" /> manque</span>
        </div>
        <ul className="bands">
          {tb.bands.map((b) => {
            const d = b.deviation;
            const tone = Math.abs(d) < 2 ? "" : d > 0 ? "warn" : "violet";
            return (
              <li key={b.id}>
                <span className="label">{b.label}</span>
                <span className={`mono bands__dev${tone ? ` tone-${tone === "warn" ? "warn" : "accent"}` : ""}`}>{d > 0 ? "+" : ""}{d.toFixed(1)} dB</span>
                <span className="faint mono bands__share">{b.share.toFixed(0)} %</span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel index="C" title="Loudness & dynamique" aside={<span className="label">EBU R128 · BS.1770-4</span>}>
        <div className="statgrid">
          <Stat label="Intégré" value={fmt(L.integrated)} unit="LUFS" tone={lufsTone} hint={`cible ${profile.lufs.min} à ${profile.lufs.max}`} />
          <Stat label="Court terme max" value={fmt(L.shortTermMax)} unit="LUFS" />
          <Stat label="True peak" value={L.truePeak.toFixed(1)} unit="dBTP" tone={L.truePeak > -1 ? "bad" : "good"} hint="≤ −1 dBTP" />
          <Stat label="LRA" value={L.lra.toFixed(1)} unit="LU" hint="plage de loudness" />
          <Stat label="PLR" value={fmt(L.plr)} unit="dB" tone={L.plr < 6 ? "warn" : undefined} hint="punch : 6–12 dB" />
          <Stat label="Clipping" value={L.clippedSamples} unit="éch." tone={L.clippedSamples > 0 ? "bad" : "good"} />
        </div>
        <div className="sparkwrap">
          <span className="label">Loudness court terme (3 s) sur la durée</span>
          <Sparkline values={L.shortTerm} min={-40} max={-4} band={[profile.lufs.min, profile.lufs.max]} />
        </div>
      </Panel>

      <Panel index="D" title="Image stéréo">
        <div className="statgrid">
          <Stat label="Corrélation" value={st.correlation.toFixed(2)} hint="+1 mono · 0 large · −1 phase" tone={st.correlation < 0.2 ? "bad" : undefined} />
          <Stat label="Basses < 120 Hz" value={st.lowCorrelation.toFixed(2)} tone={st.lowCorrelation < 0.8 ? "warn" : "good"} hint="idéal > 0,9" />
          <Stat label="Perte en mono" value={st.monoLossDb.toFixed(1)} unit="dB" tone={st.monoLossDb < -2 ? "bad" : "good"} />
          <Stat label="Balance G/D" value={`${st.balanceDb >= 0 ? "+" : ""}${st.balanceDb.toFixed(1)}`} unit="dB" />
        </div>
        <ul className="widths">
          {st.widthByBand.map((w) => (
            <li key={w.label}>
              <span className="label">{w.label}</span>
              <Bar value={w.width * 100} max={50} tone="violet" />
              <span className="mono faint">{Math.round(w.width * 100)} %</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel index="E" title="Structure" aside={<span className="label">calée sur {Math.round(features.rhythm.bpm)} BPM</span>}>
        <div className="bp">
          <div className="bp__row">
            <div className="bp__head">
              <strong>Ta structure actuelle</strong>
              <span className="mono faint">{formatTime(features.meta.duration)}</span>
            </div>
            <div style={{ width: `${(features.meta.analysedDuration / maxBp) * 100}%` }}>
              <StructureStrip sections={features.structure.sections} duration={features.meta.analysedDuration} />
            </div>
          </div>
          {advice.blueprints.map((b) => (
            <div key={b.id} className="bp__row">
              <div className="bp__head">
                <strong>{b.title}</strong>
                <span className="mono faint">{formatTime(b.duration)}</span>
              </div>
              <div style={{ width: `${(b.duration / maxBp) * 100}%` }}>
                <BlueprintStrip bp={b} total={b.duration} />
              </div>
              <p className="muted bp__why">{b.why}</p>
              <details className="bp__details">
                <summary className="label">Détail mesure par mesure</summary>
                <ol>
                  {b.parts.map((p, i) => (
                    <li key={i}>
                      <span className="mono faint">{formatTime(p.start)}</span>
                      <span>{p.name}</span>
                      <span className="mono faint">{p.bars} mes.</span>
                      <span className="faint">{p.note ?? ""}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          ))}
        </div>
      </Panel>

      <Panel index="F" title="Idées de mixage & de production">
        <div className="ideas">
          {advice.ideas.map((i, k) => (
            <article key={k} className="idea">
              <span className="label">{i.tag}</span>
              <h4>{i.title}</h4>
              <p className="muted">{i.detail}</p>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
