"""Audio-to-MIDI with Spotify Basic Pitch (Apache-2.0)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..jobs import JobContext
from .base import Availability, Engine, has_module


class ToplineEngine(Engine):
    name = "topline"
    label = "Transcription MIDI"
    inputs = ("audio",)

    def status(self) -> Availability:
        if has_module("basic_pitch"):
            return Availability(True, "Basic Pitch (Spotify)")
        return Availability(False, "pip install basic-pitch")

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        from basic_pitch.inference import predict

        ctx.progress(0.1, "Transcription des notes…")
        _, midi, note_events = predict(str(files["audio"]))
        out = ctx.out_dir / "topline.mid"
        midi.write(str(out))
        ctx.add_file(out, "midi")
        notes = [
            {"start": round(float(s), 3), "end": round(float(e), 3), "midi": int(p), "velocity": int(max(1, min(127, round(float(a) * 127))))}
            for s, e, p, a, *_ in note_events
        ]
        notes.sort(key=lambda n: n["start"])
        return {"notes": notes}
