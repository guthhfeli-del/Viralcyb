from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..jobs import JobContext


def has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


@dataclass(frozen=True)
class Availability:
    available: bool
    detail: str


class Engine:
    """A server-side processing engine. Subclasses declare their required
    upload fields and implement `status` and `run`."""

    name: str = ""
    label: str = ""
    inputs: tuple[str, ...] = ()
    optional_inputs: tuple[str, ...] = ()

    def status(self) -> Availability:  # pragma: no cover - overridden
        raise NotImplementedError

    def run(self, ctx: JobContext, files: dict[str, Path], params: dict[str, str]) -> dict[str, Any]:  # pragma: no cover
        raise NotImplementedError


def param_float(params: dict[str, str], key: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float(params.get(key, default))
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def param_int(params: dict[str, str], key: str, default: int, lo: int, hi: int) -> int:
    return int(round(param_float(params, key, default, lo, hi)))
