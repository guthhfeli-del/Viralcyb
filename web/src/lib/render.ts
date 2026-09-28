/**
 * Viral edits rendered offline with the browser's audio engine:
 * sped-up / nightcore, slowed + reverb, 8D, bass boost, lo-fi, TikTok cut
 * and loop, quick karaoke instrumental.
 */
import { audioContext } from "./audio";

export type VersionId = "spedup" | "nightcore" | "slowed" | "eightd" | "bassboost" | "lofi" | "tiktok" | "loop" | "karaoke";

export interface VersionSpec {
  id: VersionId;
  label: string;
  hint: string;
  param?: { label: string; min: number; max: number; step: number; value: number; unit: string };
}

export const VERSION_SPECS: VersionSpec[] = [
  { id: "spedup", label: "Sped up", hint: "Tempo et pitch montés ensemble — le format TikTok par excellence.", param: { label: "Vitesse", min: 1.08, max: 1.35, step: 0.01, value: 1.2, unit: "×" } },
  { id: "nightcore", label: "Nightcore", hint: "Plus rapide, plus brillant, plus aigu.", param: { label: "Vitesse", min: 1.2, max: 1.4, step: 0.01, value: 1.28, unit: "×" } },
  { id: "slowed", label: "Slowed + reverb", hint: "Ralenti, grave et noyé dans une réverbe — pour les edits émotionnels.", param: { label: "Vitesse", min: 0.75, max: 0.95, step: 0.01, value: 0.84, unit: "×" } },
  { id: "eightd", label: "8D audio", hint: "Le son tourne autour de la tête (au casque).", param: { label: "Tours / min", min: 4, max: 20, step: 1, value: 9, unit: "" } },
  { id: "bassboost", label: "Bass boosted", hint: "Sub et basses gonflés, limité proprement.", param: { label: "Boost", min: 3, max: 12, step: 1, value: 7, unit: "dB" } },
  { id: "lofi", label: "Lo-fi", hint: "Bande passante réduite, saturation, pleurage, vinyle.", param: { label: "Intensité", min: 0.2, max: 1, step: 0.05, value: 0.6, unit: "" } },
  { id: "tiktok", label: "Extrait TikTok", hint: "Le meilleur passage calé sur les mesures, prêt à uploader comme son." },
  { id: "loop", label: "Boucle ×3", hint: "L'extrait bouclé trois fois pour tester le replay." },
  { id: "karaoke", label: "Instru rapide", hint: "Retire le centre au-dessus de 150 Hz (approximation locale de l'instrumental)." },
];

function irBuffer(ctx: BaseAudioContext, seconds: number, decay = 2.4): AudioBuffer {
  const n = Math.round(seconds * ctx.sampleRate);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let seed = 777 + c * 131;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647 - 0.5) * Math.pow(1 - i / n, decay);
    }
  }
  return b;
}

function saturationCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

export interface RenderOptions {
  value?: number;
  clip?: { start: number; end: number };
}

