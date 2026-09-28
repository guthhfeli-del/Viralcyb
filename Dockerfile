# Viral Cyb — web app + API in one image.
#   docker build -t viralcyb .
#   docker build -t viralcyb --build-arg ENGINES="matchering faster-whisper audio-separator[cpu]" .

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.11-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/requirements.txt server/requirements-engines.txt ./
ARG ENGINES=""
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ -n "$ENGINES" ]; then pip install --no-cache-dir $ENGINES; fi
COPY server/ ./
COPY --from=web /web/dist /app/web/dist
RUN useradd --create-home --uid 1000 viralcyb && mkdir -p /data && chown viralcyb /data
USER viralcyb
ENV VIRALCYB_STATIC_DIR=/app/web/dist \
    VIRALCYB_DATA_DIR=/data \
    PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
