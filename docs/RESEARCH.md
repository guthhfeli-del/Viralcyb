# Recherche — viralité, concurrents, briques open source

*Septembre 2026. Synthèse de la recherche faite pour concevoir Viral Cyb, et de la façon dont chaque résultat est utilisé dans l'application.*

## 1. Ce qui rend un son viral (et ce qu'on peut mesurer)

| Constat | Source | Où c'est utilisé |
|---|---|---|
| Dans le top 10 US, l'intro moyenne est passée de plus de 20 s (milieu des années 80) à environ 5 s ; le tempo a augmenté et le titre est chanté plus tôt. | Léveillé Gauvin, *Musicae Scientiae* 2018 ([Ohio State](https://news.osu.edu/has-music-streaming-killed-the-instrumental-intro/)) | Critère « Accroche immédiate » (pleine note ≤ 5 s), conseil « hook trop tard », title-drop dans l'onglet Paroles |
| Sur TikTok, la décision se prend dans les 3 premières secondes ; les producteurs placent le hook dans les 3–5 premières secondes et conçoivent des extraits qui bouclent. | [Soundstripe](https://www.soundstripe.com/blogs/how-tiktok-is-changing-the-music-industry), [InspiredByBeatz](https://www.inspiredbybeatz.com/en/hook-first-2026-songs-for-the-first-15-seconds/) | Note maximale si l'accroche arrive ≤ 3 s ; extrait TikTok calé sur les mesures avec score de boucle ; plan de structure « Hook-first » |
| Sur 250 sons viraux TikTok analysés, 198 dépassent 100 BPM ; la dansabilité ressort comme un facteur clé. | [analyse de 250 sons viraux (J. Viner)](https://www.linkedin.com/pulse/how-make-viral-tiktok-song-analyzing-data-behind-most-josh-viner), [PMC 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12453869/) | Critère « Groove & tempo » (fenêtres de tempo par genre + dansabilité mesurée) |
| La plupart des utilisateurs n'utilisent que 10–15 s d'un son. | [même analyse](https://www.linkedin.com/pulse/how-make-viral-tiktok-song-analyzing-data-behind-most-josh-viner) | Extrait de 11–17 s, micro-boucle de ~7 s |
| Les versions sped-up / slowed + reverb sont devenues un format de sortie officiel des labels et font parfois plus que l'original. | [Chartmetric](https://hmc.chartmetric.com/nightcore-slowed-reverb-tiktok-remix/), [NBC](https://www.nbcnews.com/pop-culture/viral/tiktok-sped-up-fast-songs-sounds-rcna79256) | Onglet Versions (sped up, nightcore, slowed + reverb, 8D, lo-fi, bass boost) |
| La viralité est plus rapide mais moins durable : il fallait ~340 jours pour atteindre 100k posts en 2020, ~50 en 2025, et moins de sons viraux deviennent des hits durables. | [Chartmetric](https://hmc.chartmetric.com/why-tiktok-songs-go-viral-faster/) | Le score reste un indicateur de préparation, pas une prédiction de streams (dit explicitement dans l'interface) |
| Normalisation : Spotify/YouTube/Tidal/Amazon ≈ −14 LUFS, Apple ≈ −16 LUFS, TikTok/Instagram ≈ −14/−15 ; plafond true peak −1 dBTP. | [Soundplate](https://soundplate.com/streaming-loudness-lufs-table/), [Sage Audio](https://www.sageaudio.com/articles/mastering-for-streaming-platform-loudness-and-normalization-explained) | Presets de master, critère Loudness (PLR 6–12 dB pour garder le punch après normalisation), limiteur true-peak |
| Tempo, énergie, loudness et dansabilité sont les attributs audio les plus corrélés à la popularité dans les études récentes. | [arXiv 2505.07280](https://arxiv.org/html/2505.07280v1), [arXiv 2508.11632](https://arxiv.org/html/2508.11632) | Critères Groove, Arc d'énergie, Loudness |

**Choix de conception.** Viral Cyb n'invente pas une « probabilité de hit » opaque : le score combine 9 critères mesurables, pondérés et expliqués un par un (valeur mesurée, pourquoi c'est important, action à faire). Les poids favorisent ce qui se joue dans les premières secondes et la répétition du hook, parce que c'est là que la recherche est la plus convergente.

## 2. Plateformes existantes

| Plateforme | Ce qu'elle fait | Ce que Viral Cyb fait en plus / autrement |
|---|---|---|
| **Santo** ([santomusic.io](https://www.santomusic.io/)) | « Hit-engine » : 12 stations d'analyse, 312 dimensions acoustiques, benchmark sur ~4 M titres classés ; timing du hook, densité vocale, placement des drops, boucle TikTok de 7 s ; remixes IA. *Site non accessible depuis notre environnement : infos issues des pages indexées.* | Analyse **locale et instantanée** (le son ne quitte pas l'appareil), score **transparent** critère par critère, test d'écoute en temps réel sur 9 supports, master téléchargeable, micro prédictif, stems et clone de voix open source. |
| **SIQA** ([thesiqa.com](https://www.thesiqa.com/)) | Charts et rapports dédiés à la musique IA, registre de vérification, exigence de transparence et interdiction des voix clonées non autorisées. | Détecteur IA intégré (indices locaux + modèle SONICS), consentement obligatoire pour le clone de voix, rappel de déclarer l'usage de l'IA. |
| Chartmetric, Soundcharts | Données de streaming et de réseaux sociaux (après la sortie). | Viral Cyb agit **avant** la sortie, sur le son lui-même. |
| LANDR, eMastered, iZotope Ozone | Mastering (en ligne ou plugin). | Master local gratuit avec presets orientés plateformes (TikTok, Club…), A/B à volume égal, master par référence (Matchering). |
| LALAL.AI, Moises | Séparation de stems. | Stems via Demucs/RoFormer open source + mixeur multipiste, envoi d'un stem vers le test supports ou le clone de voix. |
| Deezer, SubmitHub, IRCAM Amplify, Sightengine, AHA Music | Détection de musique IA. | Indices expliqués + modèle SONICS ; intégré dans le même flux que le reste. |

## 3. Briques open source retenues

| Besoin | Projet | Pourquoi |
|---|---|---|
| Stems | Demucs v4 (`htdemucs_6s`, 6 stems) et BS-RoFormer via **python-audio-separator** (MIT, ~1,4k ★) | Meilleure qualité open source actuelle, CPU possible |
| Master par référence | **Matchering 2.0** (GPL-3.0, ~2,6k ★) | Aligne RMS, réponse en fréquence, crête et largeur stéréo sur une référence |
| Paroles depuis l'audio | **faster-whisper** (MIT) | Whisper rapide, CPU/GPU |
| Topline → MIDI | **Basic Pitch** de Spotify (Apache-2.0, ~5,6k ★) | Transcription polyphonique fiable |
| Détection IA | **SONICS / SpecTTTra** (ICLR 2025, MIT) | Modèle entraîné sur 97k chansons (49k générées par Suno/Udio) |
| Clone de voix chantée | **Seed-VC** (GPL-3.0, ~3,9k ★) | Zéro-shot à partir de 1–30 s de voix, conditionnement f0 pour le chant |
| Versions IA dans un autre genre | **ACE-Step 1.5** (MIT, ~12,9k ★, n°1 du topic GitHub *ai-music*) | Tâche « cover » pilotée par le morceau source, API REST, ≥ 4 Go de VRAM |
| Variantes de paroles | API **Claude** | Réécritures fondées sur le texte de l'artiste, sortie structurée |

**Écartés à dessein.**
- Le code du détecteur de Deezer (*A Fourier Explanation of AI-music Artifacts*, meilleur article ISMIR 2025) est sous **CC BY-NC 4.0** et couvert par des demandes de brevet : non réutilisable commercialement. Les indices locaux de Viral Cyb reposent sur une implémentation indépendante (stationnarité des pics fins entre sections, bande passante, netteté des transitoires) et sont présentés comme des indices, pas comme un verdict.
- MusicGen (AudioCraft) : poids sous licence non commerciale ; ACE-Step (MIT) couvre le même besoin.

## 4. Ce qui tourne où

- **Navigateur (TypeScript, Web Worker)** : loudness BS.1770-4 (conforme aux cas de test EBU 3341), true peak 4×, spectre 1/3 d'octave vs cibles par genre, stéréo, tempo + beats (programmation dynamique d'Ellis), tonalité (profils Krumhansl-Kessler + Temperley), structure et hook (matrices d'auto-similarité, nouveauté de Foote, répétitions diagonales), score viral, conseils, mastering (EQ, basses mono, compression de bus, saturation, limiteur look-ahead true-peak, recherche de loudness), versions (OfflineAudioContext), séparation rapide par extraction du centre, YIN temps réel + prédiction de notes, analyse des paroles.
- **Serveur (Python, optionnel)** : les modèles de la section 3.

## 5. Limites connues

- Le score mesure la préparation du son, pas son destin : la sortie, la communauté et le timing comptent autant.
- La présence vocale est estimée sans séparation (énergie centrée 300 Hz–3,4 kHz) ; elle devient exacte avec le stem voix.
- La reconnaissance des paroles en direct utilise l'API vocale du navigateur (Chrome/Edge/Safari) et reste approximative sur du chant.
- Aucun détecteur d'IA n'est infaillible.
