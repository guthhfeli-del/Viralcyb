import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "./state/store";
import { Home } from "./pages/Home";
import { Rail, TabBar, NAV, Logo } from "./ui/Nav";
import { PlayerBar } from "./ui/PlayerBar";
import { AnalysisOverlay } from "./ui/AnalysisOverlay";
import { refreshServer, ServerButton } from "./ui/ServerDialog";
import { player } from "./lib/player";
import { useGenre, useDisplayBpm } from "./state/hooks";
import { GENRES, type GenreId } from "./engine/genres";
import { fmt, formatTime } from "./dsp/util";
import { Empty } from "./ui/Bits";
import { Dropzone } from "./ui/Dropzone";
import { loadDemo, loadFile } from "./lib/loadTrack";
import { Icon } from "./ui/Icon";

const Score = lazy(() => import("./pages/Score"));
const Mix = lazy(() => import("./pages/Mix"));
const Devices = lazy(() => import("./pages/Devices"));
const Master = lazy(() => import("./pages/Master"));
const Versions = lazy(() => import("./pages/Versions"));
const Stems = lazy(() => import("./pages/Stems"));
const Lyrics = lazy(() => import("./pages/Lyrics"));
const Topline = lazy(() => import("./pages/Topline"));
const Voice = lazy(() => import("./pages/Voice"));
const AiDetect = lazy(() => import("./pages/AiDetect"));

const PAGES = { score: Score, mix: Mix, devices: Devices, master: Master, versions: Versions, stems: Stems, lyrics: Lyrics, topline: Topline, voice: Voice, ai: AiDetect };

export default function App() {
  const track = useStore((s) => s.track);
  const page = useStore((s) => s.page);
  const [inStudio, setInStudio] = useState(false);

  useEffect(() => {
    void refreshServer();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.code === "Space" && useStore.getState().track) {
        e.preventDefault();
        player.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.querySelector(".main")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [page]);

  if (!inStudio && !track) return <Home onEnter={() => setInStudio(true)} />;

  const nav = NAV.find((n) => n.id === page)!;
  const Page = PAGES[page];
  const home = () => {
    player.clear();
    useStore.getState().reset();
    setInStudio(false);
  };
  return (
    <div className={`shell${track ? " has-track" : ""}`}>
      <Rail onHome={home} />
      <div className="main">
        <TopBar onHome={home} />
        <main className="content" id="content">
          {nav.needsTrack && !track ? (
            <NoTrack />
          ) : (
            <Suspense fallback={<div className="page-loading" />}>
              <Page />
            </Suspense>
          )}
        </main>
      </div>
      <PlayerBar />
      <TabBar />
      <AnalysisOverlay />
    </div>
  );
}

function TopBar({ onHome }: { onHome: () => void }) {
  const track = useStore((s) => s.track);
  const features = useStore((s) => s.features);
  const genre = useStore((s) => s.genre);
  const setGenre = useStore((s) => s.setGenre);
  const g = useGenre();
  const bpm = useDisplayBpm();
  return (
    <header className="topbar">
      <button className="topbar__brand" onClick={onHome} aria-label="Accueil">
        <Logo size={26} />
      </button>
      <div className="topbar__track">
        {track ? (
          <>
            <span className="topbar__name">{track.name}</span>
            {features && (
              <span className="topbar__facts mono">
                <span>{Math.round(bpm ?? features.rhythm.bpm)} BPM</span>
                <span>{features.key.short} · {features.key.camelot}</span>
                <span>{formatTime(features.meta.duration)}</span>
                <span>{fmt(features.loudness.integrated)} LUFS</span>
              </span>
            )}
          </>
        ) : (
          <span className="topbar__name faint">Aucun son chargé</span>
        )}
      </div>
      <div className="topbar__right">
        {features && (
          <label className="select">
            <span className="label">Genre</span>
            <select value={genre} onChange={(e) => setGenre(e.target.value as GenreId | "auto")} aria-label="Genre de référence">
              <option value="auto">Auto · {g.auto ? g.label : "détection"}</option>
              {GENRES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="topbar__server">
          <ServerButton />
        </span>
      </div>
    </header>
  );
}

function NoTrack() {
  return (
    <div className="notrack rise">
      <Empty icon="upload" title="Charge un son pour commencer">
        Cet outil a besoin d'un morceau. Tout est analysé dans ton navigateur.
      </Empty>
      <Dropzone onFile={(f) => void loadFile(f)} />
      <button className="linkbtn" onClick={() => void loadDemo()}>
        <Icon name="play" size={14} /> Utiliser le son démo
      </button>
    </div>
  );
}
