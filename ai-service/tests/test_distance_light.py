import cv2
import numpy as np

from app.services.face_engine import _compensate_light, _detection_view, _looks_like_face, _merge_faces, _prune_faces
from app.services.face_engine import DetectedFace
from app.services.quality import QualityReport


def _report(**kwargs) -> QualityReport:
    base = dict(score=0.3, face_size=48, sharpness=0.2, brightness=0.3, pose_yaw=0.2, detection_score=0.7, issues=["FACE_TOO_SMALL", "TOO_DARK"])
    base.update(kwargs)
    return QualityReport(**base)


def test_distant_dim_face_is_still_matched():
    report = _report()
    assert report.usable(0.5) is False
    assert report.identifiable(64, 0.85) is True


def test_unreliable_landmarks_are_never_matched():
    report = _report(face_size=120, detection_score=0.95, score=0.8, issues=["LANDMARKS_UNRELIABLE"])
    assert report.identifiable(64, 0.85) is False


def test_tiny_face_is_rejected():
    assert _report(face_size=24, issues=[]).identifiable(64, 0.85) is False


def test_bright_enrollment_crop_is_unchanged():
    image = np.full((112, 112, 3), 140, np.uint8)
    assert _compensate_light(image) is image


def test_dark_crop_is_lifted_toward_daylight():
    image = np.full((112, 112, 3), 28, np.uint8)
    lifted = _compensate_light(image)
    assert float(cv2.cvtColor(lifted, cv2.COLOR_BGR2GRAY).mean()) > 60


def test_bright_frame_skips_detection_enhancement():
    image = np.full((40, 40, 3), 160, np.uint8)
    assert _detection_view(image) is image


def test_overlapping_distance_pass_does_not_duplicate_a_face():
    row = np.array([10, 10, 40, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.9], dtype=np.float32)
    shifted = row.copy()
    shifted[0] = 14
    merged = _merge_faces([DetectedFace(row)], [DetectedFace(shifted)])
    assert len(merged) == 1


def test_nested_ear_box_is_pruned_from_face():
    face = np.array([20, 20, 120, 140, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.92], dtype=np.float32)
    ear = np.array([100, 70, 28, 36, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.55], dtype=np.float32)
    pruned = _prune_faces([DetectedFace(face), DetectedFace(ear)])
    assert len(pruned) == 1
    assert pruned[0].bbox[2] == 120


def test_landmarks_in_a_face_arrangement_are_kept():
    # Box 80x100, eyes level, nose below them, mouth below the nose.
    row = np.array([100, 80, 80, 100, 122, 115, 162, 118, 142, 145, 128, 172, 158, 174, 0.9], dtype=np.float32)
    assert _looks_like_face(row) is True


def test_object_box_without_a_face_arrangement_is_dropped():
    wide = np.array([0, 0, 240, 50, 20, 20, 80, 22, 50, 10, 30, 8, 70, 9, 0.8], dtype=np.float32)
    assert _looks_like_face(wide) is False


def test_extreme_profile_is_not_matched():
    report = _report(face_size=120, detection_score=0.95, score=0.7, pose_yaw=0.72, issues=["POSE_NOT_FRONTAL"])
    assert report.identifiable(64, 0.85) is False
