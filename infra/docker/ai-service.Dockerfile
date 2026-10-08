# syntax=docker/dockerfile:1
# VITA EYE AI recognition service (FastAPI + OpenCV YuNet/SFace). Build context: repository root.

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    AI_HOST=0.0.0.0 \
    AI_PORT=8000 \
    AI_MODELS_DIR=./models
WORKDIR /app/ai-service
COPY ai-service/requirements.txt ./
RUN pip install -r requirements.txt
# Model weights are fetched at build time and verified against pinned SHA-256 digests
COPY ai-service/scripts ./scripts
RUN python scripts/download_models.py --dir /app/ai-service/models
COPY ai-service/app ./app
RUN useradd --system --uid 10001 --no-create-home vita && chown -R vita /app
USER vita
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import os,sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('AI_PORT','8000'), timeout=4).status == 200 else 1)"
CMD ["python", "-m", "app.main"]
