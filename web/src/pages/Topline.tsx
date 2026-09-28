import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useDisplayBpm } from "../state/hooks";
import { keyFromNotes, predictNext, quantizeToKey, segmentNotes, variations, type NoteEvent, type PitchPoint, type Prediction } from "../dsp/topline";
import { scaleOf, type KeyResult } from "../dsp/key";
import { hzToMidi, midiName, NOTE_NAMES_FR } from "../dsp/util";
import { notesToMidi } from "../dsp/midi";
import { micSupported, playNotes, speechSupported, startLiveMic, type LiveMic } from "../lib/liveMic";
import { decodeFile, stereoChannels } from "../lib/audio";
import { dsp } from "../lib/dsp";
import { player } from "../lib/player";
import { baseName, bufferToWavBlob, downloadBlob } from "../lib/download";
import { PianoRoll } from "../ui/PianoRoll";
import { Button, Chip, PageHead, Panel, Progress, Segmented } from "../ui/Bits";
import { transcribeNotes } from "../lib/ml";
import { Dropzone } from "../ui/Dropzone";

export default function Topline() {
  const track = useStore((s) => s.track);
  const features = useStore((s) => s.features);
  const take = useStore((s) => s.take);
  const setTake = useStore((s) => s.setTake);
  const setPage = useStore((s) => s.setPage);
  const lyrics = useStore((s) => s.lyrics);
  const setLyrics = useStore((s) => s.setLyrics);
  const bpm = useDisplayBpm();
  const [live, setLive] = useState(false);
  const [withBeat, setWithBeat] = useState(!!track);
  const [withWords, setWithWords] = useState(speechSupported());
  const [lang, setLang] = useState("fr-FR");
  const [notes, setNotes] = useState<NoteEvent[]>(take?.notes ?? []);
  const [points, setPoints] = useState<PitchPoint[]>([]);
  const [now, setNow] = useState(0);
  const [words, setWords] = useState({ final: take?.words ?? "", interim: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"voice" | "poly">("voice");
  const [err, setErr] = useState<string | null>(null);
  const mic = useRef<LiveMic | null>(null);
  const committed = useRef<NoteEvent[]>([]);
  const stopSynth = useRef<(() => void) | null>(null);

  const trackKey: KeyResult | null = withBeat && features ? features.key : null;
  const liveKey = useMemo(() => trackKey ?? keyFromNotes(notes), [trackKey, notes]);
  const scale = liveKey ? scaleOf(liveKey.mode).map((d) => (d + liveKey.tonic) % 12) : null;
  const predictions: Prediction[] = useMemo(() => predictNext(notes, liveKey, 3), [notes, liveKey]);

  // live loop: refresh the view and commit stable notes
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    let lastSeg = 0;
    const loop = () => {
      const m = mic.current;
      if (m) {
        const t = m.now();
        setNow(t);
        setPoints(m.points.slice(-900));
        if (t - lastSeg > 0.15) {
          lastSeg = t;
          const from = committed.current.length ? committed.current[committed.current.length - 1].end + 0.02 : 0;
          const seg = segmentNotes(m.points.filter((p) => p.t >= from));
          const stable = seg.filter((n) => n.end < t - 0.12);
          if (stable.length) {
            committed.current = [...committed.current, ...stable];
            setNotes(committed.current.slice());
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  useEffect(() => () => {
    void mic.current?.stop();
    stopSynth.current?.();
  }, []);

  const start = async () => {
    setErr(null);
    committed.current = [];
    setNotes([]);
    setWords({ final: "", interim: "" });
    try {
      mic.current = await startLiveMic({ record: true, speech: withWords, lang, onWords: (f, i) => setWords({ final: f, interim: i }) });
      setLive(true);
      if (withBeat && track) {
        player.use(player.has("instru") ? "instru" : "orig", { keepTime: false, loop: null });
        player.play(0);
      }
    } catch {
      setErr("Micro inaccessible : autorise l'accès au micro dans ton navigateur (HTTPS requis).");
    }
  };

  const stop = async () => {
    const m = mic.current;
    if (!m) return;
    setLive(false);
    player.pause();
    const { blob } = await m.stop();
    const all = segmentNotes(m.points);
    committed.current = all;
    setNotes(all);
    setPoints(m.points.slice());
    setNow(m.now());
    mic.current = null;
    let buffer: AudioBuffer | null = null;
    if (blob) {
      try {
        buffer = await decodeFile(blob);
      } catch {
        buffer = null;
      }
    }
    setTake({ buffer, notes: all, blob, words: words.final });
  };

  const fromFile = async (file: File) => {
    setErr(null);
    setBusy(importMode === "poly" ? "Transcription polyphonique (Basic Pitch)…" : "Transcription de la topline…");
    try {
      const buf = await decodeFile(file);
      if (importMode === "poly") {
        const ns = await transcribeNotes(buf, (_, p) => setBusy(`Transcription polyphonique (Basic Pitch) · ${Math.round(p * 100)} %`));
        committed.current = ns;
        setNotes(ns);
        setPoints([]);
        setNow(buf.duration);
        setTake({ buffer: buf, notes: ns, blob: file, words: "" });
        return;
      }
      const [l, r] = stereoChannels(buf);
      const mono = new Float32Array(l.length);
      for (let i = 0; i < l.length; i++) mono[i] = 0.5 * (l[i] + r[i]);
      const tr = await dsp.pitch(mono, buf.sampleRate);
      const pts = tr.times.map((t, i) => ({ t, freq: tr.freqs[i], clarity: tr.clarity[i], rms: tr.rms[i] }));
      const ns = segmentNotes(pts);
      committed.current = ns;
      setNotes(ns);
      setPoints(pts);
      setNow(buf.duration);
      setTake({ buffer: buf, notes: ns, blob: file, words: "" });
    } catch (e) {
      setErr(importMode === "poly" && e instanceof Error ? `Transcription impossible : ${e.message}` : "Impossible de lire ce fichier.");
    } finally {
      setBusy(null);
    }
  };

  const snap = () => {
    if (!liveKey) return;
    const q = quantizeToKey(notes, liveKey);
    committed.current = q;
    setNotes(q);
    if (take) setTake({ ...take, notes: q });
  };

  const listen = (ns: NoteEvent[]) => {
    stopSynth.current?.();
    stopSynth.current = playNotes(ns);
  };

  const current = [...points].reverse().find((p) => p.freq > 0 && p.clarity > 0.6 && now - p.t < 0.15);
  const curMidi = current ? hzToMidi(current.freq) : null;
  const cents = curMidi !== null ? Math.round((curMidi - Math.round(curMidi)) * 100) : 0;
  const vars = useMemo(() => (!live && notes.length >= 3 ? variations(notes.slice(0, 16), liveKey) : []), [live, notes, liveKey]);
  const name = baseName(track?.name ?? "topline");

  return (
    <div className="page">
      <PageHead kicker="08 · Micro prédictif" title={<>Chante, <span className="serif italic">on écrit</span>.</>}>
        Ta topline est transcrite en notes pendant que tu chantes, la tonalité se cale toute seule et la note suivante la plus probable s'affiche en pointillés — calculée à partir de tes propres motifs et de la tonalité du beat.
      </PageHead>

      <section className="stage rise">
        <div className="stage__readout">
          <span className="label">{live ? "En direct" : notes.length ? "Prise" : "Prêt"}</span>
          <p className="stage__note serif">{curMidi !== null ? `${NOTE_NAMES_FR[((Math.round(curMidi) % 12) + 12) % 12]}${Math.floor(Math.round(curMidi) / 12) - 1}` : notes.length ? midiName(notes[notes.length - 1].midi) : "—"}</p>
          <div className="cents" aria-label={`Justesse ${cents} cents`}>
            <div className="cents__scale" />
            <div className="cents__needle" style={{ left: `${50 + cents}%`, background: Math.abs(cents) < 15 ? "var(--green)" : "var(--amber)" }} />
          </div>
          <span className="mono faint">{curMidi !== null ? `${cents > 0 ? "+" : ""}${cents} cents` : " "}</span>
          <div className="stage__key">
            <span className="label">Tonalité</span>
            <strong>{liveKey ? `${liveKey.nameFr}` : "…"}</strong>
            {liveKey && <span className="mono faint">{liveKey.camelot}{trackKey ? " · du beat" : " · estimée"}</span>}
          </div>
          <div className="stage__pred">
            <span className="label">Note suivante</span>
            <div>
              {predictions.length ? (
                predictions.map((p, i) => (
                  <span key={i} className={`pred${i === 0 ? " pred--top" : ""}`}>
                    {midiName(p.midi)} <span className="mono">{Math.round(p.p * 100)}%</span>
                  </span>
                ))
              ) : (
                <span className="faint">chante quelques notes</span>
              )}
            </div>
          </div>
        </div>
        <div className="stage__roll">
          <PianoRoll notes={notes} points={points} now={now} scale={scale} predictions={live ? predictions : []} bpm={withBeat && bpm ? bpm : null} live={live} height={340} />
          {(words.final || words.interim) && (
            <p className="stage__words">
              {words.final} <span className="faint">{words.interim}</span>
            </p>
          )}
        </div>
      </section>

      <div className="stage__controls">
        {!live ? (
          <Button variant="primary" size="lg" icon="record" onClick={start} disabled={!micSupported()}>
            {notes.length ? "Nouvelle prise" : "Démarrer le micro"}
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon="stop" onClick={stop}>
            Arrêter
          </Button>
        )}
        {track && (
          <label className="toggle">
            <input type="checkbox" checked={withBeat} onChange={(e) => setWithBeat(e.target.checked)} disabled={live} />
            Chanter sur le beat ({features ? `${Math.round(bpm ?? features.rhythm.bpm)} BPM · ${features.key.short}` : "…"})
          </label>
        )}
        <label className="toggle" title={speechSupported() ? "" : "Non supporté par ce navigateur (Chrome/Edge/Safari)"}>
          <input type="checkbox" checked={withWords} onChange={(e) => setWithWords(e.target.checked)} disabled={live || !speechSupported()} />
          Paroles en direct <Chip>expérimental</Chip>
        </label>
        {withWords && (
          <select className="input input--sm" value={lang} onChange={(e) => setLang(e.target.value)} disabled={live} aria-label="Langue">
            <option value="fr-FR">Français</option>
            <option value="en-US">English</option>
            <option value="es-ES">Español</option>
          </select>
        )}
      </div>
      {!micSupported() && <p className="warnline">Ce navigateur ne donne pas accès au micro (il faut HTTPS ou localhost).</p>}
      {err && <p className="error">{err}</p>}

      {!live && notes.length > 0 && (
        <Panel index="A" title="Ta prise" aside={<span className="label">{notes.length} notes</span>} className="rise">
          <div className="actions">
            <Button icon="play" onClick={() => listen(notes)}>Rejouer la mélodie</Button>
            {liveKey && <Button onClick={snap}>Caler sur {liveKey.short}</Button>}
            <Button icon="download" onClick={() => downloadBlob(new Blob([notesToMidi(notes, Math.round(bpm ?? 120)) as Uint8Array<ArrayBuffer>], { type: "audio/midi" }), `${name} topline.mid`)}>MIDI</Button>
            {take?.buffer && <Button icon="download" variant="quiet" onClick={() => downloadBlob(bufferToWavBlob(take.buffer!, 24), `${name} prise voix.wav`)}>WAV de la prise</Button>}
            {take?.buffer && <Button icon="voice" variant="accent" onClick={() => setPage("voice")}>Convertir avec ta voix clonée</Button>}
            {words.final && <Button variant="quiet" onClick={() => { setLyrics((lyrics ? lyrics + "\n\n" : "") + words.final); setPage("lyrics"); }}>Envoyer les paroles</Button>}
          </div>
          {vars.length > 0 && (
            <div className="vars">
              <span className="label">Variations de hook à partir de ta phrase</span>
              <div className="vars__list">
                {vars.map((v) => (
                  <button key={v.title} className="stylechip" onClick={() => listen(v.notes)}>
                    ▶ {v.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Panel>
      )}

      <Panel index="B" title="Importer une topline" aside={<span className="label">voix a cappella</span>}>
        <p className="muted">Une prise voix (ou un stem de l'onglet Stems) est transcrite en notes et en MIDI, localement. Pour un instrument ou des accords, choisis le mode polyphonique (Basic Pitch de Spotify, dans le navigateur).</p>
        <Segmented
          size="sm"
          value={importMode}
          onChange={setImportMode}
          ariaLabel="Type de source"
          options={[
            { value: "voice", label: "Voix · monophonique" },
            { value: "poly", label: "Instrument / accords · Basic Pitch" },
          ]}
        />
        <Dropzone compact label={importMode === "poly" ? "Déposer un instrument ou un stem" : "Déposer une prise voix"} sub="WAV, MP3, M4A… mono ou stéréo" onFile={fromFile} />
        {busy && <Progress label={busy} />}
      </Panel>
    </div>
  );
}
