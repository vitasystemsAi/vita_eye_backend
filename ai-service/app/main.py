"""VITA EYE AI recognition service (FastAPI)."""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

import cv2
from fastapi import FastAPI

from app.api.routes import router
from app.config.settings import get_settings
from app.pipelines.recognition import RecognitionPipeline
from app.pipelines.stream_worker import StreamManager
from app.services.backend_client import BackendClient
from app.services.face_engine import FaceEngine
from app.services.gallery import GalleryStore

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("vita.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    cv2.setNumThreads(max(1, settings.ai_inference_workers, min(4, os.cpu_count() or 1)))
    engine = FaceEngine(settings.models_path, settings.ai_inference_workers)
    backend = BackendClient(settings.backend_internal_url, settings.internal_service_token)
    galleries = GalleryStore(backend.fetch_gallery, engine.model_version)
    pipeline = RecognitionPipeline(engine, galleries)
    streams = StreamManager(pipeline, backend, settings.ai_max_streams)
    app.state.engine = engine
    app.state.backend = backend
    app.state.galleries = galleries
    app.state.pipeline = pipeline
    app.state.streams = streams
    log.info("AI service ready (model %s)", engine.model_version)
    try:
        yield
    finally:
        streams.stop_all()
        backend.close()


app = FastAPI(title="VITA EYE AI Service", version="1.0.0", lifespan=lifespan, docs_url="/docs", redoc_url=None)
app.include_router(router)


@app.get("/health")
def health():
    engine = getattr(app.state, "engine", None)
    return {
        "status": "ok" if engine else "starting",
        "modelVersion": engine.model_version if engine else None,
        "models": {
            "detector": {"name": "YuNet", "file": "face_detection_yunet_2023mar.onnx", "license": "MIT"},
            "recognizer": {"name": "SFace", "file": "face_recognition_sface_2021dec.onnx", "license": "Apache-2.0"},
            "opencv": cv2.__version__,
        },
        "streams": len(app.state.streams.list()) if engine else 0,
        "galleries": app.state.galleries.stats() if engine else {},
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.ai_host, port=settings.ai_port, log_level=settings.log_level)
