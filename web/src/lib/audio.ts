let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: "interactive" });
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export async function decodeFile(file: Blob): Promise<AudioBuffer> {
  const data = await file.arrayBuffer();
  const c = audioContext();
  return await c.decodeAudioData(data);
}

/** Stereo Float32 copies of an AudioBuffer (mono is duplicated). */
export function stereoChannels(buf: AudioBuffer): [Float32Array, Float32Array] {
  const l = new Float32Array(buf.getChannelData(0));
  const r = buf.numberOfChannels > 1 ? new Float32Array(buf.getChannelData(1)) : new Float32Array(l);
  return [l, r];
}

export function bufferFrom(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const c = audioContext();
  const b = c.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((ch, i) => b.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return b;
}

export function sliceBuffer(buf: AudioBuffer, start: number, end: number, fadeSec = 0.01): AudioBuffer {
  const s = Math.max(0, Math.floor(start * buf.sampleRate));
  const e = Math.min(buf.length, Math.floor(end * buf.sampleRate));
  const out = audioContext().createBuffer(buf.numberOfChannels, Math.max(1, e - s), buf.sampleRate);
  const fade = Math.floor(fadeSec * buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c).subarray(s, e);
    const dst = out.getChannelData(c);
    dst.set(src);
    for (let i = 0; i < fade && i < dst.length; i++) {
      const g = i / fade;
      dst[i] *= g;
      dst[dst.length - 1 - i] *= g;
    }
  }
  return out;
}
