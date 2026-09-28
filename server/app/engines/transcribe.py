"""Lyrics transcription: faster-whisper (MIT) locally, or Whisper through
OpenRouter when only an OPENROUTER_API_KEY is available."""

from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any

from .. import audio, openrouter
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
        if openrouter.api_key():
            return Availability(True, f"OpenRouter · {settings.openrouter_stt_model}")
        return Availability(False, "pip install faster-whisper, ou définis OPENROUTER_API_KEY")

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        if not has_module("faster_whisper"):
            return self._openrouter(ctx, files["audio"], params.get("language") or None)
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

    def _openrouter(self, ctx: JobContext, src: Path, language: str | None) -> dict[str, Any]:
        # 16 kHz mono FLAC keeps a 4-minute song around 4 MB (Whisper caps uploads at 25 MB)
        ctx.progress(0.1, "Préparation de l'audio…")
        data, sr = audio.load(src, target_sr=16000, mono=True)
        flac = audio.write_flac(ctx.work_dir / "speech.flac", data, sr)
        ctx.progress(0.3, "Transcription (OpenRouter)…")
        res = openrouter.transcribe(flac.read_bytes(), "flac", language)
        text = (res.get("text") or "").strip()
        # one line per sentence reads better in the lyrics editor
        lines = [ln.strip() for ln in re.split(r"(?<=[.!?…])\s+|\n+", text) if ln.strip()]
        return {"language": res.get("language") or language, "segments": [], "text": "\n".join(lines)}
