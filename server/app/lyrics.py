"""Lyric variants written by Claude, grounded in the artist's own text."""

from __future__ import annotations

import os
from typing import Literal

from pydantic import BaseModel, Field

from . import openrouter
from .config import settings
from .engines.base import Availability, has_module

StyleId = Literal["catchy", "tiktok", "emotional", "street", "clean", "english", "alt-chorus", "same-flow"]

STYLE_BRIEFS: dict[str, str] = {
    "catchy": "Plus accrocheur : phrases plus courtes, mots simples, répétition assumée du hook, rimes plus riches.",
    "tiktok": "Hook TikTok : 2 à 4 lignes qui tiennent en ~15 secondes, faciles à chanter en lipsync, avec une phrase « quotable » qu'on met en légende.",
    "emotional": "Plus émotionnel : images concrètes et personnelles, vulnérabilité, montée émotionnelle vers le refrain.",
    "street": "Plus street / imagé : punchlines, images visuelles fortes, vocabulaire actuel, flow plus dense sur les couplets.",
    "clean": "Version radio : aucune grossièreté ni référence explicite, même énergie et même sens.",
    "english": "Version anglaise : adaptation (pas traduction littérale) qui garde le sens, les images et un schéma de rimes naturel en anglais.",
    "alt-chorus": "Refrain alternatif : un nouveau refrain (le reste est inchangé) plus mémorable, qui peut porter le titre du morceau.",
    "same-flow": "Même flow, autres mots : garder le nombre de syllabes par ligne et le schéma de rimes, changer les mots et les images.",
}

SYSTEM = """Tu es un parolier et topliner professionnel qui écrit des hits (pop, rap, afro, R&B, drill, dancehall) en français et en anglais.
On te donne les paroles d'un artiste. Tu écris des variantes de SES paroles : garde son thème, son histoire, son point de vue et ses meilleures images ; améliore la mémorisation, le rythme et l'impact.

Règles :
- Chaque variante est un texte complet et chantable, avec des balises de section entre crochets ([Refrain], [Couplet 1], [Hook]…), sauf pour un hook TikTok court.
- Respecte le débit : garde un nombre de syllabes par ligne proche de l'original, sauf si le style demandé dit le contraire.
- Le hook doit pouvoir se retenir après une écoute : court, répété, avec une rime ou une assonance forte.
- N'emprunte aucune ligne à une chanson existante d'un autre artiste.
- Écris dans la langue des paroles d'origine, sauf pour le style « Version anglaise ».
- Dans `notes`, explique en une ou deux phrases ce que la variante change et pourquoi ça accroche mieux."""


class LyricVariant(BaseModel):
    title: str = Field(description="Nom court de la variante")
    style: str = Field(description="Style demandé, en clair")
    text: str = Field(description="Paroles complètes de la variante")
    notes: str = Field(description="Ce qui change et pourquoi")


class LyricVariants(BaseModel):
    variants: list[LyricVariant]


class VariantsRequest(BaseModel):
    lyrics: str = Field(min_length=10, max_length=8000)
    title: str | None = Field(default=None, max_length=200)
    language: Literal["fr", "en"] = "fr"
    genre: str | None = Field(default=None, max_length=60)
    bpm: int | None = Field(default=None, ge=40, le=260)
    key: str | None = Field(default=None, max_length=20)
    styles: list[StyleId] = Field(min_length=1, max_length=5)
    hook: str | None = Field(default=None, max_length=300)


class LyricsRefused(RuntimeError):
    pass


# JSON Schema for strict structured output on OpenRouter (mirrors LyricVariants).
VARIANTS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "variants": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Nom court de la variante"},
                    "style": {"type": "string", "description": "Style demandé, en clair"},
                    "text": {"type": "string", "description": "Paroles complètes de la variante"},
                    "notes": {"type": "string", "description": "Ce qui change et pourquoi"},
                },
                "required": ["title", "style", "text", "notes"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["variants"],
    "additionalProperties": False,
}


def _anthropic_ready() -> bool:
    return has_module("anthropic") and any(os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE"))


def lyrics_provider() -> str | None:
    """OpenRouter wins when its key is set; the Anthropic API is the alternative."""
    if openrouter.api_key():
        return "openrouter"
    if _anthropic_ready():
        return "anthropic"
    return None


def lyrics_status() -> Availability:
    provider = lyrics_provider()
    if provider == "openrouter":
        return Availability(True, f"OpenRouter · {settings.openrouter_model}")
    if provider == "anthropic":
        return Availability(True, f"Claude · {settings.claude_model}")
    return Availability(False, "Définis OPENROUTER_API_KEY (ou ANTHROPIC_API_KEY) sur le serveur")


def build_user_message(req: VariantsRequest) -> str:
    context = [f"Langue : {req.language}"]
    if req.title:
        context.append(f"Titre : {req.title}")
    if req.genre:
        context.append(f"Genre : {req.genre}")
    if req.bpm:
        context.append(f"Tempo : {req.bpm} BPM")
    if req.key:
        context.append(f"Tonalité : {req.key}")
    if req.hook:
        context.append(f"Ligne la plus « hook » détectée : {req.hook}")
    briefs = "\n".join(f"{i + 1}. {STYLE_BRIEFS[s]}" for i, s in enumerate(req.styles))
    return (
        "\n".join(context)
        + f"\n\nÉcris exactement {len(req.styles)} variantes, une par style, dans cet ordre :\n{briefs}"
        + f"\n\nParoles d'origine :\n<paroles>\n{req.lyrics}\n</paroles>"
    )


def generate_variants(req: VariantsRequest, client=None, http=None) -> list[LyricVariant]:
    if lyrics_provider() == "openrouter":
        return _openrouter_variants(req, http)
    return _anthropic_variants(req, client)


def _openrouter_variants(req: VariantsRequest, http=None) -> list[LyricVariant]:
    try:
        data = openrouter.chat_json(SYSTEM, build_user_message(req), "lyric_variants", VARIANTS_SCHEMA, client=http)
    except openrouter.OpenRouterRefusal as exc:
        raise LyricsRefused("Le modèle a refusé de réécrire ce texte.") from exc
    parsed = LyricVariants.model_validate(data)
    if not parsed.variants:
        raise RuntimeError("Réponse vide du modèle.")
    return parsed.variants


def _anthropic_variants(req: VariantsRequest, client=None) -> list[LyricVariant]:
    import anthropic

    client = client or anthropic.Anthropic()
    response = client.beta.messages.parse(
        model=settings.claude_model,
        max_tokens=16000,
        system=SYSTEM,
        thinking={"type": "adaptive"},
        output_config={"effort": "medium"},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": build_user_message(req)}],
        output_format=LyricVariants,
    )
    if response.stop_reason == "refusal":
        raise LyricsRefused("Le modèle a refusé de réécrire ce texte.")
    parsed = response.parsed_output
    if parsed is None or not parsed.variants:
        raise RuntimeError("Réponse vide du modèle.")
    return parsed.variants
