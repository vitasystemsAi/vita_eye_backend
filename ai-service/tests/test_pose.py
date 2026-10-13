import numpy as np

from app.services.quality import appearance_pitch, estimate_yaw, pose_nudge, poses_ready


def _row(re, le, nose, rm, lm, score=0.99):
    return np.array(
        [80, 40, 160, 200, re[0], re[1], le[0], le[1], nose[0], nose[1], rm[0], rm[1], lm[0], lm[1], score],
        dtype=np.float32,
    )


def frontal():
    # Person's right eye is on the left of an unmirrored frame.
    return _row((100, 100), (160, 100), (130, 140), (112, 180), (148, 180))


def test_frontal_is_straight():
    row = frontal()
    assert abs(estimate_yaw(row)) < 0.02
    assert poses_ready(estimate_yaw(row), 0.0, 0.0) == ["straight"]
    matched, nudge = pose_nudge("straight", estimate_yaw(row), 0.0, 0.0, [])
    assert matched and nudge == "Hold still"


def test_subject_left_is_positive_yaw():
    row = frontal()
    row[8] = 148  # nose moves toward image-right, the person's left
    yaw = estimate_yaw(row)
    assert yaw > 0.2
    assert poses_ready(yaw, 0.0, 0.0) == ["left"]
    matched, nudge = pose_nudge("left", yaw, 0.0, 0.0, [])
    assert matched and nudge == "Hold still"
    matched, nudge = pose_nudge("straight", yaw, 0.0, 0.0, [])
    assert not matched


def test_subject_right_is_negative_yaw():
    row = frontal()
    row[8] = 112
    yaw = estimate_yaw(row)
    assert yaw < -0.2
    assert poses_ready(yaw, 0.0, 0.0) == ["right"]


def test_chin_up_and_down():
    assert "up" in poses_ready(0.0, 0.50, 0.0)
    matched, nudge = pose_nudge("up", 0.0, 0.50, 0.0, [])
    assert matched and nudge == "Hold still"
    assert poses_ready(0.0, -0.20, 0.0) == ["down"]
    matched, nudge = pose_nudge("up", 0.0, 0.13, 0.0, [])
    assert not matched and nudge == "Lift your chin a little"


def test_raised_chin_darkens_nostrils():
    row = np.zeros(15, np.float32)
    row[:4] = [0, 0, 80, 100]
    flat = np.full((100, 80, 3), 140, np.uint8)
    raised = flat.copy()
    raised[50:62, :, :] = 120
    assert appearance_pitch(flat, row) < 0.05
    assert appearance_pitch(raised, row) > 0.14
    assert "up" in poses_ready(0.0, appearance_pitch(raised, row), 0.0)


def test_tilt_and_blockers_do_not_match():
    assert poses_ready(0.0, 0.0, 0.3) == []
    matched, nudge = pose_nudge("straight", 0.0, 0.0, 0.0, ["NO_FACE"])
    assert not matched and nudge == "Look into the guide"
    matched, nudge = pose_nudge("left", 0.0, 0.0, 0.0, [])
    assert not matched and "left" in nudge
