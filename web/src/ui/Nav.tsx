import { useId } from "react";
import { useStore, type PageId } from "../state/store";
import { Icon, type IconName } from "./Icon";

export const NAV: { id: PageId; label: string; short: string; icon: IconName; needsTrack: boolean }[] = [
  { id: "score", label: "Score viral", short: "Score", icon: "score", needsTrack: true },
  { id: "mix", label: "Mix & structure", short: "Mix", icon: "mix", needsTrack: true },
  { id: "devices", label: "Test supports", short: "Supports", icon: "devices", needsTrack: true },
  { id: "master", label: "Mastering", short: "Master", icon: "master", needsTrack: true },
  { id: "versions", label: "Versions virales", short: "Versions", icon: "versions", needsTrack: true },
  { id: "stems", label: "Stems", short: "Stems", icon: "stems", needsTrack: true },
  { id: "lyrics", label: "Paroles", short: "Paroles", icon: "lyrics", needsTrack: false },
  { id: "topline", label: "Micro prédictif", short: "Topline", icon: "topline", needsTrack: false },
  { id: "voice", label: "Clone de voix", short: "Voix", icon: "voice", needsTrack: false },
  { id: "ai", label: "Détecteur IA", short: "IA ?", icon: "ai", needsTrack: true },
];

export function Rail({ onHome }: { onHome: () => void }) {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const server = useStore((s) => s.server);
  return (
    <nav className="rail" aria-label="Outils">
      <button className="rail__brand" onClick={onHome} aria-label="Accueil Viral Cyb">
        <Logo />
        <span className="rail__word">
          Viral <span className="serif italic">Cyb</span>
        </span>
      </button>
      <ol className="rail__list">
        {NAV.map((n, i) => (
          <li key={n.id}>
            <button data-nav={n.id} className={`rail__item${page === n.id ? " is-on" : ""}`} onClick={() => setPage(n.id)} aria-current={page === n.id ? "page" : undefined}>
              <span className="rail__num mono">{String(i + 1).padStart(2, "0")}</span>
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="rail__foot">
        <span className={`dot${server.ok ? " dot--on" : ""}`} />
        <span className="label">{server.checked ? (server.ok ? "Moteurs IA connectés" : "Mode local") : "…"}</span>
      </div>
    </nav>
  );
}

export function TabBar() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  return (
    <nav className="tabbar" aria-label="Outils">
      {NAV.map((n) => (
        <button key={n.id} data-nav={n.id} className={`tabbar__item${page === n.id ? " is-on" : ""}`} onClick={() => setPage(n.id)} aria-current={page === n.id ? "page" : undefined}>
          <Icon name={n.icon} size={20} />
          <span>{n.short}</span>
        </button>
      ))}
    </nav>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  const gid = `logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <defs>
        <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--green)" />
          <stop offset="1" stopColor="var(--violet)" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="9" fill="none" stroke="var(--line-3)" />
      <path d="M7 18.5 L11 18.5 L13.2 11 L16.4 23 L19.2 8.5 L21.6 18.5 L25 18.5" fill="none" stroke={`url(#${gid})`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
