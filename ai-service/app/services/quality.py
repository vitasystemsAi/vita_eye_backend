"""Face image quality assessment.

All scores are in [0, 1]. Hard issues (face too small, low detector confidence) make a face
unusable regardless of the composite score. The composite weights sharpness, pose, brightness,
size and detector confidence; it is a heuristic gate and should be validated per camera.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

HARD_ISSUES = {"FACE_TOO_SMALL", "LOW_DETECTION_CONFIDENCE", "LANDMARKS_UNRELIABLE"}


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

    def identifiable(self, min_face_size: int, min_detection_score: float) -> bool:
        """A live camera may still match this face.

        Enrollment keeps the strict ``usable`` gate. Distance and low light often miss that
        bar while the landmarks are still good enough for a similarity decision.
        """
        if "LANDMARKS_UNRELIABLE" in self.issues:
            return False
        if self.face_size < max(32, int(min_face_size * 0.5)):
            return False
        # Never demand more detector confidence than the organization asked for, and never
        # let a strict enrollment-style cutoff throw away a clear but distant face.
        if self.detection_score < min(0.62, min_detection_score):
            return False
        return True

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


def estimate_roll(face_row: np.ndarray) -> float:
    """Absolute tilt of the eye line in radians. ~0 when the eyes are level."""
    re = face_row[4:6]
    le = face_row[6:8]
    dx = float(le[0] - re[0])
    dy = float(le[1] - re[1])
    if dx * dx + dy * dy < 1e-4:
        return 1.0
    return float(abs(math.atan2(dy, dx)))


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
    roll = estimate_roll(face_row)
    eye_dist = float(np.linalg.norm(face_row[6:8] - face_row[4:6]))
    yaw_pose = _clip(1.0 - abs(yaw) / 0.6)
    roll_pose = _clip(1.0 - roll / 0.5)
    pose = min(yaw_pose, roll_pose)
    size = _clip(face_size / (min_face_size * 1.5))
    det = _clip((det_score - 0.5) / 0.5)

    score = 0.30 * sharp + 0.25 * pose + 0.20 * bright + 0.15 * size + 0.10 * det

    issues: list[str] = []
    if face_size < min_face_size:
        issues.append("FACE_TOO_SMALL")
    if det_score < min_detection_score:
        issues.append("LOW_DETECTION_CONFIDENCE")
    if eye_dist < max(8.0, 0.12 * float(w)):
        issues.append("LANDMARKS_UNRELIABLE")
    if sharp < 0.3:
        issues.append("BLURRY")
    if mean < 50:
        issues.append("TOO_DARK")
    elif mean > 215:
        issues.append("TOO_BRIGHT")
    if abs(yaw) > 0.45:
        issues.append("POSE_NOT_FRONTAL")
    if roll > 0.26:
        issues.append("FACE_TILTED")

    return QualityReport(
        score=_clip(score),
        face_size=face_size,
        sharpness=sharp,
        brightness=bright,
        pose_yaw=yaw,
        detection_score=det_score,
        issues=issues,
    )


# Nose sits about halfway from the eye line to the mouth on a level face.
NEUTRAL_NOSE_RATIO = 0.50
POSE_TARGETS = ("straight", "left", "right", "up", "down")


def estimate_pitch(face_row: np.ndarray) -> float:
    """Nose height between the eyes and the mouth. Kept for diagnostics.

    YuNet keeps this ratio almost constant when the chin rises, so guided
    capture uses appearance_pitch instead.
    """
    eye_y = float(face_row[5] + face_row[7]) / 2.0
    mouth_y = float(face_row[11] + face_row[13]) / 2.0
    span = mouth_y - eye_y
    if span < 1e-3:
        return 0.0
    return float((float(face_row[9]) - eye_y) / span - NEUTRAL_NOSE_RATIO)


def appearance_pitch(img_bgr: np.ndarray, face_row: np.ndarray) -> float:
    """Positive when the chin is raised.

    A raised chin turns the nostrils toward the camera, so the band under the
    nose is darker than the cheeks. The value is that darkness divided by 40.
    """
    x, y, w, h = (int(round(float(v))) for v in face_row[:4])
    height, width = img_bgr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1 = min(width, x + max(w, 1))
    y1 = min(height, y + max(h, 1))
    crop = img_bgr[y0:y1, x0:x1]
    if crop.size == 0 or crop.shape[0] < 20 or crop.shape[1] < 20:
        return 0.0
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    crop_h, crop_w = gray.shape
    c0, c1 = int(crop_w * 0.30), max(int(crop_w * 0.30) + 1, int(crop_w * 0.70))

    def band(top: float, bottom: float) -> float:
        r0 = int(crop_h * top)
        r1 = max(r0 + 1, int(crop_h * bottom))
        return float(gray[r0:r1, c0:c1].mean())

    return float((band(0.36, 0.46) - band(0.50, 0.62)) / 40.0)


def poses_ready(yaw: float, pitch: float, roll: float) -> list[str]:
    """Which enrollment commands this head pose satisfies.

    Yaw is from estimate_yaw on an unmirrored camera frame: positive means the
    person has turned to their own left (nose moves toward image-right).
    Pitch is appearance_pitch: positive means the chin is raised.
    A turn must stay under the enrollment limit (|yaw| 0.45) so the saved photo is accepted.
    """
    if roll > 0.22:
        return []
    if abs(yaw) <= 0.10 and -0.12 <= pitch <= 0.26:
        return ["straight"]
    ready: list[str] = []
    if 0.16 <= yaw <= 0.40:
        ready.append("left")
    if -0.40 <= yaw <= -0.16:
        ready.append("right")
    if abs(yaw) <= 0.16 and 0.34 <= pitch <= 0.75:
        ready.append("up")
    if abs(yaw) <= 0.16 and -0.55 <= pitch <= -0.08:
        ready.append("down")
    return ready


def pose_nudge(target: str, yaw: float | None, pitch: float | None, roll: float | None, issues: list[str]) -> tuple[bool, str]:
    """Operator instruction for the commanded pose. matched is true only when the head is in range."""
    text = {
        "NO_FACE": "Look into the guide",
        "MULTIPLE_FACES": "One person only",
        "FACE_TOO_SMALL": "Move closer",
        "LOW_DETECTION_CONFIDENCE": "Face the camera in even light",
        "LANDMARKS_UNRELIABLE": "Face the camera so both eyes are clear",
        "BLURRY": "Hold still",
        "TOO_DARK": "Too dark — add light",
        "TOO_BRIGHT": "Too bright — soften the light",
        "FACE_TILTED": "Keep your eyes level",
    }
    for code in text:
        if code in issues:
            return False, text[code]
    if yaw is None or pitch is None or roll is None:
        return False, "Look into the guide"
    if target in poses_ready(yaw, pitch, roll):
        return True, "Hold still"
    if target == "straight":
        if yaw > 0.10:
            return False, "Turn back toward the camera"
        if yaw < -0.10:
            return False, "Turn back toward the camera"
        if pitch > 0.26:
            return False, "Lower your chin a little"
        if pitch < -0.12:
            return False, "Lift your chin a little"
        return False, "Face the camera"
    if target == "left":
        if yaw > 0.40:
            return False, "Not so far left — both eyes stay visible"
        return False, "Turn your head to your left"
    if target == "right":
        if yaw < -0.40:
            return False, "Not so far right — both eyes stay visible"
        return False, "Turn your head to your right"
    if target == "up":
        if abs(yaw) > 0.16:
            return False, "Face forward, then lift your chin"
        if pitch > 0.75:
            return False, "Not so far — keep your eyes open"
        return False, "Lift your chin a little"
    if target == "down":
        if abs(yaw) > 0.16:
            return False, "Face forward, then lower your chin"
        if pitch < -0.55:
            return False, "Not so far down — both eyes stay visible"
        return False, "Lower your chin a little"
    return False, "Follow the pose on screen"


def guide_reading(img_bgr: np.ndarray, face_row: np.ndarray, target: str) -> dict:
    """Pose and capture blockers for one detected face. Does not build an embedding."""
    yaw = estimate_yaw(face_row)
    pitch = appearance_pitch(img_bgr, face_row)
    roll = estimate_roll(face_row)
    x, y, w, h = (int(round(float(v))) for v in face_row[:4])
    issues: list[str] = []
    if min(w, h) < 48:
        issues.append("FACE_TOO_SMALL")
    if float(face_row[14]) < 0.7:
        issues.append("LOW_DETECTION_CONFIDENCE")
    eye_dist = float(np.linalg.norm(face_row[6:8] - face_row[4:6]))
    if eye_dist < max(8.0, 0.12 * float(w)):
        issues.append("LANDMARKS_UNRELIABLE")
    if roll > 0.26:
        issues.append("FACE_TILTED")
    height, width = img_bgr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(width, x + max(w, 1)), min(height, y + max(h, 1))
    crop = img_bgr[y0:y1, x0:x1]
    if crop.size:
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        if float(cv2.Laplacian(gray, cv2.CV_64F).var()) < 20.0:
            issues.append("BLURRY")
        mean = float(gray.mean())
        if mean < 50:
            issues.append("TOO_DARK")
        elif mean > 215:
            issues.append("TOO_BRIGHT")
    matched, nudge = pose_nudge(target, yaw, pitch, roll, issues)
    return {
        "yaw": round(yaw, 4),
        "pitch": round(pitch, 4),
        "roll": round(roll, 4),
        "ready": poses_ready(yaw, pitch, roll) if not issues else [],
        "matched": matched,
        "nudge": nudge,
        "issues": issues,
    }
