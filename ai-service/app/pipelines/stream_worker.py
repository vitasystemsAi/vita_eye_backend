"""Network camera ingestion (RTSP / ONVIF RTSP profiles / HTTP MJPEG).

One daemon thread per camera. Each worker keeps only the latest frame (grab/retrieve), samples
at the configured rate, reconnects with exponential backoff and reports health to the backend.
A failing camera never blocks other workers; inference concurrency is bounded by FaceEngine.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import cv2

from app.models.schemas import Policy
from app.pipelines.recognition import RecognitionPipeline
from app.services.backend_client import BackendClient

log = logging.getLogger("vita.stream")

# Keep FFmpeg from waiting indefinitely on unreachable RTSP sources.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000")

OPEN_TIMEOUT_MS = 8000
READ_TIMEOUT_MS = 8000
MAX_BACKOFF_SEC = 60
HEARTBEAT_SEC = 20
GALLERY_POLL_SEC = 60


def redact(url: str) -> str:
    if "@" not in url:
        return url
    scheme, _, rest = url.partition("://")
    return f"{scheme}://***@{rest.split('@', 1)[1]}"


def open_capture(url: str) -> cv2.VideoCapture:
    params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, OPEN_TIMEOUT_MS, cv2.CAP_PROP_READ_TIMEOUT_MSEC, READ_TIMEOUT_MS]
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except cv2.error:
        pass
    return cap


def test_stream(url: str) -> dict:
    cap = open_capture(url)
    try:
        if not cap.isOpened():
            return {"ok": False, "error": "Unable to open stream (check address, credentials and network access)"}
        ok, frame = cap.read()
        if not ok or frame is None:
            return {"ok": False, "error": "Stream opened but no frame could be read"}
        h, w = frame.shape[:2]
        return {"ok": True, "width": int(w), "height": int(h)}
    finally:
        cap.release()


@dataclass
class StreamConfig:
    camera_id: str
    organization_id: str
    url: str
    sampling_fps: float
    gallery_version: str
    policy: Policy


class StreamWorker(threading.Thread):
    def __init__(
        self,
        cfg: StreamConfig,
        pipeline: RecognitionPipeline,
        backend: BackendClient,
        gallery_version_probe: Callable[[str, str], Optional[str]],
    ):
        super().__init__(name=f"stream-{cfg.camera_id[:8]}", daemon=True)
        self.cfg = cfg
        self.pipeline = pipeline
        self.backend = backend
        self.probe = gallery_version_probe
        self._stop_event = threading.Event()
        self.status = "STARTING"
        self.error: Optional[str] = None
        self.frames_processed = 0
        self.events_sent = 0
        self.last_frame_at: Optional[float] = None
        self._last_gallery_poll = 0.0

    def stop(self) -> None:
        self._stop_event.set()

    def update_policy(self, policy: Policy, gallery_version: str) -> None:
        self.cfg.policy = policy
        self.cfg.gallery_version = gallery_version

    def _set_status(self, status: str, error: Optional[str] = None) -> None:
        changed = status != self.status or error != self.error
        self.status, self.error = status, error
        if changed:
            self.backend.post_camera_status(self.cfg.camera_id, status, error, self.cfg.organization_id)

    def info(self) -> dict:
        return {
            "cameraId": self.cfg.camera_id,
            "organizationId": self.cfg.organization_id,
            "status": self.status,
            "error": self.error,
            "samplingFps": self.cfg.sampling_fps,
            "framesProcessed": self.frames_processed,
            "eventsSent": self.events_sent,
            "lastFrameAt": self.last_frame_at,
        }

    def run(self) -> None:
        backoff = 2.0
        while not self._stop_event.is_set():
            cap = open_capture(self.cfg.url)
            if not cap.isOpened():
                cap.release()
                self._set_status("ERROR", "Unable to connect to stream")
                log.warning("Camera %s: connect failed (%s); retry in %.0fs", self.cfg.camera_id, redact(self.cfg.url), backoff)
                self._stop_event.wait(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SEC)
                continue

            backoff = 2.0
            self._set_status("ONLINE")
            last_heartbeat = time.time()
            interval = 1.0 / max(self.cfg.sampling_fps, 0.1)
            next_sample = 0.0
            try:
                while not self._stop_event.is_set():
                    if not cap.grab():
                        raise ConnectionError("Stream read failed")
                    now = time.time()
                    if now < next_sample:
                        continue
                    next_sample = now + interval
                    ok, frame = cap.retrieve()
                    if not ok or frame is None:
                        raise ConnectionError("Frame decode failed")
                    self._process(frame, now)
                    if now - last_heartbeat > HEARTBEAT_SEC:
                        self.backend.post_camera_status(self.cfg.camera_id, "ONLINE", None, self.cfg.organization_id)
                        last_heartbeat = now
            except Exception as exc:  # noqa: BLE001 - any stream failure triggers reconnect
                log.warning("Camera %s: %s; reconnecting", self.cfg.camera_id, exc)
                self._set_status("ERROR", str(exc)[:200])
                self._stop_event.wait(backoff)
            finally:
                cap.release()
        self._set_status("OFFLINE")
        self.pipeline.reset_camera(self.cfg.camera_id)

    def _process(self, frame, now: float) -> None:
        if now - self._last_gallery_poll > GALLERY_POLL_SEC:
            self._last_gallery_poll = now
            latest = self.probe(self.cfg.organization_id, self.cfg.gallery_version)
            if latest:
                self.cfg.gallery_version = latest
        try:
            result = self.pipeline.process(
                frame, self.cfg.organization_id, self.cfg.camera_id, self.cfg.gallery_version, self.cfg.policy, now
            )
        except Exception as exc:  # noqa: BLE001
            log.error("Camera %s: recognition failed: %s", self.cfg.camera_id, exc)
            return
        self.frames_processed += 1
        self.last_frame_at = now
        if result["events"]:
            try:
                self.backend.post_detections(
                    {
                        "organizationId": self.cfg.organization_id,
                        "cameraId": self.cfg.camera_id,
                        "events": result["events"],
                    }
                )
                self.events_sent += len(result["events"])
            except Exception as exc:  # noqa: BLE001
                log.error("Camera %s: failed to deliver %d event(s): %s", self.cfg.camera_id, len(result["events"]), exc)


class StreamManager:
    def __init__(self, pipeline: RecognitionPipeline, backend: BackendClient, max_streams: int):
        self.pipeline = pipeline
        self.backend = backend
        self.max_streams = max_streams
        self._workers: dict[str, StreamWorker] = {}
        self._lock = threading.Lock()

    def _probe(self, organization_id: str, known: str) -> Optional[str]:
        try:
            data = self.backend.fetch_gallery(organization_id, known)
            return str(data["version"]) if data.get("version") else None
        except Exception:  # noqa: BLE001
            return None

    def start(self, cfg: StreamConfig) -> None:
        with self._lock:
            existing = self._workers.get(cfg.camera_id)
            if existing and existing.is_alive():
                existing.stop()
            elif len([w for w in self._workers.values() if w.is_alive()]) >= self.max_streams:
                raise RuntimeError(f"Maximum concurrent streams reached ({self.max_streams})")
            worker = StreamWorker(cfg, self.pipeline, self.backend, self._probe)
            self._workers[cfg.camera_id] = worker
            worker.start()

    def stop(self, camera_id: str) -> bool:
        with self._lock:
            worker = self._workers.pop(camera_id, None)
        if worker:
            worker.stop()
            return True
        return False

    def update_policy(self, organization_id: str, policy: Policy, gallery_version: str) -> int:
        n = 0
        with self._lock:
            for w in self._workers.values():
                if w.cfg.organization_id == organization_id:
                    w.update_policy(policy, gallery_version)
                    n += 1
        return n

    def list(self) -> list[dict]:
        with self._lock:
            return [w.info() for w in self._workers.values()]

    def stop_all(self) -> None:
        with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        for w in workers:
            w.stop()
