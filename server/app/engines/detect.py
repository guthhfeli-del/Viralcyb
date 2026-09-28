"""AI-generated song detection with SONICS / SpecTTTra (ICLR 2025, MIT).

The model scores 5-second windows of 16 kHz mono audio; we average the
per-window probabilities over up to ~2 minutes spread across the song."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

import numpy as np

from .. import audio
from ..config import settings
from ..jobs import JobContext
from .base import Availability, Engine, has_module

SR = 16000
WIN = 5 * SR
MAX_WINDOWS = 24

_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    with _lock:
        if _model is None:
            from sonics import HFAudioClassifier

            _model = HFAudioClassifier.from_pretrained(settings.sonics_model)
            _model.eval()
        return _model


def pick_windows(n_samples: int, win: int = WIN, max_windows: int = MAX_WINDOWS) -> list[int]:
    """Start offsets of evenly spread, non-overlapping windows."""
    if n_samples < win:
        return [0]
    count = min(max_windows, n_samples // win)
    if count <= 1:
        return [(n_samples - win) // 2]
    step = (n_samples - win) / (count - 1)
    return [int(round(i * step)) for i in range(count)]


class DetectEngine(Engine):
    name = "detect"
    label = "Détecteur IA"
    inputs = ("audio",)

    def status(self) -> Availability:
        if has_module("sonics") and has_module("torch"):
            return Availability(True, f"SONICS · {settings.sonics_model.split('/')[-1]}")
        return Availability(False, "pip install torch 'sonics @ git+https://github.com/awsaf49/sonics.git'")

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        import torch

        ctx.progress(0.05, "Chargement du modèle SONICS…")
        model = _get_model()
        data, _ = audio.load(files["audio"], target_sr=SR, mono=True)
        x = data[:, 0]
        starts = pick_windows(len(x))
        batch = np.stack([np.pad(x[s : s + WIN], (0, max(0, WIN - len(x[s : s + WIN])))) for s in starts]).astype(np.float32)
        ctx.progress(0.3, "Analyse des fenêtres…")
        probs: list[float] = []
        with torch.no_grad():
            for i in range(0, len(batch), 8):
                logits = model(torch.from_numpy(batch[i : i + 8]))
                probs.extend(torch.sigmoid(logits).reshape(-1).tolist())
                ctx.progress(0.3 + 0.65 * min(1.0, (i + 8) / len(batch)))
        p = float(np.mean(probs)) if probs else 0.0
        return {
            "probability": round(p, 4),
            "model": settings.sonics_model.split("/")[-1],
            "windows": [{"start": round(s / SR, 1), "p": round(q, 4)} for s, q in zip(starts, probs)],
        }
