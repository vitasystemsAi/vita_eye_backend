"""Open RTSP and HTTP camera feeds, including phone apps that publish a web page at the root URL.

OpenCV is tried first. HTTP MJPEG that OpenCV cannot decode is read directly from the
multipart response. A root URL such as http://phone:8080/ is followed to the usual video paths
on that same host (/video, /videofeed, and the common IP-camera CGI paths).
"""
from __future__ import annotations

import base64
import logging
import os
import select
import socket
import threading
import time
from typing import Optional
from urllib.parse import unquote, urlparse, urlunparse

import cv2
import http.client
import numpy as np

log = logging.getLogger("vita.capture")

OPEN_TIMEOUT_MS = 5000
READ_TIMEOUT_MS = 8000
SNIFF_TIMEOUT = 4

# Same host only. These are the paths phone apps and IP cameras actually stream on.
HTTP_VIDEO_PATHS = (
    "/video",
    "/videofeed",
    "/video.mjpg",
    "/mjpg/video.mjpg",
    "/cgi-bin/mjpg/video.cgi",
    "/axis-cgi/mjpg/video.cgi",
    "/mjpegfeed",
    "/stream",
    "/shot.jpg",
)

_OPEN_LOCK = threading.Lock()


def stream_candidates(url: str) -> list[str]:
    """Original URL, then well-known video paths on that exact host when the scheme is HTTP."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return [url]
    found = [url]
    for path in HTTP_VIDEO_PATHS:
        alt = urlunparse(parsed._replace(path=path, params="", query="", fragment=""))
        if alt not in found:
            found.append(alt)
    return found


def _auth_header(parsed) -> dict[str, str]:
    if not parsed.username:
        return {}
    user = unquote(parsed.username)
    password = unquote(parsed.password or "")
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


def _connection(parsed, timeout: float = SNIFF_TIMEOUT):
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    host = parsed.hostname or ""
    if parsed.scheme == "https":
        return http.client.HTTPSConnection(host, port, timeout=timeout)
    return http.client.HTTPConnection(host, port, timeout=timeout)


def _request_path(parsed) -> str:
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return path


def sniff(url: str) -> str:
    """Classify a URL from response headers only. One of: mjpeg, jpeg, html, missing, down."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return "other"
    conn = _connection(parsed)
    try:
        conn.request("GET", _request_path(parsed), headers=_auth_header(parsed))
        response = conn.getresponse()
        kind = _classify(response.status, response.getheader("Content-Type") or "")
        # Drop the socket before close so a never-ending MJPEG body is not read.
        sock = conn.sock
        conn.sock = None
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()
        return kind
    except (TimeoutError, OSError, http.client.HTTPException):
        return "down"
    finally:
        conn.close()


def _classify(status: int, content_type: str) -> str:
    if status == 404 or status == 400:
        return "missing"
    if status != 200:
        return "down"
    ctype = content_type.lower()
    if "multipart" in ctype:
        return "mjpeg"
    if ctype.startswith("image/jpeg") or ctype.startswith("image/jpg"):
        return "jpeg"
    if "text/html" in ctype or ctype.startswith("text/"):
        return "html"
    return "other"


