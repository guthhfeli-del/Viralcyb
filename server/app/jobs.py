"""Background job queue: uploads are stored per job on disk, engines run in a
bounded thread pool, clients poll for status and download result files."""

from __future__ import annotations

import logging
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger("viralcyb.jobs")


@dataclass
class OutputFile:
    name: str
    label: str


@dataclass
class Job:
    id: str
    kind: str
    dir: Path
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    message: str | None = None
    error: str | None = None
    result: dict[str, Any] = field(default_factory=dict)
    files: list[OutputFile] = field(default_factory=list)
    created: float = field(default_factory=time.time)
    finished: float | None = None

    @property
    def in_dir(self) -> Path:
        return self.dir / "in"

    @property
    def out_dir(self) -> Path:
        return self.dir / "out"

    def public(self) -> dict[str, Any]:
        result = dict(self.result)
        if self.files:
            result["files"] = [{"name": f.name, "label": f.label, "url": f"/api/files/{self.id}/{f.name}"} for f in self.files]
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 3),
            "message": self.message,
            "error": self.error,
            "result": result if self.status == "done" else None,
        }


class JobContext:
    """Handle given to engines to report progress and publish output files."""

    def __init__(self, job: Job, lock: threading.Lock):
        self._job = job
        self._lock = lock

    @property
    def out_dir(self) -> Path:
        self._job.out_dir.mkdir(parents=True, exist_ok=True)
        return self._job.out_dir

    @property
    def work_dir(self) -> Path:
        d = self._job.dir / "work"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def progress(self, value: float, message: str | None = None) -> None:
        with self._lock:
            self._job.progress = max(0.0, min(1.0, value))
            if message is not None:
                self._job.message = message

    def add_file(self, path: Path, label: str) -> None:
        """Publish a file that lives in (or is moved into) the job's out dir."""
        out = self.out_dir
        if path.parent.resolve() != out.resolve():
            dest = out / path.name
            shutil.move(str(path), dest)
            path = dest
        with self._lock:
            self._job.files.append(OutputFile(name=path.name, label=label))


Runner = Callable[[JobContext, dict[str, Path], dict[str, str]], dict[str, Any]]


class QueueFull(RuntimeError):
    pass


class JobStore:
    def __init__(self, root: Path, workers: int = 1, max_queued: int = 32, ttl_hours: float = 6):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="viralcyb-job")
        self._max_queued = max_queued
        self._ttl = ttl_hours * 3600

    def create(self, kind: str) -> Job:
        with self._lock:
            active = sum(1 for j in self._jobs.values() if j.status in ("queued", "running"))
            if active >= self._max_queued:
                raise QueueFull("Trop de traitements en attente, réessaie dans un instant.")
            job_id = uuid.uuid4().hex
            job = Job(id=job_id, kind=kind, dir=self.root / job_id)
            job.in_dir.mkdir(parents=True, exist_ok=True)
            self._jobs[job_id] = job
            return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def submit(self, job: Job, runner: Runner, files: dict[str, Path], params: dict[str, str]) -> None:
        ctx = JobContext(job, self._lock)

        def run() -> None:
            with self._lock:
                job.status = "running"
                job.message = job.message or "Traitement…"
            try:
                result = runner(ctx, files, params) or {}
                with self._lock:
                    job.result = result
                    job.status = "done"
                    job.progress = 1.0
                    job.message = "Terminé"
            except Exception as exc:  # engines are third-party code: report, don't crash the worker
                log.exception("job %s (%s) failed", job.id, job.kind)
                with self._lock:
                    job.status = "error"
                    job.error = str(exc) or exc.__class__.__name__
            finally:
                with self._lock:
                    job.finished = time.time()
                shutil.rmtree(job.dir / "work", ignore_errors=True)

        self._pool.submit(run)

    def delete(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job:
            shutil.rmtree(job.dir, ignore_errors=True)
        return job is not None

    def cleanup(self) -> int:
        """Remove finished jobs older than the TTL. Returns how many were removed."""
        now = time.time()
        with self._lock:
            stale = [j.id for j in self._jobs.values() if j.finished and now - j.finished > self._ttl]
        for job_id in stale:
            self.delete(job_id)
        return len(stale)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
