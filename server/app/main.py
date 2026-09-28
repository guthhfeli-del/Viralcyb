"""Viral Cyb API: optional heavy engines behind a small job queue.

Everything the web app can do locally stays local; this server adds stem
separation, reference mastering, transcription, MIDI, AI detection, voice
conversion, AI re-interpretations and LLM lyric variants."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import settings
from .engines import ENGINES, engine_status
from .jobs import JobStore, QueueFull
from .lyrics import LyricsRefused, VariantsRequest, generate_variants, lyrics_status
from .ratelimit import RateLimiter

log = logging.getLogger("viralcyb")

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".aif", ".aiff", ".webm", ".mp4"}
FIELD_RE = re.compile(r"^[a-z_]{1,32}$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9._ -]{1,120}$")
CHUNK = 1 << 20


def create_app(store: JobStore | None = None) -> FastAPI:
    jobs = store or JobStore(settings.data_dir / "jobs", settings.max_workers, settings.max_queued_jobs, settings.job_ttl_hours)
    job_limiter = RateLimiter(per_minute=12, burst=6)
    lyrics_limiter = RateLimiter(per_minute=6, burst=3)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI):
        async def janitor():
            while True:
                await asyncio.sleep(600)
                removed = jobs.cleanup()
                if removed:
                    log.info("cleaned %d expired jobs", removed)

        task = asyncio.create_task(janitor())
        yield
        task.cancel()
        jobs.shutdown()

    app = FastAPI(title="Viral Cyb API", version=__version__, lifespan=lifespan)
    app.state.jobs = jobs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )

    def client_key(request: Request) -> str:
        return request.client.host if request.client else "anon"

    @app.get("/api/health")
    def health():
        engines = {name: engine_status(name).__dict__ for name in ENGINES}
        engines["lyrics"] = lyrics_status().__dict__
        return {"ok": True, "version": __version__, "engines": engines}

    @app.post("/api/jobs/{kind}")
    async def create_job(kind: str, request: Request):
        engine = ENGINES.get(kind)
        if not engine:
            raise HTTPException(404, "Moteur inconnu.")
        status = engine_status(kind)
        if not status.available:
            raise HTTPException(503, f"Moteur indisponible : {status.detail}")
        if not job_limiter.allow(client_key(request)):
            raise HTTPException(429, "Trop de requêtes, patiente une minute.")
        form = await request.form(max_files=4, max_fields=24)
        uploads = {k: v for k, v in form.multi_items() if isinstance(v, UploadFile) or hasattr(v, "filename")}
        params = {k: str(v)[:500] for k, v in form.multi_items() if not hasattr(v, "filename")}
        missing = [f for f in engine.inputs if f not in uploads]
        if missing:
            raise HTTPException(422, f"Fichier(s) manquant(s) : {', '.join(missing)}")
        try:
            job = jobs.create(kind)
        except QueueFull as exc:
            raise HTTPException(503, str(exc)) from exc
        files: dict[str, Path] = {}
        try:
            for field_name, up in uploads.items():
                if field_name not in engine.inputs and field_name not in engine.optional_inputs:
                    continue
                if not FIELD_RE.match(field_name):
                    raise HTTPException(422, "Nom de champ invalide.")
                ext = Path(up.filename or "").suffix.lower() or ".wav"
                if ext not in AUDIO_EXT:
                    raise HTTPException(415, f"Format non supporté : {ext}")
                dest = job.in_dir / f"{field_name}{ext}"
                await _save_upload(up, dest, settings.max_upload_mb)
                files[field_name] = dest
        except HTTPException:
            jobs.delete(job.id)
            raise
        jobs.submit(job, engine.run, files, params)
        return job.public()

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job introuvable.")
        return job.public()

    @app.delete("/api/jobs/{job_id}")
    def delete_job(job_id: str):
        if not jobs.delete(job_id):
            raise HTTPException(404, "Job introuvable.")
        return {"ok": True}

    @app.get("/api/files/{job_id}/{name}")
    def get_file(job_id: str, name: str):
        job = jobs.get(job_id)
        if not job or not SAFE_NAME.match(name) or name not in {f.name for f in job.files}:
            raise HTTPException(404, "Fichier introuvable.")
        path = (job.out_dir / name).resolve()
        if path.parent != job.out_dir.resolve() or not path.is_file():
            raise HTTPException(404, "Fichier introuvable.")
        return FileResponse(path, filename=name)

    @app.post("/api/lyrics/variants")
    async def lyric_variants(body: VariantsRequest, request: Request):
        status = lyrics_status()
        if not status.available:
            raise HTTPException(503, f"Variantes IA indisponibles : {status.detail}")
        if not lyrics_limiter.allow(client_key(request)):
            raise HTTPException(429, "Trop de requêtes, patiente une minute.")
        try:
            variants = await run_in_threadpool(generate_variants, body)
        except LyricsRefused as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:
            log.exception("lyrics generation failed")
            raise HTTPException(502, "La génération des variantes a échoué.") from exc
        return {"variants": [v.model_dump() for v in variants]}

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error: %s", exc)
        return JSONResponse(status_code=500, content={"detail": "Erreur interne."})

    static = settings.static_dir or (Path(__file__).resolve().parents[2] / "web" / "dist")
    if static.is_dir():
        app.mount("/", SpaStatic(directory=str(static), html=True), name="web")
    return app


class SpaStatic(StaticFiles):
    """Serve the built web app; unknown paths fall back to index.html."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except Exception as exc:
            if getattr(exc, "status_code", None) == 404 and not path.startswith("api/"):
                return await super().get_response("index.html", scope)
            raise


async def _save_upload(up, dest: Path, max_mb: int) -> None:
    limit = max_mb * 1024 * 1024
    size = 0
    with dest.open("wb") as fh:
        while chunk := await up.read(CHUNK):
            size += len(chunk)
            if size > limit:
                fh.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"Fichier trop lourd (> {max_mb} Mo).")
            fh.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, "Fichier vide.")


app = create_app()
