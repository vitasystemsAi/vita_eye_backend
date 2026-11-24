"""One camera path at a time, so the operator can watch the attempt and stop it.

The automatic opener tries every known path inside one call. A live preview instead
reports the path it just tried and the next path, then waits. The picture is a
separate short-lived session opened only after that path is accepted.
"""
from __future__ import annotations

import base64
import secrets
import threading
import time
from typing import Optional
from urllib.parse import urlparse

from app.pipelines.capture import (
    _open_http_picture,
    _open_rtsp_transports,
    _replace_rtsp_path,
    _rtsp_reply_message,
    _rtsp_status,
    _rtsps_status,
    _tcp_failure,
    http_probe,
    public_stream_url,
    rtsp_candidates,
    stream_candidates,
)
from app.pipelines.stream_worker import preview_jpeg

IDLE_SEC = 90
MAX_PREVIEWS = 4


def stream_path(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return path


def candidate_paths(url: str) -> list[str]:
    """Paths the opener would try, in order, with the password left out."""
    parsed = urlparse(url)
    if parsed.scheme in ("rtsp", "rtsps"):
        urls = rtsp_candidates(url)
    elif parsed.scheme in ("http", "https"):
        urls = stream_candidates(url)
    else:
        urls = [url]
    found: list[str] = []
    for item in urls:
        path = stream_path(item)
        if path not in found:
            found.append(path)
    return found


def next_candidate_path(url: str, current: str) -> Optional[str]:
    paths = candidate_paths(url)
    try:
        index = paths.index(current)
    except ValueError:
        return None
    if index + 1 >= len(paths):
        return None
    return paths[index + 1]


def checkpoint_decision(opened: bool, login_failed: bool, has_next: bool) -> str:
    """open shows the picture. pause waits for the operator. stop is the end of this address."""
    if opened:
        return "open"
    if login_failed or has_next:
        return "pause"
    return "stop"


def _pack(decision: str, message: str, path: str, public_url: str, code: Optional[int], encrypted: bool, nxt: Optional[str]) -> dict:
    return {
        "decision": decision,
        "message": message[:500],
        "path": path,
        "publicUrl": public_url,
        "code": code,
        "encrypted": encrypted,
        "nextPath": None if decision == "stop" else nxt,
    }


def probe_checkpoint(url: str, path: Optional[str] = None) -> dict:
    """Check one path. Does not open the video and does not try the next path."""
    if path and ("://" in path or path.startswith("//") or "@" in path or not path.startswith("/")):
        return _pack("stop", "Path must start with / and stay on this camera.", path, public_stream_url(url), None, False, None)
    target = _replace_rtsp_path(url, path) if path else url
    parsed = urlparse(target)
    base = urlparse(url)
    if parsed.hostname != base.hostname or parsed.port != base.port:
        return _pack("stop", "Path must stay on the camera you entered.", stream_path(target), public_stream_url(url), None, False, None)
    current = stream_path(target)
    nxt = next_candidate_path(url, current)
    public = public_stream_url(target)
    host = parsed.hostname or ""
    port = parsed.port or (554 if parsed.scheme in ("rtsp", "rtsps") else 443 if parsed.scheme == "https" else 80)
    tcp = _tcp_failure(host, port)
    if tcp:
        return _pack("stop", tcp, current, public, None, False, None)
    try:
        if parsed.scheme in ("rtsp", "rtsps"):
            return _probe_rtsp(target, parsed, host, port, current, public, nxt)
        if parsed.scheme in ("http", "https"):
            return _probe_http(target, host, current, public, nxt)
    except OSError as exc:
        return _pack("stop", f"Could not open {host} port {port}: {exc.strerror or exc}.", current, public, None, False, None)
    return _pack("stop", "This address is not an RTSP or HTTP video stream.", current, public, None, False, None)


def _probe_rtsp(target: str, parsed, host: str, port: int, current: str, public: str, nxt: Optional[str]) -> dict:
    encrypted = parsed.scheme == "rtsps"
    reply = _rtsps_status(target, host, port) if encrypted else _rtsp_status(target, host, port)
    if reply is None and not encrypted:
        reply = _rtsps_status(target, host, port)
        encrypted = reply is not None
    if reply is None:
        decision = checkpoint_decision(False, False, nxt is not None)
        message = f"{host} port {port} is open, but the camera sent no RTSP reply for {current}."
        return _pack(decision, message, current, public, None, encrypted, nxt)
    code, reason = reply
    opened = 200 <= code < 300
    login = code in (401, 403)
    decision = checkpoint_decision(opened, login, nxt is not None)
    if opened:
        via = "RTSPS" if encrypted else "RTSP"
        message = f"The camera at {host} accepted {current} ({via} {code})."
    else:
        message = _rtsp_reply_message(host, current, code, reason, parsed.username, encrypted)
    return _pack(decision, message, current, public, code, encrypted, nxt)


def _probe_http(target: str, host: str, current: str, public: str, nxt: Optional[str]) -> dict:
    probed = http_probe(target)
    if probed is None:
        decision = checkpoint_decision(False, False, nxt is not None)
        return _pack(decision, f"{host} did not answer for {current}.", current, public, None, False, nxt)
    code, kind = probed
    if code in (401, 403):
        decision = checkpoint_decision(False, True, nxt is not None)
        message = f"The camera at {host} refused the login (HTTP {code}). Check the username and password."
        return _pack(decision, message, current, public, code, False, nxt)
    if kind == "html":
        decision = checkpoint_decision(False, False, nxt is not None)
        return _pack(decision, "This address is the camera web page, not the video feed.", current, public, code, False, nxt)
    if kind in ("mjpeg", "jpeg", "other"):
        return _pack("open", f"The camera at {host} accepted {current}.", current, public, code, False, nxt)
    decision = checkpoint_decision(False, False, nxt is not None)
    if kind == "missing":
        message = f"The camera at {host} is online, but the path {current} was not found."
    else:
        message = f"The camera at {host} answered HTTP {code} for {current}, and it is not a video feed."
    return _pack(decision, message, current, public, code, False, nxt)


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
