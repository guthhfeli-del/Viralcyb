/** Builds a real-time Web Audio chain for a playback-device profile. */
import type { DeviceProfile } from "../engine/devices";

export interface DeviceGraph {
  input: AudioNode;
  output: AudioNode;
  dispose(): void;
}

const irCache = new Map<string, AudioBuffer>();
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${seconds}`;
  const hit = irCache.get(key);
  if (hit && hit.sampleRate === ctx.sampleRate) return hit;
  const n = Math.round(seconds * ctx.sampleRate);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let seed = 1234 + c * 77;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const r = seed / 2147483647 - 0.5;
      const t = i / n;
      // early reflections + exponential tail
      d[i] = r * Math.pow(1 - t, 2.2) * (i < 0.004 * ctx.sampleRate ? 0 : 1);
    }
  }
  irCache.set(key, b);
  return b;
}

const noiseCache = new Map<string, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext, kind: "road" | "crowd" | "hiss"): AudioBuffer {
  const key = `${ctx.sampleRate}:${kind}`;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const n = ctx.sampleRate * 4;
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let seed = 99 + c;
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const w = seed / 2147483647 - 0.5;
      if (kind === "road") {
        lp += 0.02 * (w - lp);
        lp2 += 0.05 * (lp - lp2);
        d[i] = lp2 * 18;
      } else if (kind === "crowd") {
        lp += 0.25 * (w - lp);
        const mod = 0.6 + 0.4 * Math.sin((2 * Math.PI * i) / (ctx.sampleRate * 1.7) + c);
        d[i] = lp * mod * 2.2;
      } else d[i] = w * 0.6;
    }
    // loop-friendly fade at the seam
    const f = Math.round(0.05 * ctx.sampleRate);
    for (let i = 0; i < f; i++) {
      d[i] *= i / f;
      d[n - 1 - i] *= i / f;
    }
  }
  noiseCache.set(key, b);
  return b;
}

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + amount * 6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

export function buildDeviceGraph(ctx: BaseAudioContext, d: DeviceProfile): DeviceGraph {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const input = ctx.createGain();
  nodes.push(input);
  let last: AudioNode = input;
  const chain = (n: AudioNode) => {
    last.connect(n);
    last = n;
    nodes.push(n);
  };
  if (d.mono) {
    const m = ctx.createGain();
    m.channelCount = 1;
    m.channelCountMode = "explicit";
    m.channelInterpretation = "speakers";
    chain(m);
  }
  for (const f of d.filters) {
    const b = ctx.createBiquadFilter();
    b.type = f.type;
    b.frequency.value = f.freq;
    b.Q.value = f.type === "lowshelf" || f.type === "highshelf" ? 0.0001 + (f.q ?? 0.707) : f.q ?? 0.707;
    if (f.gain !== undefined) b.gain.value = f.gain;
    chain(b);
  }
  if (d.drive > 0) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(d.drive);
    ws.oversample = "2x";
    const pre = ctx.createGain();
    pre.gain.value = 1 + d.drive;
    chain(pre);
    chain(ws);
  }
  if (d.compressor) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = d.compressor.threshold;
    c.ratio.value = d.compressor.ratio;
    c.attack.value = d.compressor.attack;
    c.release.value = d.compressor.release;
    c.knee.value = d.compressor.knee;
    chain(c);
  }
  const out = ctx.createGain();
  out.gain.value = Math.pow(10, d.gainDb / 20);
  nodes.push(out);
  last.connect(out);
  if (d.reverb) {
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, d.reverb.seconds);
    const wet = ctx.createGain();
    wet.gain.value = d.reverb.wet;
    last.connect(conv);
    conv.connect(wet);
    wet.connect(out);
    nodes.push(conv, wet);
  }
  if (d.noise) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, d.noise.kind);
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = Math.pow(10, d.noise.level / 20);
    src.connect(g);
    g.connect(out);
    src.start();
    sources.push(src);
    nodes.push(src, g);
  }
  return {
    input,
    output: out,
    dispose() {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      for (const n of nodes) n.disconnect();
    },
  };
}
