"""A camera web page at / must resolve to the real MJPEG feed on the same host."""
from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import cv2
import numpy as np

from app.pipelines.capture import open_working_capture, stream_candidates

JPEG = cv2.imencode(".jpg", np.full((48, 64, 3), 40, dtype=np.uint8))[1].tobytes()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("", "/"):
            body = b"<html><title>IP Webcam</title><body>camera page</body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/video":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            part = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + JPEG + b"\r\n"
            try:
                while True:
                    self.wfile.write(part)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
                return
            return
        self.send_error(404)

    def log_message(self, _format, *_args):
        return


def test_candidates_stay_on_the_same_host():
    found = stream_candidates("http://user:pass@192.168.1.20:8080/")
    assert found[0].endswith(":8080/")
    assert all(urlparse(item).hostname == "192.168.1.20" for item in found)
    assert any(item == "http://user:pass@192.168.1.20:8080/video" for item in found)


def test_root_page_opens_the_video_feed():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    try:
        cap, resolved, error = open_working_capture(url)
        assert error is None
        assert cap is not None
        assert resolved == url.rstrip("/") + "/video"
        ok, frame = cap.read()
        assert ok and frame is not None
        assert frame.shape[1] == 64
        cap.release()
    finally:
        server.shutdown()
        server.server_close()


def test_offline_host_fails_without_trying_every_path():
    cap, resolved, error = open_working_capture("http://127.0.0.1:1/")
    assert cap is None
    assert resolved == "http://127.0.0.1:1/"
    assert error is not None
    assert "127.0.0.1 port 1" in error
    assert "Nothing is listening" in error
