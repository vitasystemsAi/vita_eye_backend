"""A short-lived live picture for a camera address the operator just typed.

The password stays in the capture URL and is never returned. The session closes
when the form does, or after it sits idle.
"""
from __future__ import annotations

import base64
import secrets
import threading
import time
from typing import Optional
from urllib.parse import urlparse

from app.pipelines.capture import _open_http_picture, _open_rtsp_transports, public_stream_url
from app.pipelines.stream_worker import preview_jpeg

IDLE_SEC = 90
MAX_PREVIEWS = 4


def stream_path(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return path


def open_exact(url: str):
    """Open this exact URL. Does not walk other paths."""
    parsed = urlparse(url)
    if parsed.scheme in ("rtsp", "rtsps"):
        return _open_rtsp_transports(url)
    if parsed.scheme in ("http", "https"):
        kind = "jpeg" if stream_path(url).endswith((".jpg", ".jpeg")) else "mjpeg"
        cap = _open_http_picture(url, kind)
        if cap is not None:
            return cap, url, None
        return None, url, "The camera accepted the path, but no video frame arrived."
    return None, url, "This address is not an RTSP or HTTP video stream."


class _Session:
    def __init__(self, cap, jpeg: bytes, size: list[int]):
        self.cap = cap
        self.jpeg = jpeg
        self.size = size
        self.touched = time.time()
        self.lock = threading.Lock()


class PreviewHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[str, _Session] = {}
        self._sweeper: Optional[threading.Thread] = None

    def start(self, url: str) -> dict:
        cap, _used, error = open_exact(url)
        if cap is None:
            return {"ok": False, "error": (error or "Unable to open the stream")[:500]}
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.release()
            return {"ok": False, "error": "The stream opened, but no picture arrived."}
        encoded = preview_jpeg(frame, [])
        if encoded is None:
            cap.release()
            return {"ok": False, "error": "The stream opened, but the picture could not be shown."}
        jpeg, size, _faces = encoded
        self._arm()
        with self._lock:
            self._sweep()
            if len(self._sessions) >= MAX_PREVIEWS:
                cap.release()
                return {"ok": False, "error": "Too many live previews are open. Close one and try again."}
            session_id = secrets.token_urlsafe(18)
            self._sessions[session_id] = _Session(cap, jpeg, size)
        return {
            "ok": True,
            "sessionId": session_id,
            "frame": base64.b64encode(jpeg).decode(),
            "width": size[0],
            "height": size[1],
            "publicUrl": public_stream_url(url),
            "path": stream_path(url),
        }

    def frame(self, session_id: str) -> Optional[dict]:
        with self._lock:
            self._sweep()
            session = self._sessions.get(session_id)
        if session is None:
            return None
        with session.lock:
            ok, image = session.cap.read()
            if ok and image is not None:
                encoded = preview_jpeg(image, [])
                if encoded is not None:
                    session.jpeg, session.size = encoded[0], encoded[1]
            session.touched = time.time()
            return {
                "frame": base64.b64encode(session.jpeg).decode(),
                "width": session.size[0],
                "height": session.size[1],
            }

    def stop(self, session_id: str) -> bool:
        with self._lock:
            session = self._sessions.pop(session_id, None)
        if session is None:
            return False
        with session.lock:
            session.cap.release()
        return True

    def _arm(self) -> None:
        if self._sweeper is not None:
            return
        self._sweeper = threading.Thread(target=self._loop, name="preview-sweep", daemon=True)
        self._sweeper.start()

    def _loop(self) -> None:
        while True:
            time.sleep(30)
            with self._lock:
                self._sweep()

    def _sweep(self) -> None:
        now = time.time()
        stale = [sid for sid, session in self._sessions.items() if now - session.touched > IDLE_SEC]
        for sid in stale:
            session = self._sessions.pop(sid, None)
            if session is not None:
                with session.lock:
                    session.cap.release()


preview_hub = PreviewHub()
