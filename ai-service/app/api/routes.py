from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import ValidationError

from app.api.deps import require_internal_token
from app.config.settings import get_settings
from app.models.schemas import FrameMeta, FrameResponse, Policy, PolicyUpdate, PreviewStop, StreamStart, StreamStop, StreamTest
from app.pipelines.preview import preview_hub
from app.pipelines.stream_worker import StreamConfig, test_stream
from app.services.face_engine import decode_image
from app.services.quality import POSE_TARGETS, guide_reading, pose_nudge

log = logging.getLogger("vita.api")

router = APIRouter(prefix="/v1", dependencies=[Depends(require_internal_token)])

ENROLL_MIN_QUALITY = 0.6
ENROLL_MIN_FACE = 96
ENROLL_MIN_DETECTION = 0.8


def _read_upload(upload: UploadFile) -> bytes:
    limit = get_settings().ai_max_upload_mb * 1024 * 1024
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail="Image too large")
    if not data:
        raise HTTPException(status_code=400, detail="Empty image")
    return data


def _reject(message: str, reasons: list[str], quality: dict | None = None):
    raise HTTPException(
        status_code=422,
        detail={"code": "FACE_QUALITY_REJECTED", "message": message, "reasons": reasons, "quality": quality},
    )


@router.post("/enroll/embed")
def enroll_embed(request: Request, image: UploadFile = File(...), policy: str | None = Form(default=None)):
    """Generate an enrollment template from a single image with strict quality requirements."""
    try:
        pol = Policy.model_validate_json(policy) if policy else Policy()
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid policy: {exc.errors()[:3]}") from exc
    try:
        img = decode_image(_read_upload(image))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    engine = request.app.state.engine
    with engine.slot():
        faces = engine.detect(img)
        if not faces:
            _reject("No face detected", ["NO_FACE"])
        faces.sort(key=lambda f: f.bbox[2] * f.bbox[3], reverse=True)
        if len(faces) > 1:
            a0 = faces[0].bbox[2] * faces[0].bbox[3]
            a1 = faces[1].bbox[2] * faces[1].bbox[3]
            # A second face even at a quarter of the subject is enough to enroll the wrong person.
            if a1 > 0.22 * a0:
                _reject("Multiple faces detected; only the enrolled person may be in the image", ["MULTIPLE_FACES"])
        face = faces[0]
        aligned, q = engine.analyse(
            img,
            face,
            max(pol.min_face_size, ENROLL_MIN_FACE),
            max(pol.min_detection_score, ENROLL_MIN_DETECTION),
        )
        threshold = max(pol.min_quality, ENROLL_MIN_QUALITY)
        if q.issues or q.score < threshold:
            reasons = list(q.issues) or ["LOW_QUALITY_SCORE"]
            _reject(f"Face image quality insufficient for enrollment (score {q.score:.2f} < {threshold:.2f})" if not q.issues
                    else "Face image quality insufficient for enrollment", reasons, q.to_dict())
        emb = engine.embed_aligned(aligned)

    return {
        "embedding": [round(float(v), 7) for v in emb.tolist()],
        "quality": q.to_dict(),
        "bbox": list(face.bbox),
        "modelName": engine.model_name,
        "modelVersion": engine.model_version,
    }


def _pose_body(target: str, faces: int, issues: list[str], reading: dict | None = None) -> dict:
    yaw = reading["yaw"] if reading else None
    pitch = reading["pitch"] if reading else None
    roll = reading["roll"] if reading else None
    matched, nudge = pose_nudge(target, yaw, pitch, roll, issues)
    return {
        "faces": faces,
        "yaw": yaw,
        "pitch": pitch,
        "roll": roll,
        "ready": reading["ready"] if reading and not issues else [],
        "matched": matched,
        "nudge": nudge,
        "issues": issues,
    }


@router.post("/enroll/pose")
def enroll_pose(request: Request, image: UploadFile = File(...), target: str = Form(...)):
    """Detect the live head pose for guided enrollment. No embedding is stored."""
    if target not in POSE_TARGETS:
        raise HTTPException(status_code=400, detail="Unknown pose target")
    try:
        img = decode_image(_read_upload(image))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    engine = request.app.state.engine
    with engine.slot():
        faces = engine.detect(img)
    if not faces:
        return _pose_body(target, 0, ["NO_FACE"])
    faces.sort(key=lambda f: f.bbox[2] * f.bbox[3], reverse=True)
    if len(faces) > 1:
        a0 = faces[0].bbox[2] * faces[0].bbox[3]
        a1 = faces[1].bbox[2] * faces[1].bbox[3]
        if a1 > 0.22 * a0:
            return _pose_body(target, len(faces), ["MULTIPLE_FACES"])
    reading = guide_reading(img, faces[0].row, target)
    return _pose_body(target, 1, reading["issues"], reading)


@router.post("/frames/process", response_model=FrameResponse, response_model_by_alias=True)
def process_frame(request: Request, frame: UploadFile = File(...), meta: str = Form(...)):
    try:
        m = FrameMeta.model_validate(json.loads(meta))
    except (ValidationError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid frame metadata") from exc
    try:
        img = decode_image(_read_upload(frame))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        return request.app.state.pipeline.process(img, m.organization_id, m.camera_id, m.gallery_version, m.policy)
    except Exception as exc:  # noqa: BLE001
        log.exception("Frame processing failed for camera %s", m.camera_id)
        raise HTTPException(status_code=500, detail=f"Recognition failed: {exc}") from exc


@router.post("/streams/start")
def streams_start(request: Request, body: StreamStart):
    try:
        request.app.state.streams.start(
            StreamConfig(
                camera_id=body.camera_id,
                organization_id=body.organization_id,
                url=body.url,
                sampling_fps=body.sampling_fps,
                gallery_version=body.gallery_version,
                policy=body.policy,
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return {"started": True}


@router.post("/streams/stop")
def streams_stop(request: Request, body: StreamStop):
    return {"stopped": request.app.state.streams.stop(body.camera_id)}


@router.post("/streams/test")
def streams_test(body: StreamTest):
    return test_stream(body.url)


@router.post("/streams/preview/start")
def streams_preview_start(body: StreamTest):
    return preview_hub.start(body.url)


@router.get("/streams/preview/{session_id}")
def streams_preview_frame(session_id: str):
    frame = preview_hub.frame(session_id)
    if frame is None:
        raise HTTPException(status_code=404, detail="Preview is not running")
    return frame


@router.post("/streams/preview/stop")
def streams_preview_stop(body: PreviewStop):
    return {"stopped": preview_hub.stop(body.session_id)}


@router.get("/streams")
def streams_list(request: Request):
    return {"streams": request.app.state.streams.list()}


@router.post("/policy")
def policy_update(request: Request, body: PolicyUpdate):
    n = request.app.state.streams.update_policy(body.organization_id, body.policy, body.gallery_version)
    return {"updated": n}
