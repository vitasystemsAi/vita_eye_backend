"""Face image quality assessment.

All scores are in [0, 1]. Hard issues (face too small, low detector confidence) make a face
unusable regardless of the composite score. The composite weights sharpness, pose, brightness,
size and detector confidence; it is a heuristic gate and should be validated per camera.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

HARD_ISSUES = {"FACE_TOO_SMALL", "LOW_DETECTION_CONFIDENCE"}


@dataclass
class QualityReport:
    score: float
    face_size: int
    sharpness: float
    brightness: float
    pose_yaw: float
    detection_score: float
    issues: list[str] = field(default_factory=list)

    def usable(self, min_quality: float) -> bool:
        return not (set(self.issues) & HARD_ISSUES) and self.score >= min_quality

    def to_dict(self) -> dict:
        return {
            "score": round(self.score, 4),
            "faceSize": self.face_size,
            "sharpness": round(self.sharpness, 4),
            "brightness": round(self.brightness, 4),
            "poseYaw": round(self.pose_yaw, 4),
            "detectionScore": round(self.detection_score, 4),
            "issues": list(self.issues),
        }


def _clip(v: float) -> float:
    return float(min(1.0, max(0.0, v)))


def estimate_yaw(face_row: np.ndarray) -> float:
    """Horizontal nose offset from the eye midpoint, normalised by inter-ocular distance.

    YuNet row layout: x, y, w, h, re_x, re_y, le_x, le_y, nose_x, nose_y, rm_x, rm_y, lm_x, lm_y, score
    ~0 for frontal faces, |yaw| > 0.5 for strong profiles.
    """
    re = face_row[4:6]
    le = face_row[6:8]
    nose = face_row[8:10]
    eye_dist = float(np.linalg.norm(le - re))
    if eye_dist < 1e-3:
        return 1.0
    mid_x = (re[0] + le[0]) / 2.0
    return float((nose[0] - mid_x) / eye_dist)


def assess(aligned_bgr: np.ndarray, face_row: np.ndarray, min_face_size: int, min_detection_score: float) -> QualityReport:
    x, y, w, h = face_row[:4]
    face_size = int(min(w, h))
    det_score = float(face_row[14])

    gray = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharp = _clip((lap_var - 15.0) / (180.0 - 15.0))

    mean = float(gray.mean())
    if 70 <= mean <= 190:
        bright = 1.0
    elif mean < 70:
        bright = _clip((mean - 25.0) / (70.0 - 25.0))
    else:
        bright = _clip((235.0 - mean) / (235.0 - 190.0))

    yaw = estimate_yaw(face_row)
    pose = _clip(1.0 - abs(yaw) / 0.6)
    size = _clip(face_size / (min_face_size * 1.5))
    det = _clip((det_score - 0.5) / 0.5)

    score = 0.30 * sharp + 0.25 * pose + 0.20 * bright + 0.15 * size + 0.10 * det

    issues: list[str] = []
    if face_size < min_face_size:
        issues.append("FACE_TOO_SMALL")
    if det_score < min_detection_score:
        issues.append("LOW_DETECTION_CONFIDENCE")
    if sharp < 0.3:
        issues.append("BLURRY")
    if mean < 50:
        issues.append("TOO_DARK")
    elif mean > 215:
        issues.append("TOO_BRIGHT")
    if abs(yaw) > 0.45:
        issues.append("POSE_NOT_FRONTAL")

    return QualityReport(
        score=_clip(score),
        face_size=face_size,
        sharpness=sharp,
        brightness=bright,
        pose_yaw=yaw,
        detection_score=det_score,
        issues=issues,
    )
