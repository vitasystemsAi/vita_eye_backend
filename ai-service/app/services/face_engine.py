"""OpenCV YuNet face detector + SFace recogniser.

OpenCV DNN network objects are not thread-safe, so each worker thread lazily creates its own
detector/recogniser pair. A bounded semaphore caps concurrent CPU inference.
"""
from __future__ import annotations

import logging
import math
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
# A second pass upscales toward this so a face across the room still crosses YuNet's stride.
DISTANCE_DETECT_SIDE = 1920
DISTANCE_FACE_PX = 96
DETECTOR_SCORE_FLOOR = 0.45
# Aligned faces brighter than this are embedded unchanged, so well-lit enrollments stay valid.
LIGHT_LIFT_BELOW = 78.0


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
        prepared = _detection_view(img)
        found = self._detect_scaled(prepared, 1.0, MAX_DETECT_SIDE)
        largest = max((min(face.bbox[2], face.bbox[3]) for face in found), default=0)
        long_side = max(img.shape[:2])
        if largest < DISTANCE_FACE_PX and long_side < DISTANCE_DETECT_SIDE:
            scale = min(1.6, DISTANCE_DETECT_SIDE / float(long_side))
            if scale > 1.08:
                found = _merge_faces(found, self._detect_scaled(prepared, scale, DISTANCE_DETECT_SIDE))
        return found

    def _detect_scaled(self, img: np.ndarray, scale: float, max_side: int) -> list[DetectedFace]:
        detector, _ = self._models()
        height, width = img.shape[:2]
        applied = scale
        if max(height, width) * applied > max_side:
            applied = max_side / float(max(height, width))
        work = img
        if abs(applied - 1.0) > 0.01:
            interpolation = cv2.INTER_AREA if applied < 1 else cv2.INTER_LINEAR
            work = cv2.resize(img, (max(1, int(width * applied)), max(1, int(height * applied))), interpolation=interpolation)
        detector.setInputSize((work.shape[1], work.shape[0]))
        _, faces = detector.detect(work)
        if faces is None:
            return []
        out = []
        for row in faces:
            recovered = row.astype(np.float32).copy()
            if abs(applied - 1.0) > 0.01:
                recovered[:14] /= applied
            out.append(DetectedFace(recovered))
        return out

    def align(self, img: np.ndarray, face: DetectedFace) -> np.ndarray:
        """Upscale only a small face so SFace interpolates from more than a handful of pixels."""
        _, recognizer = self._models()
        _x, _y, width, height = face.bbox
        short = min(width, height)
        if short >= DISTANCE_FACE_PX or short < 8:
            return recognizer.alignCrop(img, face.row)
        factor = min(3.0, 140.0 / float(short))
        pad = int(max(width, height) * 0.75)
        image_h, image_w = img.shape[:2]
        x0 = max(0, int(face.row[0]) - pad)
        y0 = max(0, int(face.row[1]) - pad)
        x1 = min(image_w, int(face.row[0] + face.row[2]) + pad)
        y1 = min(image_h, int(face.row[1] + face.row[3]) + pad)
        crop = img[y0:y1, x0:x1]
        if crop.size == 0:
            return recognizer.alignCrop(img, face.row)
        big = cv2.resize(crop, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC)
        row = face.row.astype(np.float32).copy()
        row[0] = (face.row[0] - x0) * factor
        row[1] = (face.row[1] - y0) * factor
        row[2] = face.row[2] * factor
        row[3] = face.row[3] * factor
        for index in range(4, 14, 2):
            row[index] = (face.row[index] - x0) * factor
            row[index + 1] = (face.row[index + 1] - y0) * factor
        return recognizer.alignCrop(big, row)

    def embed_aligned(self, aligned: np.ndarray) -> np.ndarray:
        _, recognizer = self._models()
        feat = recognizer.feature(_compensate_light(aligned)).astype(np.float32).reshape(-1)
        norm = float(np.linalg.norm(feat))
        return feat / norm if norm > 0 else feat

    def analyse(
        self, img: np.ndarray, face: DetectedFace, min_face_size: int, min_detection_score: float
    ) -> tuple[np.ndarray, QualityReport]:
        aligned = self.align(img, face)
        return aligned, assess(aligned, face.row, min_face_size, min_detection_score)


def _detection_view(img: np.ndarray) -> np.ndarray:
    """Lift a dark frame for the detector only. The embedding is still taken from the original."""
    if float(img.mean()) >= 90.0:
        return img
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    lightness, green, red = cv2.split(lab)
    lightness = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(lightness)
    return cv2.cvtColor(cv2.merge((lightness, green, red)), cv2.COLOR_LAB2BGR)


def _compensate_light(aligned: np.ndarray) -> np.ndarray:
    """Bring a dark aligned face toward the brightness SFace saw at a normal enrollment.

    A well-lit crop is returned unchanged, so existing gallery templates stay comparable.
    """
    mean = float(cv2.cvtColor(aligned, cv2.COLOR_BGR2GRAY).mean())
    if mean >= LIGHT_LIFT_BELOW or mean < 8.0:
        return aligned
    gamma = min(2.4, max(1.05, math.log(mean / 255.0) / math.log(115.0 / 255.0)))
    lut = np.clip(((np.arange(256, dtype=np.float32) / 255.0) ** (1.0 / gamma)) * 255.0, 0, 255).astype(np.uint8)
    lifted = cv2.LUT(aligned, lut)
    lab = cv2.cvtColor(lifted, cv2.COLOR_BGR2LAB)
    lightness, green, red = cv2.split(lab)
    lightness = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(lightness)
    return cv2.cvtColor(cv2.merge((lightness, green, red)), cv2.COLOR_LAB2BGR)


def _iou(a: DetectedFace, b: DetectedFace) -> float:
    ax, ay, aw, ah = a.bbox
    bx, by, bw, bh = b.bbox
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    overlap = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - overlap
    return overlap / union if union else 0.0


def _merge_faces(primary: list[DetectedFace], extra: list[DetectedFace]) -> list[DetectedFace]:
    merged = list(primary)
    for face in extra:
        if any(_iou(face, kept) >= 0.4 for kept in merged):
            continue
        merged.append(face)
    return merged


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
