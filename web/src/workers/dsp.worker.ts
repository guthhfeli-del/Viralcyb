/// <reference lib="webworker" />
import { analyzeTrack } from "../engine/analyze";
import { master, type MasterSettings } from "../dsp/master";
import { centerCut } from "../dsp/centercut";
import { pitchTrack } from "../dsp/pitch";
import { measureLoudness } from "../dsp/loudness";
import { analyzeFrames } from "../dsp/frames";
import { spectrumProfile } from "../dsp/tonal";
import { synthSong } from "../engine/demo";

export type WorkerRequest =
  | { id: number; op: "analyze"; channels: Float32Array[]; fs: number }
  | { id: number; op: "master"; channels: Float32Array[]; fs: number; settings: MasterSettings }
  | { id: number; op: "centercut"; channels: Float32Array[]; fs: number }
  | { id: number; op: "pitch"; mono: Float32Array; fs: number }
  | { id: number; op: "profile"; channels: Float32Array[]; fs: number }
  | { id: number; op: "demo"; fs: number; bpm: number };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const progress = (stage: string, p: number) => ctx.postMessage({ id: req.id, progress: { stage, p } });
  try {
    switch (req.op) {
      case "analyze": {
        const f = analyzeTrack(req.channels, req.fs, progress);
        ctx.postMessage({ id: req.id, ok: true, result: f });
        break;
      }
      case "master": {
        progress("master", 0.1);
        const r = master(req.channels, req.fs, req.settings);
        ctx.postMessage({ id: req.id, ok: true, result: r }, [r.channels[0].buffer, r.channels[1].buffer]);
        break;
      }
      case "centercut": {
        progress("centercut", 0.1);
        const r = centerCut(req.channels[0], req.channels[1] ?? req.channels[0], req.fs);
        ctx.postMessage({ id: req.id, ok: true, result: r }, [r.center.buffer, r.sides[0].buffer, r.sides[1].buffer]);
        break;
      }
      case "pitch": {
        const r = pitchTrack(req.mono, req.fs);
        ctx.postMessage({ id: req.id, ok: true, result: r });
        break;
      }
      case "demo": {
        const s = synthSong(req.bpm, req.fs);
        ctx.postMessage({ id: req.id, ok: true, result: { left: s.left, right: s.right } }, [s.left.buffer, s.right.buffer]);
        break;
      }
      case "profile": {
        // loudness + spectrum only (reference tracks)
        const l = measureLoudness(req.channels, req.fs);
        const fr = analyzeFrames(req.channels[0], req.channels[1] ?? req.channels[0], req.fs);
        ctx.postMessage({ id: req.id, ok: true, result: { loudness: l, spectrum: spectrumProfile(fr.ltasMid, fr.ltasSide, fr.binHz) } });
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
