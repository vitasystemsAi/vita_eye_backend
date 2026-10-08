"""Builds a Y4M clip from the face fixtures for Chromium's fake webcam (UI end-to-end tests only).

Sequence (looped by the browser): registered person -> empty scene -> unregistered person -> empty scene.
Run with the AI service virtualenv:  ai-service/.venv/Scripts/python tests/tools/make_fake_camera.py
"""

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "ai-service" / "tests" / "fixtures"
OUT = ROOT / "tests" / "fixtures" / "fake-camera.y4m"
W, H, FPS = 640, 480, 10


def letterbox(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None:
        raise SystemExit(f"Missing fixture {path}; run ai-service/scripts/download_test_fixtures.py")
    scale = min(W / img.shape[1], H / img.shape[0])
    resized = cv2.resize(img, (int(img.shape[1] * scale), int(img.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    canvas = np.full((H, W, 3), 40, np.uint8)
    y = (H - resized.shape[0]) // 2
    x = (W - resized.shape[1]) // 2
    canvas[y : y + resized.shape[0], x : x + resized.shape[1]] = resized
    return canvas


def main() -> None:
    blank = np.full((H, W, 3), 40, np.uint8)
    segments = [
        (letterbox(FIXTURES / "person_a_2.jpg"), 10),
        (blank, 6),
        (letterbox(FIXTURES / "person_b_1.jpg"), 10),
        (blank, 6),
    ]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n".encode())
        for frame, seconds in segments:
            yuv = cv2.cvtColor(frame, cv2.COLOR_BGR2YUV_I420).tobytes()
            for _ in range(seconds * FPS):
                f.write(b"FRAME\n")
                f.write(yuv)
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()
