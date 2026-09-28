"""Tiny in-memory token bucket, keyed by client address."""

from __future__ import annotations

import threading
import time


class RateLimiter:
    def __init__(self, per_minute: int, burst: int | None = None):
        self.rate = per_minute / 60.0
        self.capacity = float(burst or per_minute)
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            tokens, last = self._buckets.get(key, (self.capacity, now))
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens < 1:
                self._buckets[key] = (tokens, now)
                return False
            self._buckets[key] = (tokens - 1, now)
            if len(self._buckets) > 10_000:  # bound memory under address churn
                self._buckets = {k: v for k, v in self._buckets.items() if now - v[1] < 600}
            return True
