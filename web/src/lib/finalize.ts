import { dsp } from "./dsp";
import { bufferFrom } from "./audio";

/** Loudness-normalise and true-peak limit a rendered buffer (no colouring). */
export async function finalize(buf: AudioBuffer, targetLufs: number): Promise<AudioBuffer> {
  const chs: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c));
  if (chs.length === 1) chs.push(chs[0]);
  const r = await dsp.master(chs, buf.sampleRate, {
    targetLufs: Number.isFinite(targetLufs) ? Math.min(-7, targetLufs) : -12,
    ceiling: -1,
    eq: [],
    lowCut: 0,
    monoBelow: 0,
    width: 1,
    glue: null,
    saturation: 0,
    releaseMs: 80,
  });
  return bufferFrom(r.channels, buf.sampleRate);
}
