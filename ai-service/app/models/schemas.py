from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

FaceLabel = Literal["KNOWN", "UNKNOWN", "UNCERTAIN", "LOW_QUALITY", "PENDING"]
EventType = Literal["KNOWN", "UNKNOWN", "UNCERTAIN"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Policy(CamelModel):
    """Recognition policy supplied by the backend (per-organization settings)."""

    known_threshold: float = Field(0.42, ge=0, le=1)
    unknown_threshold: float = Field(0.28, ge=0, le=1)
    match_margin: float = Field(0.05, ge=0, le=0.5)
    min_face_size: int = Field(64, ge=20, le=1000)
    min_quality: float = Field(0.5, ge=0, le=1)
    min_detection_score: float = Field(0.85, ge=0.3, le=1)
    temporal_min_frames: int = Field(3, ge=1, le=30)
    temporal_window_sec: int = Field(10, ge=1, le=120)
    temporal_agreement: float = Field(0.7, ge=0.5, le=1)
    unknown_cooldown_sec: int = Field(120, ge=0, le=86400)
    capture_evidence: bool = True


class Quality(CamelModel):
    score: float
    face_size: int
    sharpness: float
    brightness: float
    pose_yaw: float
    detection_score: float
    issues: list[str]


class EmbedResponse(CamelModel):
    embedding: list[float]
    quality: Quality
    bbox: tuple[int, int, int, int]
    model_name: str
    model_version: str


class FrameMeta(CamelModel):
    organization_id: str
    camera_id: str
    gallery_version: str
    policy: Policy


class FaceResult(CamelModel):
    track_id: str
    bbox: tuple[int, int, int, int]
    label: FaceLabel
    person_id: Optional[str] = None
    similarity: Optional[float] = None
    quality: float


class ConfirmedEvent(CamelModel):
    track_id: str
    event_type: EventType
    person_id: Optional[str] = None
    confidence: Optional[float] = None
    quality: float
    frames_observed: int
    timestamp: str
    model_version: str
    evidence_jpeg_b64: Optional[str] = None
    evidence_face_jpeg_b64: Optional[str] = None


class FrameResponse(CamelModel):
    faces: list[FaceResult]
    events: list[ConfirmedEvent]
    frame_size: tuple[int, int]
    model_version: str


class StreamStart(CamelModel):
    camera_id: str
    organization_id: str
    url: str
    sampling_fps: float = Field(8.0, ge=0.2, le=15)
    gallery_version: str
    policy: Policy


class StreamStop(CamelModel):
    camera_id: str


class StreamTest(CamelModel):
    url: str


class PolicyUpdate(CamelModel):
    organization_id: str
    policy: Policy
    gallery_version: str
