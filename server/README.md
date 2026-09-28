# Viral Cyb — serveur (FastAPI)

Le serveur est **optionnel** : l'application web fait l'analyse, le score viral, le mastering, les versions, le test supports et le micro prédictif directement dans le navigateur. Le serveur ajoute les modèles lourds, chacun activable séparément.

| Moteur (`/api/jobs/<kind>`) | Rôle | Projet open source | Licence | Installation |
|---|---|---|---|---|
| `stems` | Voix, batterie, basse, guitare, piano, autres | [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) (Demucs v4 `htdemucs_6s`, BS-RoFormer) | MIT | `pip install "audio-separator[cpu]"` (ou `[gpu]`) |
| `master_ref` | Master calé sur une référence | [Matchering 2.0](https://github.com/sergree/matchering) | GPL-3.0 | `pip install matchering` |
| `transcribe` | Paroles depuis l'audio | Whisper via [OpenRouter](https://openrouter.ai) (`openai/whisper-1`), ou [faster-whisper](https://github.com/SYSTRAN/faster-whisper) en local | — / MIT | `OPENROUTER_API_KEY`, ou `pip install faster-whisper` |
| `topline` | Audio → MIDI | [Basic Pitch](https://github.com/spotify/basic-pitch) | Apache-2.0 | `pip install basic-pitch` |
| `detect` | Chanson générée par IA ? | [SONICS / SpecTTTra](https://github.com/awsaf49/sonics) (ICLR 2025) | MIT | `pip install torch "sonics @ git+https://github.com/awsaf49/sonics.git"` |
| `voice` | Conversion de voix chantée zéro-shot | [Seed-VC](https://github.com/Plachtaa/seed-vc) | GPL-3.0 | checkout séparé + `VIRALCYB_SEEDVC_DIR` |
| `generate` | Réinterprétation du morceau dans un autre genre | [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) | MIT | serveur API ACE-Step + `VIRALCYB_ACESTEP_URL` |
| `/api/lyrics/variants` | Variantes de paroles | Claude via OpenRouter (`anthropic/claude-opus-5`, sortie JSON stricte), ou API Anthropic en direct | — | `OPENROUTER_API_KEY` (prioritaire) ou `ANTHROPIC_API_KEY` |

La séparation 4 stems (HT-Demucs) et l'audio → MIDI (Basic Pitch) tournent aussi **dans le navigateur**, sans ce serveur : les moteurs `stems` et `topline` ci-dessus ne servent qu'à monter en qualité (6 stems, RoFormer).

`GET /api/health` indique quels moteurs sont disponibles ; l'interface affiche l'état et explique comment activer ceux qui manquent.

## Démarrage

```bash
cd server
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
# + les moteurs voulus, par ex. :
pip install matchering faster-whisper "audio-separator[cpu]"
uvicorn app.main:app --port 8000
```

En développement, `npm run dev` dans `web/` redirige `/api` vers `http://127.0.0.1:8000` (variable `VIRALCYB_API` pour changer). En production, le serveur sert aussi le build du front (`web/dist`) : un seul processus, une seule URL.

### Seed-VC (clone de voix)

```bash
git clone https://github.com/Plachtaa/seed-vc.git /opt/seed-vc
cd /opt/seed-vc && python -m venv .venv && .venv/bin/pip install -r requirements.txt
export VIRALCYB_SEEDVC_DIR=/opt/seed-vc
export VIRALCYB_SEEDVC_PYTHON=/opt/seed-vc/.venv/bin/python
```

Le serveur refuse toute conversion sans le champ `consent=true` envoyé par l'interface (case à cocher obligatoire).

### ACE-Step 1.5 (versions IA)

```bash
git clone https://github.com/ace-step/ACE-Step-1.5.git && cd ACE-Step-1.5
# suivre leur README (uv, GPU ≥ 4 Go de VRAM), puis :
python -m acestep.api_server --api-key <secret>        # port 8001
export VIRALCYB_ACESTEP_URL=http://127.0.0.1:8001
export VIRALCYB_ACESTEP_KEY=<secret>
```

Viral Cyb utilise la tâche `cover` : le morceau conditionne la génération ; le curseur « intensité » de l'interface pilote `audio_cover_strength` (plus bas = plus libre).

### Pas de GPU sur ta machine ?

Seed-VC (clone de voix) et ACE-Step (remix IA) ont besoin d'une carte graphique. Deux options sans rien acheter :

- **GPU loué à l'heure** (RunPod, Vast.ai, Lambda, Paperspace…) : une instance avec Docker et une carte ≥ 8 Go, tu clones le dépôt, tu lances `docker compose up` + les services Seed-VC et ACE-Step, et tu pointes l'app (bouton « Moteurs serveur ») vers l'URL de l'instance. Tu éteins quand tu as fini.
- **GPU gratuit ponctuel** : Google Colab ou un Space Hugging Face (ZeroGPU) pour lancer ACE-Step ou Seed-VC le temps d'une session, exposés via leur API ; renseigne ensuite `VIRALCYB_ACESTEP_URL` / `VIRALCYB_SEEDVC_DIR` côté serveur.

SONICS (détecteur IA) tourne sur CPU : `pip install torch "sonics @ git+https://github.com/awsaf49/sonics.git"` suffit.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Variantes de paroles + transcription via OpenRouter |
| `VIRALCYB_OPENROUTER_MODEL` | `anthropic/claude-opus-5` | Modèle OpenRouter des variantes de paroles |
| `VIRALCYB_OPENROUTER_STT_MODEL` | `openai/whisper-1` | Modèle OpenRouter de transcription |
| `VIRALCYB_PUBLIC_URL` | — | URL publique de l'app (en-tête `HTTP-Referer` pour OpenRouter) |
| `VIRALCYB_DATA_DIR` | `server/data` | Stockage temporaire des jobs |
| `VIRALCYB_STATIC_DIR` | `web/dist` | Build du front à servir |
| `VIRALCYB_ALLOWED_ORIGINS` | `*` | CORS (à restreindre en production) |
| `VIRALCYB_MAX_UPLOAD_MB` | `200` | Taille max par fichier |
| `VIRALCYB_MAX_WORKERS` | `1` | Jobs en parallèle (1 par GPU) |
| `VIRALCYB_MAX_QUEUED_JOBS` | `32` | File d'attente max |
| `VIRALCYB_JOB_TTL_HOURS` | `6` | Suppression des fichiers après traitement |
| `VIRALCYB_WHISPER_MODEL` | `small` | Taille du modèle Whisper |
| `VIRALCYB_SONICS_MODEL` | `awsaf49/sonics-spectttra-gamma-5s` | Modèle SONICS (Hugging Face) |
| `VIRALCYB_CLAUDE_MODEL` | `claude-opus-5` | Modèle des variantes via l'API Anthropic directe |

## Sécurité

- Uploads limités en taille et en extension, écrits dans un dossier par job, jamais servis en retour ; seuls les fichiers produits par le moteur sont téléchargeables.
- Limitation de débit par IP sur la création de jobs et les variantes de paroles.
- Les fichiers expirent après `VIRALCYB_JOB_TTL_HOURS`.
- Aucune clé n'est exposée au navigateur : l'appel à Claude se fait côté serveur.

## Tests

```bash
pip install pytest httpx
python -m pytest
```

Les tests couvrent le cycle de vie des jobs, la validation des uploads, l'accès aux fichiers, la limitation de débit, l'endpoint paroles (client Claude simulé) et le câblage de chaque moteur avec des modules de substitution qui reproduisent les API documentées.
