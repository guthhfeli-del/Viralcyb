import { useStore } from "../state/store";
import { loadDemo, loadFile } from "../lib/loadTrack";
import { Dropzone } from "../ui/Dropzone";
import { Logo, NAV } from "../ui/Nav";
import { Icon } from "../ui/Icon";
import { ServerButton } from "../ui/ServerDialog";
import { useInstallPrompt } from "../lib/install";

const DESCRIPTIONS: Record<string, string> = {
  score: "Hook, accroche des 3 premières secondes, répétition, groove, loudness, format — 9 critères pondérés et expliqués.",
  mix: "Équilibre tonal contre des références par genre, conseils chiffrés, plans de structure calés sur ton BPM.",
  devices: "Téléphone, voiture, écouteurs, club, radio FM, enceinte Bluetooth, mono — en temps réel.",
  master: "Presets Streaming → Club, limiteur true-peak, master par référence, export WAV.",
  versions: "Sped up, nightcore, slowed + reverb, 8D, bass boost, lo-fi, extrait TikTok bouclé.",
  stems: "Voix, batterie, basse, guitare, piano, autres — Demucs / RoFormer, ou séparation rapide locale.",
  lyrics: "Syllabes, rimes, répétitions, lignes les plus « hook », variantes réécrites par IA.",
  topline: "Chante : les notes s'écrivent en direct, la suivante est prédite dans la tonalité du beat.",
  voice: "Ta voix clonée sur n'importe quelle topline (Seed-VC), avec consentement.",
  ai: "Indices spectraux d'IA générative + modèle SONICS côté serveur.",
};

export function Home({ onEnter }: { onEnter: () => void }) {
  const setPage = useStore((s) => s.setPage);
  const error = useStore((s) => s.error);
  const install = useInstallPrompt();
  const open = (id: (typeof NAV)[number]["id"]) => {
    setPage(id);
    onEnter();
  };
  return (
    <div className="home">
      <div className="home__glow" aria-hidden="true" />
      <header className="home__top">
        <div className="home__brand">
          <Logo size={30} />
          <span>
            Viral <span className="serif italic">Cyb</span>
          </span>
        </div>
        <div className="home__actions">
          {install && (
            <button className="linkbtn" onClick={() => void install()}>
              <Icon name="download" size={15} /> Installer l'app
            </button>
          )}
          <ServerButton />
        </div>
      </header>

      <main className="home__main">
        <section className="hero">
          <span className="label rise">Laboratoire de viralité · analyse locale</span>
          <h1 className="hero__title rise" style={{ animationDelay: "60ms" }}>
            Ton son, <span className="serif italic hero__accent">prêt à devenir</span> viral.
          </h1>
          <p className="hero__lead muted rise" style={{ animationDelay: "120ms" }}>
            Score de viralité, mix, master, stems, paroles, topline et détection IA. Dépose un morceau : tu repars avec un son testé sur tous les supports et des actions précises pour le faire exploser.
          </p>
          <div className="hero__drop rise" style={{ animationDelay: "180ms" }}>
            <Dropzone
              onFile={(f) => {
                onEnter();
                void loadFile(f);
              }}
            />
            {error && <p className="hero__error">{error}</p>}
            <div className="hero__alt">
              <button
                className="linkbtn"
                onClick={() => {
                  onEnter();
                  void loadDemo();
                }}
              >
                <Icon name="play" size={14} /> Essayer avec le son démo
              </button>
              <button className="linkbtn" onClick={() => open("topline")}>
                <Icon name="topline" size={16} /> Micro prédictif
              </button>
              <button className="linkbtn" onClick={() => open("lyrics")}>
                <Icon name="lyrics" size={16} /> Analyser des paroles
              </button>
            </div>
          </div>
        </section>

        <section className="index" aria-label="Fonctionnalités">
          <div className="index__head">
            <span className="label">Dix outils, un seul objectif</span>
            <span className="label">{NAV.length.toString().padStart(2, "0")}</span>
          </div>
          <ol className="index__list">
            {NAV.map((n, i) => (
              <li key={n.id} className="index__row rise" style={{ animationDelay: `${220 + i * 40}ms` }}>
                <span className="index__num mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="index__name">{n.label}</span>
                <span className="index__desc muted">{DESCRIPTIONS[n.id]}</span>
                <span className="index__tag label">{n.needsTrack ? "Son requis" : "Direct"}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <footer className="home__foot">
        <span className="label">Viral Cyb</span>
        <span className="faint">L'analyse tourne dans ton navigateur : ton son ne quitte pas ton appareil, sauf si tu utilises un moteur IA serveur.</span>
      </footer>
    </div>
  );
}