class HttpFrames:
    """grab/retrieve compatible reader for one MJPEG stream or a repeating JPEG snapshot."""

    def __init__(self, url: str, single: bool):
        self.url = url
        self._single = single
        self._conn: Optional[http.client.HTTPConnection] = None
        self._response = None
        self._buf = b""
        self._frame = None
        self._opened = False
        self._fetched = 0.0
        self._open()

    def isOpened(self) -> bool:
        return self._opened

    def set(self, _prop, _value) -> bool:
        return False

    def _open(self) -> None:
        parsed = urlparse(self.url)
        conn = _connection(parsed, timeout=READ_TIMEOUT_MS / 1000)
        try:
            conn.request("GET", _request_path(parsed), headers=_auth_header(parsed))
            response = conn.getresponse()
            kind = _classify(response.status, response.getheader("Content-Type") or "")
            if kind not in ("mjpeg", "jpeg"):
                response.close()
                conn.close()
                return
            self._conn = conn
            self._response = response
            self._single = kind == "jpeg"
            self._opened = True
        except (TimeoutError, OSError, http.client.HTTPException):
            conn.close()

    def _read_jpeg(self) -> Optional[bytes]:
        response = self._response
        if response is None:
            return None
        data = self._buf
        try:
            while True:
                start = data.find(b"\xff\xd8")
                end = data.find(b"\xff\xd9", start + 2) if start >= 0 else -1
                if start >= 0 and end >= 0:
                    self._buf = data[end + 2 :]
                    return data[start : end + 2]
                chunk = response.read(8192)
                if not chunk:
                    self._buf = b""
                    return None
                data += chunk
                if len(data) > 8_000_000:
                    marker = data.rfind(b"\xff\xd8")
                    data = data[marker:] if marker >= 0 else b""
        except (TimeoutError, OSError, http.client.HTTPException):
            return None

    def _pop_complete(self) -> Optional[bytes]:
        """Returns the newest complete JPEG already in the buffer, keeping any partial tail."""
        data = self._buf
        latest = None
        while True:
            start = data.find(b"\xff\xd8")
            end = data.find(b"\xff\xd9", start + 2) if start >= 0 else -1
            if start < 0 or end < 0:
                self._buf = data[start:] if start >= 0 else b""
                return latest
            latest = data[start : end + 2]
            data = data[end + 2 :]

    def _read_latest_jpeg(self) -> Optional[bytes]:
        """One new frame, then skip pictures already waiting so a slow reader stays on the live one."""
        latest = self._pop_complete() or self._read_jpeg()
        if not latest or self._single or self._conn is None or self._conn.sock is None or self._response is None:
            return latest
        sock = self._conn.sock
        previous = sock.gettimeout()
        sock.settimeout(0.0)
        deadline = time.perf_counter() + 0.03
        try:
            while time.perf_counter() < deadline:
                newer = self._pop_complete()
                if newer:
                    latest = newer
                if not select.select([sock], [], [], 0)[0]:
                    break
                try:
                    chunk = self._response.read(65536)
                except (TimeoutError, OSError, http.client.HTTPException):
                    break
                if not chunk:
                    break
                self._buf += chunk
        finally:
            try:
                sock.settimeout(previous)
            except OSError:
                pass
        newer = self._pop_complete()
        return newer or latest

    def grab(self) -> bool:
        if not self._opened:
            return False
        now = time.time()
        if self._single and self._frame is not None and now - self._fetched < 0.25:
            return True
        if self._single and self._fetched:
            self.release()
            self._open()
            if not self._opened:
                return False
        jpeg = self._read_latest_jpeg()
        if not jpeg:
            return False
        frame = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            return False
        self._frame = frame
        self._fetched = now
        return True

    def retrieve(self):
        if self._frame is None:
            return False, None
        return True, self._frame

    def read(self):
        if not self.grab():
            return False, None
        return self.retrieve()

    def interrupt(self) -> None:
        """Unblock a read from another thread. The reader still calls release()."""
        self._opened = False
        conn = self._conn
        sock = conn.sock if conn is not None else None
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def release(self) -> None:
        self._opened = False
        conn = self._conn
        self._conn = None
        self._response = None
        self._buf = b""
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass


def _opencv_capture(url: str, options: Optional[str] = None) -> cv2.VideoCapture:
    params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, OPEN_TIMEOUT_MS, cv2.CAP_PROP_READ_TIMEOUT_MSEC, READ_TIMEOUT_MS]
    with _OPEN_LOCK:
        previous = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS")
        if options is not None:
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = options
        try:
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)
        finally:
            if options is not None:
                if previous is None:
                    os.environ.pop("OPENCV_FFMPEG_CAPTURE_OPTIONS", None)
                else:
                    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = previous
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except cv2.error:
        pass
    return cap


def _frame_ok(cap) -> bool:
    if not cap.isOpened():
        return False
    ok, frame = cap.read()
    return bool(ok and frame is not None)


def _open_rtsp(url: str):
    for options in ("rtsp_transport;tcp|stimeout;4000000", "rtsp_transport;udp|stimeout;4000000"):
        cap = _opencv_capture(url, options)
        if _frame_ok(cap):
            return cap, url, None
        cap.release()
    return None, url, "Unable to connect to stream"


def _open_http_picture(url: str, kind: str):
    # Read MJPEG in-process. OpenCV's FFmpeg demuxer aborts the whole service on a truncated phone frame.
    frames = HttpFrames(url, single=kind == "jpeg")
    if frames.isOpened() and frames.grab():
        return frames
    frames.release()
    if kind == "jpeg":
        return None
    cap = _opencv_capture(url)
    if _frame_ok(cap):
        return cap
    cap.release()
    return None


def open_working_capture(url: str):
    """Return (capture, resolved_url, error). capture is None when nothing on this host answered with video."""
    parsed = urlparse(url)
    if parsed.scheme in ("rtsp", "rtsps"):
        return _open_rtsp(url)
    if parsed.scheme not in ("http", "https"):
        return None, url, "Unable to connect to stream"

    saw_page = False
    for index, candidate in enumerate(stream_candidates(url)):
        kind = sniff(candidate)
        if kind == "down":
            if index == 0:
                return None, url, "Unable to connect to stream"
            continue
        if kind == "html":
            saw_page = True
            continue
        if kind not in ("mjpeg", "jpeg", "other"):
            continue
        cap = _open_http_picture(candidate, kind)
        if cap is not None:
            if candidate != url:
                log.info("Using video feed %s for %s", candidate, url)
            return cap, candidate, None
    if saw_page:
        return None, url, "This address is the camera web page, and no video feed was found on it"
    return None, url, "Unable to connect to stream"
