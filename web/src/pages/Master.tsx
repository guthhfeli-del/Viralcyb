import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { useGenre } from "../state/hooks";
import { PRESETS, autoEq, matchEq, type MasterSettings, type PresetId } from "../dsp/master";
import { genreById } from "../engine/genres";
import { dsp } from "../lib/dsp";
import { player } from "../lib/player";
import { usePlayer } from "../lib/usePlayer";
import { bufferFrom, decodeFile, stereoChannels } from "../lib/audio";
import { baseName, bufferToWavBlob, downloadBlob } from "../lib/download";
import { startJob, waitJob, fileUrl } from "../lib/api";
import { Button, PageHead, Panel, Progress, Segmented, Stat } from "../ui/Bits";
import { Dropzone } from "../ui/Dropzone";
import type { LoudnessReport } from "../dsp/loudness";
import type { SpectrumProfile } from "../dsp/tonal";

type Ref = { name: string; file: File; loudness: LoudnessReport; spectrum: SpectrumProfile };

export default function Master() {
  const track = useStore((s) => s.track)!;
  const features = useStore((s) => s.features);
  const mastered = useStore((s) => s.mastered);
  const setMastered = useStore((s) => s.setMastered);
  const server = useStore((s) => s.server);
  const g = useGenre();
  const snap = usePlayer();
  const family = genreById(g.id).family;
  const suggested: PresetId = g.id === "edm" ? "club" : g.id === "rnb" ? "warm" : "tiktok";
  const [preset, setPreset] = useState<PresetId>(suggested);
  const base = PRESETS[preset].settings;
  const [target, setTarget] = useState(base.targetLufs);
  const [ceiling, setCeiling] = useState(base.ceiling);
  const [useAutoEq, setUseAutoEq] = useState(true);
  const [eqStrength, setEqStrength] = useState(0.5);
  const [monoBelow, setMonoBelow] = useState(base.monoBelow);
  const [width, setWidth] = useState(base.width);
  const [saturation, setSaturation] = useState(base.saturation);
  const [matchVol, setMatchVol] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ref, setRef] = useState<Ref | null>(null);

  useEffect(() => {
    const p = PRESETS[preset].settings;
    setTarget(ref ? Math.round(ref.loudness.integrated * 10) / 10 : p.targetLufs);
    setCeiling(p.ceiling);
    setMonoBelow(p.monoBelow);
    setWidth(p.width);
    setSaturation(p.saturation);
  }, [preset, ref]);

  const eq = useMemo(() => {
    if (!features) return [];
    const corrective = ref ? matchEq(features.spectrum.thirdsRaw, ref.spectrum.thirdsRaw, eqStrength + 0.1) : useAutoEq ? autoEq(features.spectrum.thirdsRaw, family, eqStrength) : [];
    return [...corrective, ...PRESETS[preset].settings.tone];
  }, [features, ref, useAutoEq, eqStrength, family, preset]);

  useEffect(() => {
    if (mastered) player.setGain("master", matchVol ? mastered.report.lufsIn - mastered.report.lufsOut : 0);
  }, [matchVol, mastered]);

  const run = async () => {
    setErr(null);
    setBusy("Mastering en cours…");
    const settings: MasterSettings = { ...PRESETS[preset].settings, targetLufs: target, ceiling, monoBelow, width, saturation, eq };
    try {
      const r = await dsp.master(track.channels, track.sampleRate, settings);
      const buf = bufferFrom(r.channels, track.sampleRate);
      player.set("master", buf, matchVol ? r.report.lufsIn - r.report.lufsOut : 0);
      setMastered({ buffer: buf, report: r.report, preset: ref ? "reference" : preset });
      player.use("master");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const loadRef = async (file: File) => {
    setErr(null);
    setBusy("Analyse de la référence…");
    try {
      const buf = await decodeFile(file);
      const prof = await dsp.profile(stereoChannels(buf), buf.sampleRate);
      setRef({ name: file.name, file, ...prof });
    } catch {
      setErr("Impossible de lire la référence.");
    } finally {
      setBusy(null);
    }
  };

  const runMatchering = async () => {
    if (!ref || !track.file) return;
    setErr(null);
    setBusy("Matchering (serveur)…");
    try {
      const job = await startJob("master_ref", { target: track.file, reference: ref.file });
      const done = await waitJob(job.id, (j) => setBusy(`Matchering (serveur)… ${Math.round(j.progress * 100)} %`));
      const f = done.result?.files?.[0];
      if (!f) throw new Error("Aucun fichier renvoyé");
      const blob = await (await fetch(fileUrl(f.url))).blob();
      const buf = await decodeFile(blob);
      const prof = await dsp.profile(stereoChannels(buf), buf.sampleRate);
      const report = {
        lufsIn: features?.loudness.integrated ?? -20,
        lufsOut: prof.loudness.integrated,
        truePeakOut: prof.loudness.truePeak,
        gainDb: 0,
        maxGrDb: 0,
        avgGrDb: 0,
        glueGrDb: 0,
        reachedTarget: true,
        chain: ["Matchering 2.0 (serveur) — RMS, réponse en fréquence, crête et largeur stéréo alignés sur la référence"],
      };
      player.set("master", buf, matchVol ? report.lufsIn - report.lufsOut : 0);
      setMastered({ buffer: buf, report, preset: "reference" });
      player.use("master");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!features) return <div className="page-loading" />;
  const rep = mastered?.report;
  const external = !!rep && rep.chain.length === 1 && rep.chain[0].startsWith("Matchering");
  return (
    <div className="page">
      <PageHead kicker="04 · Mastering" title={<>Un master <span className="serif italic">prêt à poster</span>.</>}>
        Chaîne complète dans ton navigateur : EQ correctif, basses en mono, compression de bus, saturation douce et limiteur true-peak calé sur la loudness visée.
      </PageHead>

      <Panel index="A" title="Preset" aside={<span className="label">suggéré : {PRESETS[suggested].label}</span>}>
        <Segmented value={preset} onChange={setPreset} options={(Object.keys(PRESETS) as PresetId[]).map((id) => ({ value: id, label: PRESETS[id].label }))} ariaLabel="Preset de mastering" />
        <p className="muted preset-hint">{PRESETS[preset].hint}</p>

        <div className="controls">
          <Slider label="Loudness visée" value={target} min={-16} max={-6} step={0.5} unit="LUFS" onChange={setTarget} />
          <Slider label="Plafond true peak" value={ceiling} min={-2} max={-0.3} step={0.1} unit="dBTP" onChange={setCeiling} />
          <Slider label="Largeur stéréo" value={Math.round(width * 100)} min={80} max={130} step={1} unit="%" onChange={(v) => setWidth(v / 100)} />
          <Slider label="Saturation" value={Math.round(saturation * 100)} min={0} max={60} step={1} unit="%" onChange={(v) => setSaturation(v / 100)} />
          <Slider label="Basses mono sous" value={monoBelow} min={0} max={200} step={10} unit="Hz" onChange={setMonoBelow} display={monoBelow === 0 ? "off" : undefined} />
          <div className="control">
            <label className="toggle">
              <input type="checkbox" checked={useAutoEq || !!ref} disabled={!!ref} onChange={(e) => setUseAutoEq(e.target.checked)} />
              {ref ? "EQ de correspondance (référence)" : "EQ correctif automatique"}
            </label>
            <Slider label="Intensité EQ" value={Math.round(eqStrength * 100)} min={20} max={100} step={5} unit="%" onChange={(v) => setEqStrength(v / 100)} />
          </div>
        </div>
        {eq.length > 0 && (
          <p className="faint eqline mono">
            EQ : {eq.map((e) => `${e.type === "peaking" ? "" : e.type === "lowshelf" ? "LS " : "HS "}${e.gain && e.gain > 0 ? "+" : ""}${(e.gain ?? 0).toFixed(1)} dB @ ${e.freq >= 1000 ? `${(e.freq / 1000).toFixed(1)}k` : Math.round(e.freq)}`).join(" · ")}
          </p>
        )}
        <div className="actions">
          <Button variant="primary" size="lg" icon="master" onClick={run} disabled={!!busy}>
            {mastered ? "Refaire le master" : "Masteriser"}
          </Button>
          {busy && <Progress label={busy} />}
          {err && <p className="error">{err}</p>}
        </div>
      </Panel>

      <Panel index="B" title="Master par référence" aside={<span className="label">optionnel</span>}>
        <p className="muted">Dépose un titre qui sonne comme tu veux sonner : la loudness et la courbe tonale du master seront alignées dessus.</p>
        {ref ? (
          <div className="refbox">
            <div>
              <strong>{ref.name}</strong>
              <p className="mono faint">{ref.loudness.integrated.toFixed(1)} LUFS · {ref.loudness.truePeak.toFixed(1)} dBTP · PLR {ref.loudness.plr.toFixed(1)}</p>
            </div>
            <div className="refbox__actions">
              {server.engines.master_ref?.available && track.file && (
                <Button size="sm" variant="accent" icon="server" onClick={runMatchering} disabled={!!busy}>
                  Matchering (serveur)
                </Button>
              )}
              <Button size="sm" variant="quiet" icon="close" onClick={() => setRef(null)}>
                Retirer
              </Button>
            </div>
          </div>
        ) : (
          <Dropzone compact label="Déposer une référence" sub="WAV, MP3, M4A… analysée localement" onFile={loadRef} />
        )}
      </Panel>

      {rep && mastered && (
        <Panel index="C" title="Résultat" aside={<span className="label">{mastered.preset === "reference" ? "référence" : PRESETS[mastered.preset as PresetId]?.label}</span>} className="rise">
          <div className="statgrid">
            <Stat label="Avant" value={rep.lufsIn.toFixed(1)} unit="LUFS" />
            <Stat label="Après" value={rep.lufsOut.toFixed(1)} unit="LUFS" tone={rep.reachedTarget ? "good" : "warn"} hint={rep.reachedTarget ? "cible atteinte" : "limité pour préserver le mix"} />
            <Stat label="True peak" value={rep.truePeakOut.toFixed(1)} unit="dBTP" tone={rep.truePeakOut <= -0.9 ? "good" : "warn"} />
            {!external && <Stat label="Limiteur max" value={rep.maxGrDb.toFixed(1)} unit="dB" tone={rep.maxGrDb > 8 ? "warn" : undefined} hint={`moy. ${rep.avgGrDb.toFixed(1)} dB`} />}
          </div>
          <ol className="chain">
            {rep.chain.map((c, i) => (
              <li key={i}>
                <span className="mono faint">{String(i + 1).padStart(2, "0")}</span>
                {c}
              </li>
            ))}
          </ol>
          <div className="actions">
            <Segmented
              value={snap.sourceId === "master" ? "master" : "orig"}
              onChange={(v) => {
                player.use(v);
                if (!snap.playing) player.play();
              }}
              options={[
                { value: "orig", label: "A · Original" },
                { value: "master", label: "B · Master" },
              ]}
              ariaLabel="Comparer"
            />
            <label className="toggle">
              <input type="checkbox" checked={matchVol} onChange={(e) => setMatchVol(e.target.checked)} />
              Comparer à volume égal
            </label>
          </div>
          <div className="actions">
            <Button icon="download" onClick={() => downloadBlob(bufferToWavBlob(mastered.buffer, 24), `${baseName(track.name)} (Viral Cyb master).wav`)}>
              WAV 24 bits
            </Button>
            <Button icon="download" variant="quiet" onClick={() => downloadBlob(bufferToWavBlob(mastered.buffer, 16), `${baseName(track.name)} (Viral Cyb master) 16bit.wav`)}>
              WAV 16 bits (dither)
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange, display }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; display?: string }) {
  return (
    <label className="control slider">
      <span className="slider__head">
        <span className="label">{label}</span>
        <span className="mono">{display ?? value.toFixed(step < 1 ? 1 : 0)} {display ? "" : unit}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
