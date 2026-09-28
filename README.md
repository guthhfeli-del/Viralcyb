# Viral Cyb

**Teste la viralité de ton son — et repars avec une version prête à poster.**

Viral Cyb est une application web installable (téléphone et ordinateur) qui analyse un morceau comme le ferait une équipe A&R + ingé son + topliner :

| # | Outil | Ce qu'il fait | Où ça tourne |
|---|---|---|---|
| 01 | **Score viral** | 9 critères pondérés et expliqués : accroche des premières secondes, force et répétition du hook, groove & tempo, arc d'énergie, loudness & punch, clarté de la voix, rendu téléphone/mono, format & boucle. Timeline avec sections (intro, couplet, refrain…), hook ▲ et meilleur extrait TikTok à écouter en boucle. | navigateur |
| 02 | **Mix & structure** | Équilibre tonal 1/3 d'octave contre une cible par genre, loudness EBU R128, stéréo, actions chiffrées (« −2,3 dB à 630 Hz »), plans de structure calés sur ton BPM, idées de production (808 accordée sur la tonalité, silence avant le drop…). | navigateur |
| 03 | **Test supports** | Écoute en temps réel comme sur un téléphone, des écouteurs, un laptop, en voiture, sur une enceinte Bluetooth, en club, à la radio FM ou en mono — avec un score de traduction par support. | navigateur |
| 04 | **Mastering** | Presets Streaming / Équilibré / TikTok / Club / Chaleureux, EQ correctif automatique, basses mono, compression de bus, saturation, limiteur true-peak −1 dBTP, cible LUFS, A/B à volume égal, export WAV 24/16 bits, master par référence (local ou Matchering). | navigateur (+ serveur) |
| 05 | **Versions virales** | Sped up, nightcore, slowed + reverb, 8D, bass boost, lo-fi, extrait TikTok calé sur les mesures, boucle ×3, instru rapide — et réinterprétation IA dans un autre genre (ACE-Step). | navigateur (+ serveur) |
| 06 | **Stems** | Voix, batterie, basse, guitare, piano, autres (Demucs v4 / BS-RoFormer), mixeur multipiste ; séparation rapide locale sans serveur. | serveur (+ navigateur) |
| 07 | **Paroles** | Syllabes, schéma de rimes, lignes les plus « hook », phrases signature, title-drop, restructurations ; variantes réécrites par Claude (plus accrocheur, hook TikTok, version anglaise, radio…). | navigateur (+ serveur) |
| 08 | **Micro prédictif** | Chante : ta topline s'écrit en notes en direct sur un piano roll, la tonalité se cale, la note suivante la plus probable s'affiche ; paroles en direct, export MIDI, variations de hook, chant sur le beat. | navigateur |
| 09 | **Clone de voix** | Ta voix (10–30 s) sur n'importe quelle topline, avec consentement obligatoire (Seed-VC). | serveur |
| 10 | **Détecteur IA** | Indices spectraux locaux + modèle SONICS entraîné sur Suno/Udio. | navigateur (+ serveur) |

Tout ce qui peut tourner dans le navigateur y tourne : **ton son ne quitte pas ton appareil** tant que tu n'utilises pas un moteur serveur. Les modèles lourds sont optionnels et s'activent un par un.

La recherche derrière le score (études sur les intros, données TikTok, normes de loudness, concurrents comme Santo et SIQA, choix des dépôts open source) est dans [`docs/RESEARCH.md`](docs/RESEARCH.md).

## Lancer l'app

**Front seul (analyse, score, master, versions, micro…) :**

```bash
cd web
npm install
npm run dev        # http://localhost:5173 — sur le même Wi-Fi, ouvre l'URL "Network" sur ton téléphone
```

Bouton **« Essayer avec le son démo »** sur l'accueil pour tout tester sans fichier.

**Front + serveur (stems, Matchering, Whisper, SONICS, Seed-VC, ACE-Step, Claude) :**

```bash
docker compose up --build            # http://localhost:8000
```

ou sans Docker : voir [`server/README.md`](server/README.md).

> Le micro (topline, clone de voix) exige HTTPS ou `localhost`. Pour tester sur téléphone, sers l'app en HTTPS (reverse proxy, tunnel) ou installe-la comme application depuis le navigateur (« Ajouter à l'écran d'accueil ») une fois déployée.

## Installer sur téléphone / ordinateur

Viral Cyb est une PWA : manifeste, icônes et service worker (hors ligne pour l'interface). Depuis Chrome/Edge : menu → *Installer l'application* ; depuis Safari iOS : Partager → *Sur l'écran d'accueil*.

## Architecture

```
web/                      React 19 + TypeScript + Vite (PWA)
  src/dsp/                moteur audio pur TS : loudness BS.1770, FFT, tempo/beats, tonalité,
                          structure & hook, tonal/stéréo, indices IA, mastering, YIN, topline, MIDI, WAV
  src/engine/             analyse complète, score viral, conseils, genres, supports, paroles
  src/workers/            Web Worker (l'analyse et le master ne bloquent jamais l'interface)
  src/pages/              les 10 outils
  tests/                  vitest (conformité EBU 3341, tempo, tonalité, structure, master, topline…)
server/                   FastAPI : file de jobs, moteurs optionnels, variantes de paroles (Claude)
  tests/                  pytest (API, sécurité des fichiers, moteurs)
docs/RESEARCH.md          recherche et sources
```

Design : minimaliste, sombre, vert menthe et lavande (jamais néon), Geist + Instrument Serif, grain léger, typographie éditoriale inspirée des sites « godly ».

## Tests

```bash
cd web && npm test && npm run build
cd server && python -m pytest
```

## Honnêteté

Le score mesure à quel point ton son est **prêt** pour les usages viraux ; il ne prédit pas les streams. Le détecteur IA donne des indices et une probabilité, pas une preuve. Le clone de voix est réservé à ta propre voix ou à une voix dont tu as l'autorisation.
