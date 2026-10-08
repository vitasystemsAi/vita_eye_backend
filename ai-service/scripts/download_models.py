"""Download the face detection / recognition models from the OpenCV Zoo.

* YuNet  (face_detection_yunet_2023mar.onnx)   - MIT License
* SFace  (face_recognition_sface_2021dec.onnx) - Apache License 2.0

Usage:  python scripts/download_models.py [--dir models]
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/opencv/opencv_zoo/raw/main/models"
MODELS = {
    "face_detection_yunet_2023mar.onnx": {
        "url": f"{BASE}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    },
    "face_recognition_sface_2021dec.onnx": {
        "url": f"{BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    },
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default=str(Path(__file__).resolve().parents[1] / "models"))
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    target = Path(args.dir)
    target.mkdir(parents=True, exist_ok=True)

    ok = True
    for name, info in MODELS.items():
        dest = target / name
        if dest.exists() and not args.force and sha256(dest) == info["sha256"]:
            print(f"[ok]   {name} already present")
            continue
        print(f"[get]  {name} <- {info['url']}")
        tmp = dest.with_suffix(".part")
        urllib.request.urlretrieve(info["url"], tmp)  # noqa: S310 - fixed https URL
        digest = sha256(tmp)
        if digest != info["sha256"]:
            tmp.unlink(missing_ok=True)
            print(f"[fail] {name}: checksum mismatch ({digest})", file=sys.stderr)
            ok = False
            continue
        tmp.replace(dest)
        print(f"[ok]   {name} ({dest.stat().st_size // 1024} KiB, sha256 verified)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
