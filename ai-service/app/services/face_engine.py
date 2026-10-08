"""OpenCV YuNet face detector + SFace recogniser.

OpenCV DNN network objects are not thread-safe, so each worker thread lazily creates its own
detector/recogniser pair. A bounded semaphore caps concurrent CPU inference.
"""
from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.services.quality import QualityReport, assess

log = logging.getLogger("vita.engine")

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"
MODEL_NAME = "opencv-yunet-sface"
MODEL_VERSION = "yunet-2023mar+sface-2021dec"
MAX_DETECT_SIDE = 1280
DETECTOR_SCORE_FLOOR = 0.6


@dataclass
class DetectedFace:
    row: np.ndarray  # YuNet row in original-image coordinates (15 floats)

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        x, y, w, h = self.row[:4]
        return int(round(x)), int(round(y)), int(round(w)), int(round(h))

    @property
    def score(self) -> float:
        return float(self.row[14])


class ModelsMissingError(RuntimeError):
    pass


class FaceEngine:
    def __init__(self, models_dir: Path, workers: int = 2):
        self.detector_path = models_dir / DETECTOR_FILE
        self.recognizer_path = models_dir / RECOGNIZER_FILE
        missing = [p.name for p in (self.detector_path, self.recognizer_path) if not p.exists()]
        if missing:
            raise ModelsMissingError(
                f"Model files missing in {models_dir}: {', '.join(missing)}. Run: python scripts/download_models.py"
            )
        self._local = threading.local()
        self._slots = threading.BoundedSemaphore(max(1, workers))
        self.model_name = MODEL_NAME
        self.model_version = MODEL_VERSION
        # Fail fast if the ONNX files are corrupt.
        self._models()
        log.info("Face models loaded (%s)", MODEL_VERSION)

    def _models(self):
        if not hasattr(self._local, "detector"):
            self._local.detector = cv2.FaceDetectorYN.create(
                str(self.detector_path), "", (320, 320), DETECTOR_SCORE_FLOOR, 0.3, 50
            )
            self._local.recognizer = cv2.FaceRecognizerSF.create(str(self.recognizer_path), "")
        return self._local.detector, self._local.recognizer

    @contextmanager
    def slot(self):
        self._slots.acquire()
        try:
            yield
        finally:
            self._slots.release()

    def detect(self, img: np.ndarray) -> list[DetectedFace]:
        detector, _ = self._models()
        h, w = img.shape[:2]
        scale = 1.0
        work = img
        if max(h, w) > MAX_DETECT_SIDE:
            scale = MAX_DETECT_SIDE / float(max(h, w))
            work = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        detector.setInputSize((work.shape[1], work.shape[0]))
        _, faces = detector.detect(work)
        if faces is None:
            return []
        out = []
        for row in faces:
            r = row.astype(np.float32).copy()
            if scale != 1.0:
                r[:14] /= scale
            out.append(DetectedFace(r))
        return out

    def align(self, img: np.ndarray, face: DetectedFace) -> np.ndarray:
        _, recognizer = self._models()
        return recognizer.alignCrop(img, face.row)

    def embed_aligned(self, aligned: np.ndarray) -> np.ndarray:
        _, recognizer = self._models()
        feat = recognizer.feature(aligned).astype(np.float32).reshape(-1)
        norm = float(np.linalg.norm(feat))
        return feat / norm if norm > 0 else feat

    def analyse(
        self, img: np.ndarray, face: DetectedFace, min_face_size: int, min_detection_score: float
    ) -> tuple[np.ndarray, QualityReport]:
        aligned = self.align(img, face)
        return aligned, assess(aligned, face.row, min_face_size, min_detection_score)


def decode_image(data: bytes, max_side: int = 1920) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Unsupported or corrupt image")
    h, w = img.shape[:2]
    if max(h, w) > max_side:
        s = max_side / float(max(h, w))
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return img
