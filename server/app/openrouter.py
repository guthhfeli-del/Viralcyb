"""Minimal OpenRouter client (OpenAI-compatible HTTP API): JSON-schema chat
completions for lyric variants and Whisper speech-to-text for transcription."""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any

import httpx

from .config import settings

DEFAULT_BASE = "https://openrouter.ai/api/v1"


class OpenRouterError(RuntimeError):
    pass


class OpenRouterRefusal(OpenRouterError):
    pass


def api_key() -> str | None:
    return os.environ.get("OPENROUTER_API_KEY") or None


def _headers() -> dict[str, str]:
    key = api_key()
    if not key:
        raise OpenRouterError("OPENROUTER_API_KEY n'est pas défini sur le serveur.")
    h = {"Authorization": f"Bearer {key}", "X-Title": "Viral Cyb"}
    if settings.public_url:
        h["HTTP-Referer"] = settings.public_url
    return h


def _raise_for(r: httpx.Response) -> None:
    if r.status_code < 400:
        return
    try:
        detail = r.json().get("error", {}).get("message") or r.text[:300]
    except ValueError:
        detail = r.text[:300]
    messages = {
        401: "Clé OpenRouter invalide.",
        402: "Crédits OpenRouter insuffisants.",
        403: "Requête refusée par OpenRouter (modération ou droits).",
        404: "Modèle introuvable sur OpenRouter.",
        408: "OpenRouter a mis trop de temps à répondre.",
        429: "Limite de débit OpenRouter atteinte, réessaie dans un instant.",
    }
    raise OpenRouterError(f"{messages.get(r.status_code, f'Erreur OpenRouter ({r.status_code}).')} {detail}".strip())


def _extract_json(text: str) -> Any:
    """Parse a JSON object even if a provider wrapped it in a code fence."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise OpenRouterError("Réponse du modèle illisible (pas de JSON).")
    return json.loads(text[start : end + 1])


def chat_json(system: str, user: str, schema_name: str, schema: dict[str, Any], model: str | None = None, max_tokens: int = 16000, client: httpx.Client | None = None) -> Any:
    body = {
        "model": model or settings.openrouter_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
        "max_tokens": max_tokens,
    }
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(300.0, connect=15.0))
    try:
        r = client.post(f"{settings.openrouter_base}/chat/completions", headers=_headers(), json=body)
        _raise_for(r)
        data = r.json()
    finally:
        if own:
            client.close()
    if data.get("error"):
        raise OpenRouterError(f"Erreur OpenRouter : {data['error'].get('message', data['error'])}")
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    if message.get("refusal"):
        raise OpenRouterRefusal(str(message["refusal"]))
    content = message.get("content")
    if isinstance(content, list):  # some providers return content parts
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    if not content:
        raise OpenRouterError("Réponse vide du modèle.")
    return _extract_json(content)


def transcribe(audio: bytes, fmt: str, language: str | None = None, model: str | None = None, client: httpx.Client | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model or settings.openrouter_stt_model,
        "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": fmt},
    }
    if language:
        body["language"] = language
    own = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(600.0, connect=15.0))
    try:
        r = client.post(f"{settings.openrouter_base}/audio/transcriptions", headers=_headers(), json=body)
        _raise_for(r)
        return r.json()
    finally:
        if own:
            client.close()
