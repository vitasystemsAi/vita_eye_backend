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
from app.pipelines.capture import open_working_capture
from app.pipelines.recognition import RecognitionPipeline
from app.services.backend_client import BackendClient

log = logging.getLogger("vita.stream")

# Keep FFmpeg from waiting indefinitely on unreachable RTSP sources.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000")
MAX_BACKOFF_SEC = 60
HEARTBEAT_SEC = 20
GALLERY_POLL_SEC = 60
PREVIEW_MAX_EDGE = 960
PREVIEW_INTERVAL_SEC = 0.08
PREVIEW_PROBE_SEC = 1.0


def redact(url: str) -> str:
    if "@" not in url:
        return url
    scheme, _, rest = url.partition("://")
    return f"{scheme}://***@{rest.split('@', 1)[1]}"


def preview_jpeg(frame, faces: list[dict]) -> Optional[tuple[bytes, list[int], list[dict]]]:
    """Downscale a frame for the monitoring wall and scale face boxes to match."""
    height, width = frame.shape[:2]
    scale = min(1.0, PREVIEW_MAX_EDGE / max(height, width))
    image = frame
    if scale < 1:
        image = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 58])
    if not ok:
        return None
    scaled: list[dict] = []
    for face in faces:
        scaled.append({
            **face,
            "bbox": [round(float(v) * scale, 1) for v in face["bbox"]],
            "personName": face.get("personName"),
        })
    return buf.tobytes(), [int(image.shape[1]), int(image.shape[0])], scaled


def test_stream(url: str) -> dict:
    cap, _resolved, error = open_working_capture(url)
    if cap is None:
        return {"ok": False, "error": error or "Unable to connect to stream"}
    try:
        ok, frame = cap.read()
        if not ok or frame is None:
            return {"ok": False, "error": "Stream opened but no frame could be read"}
        height, width = frame.shape[:2]
        return {"ok": True, "width": int(width), "height": int(height)}
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
        self._preview_viewers = 0
        self._last_preview = 0.0
        self._preview_busy = threading.Lock()
        self._marks: list[dict] = []
        self._marks_lock = threading.Lock()

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
            cap, resolved, error = open_working_capture(self.cfg.url)
            if cap is None:
                self._set_status("ERROR", error or "Unable to connect to stream")
                log.warning("Camera %s: %s (%s); retry in %.0fs", self.cfg.camera_id, error or "connect failed", redact(self.cfg.url), backoff)
                self._stop_event.wait(backoff)
                backoff = min(backoff * 2, MAX_BACKOFF_SEC)
                continue
            if resolved != self.cfg.url:
                log.info("Camera %s: video feed is %s", self.cfg.camera_id, redact(resolved))
                self.cfg.url = resolved

            backoff = 2.0
            self._set_status("ONLINE")
            last_heartbeat = time.time()
            interval = 1.0 / max(self.cfg.sampling_fps, 0.1)
            next_sample = 0.0
            latest: dict = {"frame": None}
            frame_lock = threading.Lock()
            failure: list[BaseException] = []
            stop_read = threading.Event()
            infer_gate = threading.Lock()

            def reader() -> None:
                try:
                    while not self._stop_event.is_set() and not stop_read.is_set():
                        if not cap.grab():
                            failure.append(ConnectionError("Stream read failed"))
                            return
                        ok, frame = cap.retrieve()
                        if not ok or frame is None:
                            failure.append(ConnectionError("Frame decode failed"))
                            return
                        with frame_lock:
                            latest["frame"] = frame.copy()
                except Exception as exc:  # noqa: BLE001
                    failure.append(exc)
                finally:
                    try:
                        cap.release()
                    except Exception:  # noqa: BLE001
                        pass

            reader_thread = threading.Thread(target=reader, name=f"read-{self.cfg.camera_id[:8]}", daemon=True)
            reader_thread.start()
            try:
                while not self._stop_event.is_set():
                    if failure or not reader_thread.is_alive():
                        raise failure[0] if failure else ConnectionError("Stream read failed")
                    now = time.time()
                    if self._preview_viewers <= 0 and now - self._last_preview >= PREVIEW_PROBE_SEC:
                        self._last_preview = now
                        self._preview_viewers = self.backend.post_preview(self.cfg.camera_id, self.cfg.organization_id)
                    want_preview = (
                        self._preview_viewers > 0
                        and now - self._last_preview >= PREVIEW_INTERVAL_SEC
                        and not self._preview_busy.locked()
                    )
                    want_infer = now >= next_sample and not infer_gate.locked()
                    with frame_lock:
                        src = latest["frame"]
                        snap = src.copy() if src is not None and (want_preview or want_infer) else None
                        have_frame = src is not None
                    if not have_frame:
                        self._stop_event.wait(0.02)
                        continue
                    if snap is not None and want_preview:
                        self._publish_latest(snap, now)
                    if snap is not None and want_infer and infer_gate.acquire(blocking=False):
                        next_sample = now + interval

                        def recognize(img=snap, seen=now) -> None:
                            try:
                                self._recognize(img, seen)
                            finally:
                                infer_gate.release()

                        threading.Thread(target=recognize, name=f"infer-{self.cfg.camera_id[:8]}", daemon=True).start()
                    if now - last_heartbeat > HEARTBEAT_SEC:
                        self.backend.post_camera_status(self.cfg.camera_id, "ONLINE", None, self.cfg.organization_id)
                        last_heartbeat = now
                    self._stop_event.wait(0.02)
            except Exception as exc:  # noqa: BLE001 - any stream failure triggers reconnect
                log.warning("Camera %s: %s; reconnecting", self.cfg.camera_id, exc)
                self._set_status("ERROR", str(exc)[:200])
                self._stop_event.wait(backoff)
            finally:
                stop_read.set()
                interrupt = getattr(cap, "interrupt", None)
                if callable(interrupt):
                    interrupt()
                reader_thread.join(timeout=9)
        self._set_status("OFFLINE")
        self.pipeline.reset_camera(self.cfg.camera_id)

    def _recognize(self, frame, now: float) -> None:
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
        with self._marks_lock:
            self._marks = list(result.get("faces") or [])
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

    def _publish_latest(self, frame, now: float) -> None:
        """Send the newest picture on a steady clock. Face boxes update when recognition finishes."""
        if self._preview_viewers <= 0:
            if now - self._last_preview < PREVIEW_PROBE_SEC:
                return
            self._last_preview = now
            self._preview_viewers = self.backend.post_preview(self.cfg.camera_id, self.cfg.organization_id)
            return
        if now - self._last_preview < PREVIEW_INTERVAL_SEC:
            return
        if not self._preview_busy.acquire(blocking=False):
            return
        self._last_preview = now
        with self._marks_lock:
            marks = [dict(face) for face in self._marks]

        def send(img=frame, overlay=marks) -> None:
            try:
                encoded = preview_jpeg(img, overlay)
                if encoded is None:
                    return
                jpeg, size, scaled = encoded
                self._preview_viewers = self.backend.post_preview(
                    self.cfg.camera_id, self.cfg.organization_id, jpeg, scaled, size
                )
            finally:
                self._preview_busy.release()

        threading.Thread(target=send, name=f"preview-{self.cfg.camera_id[:8]}", daemon=True).start()


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
