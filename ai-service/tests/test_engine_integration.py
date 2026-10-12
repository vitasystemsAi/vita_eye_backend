"""Integration tests on real photographs (public-domain portraits, see scripts/download_test_fixtures.py)."""
import base64

import numpy as np

from app.models.schemas import Policy
from app.pipelines.recognition import RecognitionPipeline
from app.services.face_engine import decode_image
from app.services.gallery import GalleryStore
from tests.conftest import fixture_bytes

POLICY = Policy(min_face_size=40, min_quality=0.4, min_detection_score=0.7, temporal_min_frames=3)


def embed(engine, name):
    img = decode_image(fixture_bytes(name))
    faces = engine.detect(img)
    assert faces, f"no face detected in {name}"
    face = max(faces, key=lambda f: f.bbox[2] * f.bbox[3])
    aligned, q = engine.analyse(img, face, POLICY.min_face_size, POLICY.min_detection_score)
    return engine.embed_aligned(aligned), q


def test_detects_one_face_per_portrait(engine):
    for name in ("person_a_1.jpg", "person_a_2.jpg", "person_b_1.jpg"):
        faces = engine.detect(decode_image(fixture_bytes(name)))
        assert len(faces) == 1, name


def test_same_person_more_similar_than_different_person(engine):
    a1, qa = embed(engine, "person_a_1.jpg")
    a2, _ = embed(engine, "person_a_2.jpg")
    b1, _ = embed(engine, "person_b_1.jpg")
    same = float(a1 @ a2)
    diff = float(a1 @ b1)
    assert abs(np.linalg.norm(a1) - 1.0) < 1e-4
    assert qa.score > 0.5
    assert same > 0.363, f"same-person cosine {same:.3f} below OpenCV SFace reference threshold"
    assert diff < same - 0.15, f"different-person cosine {diff:.3f} too close to same-person {same:.3f}"


def _pipeline(engine, gallery_templates):
    store = GalleryStore(lambda org, known: {"version": "v1", "templates": gallery_templates}, engine.model_version)
    return RecognitionPipeline(engine, store)


def test_pipeline_confirms_known_and_unknown_with_temporal_verification(engine):
    a1, _ = embed(engine, "person_a_1.jpg")
    pipe = _pipeline(engine, [{"personId": "person-A", "modelVersion": engine.model_version, "embedding": a1.tolist()}])

    frame_a = decode_image(fixture_bytes("person_a_2.jpg"))
    results = [pipe.process(frame_a, "org", "cam-1", "v1", POLICY, now=100.0 + i) for i in range(4)]
    assert all(r["faces"][0]["label"] == "KNOWN" for r in results)
    events = [e for r in results for e in r["events"]]
    assert len(events) == 1, "exactly one event per track"
    assert events[0]["eventType"] == "KNOWN" and events[0]["personId"] == "person-A"
    assert results[0]["events"], "a strong match is confirmed on the first frame"
    assert events[0]["framesObserved"] == 1
    assert events[0]["evidenceJpegB64"] is None and events[0]["evidenceFaceJpegB64"] is None

    frame_b = decode_image(fixture_bytes("person_b_1.jpg"))
    results_b = [pipe.process(frame_b, "org", "cam-2", "v1", POLICY, now=200.0 + i) for i in range(3)]
    events_b = [e for r in results_b for e in r["events"]]
    assert len(events_b) == 1 and events_b[0]["eventType"] == "UNKNOWN"
    assert events_b[0]["personId"] is None
    scene = decode_image(base64.b64decode(events_b[0]["evidenceJpegB64"]))
    closeup = decode_image(base64.b64decode(events_b[0]["evidenceFaceJpegB64"]))
    assert scene.shape[:2] == frame_b.shape[:2]
    assert closeup.shape[:2] == (480, 480)
    assert engine.detect(closeup), "close-up should still contain a detectable face"


def test_unknown_seen_in_one_frame_is_reported_after_leaving(engine):
    a1, _ = embed(engine, "person_a_1.jpg")
    pipe = _pipeline(engine, [{"personId": "person-A", "modelVersion": engine.model_version, "embedding": a1.tolist()}])
    frame_b = decode_image(fixture_bytes("person_b_1.jpg"))
    blank = np.full(frame_b.shape, 127, dtype=np.uint8)

    first = pipe.process(frame_b, "org", "cam-3", "v1", POLICY, now=10.0)
    assert first["faces"][0]["label"] == "UNKNOWN" and first["events"] == []
    later = [pipe.process(blank, "org", "cam-3", "v1", POLICY, now=10.0 + 0.125 * i) for i in range(1, 20)]
    events = [e for r in later for e in r["events"]]
    assert len(events) == 1 and events[0]["eventType"] == "UNKNOWN" and events[0]["framesObserved"] == 1
    assert events[0]["timestamp"].startswith("1970-01-01T00:00:10")
    assert events[0]["evidenceJpegB64"] and events[0]["evidenceFaceJpegB64"]


def test_blank_frame_produces_no_faces(engine):
    pipe = _pipeline(engine, [])
    blank = np.full((480, 640, 3), 127, dtype=np.uint8)
    r = pipe.process(blank, "org", "cam-x", "v1", POLICY, now=1.0)
    assert r["faces"] == [] and r["events"] == []
