/// <reference lib="webworker" />
/**
 * In-browser neural models, off the main thread:
 *  - Demucs (HT-Demucs, 4 stems) via demucs-web + ONNX Runtime Web (WebGPU → WASM)
 *  - Basic Pitch (Spotify) audio → polyphonic notes via TensorFlow.js
 */
export type MlRequest =
  | { id: number; op: "demucs"; model: ArrayBuffer; left: Float32Array; right: Float32Array; prefer?: "auto" | "wasm" }
  | { id: number; op: "basicpitch"; modelUrl: string; mono: Float32Array };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

ctx.onmessage = async (e: MessageEvent<MlRequest>) => {
  const req = e.data;
  const progress = (stage: string, p: number) => ctx.postMessage({ id: req.id, progress: { stage, p } });
  try {
    if (req.op === "demucs") {
      const ort = await import("onnxruntime-web");
      const { DemucsProcessor } = await import("demucs-web");
      // threads need cross-origin isolation (SharedArrayBuffer); otherwise run single-threaded
      ort.env.wasm.numThreads = ctx.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
      const make = (providers: string[]) =>
        new DemucsProcessor({
          ort,
          sessionOptions: { executionProviders: providers },
          onProgress: (info: { progress: number }) => progress("separate", info.progress),
        });
      let gpu = req.prefer !== "wasm" && (await hasWebGpu());
      progress(gpu ? "init-gpu" : "init-cpu", 0);
      let processor = make(gpu ? ["webgpu"] : ["wasm"]);
      try {
        await processor.loadModel(req.model);
      } catch (err) {
        if (!gpu || req.model.byteLength === 0) throw err;
        // WebGPU present but unusable (driver, limits): fall back to the CPU
        gpu = false;
        progress("init-cpu", 0);
        processor = make(["wasm"]);
        await processor.loadModel(req.model);
      }
      progress("separate", 0);
      const r = await processor.separate(req.left, req.right);
      const stems = (["vocals", "drums", "bass", "other"] as const).map((id) => ({ id, left: r[id].left, right: r[id].right }));
      ctx.postMessage({ id: req.id, ok: true, result: { stems, backend: gpu ? "webgpu" : "wasm" } }, stems.flatMap((s) => [s.left.buffer, s.right.buffer]));
      return;
    }
    if (req.op === "basicpitch") {
      const bp = await import("@spotify/basic-pitch");
      const model = new bp.BasicPitch(req.modelUrl);
      const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = [];
      await model.evaluateModel(
        req.mono,
        (f: number[][], o: number[][], c: number[][]) => {
          frames.push(...f);
          onsets.push(...o);
          contours.push(...c);
        },
        (p: number) => progress("transcribe", p),
      );
      const notes = bp.noteFramesToTime(bp.addPitchBendsToNoteEvents(contours, bp.outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)));
      const out = notes
        .map((n: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number; amplitude: number }) => ({
          midi: n.pitchMidi,
          cents: 0,
          start: n.startTimeSeconds,
          end: n.startTimeSeconds + n.durationSeconds,
          velocity: Math.max(1, Math.min(127, Math.round(n.amplitude * 127))),
        }))
        .sort((a: { start: number }, b: { start: number }) => a.start - b.start);
      ctx.postMessage({ id: req.id, ok: true, result: { notes: out } });
      return;
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
