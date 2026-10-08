import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from tests.conftest import MODELS, TEST_TOKEN, fixture_bytes

if not (MODELS / "face_recognition_sface_2021dec.onnx").exists():
    pytest.skip("models not downloaded", allow_module_level=True)

from app.main import app  # noqa: E402

AUTH = {"X-Internal-Token": TEST_TOKEN}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def blank_jpeg() -> bytes:
    ok, buf = cv2.imencode(".jpg", np.full((240, 320, 3), 128, dtype=np.uint8))
    return buf.tobytes()


def test_health_is_public(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_internal_token_required(client):
    r = client.post("/v1/enroll/embed", files={"image": ("x.jpg", blank_jpeg(), "image/jpeg")})
    assert r.status_code == 401
    r = client.post("/v1/enroll/embed", headers={"X-Internal-Token": "wrong"}, files={"image": ("x.jpg", blank_jpeg(), "image/jpeg")})
    assert r.status_code == 401


def test_enroll_rejects_image_without_face(client):
    r = client.post("/v1/enroll/embed", headers=AUTH, files={"image": ("x.jpg", blank_jpeg(), "image/jpeg")})
    assert r.status_code == 422
    assert r.json()["detail"]["reasons"] == ["NO_FACE"]


def test_enroll_rejects_corrupt_image(client):
    r = client.post("/v1/enroll/embed", headers=AUTH, files={"image": ("x.jpg", b"not an image", "image/jpeg")})
    assert r.status_code == 400


def test_enroll_returns_normalised_embedding(client):
    data = fixture_bytes("person_a_1.jpg")
    r = client.post(
        "/v1/enroll/embed",
        headers=AUTH,
        files={"image": ("a.jpg", data, "image/jpeg")},
        data={"policy": '{"minFaceSize": 40, "minDetectionScore": 0.7, "minQuality": 0.5}'},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["embedding"]) == 128
    assert abs(float(np.linalg.norm(body["embedding"])) - 1.0) < 1e-3
    assert body["modelVersion"] and body["quality"]["score"] >= 0.6


def test_frame_metadata_validated(client):
    r = client.post("/v1/frames/process", headers=AUTH, files={"frame": ("f.jpg", blank_jpeg(), "image/jpeg")}, data={"meta": "{}"})
    assert r.status_code == 400


def test_stream_test_reports_unreachable_source(client):
    r = client.post("/v1/streams/test", headers=AUTH, json={"url": "rtsp://127.0.0.1:1/none"})
    assert r.status_code == 200 and r.json()["ok"] is False
