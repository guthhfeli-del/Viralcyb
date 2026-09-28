import { useEffect, useRef } from "react";
import type { Features } from "../engine/types";
import { usePlayer } from "../lib/usePlayer";
import { player } from "../lib/player";
import { formatTime } from "../dsp/util";

interface Props {
  features: Features;
  height?: number;
  showSections?: boolean;
  showHook?: boolean;
  clip?: { start: number; end: number } | null;
  interactive?: boolean;
  compact?: boolean;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function Waveform({ features, height = 120, showSections = true, showHook = true, clip = null, interactive = true, compact = false }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const snap = usePlayer();
  const duration = features.meta.analysedDuration;
  const progress = snap.duration > 0 ? Math.min(1, snap.time / duration) : 0;

  useEffect(() => {
    const canvas = ref.current;
    const box = wrap.current;
    if (!canvas || !box) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = box.clientWidth;
      const h = height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const g = canvas.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const green = css("--green"), violet = css("--violet"), line = css("--line-2"), text3 = css("--text-3");
      const top = showSections && !compact ? 18 : 0;
      const bottom = h - 2;
      const mid = top + (bottom - top) / 2;
      const amp = (bottom - top) / 2;
      const x = (t: number) => (t / duration) * w;

      // sections
      if (showSections) {
        const secs = features.structure.sections;
        g.font = `500 10px ${css("--font-mono")}`;
        g.textBaseline = "top";
        secs.forEach((s, i) => {
          const x0 = x(s.start), x1 = x(s.end);
          if (s.kind === "chorus") {
            g.fillStyle = "rgba(168,152,245,0.07)";
            g.fillRect(x0, top, x1 - x0, bottom - top);
          }
          g.fillStyle = line;
          if (i > 0) g.fillRect(Math.round(x0), top, 1, bottom - top);
          if (!compact && x1 - x0 > 30) {
            g.fillStyle = s.kind === "chorus" ? violet : text3;
            let label = s.name.toUpperCase();
            const room = x1 - x0 - 10;
            while (label.length > 2 && g.measureText(label).width > room) label = label.slice(0, -1);
            if (label !== s.name.toUpperCase()) label = label.slice(0, -1) + "…";
            g.fillText(label, x0 + 5, 3);
          }
        });
      }
      // TikTok clip
      if (clip) {
        g.fillStyle = "rgba(143,220,174,0.08)";
        g.fillRect(x(clip.start), top, x(clip.end) - x(clip.start), bottom - top);
        g.fillStyle = green;
        g.fillRect(x(clip.start), bottom - 2, x(clip.end) - x(clip.start), 2);
      }
      // waveform (min/max columns)
      const peaks = features.waveform.peaks;
      const cols = peaks.length / 2;
      const barW = Math.max(1, w / cols);
      const step = compact ? 2 : 1;
      const px = x(duration * progress);
      for (let c = 0; c < cols; c += step) {
        const cx = (c / cols) * w;
        const lo = peaks[2 * c], hi = peaks[2 * c + 1];
        const y0 = mid - hi * amp * 0.95;
        const y1 = mid - lo * amp * 0.95;
        const played = cx <= px;
        g.fillStyle = played ? green : "rgba(236,235,241,0.28)";
        g.fillRect(cx, y0, Math.max(0.8, barW * step * 0.62), Math.max(1, y1 - y0));
      }
      // hook markers
      if (showHook) {
        g.fillStyle = violet;
        for (const o of features.structure.hook.occurrences) {
          const hx = x(o);
          g.beginPath();
          g.moveTo(hx, bottom);
          g.lineTo(hx - 4, bottom + 0.01);
          g.lineTo(hx, bottom - 6);
          g.lineTo(hx + 4, bottom + 0.01);
          g.closePath();
          g.fill();
        }
      }
      // playhead
      if (snap.time > 0 || snap.playing) {
        g.fillStyle = "rgba(236,235,241,0.85)";
        g.fillRect(px, top, 1, bottom - top);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [features, height, showSections, showHook, clip, progress, compact, duration, snap.time, snap.playing]);

  const onPointer = (e: React.PointerEvent) => {
    if (!interactive || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * duration;
    if (snap.loop) player.setLoop(null);
    player.seek(Math.max(0, Math.min(duration, t)));
    if (!snap.playing) player.play();
  };

  return (
    <div
      ref={wrap}
      className={`waveform${interactive ? " is-interactive" : ""}`}
      onPointerDown={onPointer}
      role={interactive ? "slider" : undefined}
      aria-label="Position de lecture"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(snap.time)}
      aria-valuetext={formatTime(snap.time)}
      tabIndex={interactive ? 0 : -1}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") player.seek(snap.time + 5);
        if (e.key === "ArrowLeft") player.seek(Math.max(0, snap.time - 5));
      }}
    >
      <canvas ref={ref} />
    </div>
  );
}
