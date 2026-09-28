from __future__ import annotations

import threading
import time

from .base import Availability, Engine
from .detect import DetectEngine
from .generate import GenerateEngine
from .master_ref import MasterRefEngine
from .stems import StemsEngine
from .topline import ToplineEngine
from .transcribe import TranscribeEngine
from .voice import VoiceEngine

ENGINES: dict[str, Engine] = {
    e.name: e
    for e in (
        StemsEngine(),
        MasterRefEngine(),
        TranscribeEngine(),
        ToplineEngine(),
        DetectEngine(),
        VoiceEngine(),
        GenerateEngine(),
    )
}

_STATUS_TTL = 30.0
_status_cache: dict[str, tuple[float, Availability]] = {}
_status_lock = threading.Lock()


def engine_status(name: str) -> Availability:
    """Availability of an engine, cached briefly (some checks hit the network)."""
    now = time.monotonic()
    with _status_lock:
        hit = _status_cache.get(name)
        if hit and now - hit[0] < _STATUS_TTL:
            return hit[1]
    try:
        status = ENGINES[name].status()
    except Exception as exc:  # a broken optional dependency must not take /health down
        status = Availability(False, f"erreur : {exc}")
    with _status_lock:
        _status_cache[name] = (now, status)
    return status


def clear_status_cache() -> None:
    with _status_lock:
        _status_cache.clear()
