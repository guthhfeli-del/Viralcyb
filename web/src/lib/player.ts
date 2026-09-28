/**
 * Single transport shared by every page: plays one of several named buffers
 * (original, master, versions, stems…), through an optional device
 * simulation, with seek, loop region and gapless A/B switching.
 */
import { audioContext } from "./audio";
import { buildDeviceGraph, type DeviceGraph } from "./deviceGraph";
import { DEVICES, type DeviceId } from "../engine/devices";

type Listener = () => void;

export interface PlayerSnapshot {
  playing: boolean;
  time: number;
  duration: number;
  sourceId: string;
  device: DeviceId;
  loop: { start: number; end: number } | null;
}

class Player {
  private buffers = new Map<string, { buffer: AudioBuffer; gainDb: number }>();
  private src: AudioBufferSourceNode | null = null;
  private pre: GainNode | null = null;
  private out: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private graph: DeviceGraph | null = null;
  private startedAt = 0;
  private offset = 0;
  private listeners = new Set<Listener>();
  private raf = 0;
  private snap: PlayerSnapshot = { playing: false, time: 0, duration: 0, sourceId: "orig", device: "studio", loop: null };

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  getSnapshot = (): PlayerSnapshot => this.snap;

  private emit() {
    this.snap = {
      playing: this.src !== null,
      time: this.currentTime(),
      duration: this.buffers.get(this.snap.sourceId)?.buffer.duration ?? 0,
      sourceId: this.snap.sourceId,
      device: this.snap.device,
      loop: this.snap.loop,
    };
    this.listeners.forEach((l) => l());
  }

  private ensureGraph() {
    const ctx = audioContext();
    if (!this.out) {
      this.out = ctx.createGain();
      this.analyserNode = ctx.createAnalyser();
      this.analyserNode.fftSize = 2048;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.out.connect(this.analyserNode);
      this.analyserNode.connect(ctx.destination);
    }
    if (!this.pre) {
      this.pre = ctx.createGain();
      this.setDevice(this.snap.device);
    }
  }

  analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /** Register a playable buffer. gainDb lets A/B comparisons be loudness-matched. */
  set(id: string, buffer: AudioBuffer, gainDb = 0) {
    this.buffers.set(id, { buffer, gainDb });
    if (id === this.snap.sourceId) this.emit();
  }

  has(id: string): boolean {
    return this.buffers.has(id);
  }

  setGain(id: string, gainDb: number) {
    const b = this.buffers.get(id);
    if (b) b.gainDb = gainDb;
    if (id === this.snap.sourceId && this.src && this.pre) this.pre.gain.setTargetAtTime(Math.pow(10, gainDb / 20), audioContext().currentTime, 0.02);
  }

  remove(id: string) {
    if (this.snap.sourceId === id) this.stop();
    this.buffers.delete(id);
  }

  clear() {
    this.stop();
    this.buffers.clear();
    this.snap = { ...this.snap, sourceId: "orig", loop: null, time: 0 };
    this.offset = 0;
    this.emit();
  }

  currentTime(): number {
    const entry = this.buffers.get(this.snap.sourceId);
    if (!entry) return 0;
    if (!this.src) return this.offset;
    const t = this.offset + (audioContext().currentTime - this.startedAt);
    const loop = this.snap.loop;
    if (loop && t >= loop.end) return loop.start + ((t - loop.start) % (loop.end - loop.start));
    return Math.min(t, entry.buffer.duration);
  }

  play(from?: number) {
    const entry = this.buffers.get(this.snap.sourceId);
    if (!entry) return;
    this.ensureGraph();
    const ctx = audioContext();
    this.stopSource();
    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    const loop = this.snap.loop;
    if (loop) {
      src.loop = true;
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
    }
    let at = from ?? this.offset;
    if (at >= entry.buffer.duration - 0.05) at = loop ? loop.start : 0;
    if (loop && (at < loop.start || at > loop.end)) at = loop.start;
    this.pre!.gain.value = Math.pow(10, entry.gainDb / 20);
    src.connect(this.pre!);
    src.start(0, at);
    src.onended = () => {
      if (this.src === src) {
        this.src = null;
        this.offset = 0;
        cancelAnimationFrame(this.raf);
        this.emit();
      }
    };
    this.src = src;
    this.startedAt = ctx.currentTime;
    this.offset = at;
    this.tick();
  }

  private tick = () => {
    this.emit();
    if (this.src) this.raf = requestAnimationFrame(this.tick);
  };

  private stopSource() {
    if (this.src) {
      const s = this.src;
      this.src = null;
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* noop */
      }
      s.disconnect();
    }
    cancelAnimationFrame(this.raf);
  }

  pause() {
    if (!this.src) return;
    this.offset = this.currentTime();
    this.stopSource();
    this.emit();
  }

  stop() {
    this.stopSource();
    this.offset = this.snap.loop?.start ?? 0;
    this.emit();
  }

  toggle() {
    if (this.src) this.pause();
    else this.play();
  }

  seek(t: number) {
    const was = !!this.src;
    this.offset = Math.max(0, t);
    if (was) this.play(this.offset);
    else this.emit();
  }

  /** Switch source keeping the playhead (A/B). */
  use(id: string, opts: { keepTime?: boolean; loop?: { start: number; end: number } | null } = {}) {
    if (!this.buffers.has(id)) return;
    const t = opts.keepTime === false ? 0 : this.currentTime();
    const was = !!this.src;
    this.stopSource();
    this.snap = { ...this.snap, sourceId: id, loop: opts.loop === undefined ? this.snap.loop : opts.loop };
    const dur = this.buffers.get(id)!.buffer.duration;
    this.offset = Math.min(t, Math.max(0, dur - 0.1));
    if (was) this.play(this.offset);
    else this.emit();
  }

  setLoop(loop: { start: number; end: number } | null) {
    const was = !!this.src;
    const t = this.currentTime();
    this.snap = { ...this.snap, loop };
    if (was) this.play(loop ? loop.start : t);
    else {
      this.offset = loop ? loop.start : t;
      this.emit();
    }
  }

  setDevice(id: DeviceId) {
    this.snap = { ...this.snap, device: id };
    if (!this.pre || !this.out) {
      this.emit();
      return;
    }
    const ctx = audioContext();
    this.pre.disconnect();
    this.graph?.dispose();
    const profile = DEVICES.find((d) => d.id === id)!;
    this.graph = buildDeviceGraph(ctx, profile);
    this.pre.connect(this.graph.input);
    this.graph.output.connect(this.out);
    this.emit();
  }
}

export const player = new Player();
