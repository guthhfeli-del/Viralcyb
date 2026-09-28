import type { Section } from "../dsp/structure";
import type { Blueprint } from "../engine/advice";
import { formatTime } from "../dsp/util";

const KIND_TONE: Record<string, string> = {
  chorus: "var(--violet)",
  hook: "var(--violet)",
  refrain: "var(--violet)",
  verse: "var(--text-3)",
  couplet: "var(--text-3)",
  prechorus: "var(--green-2)",
  intro: "var(--surface-3)",
  outro: "var(--surface-3)",
  bridge: "var(--amber)",
  break: "var(--amber)",
};

const toneFor = (name: string, kind?: string) => {
  if (kind) return KIND_TONE[kind] ?? "var(--text-3)";
  const n = name.toLowerCase();
  if (/hook|refrain|drop/.test(n)) return "var(--violet)";
  if (/pré|pre|build|post/.test(n)) return "var(--green-2)";
  if (/pont|break|bridge/.test(n)) return "var(--amber)";
  if (/intro|outro/.test(n)) return "var(--surface-3)";
  return "var(--text-3)";
};

export function StructureStrip({ sections, duration, total }: { sections: Section[]; duration: number; total?: number }) {
  const T = total ?? duration;
  return (
    <div className="strip" role="list" aria-label="Structure détectée">
      {sections.map((s, i) => (
        <div
          key={i}
          role="listitem"
          className="strip__part"
          style={{ width: `${((s.end - s.start) / T) * 100}%`, ["--tone" as string]: toneFor(s.name, s.kind) }}
          title={`${s.name} · ${formatTime(s.start)}–${formatTime(s.end)}`}
        >
          <span>{s.name}</span>
        </div>
      ))}
    </div>
  );
}

export function BlueprintStrip({ bp, total }: { bp: Blueprint; total: number }) {
  return (
    <div className="strip" role="list" aria-label={bp.title}>
      {bp.parts.map((p, i) => (
        <div
          key={i}
          role="listitem"
          className="strip__part"
          style={{ width: `${((p.end - p.start) / total) * 100}%`, ["--tone" as string]: toneFor(p.name) }}
          title={`${p.name} · ${p.bars} mesures · ${formatTime(p.start)}–${formatTime(p.end)}${p.note ? ` · ${p.note}` : ""}`}
        >
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, height = 56, min, max, band }: { values: number[]; height?: number; min?: number; max?: number; band?: [number, number] }) {
  const W = 600;
  const v = values.filter((x) => Number.isFinite(x));
  const lo = min ?? Math.min(...v);
  const hi = max ?? Math.max(...v);
  const y = (x: number) => height - 2 - ((Math.max(lo, Math.min(hi, x)) - lo) / (hi - lo || 1)) * (height - 4);
  const d = values.map((x, i) => `${i ? "L" : "M"}${(i / Math.max(1, values.length - 1)) * W},${y(x)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ height }}>
      {band && <rect x={0} width={W} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} fill="var(--violet-wash)" />}
      <path d={d} fill="none" stroke="var(--green)" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
