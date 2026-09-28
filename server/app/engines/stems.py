"""Stem separation: python-audio-separator (Demucs v4 / BS-RoFormer), with the
plain Demucs CLI as a fallback."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from ..config import settings
from ..jobs import JobContext
from .base import Availability, Engine, has_module

MODELS = {
    "htdemucs_6s": "htdemucs_6s.yaml",
    "htdemucs_ft": "htdemucs_ft.yaml",
    "roformer": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
}

STEM_IDS = {"vocals", "drums", "bass", "guitar", "piano", "other", "instrumental"}


def stem_id(filename: str) -> str:
    """'song_(Vocals)_htdemucs_6s.wav' -> 'vocals'; 'drums.wav' -> 'drums'."""
    m = re.search(r"\(([^)]+)\)", filename)
    raw = (m.group(1) if m else Path(filename).stem).strip().lower()
    raw = {"no vocals": "instrumental", "no_vocals": "instrumental", "accompaniment": "instrumental"}.get(raw, raw)
    return raw if raw in STEM_IDS else re.sub(r"[^a-z0-9]+", "-", raw).strip("-") or "stem"


class StemsEngine(Engine):
    name = "stems"
    label = "Séparation de stems"
    inputs = ("audio",)

    def status(self) -> Availability:
        if has_module("audio_separator"):
            return Availability(True, "python-audio-separator (Demucs v4 · BS-RoFormer)")
        if has_module("demucs"):
            return Availability(True, "Demucs v4 (CLI)")
        return Availability(False, "pip install 'audio-separator[cpu]' (ou [gpu])")

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        model = params.get("model", "htdemucs_6s")
        if model not in MODELS:
            model = "htdemucs_6s"
        src = files["audio"]
        ctx.progress(0.05, "Chargement du modèle…")
        if has_module("audio_separator"):
            outputs = self._separator(ctx, src, model)
        else:
            outputs = self._demucs_cli(ctx, src, "htdemucs_6s" if model == "roformer" else model)
        stems = []
        for path in outputs:
            sid = stem_id(path.name)
            final = path.with_name(f"{sid}.wav")
            if final != path:
                path.replace(final)
            ctx.add_file(final, sid)
            stems.append(sid)
        if not stems:
            raise RuntimeError("La séparation n'a produit aucun fichier.")
        return {"model": model, "stems": stems}

    def _separator(self, ctx: JobContext, src: Path, model: str) -> list[Path]:
        from audio_separator.separator import Separator

        kwargs: dict[str, Any] = {"output_dir": str(ctx.work_dir), "output_format": "WAV"}
        if settings.stems_model_dir:
            kwargs["model_file_dir"] = settings.stems_model_dir
        sep = Separator(**kwargs)
        sep.load_model(model_filename=MODELS[model])
        ctx.progress(0.2, "Séparation en cours…")
        names = sep.separate(str(src))
        ctx.progress(0.95, "Finalisation…")
        out = []
        for n in names:
            p = Path(n)
            out.append(p if p.is_absolute() else ctx.work_dir / p)
        return [p for p in out if p.exists()]

    def _demucs_cli(self, ctx: JobContext, src: Path, model: str) -> list[Path]:
        ctx.progress(0.2, "Séparation en cours (Demucs)…")
        proc = subprocess.run(
            [sys.executable, "-m", "demucs", "-n", model, "-o", str(ctx.work_dir), str(src)],
            capture_output=True,
            text=True,
            timeout=3600,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"Demucs a échoué : {proc.stderr[-400:]}")
        return sorted((ctx.work_dir / model).glob("*/*.wav"))