export async function renderVersion(buf: AudioBuffer, id: VersionId, opts: RenderOptions = {}): Promise<AudioBuffer> {
  const fs = buf.sampleRate;
  const v = opts.value ?? VERSION_SPECS.find((s) => s.id === id)?.param?.value ?? 1;

  if (id === "tiktok" || id === "loop") {
    const clip = opts.clip ?? { start: 0, end: Math.min(15, buf.duration) };
    const s = Math.floor(clip.start * fs), e = Math.min(buf.length, Math.floor(clip.end * fs));
    const len = e - s;
    const reps = id === "loop" ? 3 : 1;
    const xf = Math.floor(0.02 * fs);
    const out = audioContext().createBuffer(buf.numberOfChannels, len * reps, fs);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let r = 0; r < reps; r++) {
        for (let i = 0; i < len; i++) {
          let g = 1;
          if (r === 0 && i < xf) g = i / xf;
          if (r === reps - 1 && i > len - Math.floor(0.25 * fs)) g = Math.max(0, (len - i) / Math.floor(0.25 * fs));
          // equal-power smoothing across the loop seam
          if (reps > 1 && r > 0 && i < xf) g = Math.sin(((i / xf) * Math.PI) / 2);
          if (reps > 1 && r < reps - 1 && i > len - xf) g = Math.cos((((i - (len - xf)) / xf) * Math.PI) / 2);
          dst[r * len + i] += src[s + i] * g;
        }
      }
    }
    return out;
  }

  const rate = id === "spedup" || id === "nightcore" || id === "slowed" ? v : 1;
  const tail = id === "slowed" ? 3 : 0.5;
  const length = Math.ceil((buf.duration / rate + tail) * fs);
  const ctx = new OfflineAudioContext(2, length, fs);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  let node: AudioNode = src;
  const chain = (n: AudioNode) => {
    node.connect(n);
    node = n;
  };
  const out = ctx.createGain();
  out.connect(ctx.destination);

  switch (id) {
    case "nightcore": {
      const hs = ctx.createBiquadFilter();
      hs.type = "highshelf";
      hs.frequency.value = 6000;
      hs.gain.value = 3;
      chain(hs);
      node.connect(out);
      break;
    }
    case "slowed": {
      const ls = ctx.createBiquadFilter();
      ls.type = "lowshelf";
      ls.frequency.value = 120;
      ls.gain.value = 2;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 12000;
      chain(ls);
      chain(lp);
      const conv = ctx.createConvolver();
      conv.buffer = irBuffer(ctx, 3.2, 2.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.32;
      const dry = ctx.createGain();
      dry.gain.value = 0.85;
      node.connect(conv);
      conv.connect(wet);
      wet.connect(out);
      node.connect(dry);
      dry.connect(out);
      break;
    }
    case "eightd": {
      const pan = ctx.createStereoPanner();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = v / 60;
      const depth = ctx.createGain();
      depth.gain.value = 0.95;
      lfo.connect(depth);
      depth.connect(pan.pan);
      lfo.start();
      chain(pan);
      const conv = ctx.createConvolver();
      conv.buffer = irBuffer(ctx, 1.4, 3);
      const wet = ctx.createGain();
      wet.gain.value = 0.18;
      node.connect(conv);
      conv.connect(wet);
      wet.connect(out);
      node.connect(out);
      break;
    }
    case "bassboost": {
      const ls = ctx.createBiquadFilter();
      ls.type = "lowshelf";
      ls.frequency.value = 90;
      ls.gain.value = v;
      const pk = ctx.createBiquadFilter();
      pk.type = "peaking";
      pk.frequency.value = 55;
      pk.Q.value = 1.1;
      pk.gain.value = v * 0.4;
      chain(ls);
      chain(pk);
      const g = ctx.createGain();
      g.gain.value = Math.pow(10, -v / 40);
      chain(g);
      node.connect(out);
      break;
    }
    case "lofi": {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 90 + 120 * v;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7000 - 3500 * v;
      lp.Q.value = 0.8;
      const ws = ctx.createWaveShaper();
      ws.curve = saturationCurve(1 + 3 * v);
      ws.oversample = "2x";
      // wow & flutter
      src.detune.value = 0;
      const wow = ctx.createOscillator();
      wow.frequency.value = 0.55;
      const wowDepth = ctx.createGain();
      wowDepth.gain.value = 12 * v;
      wow.connect(wowDepth);
      wowDepth.connect(src.detune);
      wow.start();
      chain(hp);
      chain(lp);
      chain(ws);
      node.connect(out);
      // vinyl crackle
      const noise = ctx.createBuffer(2, fs * 2, fs);
      for (let c = 0; c < 2; c++) {
        const d = noise.getChannelData(c);
        let seed = 5 + c;
        for (let i = 0; i < d.length; i++) {
          seed = (seed * 16807) % 2147483647;
          const r = seed / 2147483647;
          d[i] = (r > 0.9993 ? (r - 0.5) * 0.9 : 0) + (r - 0.5) * 0.004;
        }
      }
      const ns = ctx.createBufferSource();
      ns.buffer = noise;
      ns.loop = true;
      const ng = ctx.createGain();
      ng.gain.value = 0.5 * v;
      ns.connect(ng);
      ng.connect(out);
      ns.start();
      break;
    }
    case "karaoke": {
      // centre removal above 150 Hz, keep the low end
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      const inv = ctx.createGain();
      inv.gain.value = -1;
      src.connect(split);
      const hpL = ctx.createBiquadFilter();
      hpL.type = "highpass";
      hpL.frequency.value = 150;
      const hpR = ctx.createBiquadFilter();
      hpR.type = "highpass";
      hpR.frequency.value = 150;
      // side = L - R (high band)
      split.connect(hpL, 0);
      split.connect(hpR, 1);
      hpR.connect(inv);
      const side = ctx.createGain();
      hpL.connect(side);
      inv.connect(side);
      side.connect(merge, 0, 0);
      const sideInv = ctx.createGain();
      sideInv.gain.value = -1;
      side.connect(sideInv);
      sideInv.connect(merge, 0, 1);
      // low band (mono) kept intact
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 150;
      src.connect(lp);
      lp.connect(out);
      merge.connect(out);
      src.start();
      return ctx.startRendering();
    }
    default:
      node.connect(out);
  }
  src.start();
  return ctx.startRendering();
}
