"""AI re-interpretations of a song in another style through an ACE-Step 1.5
API server (MIT). Uses the `cover` task: the uploaded song conditions the
generation, `audio_cover_strength` controls how closely it is followed."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import httpx

from ..config import settings
from ..jobs import JobContext
from .base import Availability, Engine, param_float, param_int

POLL_SECONDS = 3
TIMEOUT_SECONDS = 1800


def cover_strength(intensity: float) -> float:
    """UI 'transformation intensity' (0 = faithful, 1 = free) -> ACE-Step cover strength."""
    return round(max(0.1, min(0.95, 1.0 - intensity)), 2)


def build_prompt(style: str, extra: str, bpm: int | None, key: str | None) -> str:
    parts = [style.strip()]
    if extra.strip():
        parts.append(extra.strip())
    if bpm:
        parts.append(f"{bpm} BPM")
    if key:
        parts.append(f"in {key}")
    parts.append("radio-ready mix, punchy, modern production")
    return ", ".join(p for p in parts if p)


class GenerateEngine(Engine):
    name = "generate"
    label = "Génération de versions"
    inputs = ("audio",)

    def status(self) -> Availability:
        if not settings.acestep_url:
            return Availability(False, "Lance le serveur API ACE-Step 1.5 et définis VIRALCYB_ACESTEP_URL")
        try:
            r = httpx.get(urljoin(settings.acestep_url, "/health"), timeout=2.0, headers=self._headers())
            if r.status_code < 500:
                return Availability(True, f"ACE-Step · {settings.acestep_url}")
        except httpx.HTTPError:
            pass
        return Availability(False, f"ACE-Step injoignable ({settings.acestep_url})")

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {settings.acestep_key}"} if settings.acestep_key else {}

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:
        base = settings.acestep_url
        if not base:
            raise RuntimeError("ACE-Step n'est pas configuré.")
        intensity = param_float(params, "strength", 0.45, 0.0, 1.0)
        bpm = param_int(params, "bpm", 0, 0, 300) or None
        duration = param_int(params, "duration", 120, 10, 600)
        style = params.get("style", "pop")[:80]
        prompt = build_prompt(style, params.get("prompt", "")[:300], bpm, params.get("key"))
        form = {
            "task_type": "cover",
            "prompt": prompt,
            "audio_cover_strength": str(cover_strength(intensity)),
            "audio_duration": str(duration),
            "batch_size": "2",
            "audio_format": "wav",
        }
        if bpm:
            form["bpm"] = str(bpm)
        if params.get("key"):
            form["key_scale"] = params["key"][:20]
        ctx.progress(0.05, "Envoi à ACE-Step…")
        with httpx.Client(timeout=60.0, headers=self._headers()) as client, open(files["audio"], "rb") as fh:
            r = client.post(urljoin(base, "/release_task"), data=form, files={"src_audio": (files["audio"].name, fh)})
            r.raise_for_status()
            task_id = r.json()["data"]["task_id"]
            started = time.time()
            results: list[dict[str, Any]] = []
            while time.time() - started < TIMEOUT_SECONDS:
                time.sleep(POLL_SECONDS)
                q = client.post(urljoin(base, "/query_result"), json={"task_id_list": [task_id]})
                q.raise_for_status()
                item = (q.json().get("data") or [{}])[0]
                status = item.get("status")
                ctx.progress(min(0.9, 0.1 + (time.time() - started) / 240), "Génération (ACE-Step)…")
                if status == 1:
                    raw = item.get("result") or "[]"
                    results = json.loads(raw) if isinstance(raw, str) else raw
                    break
                if status == 2:
                    raise RuntimeError("ACE-Step a échoué sur cette génération.")
            else:
                raise TimeoutError("ACE-Step n'a pas répondu à temps.")
            for i, res in enumerate(results):
                url = res.get("file")
                if not url:
                    continue
                audio_r = client.get(urljoin(base, url))
                audio_r.raise_for_status()
                out = ctx.out_dir / f"version-{i + 1}.wav"
                out.write_bytes(audio_r.content)
                ctx.add_file(out, f"variante {i + 1}")
        return {"prompt": prompt, "cover_strength": cover_strength(intensity)}
