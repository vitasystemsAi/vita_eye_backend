import numpy as np

from app.pipelines.stream_worker import preview_jpeg


def test_preview_jpeg_fits_the_monitoring_wall():
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
    faces = [{"trackId": "t1", "bbox": [100, 200, 300, 400], "label": "UNKNOWN", "personId": None, "similarity": None, "quality": 0.8}]
    encoded = preview_jpeg(frame, faces)
    assert encoded is not None
    jpeg, size, scaled = encoded
    assert jpeg[:2] == b"\xff\xd8"
    assert max(size) <= 720
    assert scaled[0]["bbox"][0] < 100
    assert scaled[0]["bbox"][2] < 300
