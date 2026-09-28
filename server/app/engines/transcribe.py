"""Lyrics transcription with faster-whisper (MIT)."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from ..config import settings
from ..jobs import JobContext
from .base import Availability, Engine, has_module

_model = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            _model = WhisperModel(settings.whisper_model, device="auto", compute_type="default")
        return _model


class TranscribeEngine(Engine):
    name = "transcribe"
    label = "Transcription des paroles"
    inputs = ("audio",)

    def status(self) -> Availability:
        if has_module("faster_whisper"):
            return Availability(True, f"faster-whisper · modèle {settings.whisper_model}")
        return Availability(False, "pip install faster-whisper")

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        ctx.progress(0.05, "Chargement de Whisper…")
        model = _get_model()
        language = params.get("language") or None
        ctx.progress(0.15, "Transcription…")
        segments, info = model.transcribe(str(files["audio"]), language=language, vad_filter=True)
        out: list[dict[str, Any]] = []
        duration = max(1e-6, float(getattr(info, "duration", 0.0) or 0.0))
        for seg in segments:
            text = seg.text.strip()
            if text:
                out.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
            if duration > 0:
                ctx.progress(0.15 + 0.8 * min(1.0, seg.end / duration), "Transcription…")
        return {
            "language": getattr(info, "language", None),
            "segments": out,
            "text": "\n".join(s["text"] for s in out),
        }
