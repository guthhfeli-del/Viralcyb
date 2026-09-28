declare module "demucs-web" {
  import type * as Ort from "onnxruntime-web";

  export interface StereoTrack {
    left: Float32Array;
    right: Float32Array;
  }

  export class DemucsProcessor {
    constructor(options: {
      ort: typeof Ort;
      modelPath?: string;
      sessionOptions?: Ort.InferenceSession.SessionOptions;
      onProgress?: (info: { progress: number; currentSegment: number; totalSegments: number }) => void;
      onLog?: (phase: string, message: string) => void;
      onDownloadProgress?: (loaded: number, total: number) => void;
    });
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<unknown>;
    separate(left: Float32Array, right: Float32Array): Promise<Record<"drums" | "bass" | "other" | "vocals", StereoTrack>>;
  }

  export const CONSTANTS: { SAMPLE_RATE: number; DEFAULT_MODEL_URL: string; TRACKS: string[] };
}
