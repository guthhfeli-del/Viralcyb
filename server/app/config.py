"""Runtime configuration, read once from environment variables."""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


def _env_list(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


# Vercel / AWS Lambda: read-only code directory, and the instance may be frozen
# as soon as a response is sent.
SERVERLESS = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))


def _data_dir() -> Path:
    if p := os.environ.get("VIRALCYB_DATA_DIR"):
        return Path(p)
    if SERVERLESS:
        return Path(tempfile.gettempdir()) / "viralcyb"
    return Path(__file__).resolve().parent.parent / "data"


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=_data_dir)
    static_dir: Path | None = field(default_factory=lambda: Path(p) if (p := os.environ.get("VIRALCYB_STATIC_DIR")) else None)
    allowed_origins: list[str] = field(default_factory=lambda: _env_list("VIRALCYB_ALLOWED_ORIGINS", "*"))
    max_upload_mb: int = int(os.environ.get("VIRALCYB_MAX_UPLOAD_MB", "200"))
    max_workers: int = int(os.environ.get("VIRALCYB_MAX_WORKERS", "1"))
    max_queued_jobs: int = int(os.environ.get("VIRALCYB_MAX_QUEUED_JOBS", "32"))
    job_ttl_hours: float = float(os.environ.get("VIRALCYB_JOB_TTL_HOURS", "6"))
    # finish jobs inside the POST request instead of in the background (default on serverless)
    sync_jobs: bool = os.environ.get("VIRALCYB_SYNC_JOBS", "1" if SERVERLESS else "0") == "1"
    sync_timeout: float = float(os.environ.get("VIRALCYB_SYNC_TIMEOUT", "280"))
    # engines
    stems_model_dir: str | None = os.environ.get("VIRALCYB_STEMS_MODEL_DIR")
    whisper_model: str = os.environ.get("VIRALCYB_WHISPER_MODEL", "small")
    sonics_model: str = os.environ.get("VIRALCYB_SONICS_MODEL", "awsaf49/sonics-spectttra-gamma-5s")
    seedvc_dir: str | None = os.environ.get("VIRALCYB_SEEDVC_DIR")
    seedvc_python: str = os.environ.get("VIRALCYB_SEEDVC_PYTHON", "python")
    acestep_url: str | None = os.environ.get("VIRALCYB_ACESTEP_URL")
    acestep_key: str | None = os.environ.get("VIRALCYB_ACESTEP_KEY")
    claude_model: str = os.environ.get("VIRALCYB_CLAUDE_MODEL", "claude-opus-5")
    # OpenRouter (OPENROUTER_API_KEY) — preferred when set
    openrouter_base: str = os.environ.get("VIRALCYB_OPENROUTER_BASE", "https://openrouter.ai/api/v1").rstrip("/")
    openrouter_model: str = os.environ.get("VIRALCYB_OPENROUTER_MODEL", "anthropic/claude-opus-5")
    openrouter_stt_model: str = os.environ.get("VIRALCYB_OPENROUTER_STT_MODEL", "openai/whisper-1")
    public_url: str | None = os.environ.get("VIRALCYB_PUBLIC_URL")


settings = Settings()
