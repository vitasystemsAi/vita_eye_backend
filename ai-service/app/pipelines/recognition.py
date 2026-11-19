"""End-to-end frame processing: detect -> quality -> embed -> match -> track -> temporal decision."""
from __future__ import annotations

import base64
import threading
import time
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np

from app.models.schemas import Policy
from app.pipelines.classifier import classify
from app.pipelines.tracker import CameraTracker, Decision, Observation, Track
from app.services.face_engine import FaceEngine
from app.services.gallery import GalleryStore


SCENE_MAX_SIDE = 1920
CLOSEUP_SIZE = 480
CLOSEUP_CONTEXT = 1.9  # crop side as a multiple of the face box: whole head, hair and chin


def _encode(img: np.ndarray, quality: int) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else b""


def _scene_jpeg(img: np.ndarray, bbox: tuple[int, int, int, int]) -> bytes:
    """Full frame with the detected face outlined, capped at SCENE_MAX_SIDE."""
    h, w = img.shape[:2]
    scale = min(1.0, SCENE_MAX_SIDE / max(h, w))
    scene = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img.copy()
    x, y, bw, bh = (round(v * scale) for v in bbox)
    thickness = max(2, round(max(scene.shape[:2]) / 400))
    cv2.rectangle(scene, (x, y), (x + bw, y + bh), (0, 200, 255), thickness, cv2.LINE_AA)
    return _encode(scene, 85)


def _closeup_jpeg(img: np.ndarray, bbox: tuple[int, int, int, int]) -> bytes:
    """Square zoomed crop centred on the face, resized to CLOSEUP_SIZE; never stretched."""
    h, w = img.shape[:2]
    x, y, bw, bh = bbox
    side = min(round(max(bw, bh) * CLOSEUP_CONTEXT), w, h)
    cx, cy = x + bw / 2, y + bh / 2
    x0 = int(min(max(cx - side / 2, 0), w - side))
    y0 = int(min(max(cy - side / 2, 0), h - side))
    crop = img[y0 : y0 + side, x0 : x0 + side]
    if side < CLOSEUP_SIZE:
        crop = cv2.resize(crop, (CLOSEUP_SIZE, CLOSEUP_SIZE), interpolation=cv2.INTER_CUBIC)
        blur = cv2.GaussianBlur(crop, (0, 0), 1.2)
        crop = cv2.addWeighted(crop, 1.4, blur, -0.4, 0)
    elif side > CLOSEUP_SIZE:
        crop = cv2.resize(crop, (CLOSEUP_SIZE, CLOSEUP_SIZE), interpolation=cv2.INTER_AREA)
    return _encode(crop, 92)


class RecognitionPipeline:
    def __init__(self, engine: FaceEngine, galleries: GalleryStore):
        self.engine = engine
        self.galleries = galleries
        self._trackers: dict[str, CameraTracker] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _camera(self, camera_id: str) -> tuple[CameraTracker, threading.Lock]:
        with self._guard:
            if camera_id not in self._trackers:
                self._trackers[camera_id] = CameraTracker()
                self._locks[camera_id] = threading.Lock()
            return self._trackers[camera_id], self._locks[camera_id]

    def reset_camera(self, camera_id: str) -> None:
        with self._guard:
            self._trackers.pop(camera_id, None)
            self._locks.pop(camera_id, None)

    def process(
        self,
        img: np.ndarray,
        organization_id: str,
        camera_id: str,
        gallery_version: str,
        policy: Policy,
        now: Optional[float] = None,
    ) -> dict:
        now = time.time() if now is None else now
        gallery = self.galleries.get(organization_id, gallery_version)
        tracker, lock = self._camera(camera_id)

        with self.engine.slot():
            faces = self.engine.detect(img)
            analysed = []
            for f in faces:
                aligned, q = self.engine.analyse(img, f, policy.min_face_size, policy.min_detection_score)
                ok = q.identifiable(policy.min_face_size, policy.min_detection_score)
                emb = self.engine.embed_aligned(aligned) if ok else None
                analysed.append((f, q, ok, emb))

        face_results = []
        events = []
        with lock:
            for gone in tracker.expire(now, policy):
                decision = tracker.finalize(gone, policy)
                if decision:
                    events.append(self._event(gone, decision, gone.last_seen, policy))
            tracks = tracker.assign(
                [f.bbox for f, *_ in analysed],
                now,
                policy,
                [emb if ok else None for (_, _, ok, emb) in analysed],
            )
            matched = []
            for (f, q, ok, emb), track in zip(analysed, tracks):
                person_id, best, second = gallery.match(emb) if emb is not None else (None, None, None)
                label = classify(ok, best, second, policy, gallery.person_count)
                matched.append(
                    {
                        "face": f,
                        "quality": q,
                        "ok": ok,
                        "embedding": emb,
                        "track": track,
                        "person_id": person_id,
                        "best": best,
                        "label": label,
                    }
                )
            # One registered person cannot be two faces in the same frame. The stronger face
            # keeps the name; the other is left uncertain instead of borrowing it.
            claimed: dict[str, int] = {}
            for index, item in enumerate(matched):
                person_id = item["person_id"]
                if item["label"] != "KNOWN" or not person_id:
                    continue
                previous = claimed.get(person_id)
                score = item["best"] if item["best"] is not None else -1.0
                if previous is None:
                    claimed[person_id] = index
                    continue
                previous_score = matched[previous]["best"] if matched[previous]["best"] is not None else -1.0
                loser = previous if score >= previous_score else index
                if score >= previous_score:
                    claimed[person_id] = index
                matched[loser]["label"] = "UNCERTAIN"
                matched[loser]["person_id"] = None

            for item in matched:
                f = item["face"]
                q = item["quality"]
                label = item["label"]
                track = item["track"]
                person_id = item["person_id"] if label == "KNOWN" else None
                track.observations.append(
                    Observation(
                        t=now,
                        label=label,
                        person_id=person_id,
                        similarity=item["best"],
                        quality=q.score,
                        embedding=item["embedding"],
                    )
                )
                if policy.capture_evidence and item["ok"] and label != "KNOWN" and q.score > track.best_quality:
                    # Keep a reference only; JPEG encoding is deferred until an event is emitted.
                    track.best_quality = q.score
                    track.evidence_frame = img
                    track.evidence_bbox = f.bbox

                decision = tracker.evaluate(track, policy, now)
                if decision:
                    events.append(self._event(track, decision, now, policy))

                display, disp_person, disp_sim = track.display_label()
                # The live box stays on "Verifying" only until this track is confirmed.
                if display == "UNKNOWN" and not track.emitted:
                    display = "PENDING"
                if display != "KNOWN":
                    disp_person = None
                face_results.append(
                    {
                        "trackId": track.id,
                        "bbox": list(f.bbox),
                        "label": display,
                        "personId": disp_person,
                        "personName": gallery.name_for(disp_person) if display == "KNOWN" else None,
                        "similarity": None if disp_sim is None else round(disp_sim, 4),
                        "quality": round(q.score, 4),
                    }
                )

        h, w = img.shape[:2]
        return {"faces": face_results, "events": events, "frameSize": [w, h], "modelVersion": self.engine.model_version}

    def _event(self, track: Track, decision: Decision, at: float, policy: Policy) -> dict:
        scene = face = None
        if policy.capture_evidence and decision.event_type != "KNOWN" and track.evidence_frame is not None and track.evidence_bbox is not None:
            scene = base64.b64encode(_scene_jpeg(track.evidence_frame, track.evidence_bbox)).decode()
            face = base64.b64encode(_closeup_jpeg(track.evidence_frame, track.evidence_bbox)).decode()
        track.evidence_frame = None
        track.evidence_bbox = None
        return {
            "trackId": track.id,
            "eventType": decision.event_type,
            "personId": decision.person_id,
            "confidence": None if decision.confidence is None else round(decision.confidence, 4),
            "quality": round(decision.quality, 4),
            "framesObserved": decision.frames_observed,
            "timestamp": datetime.fromtimestamp(at, tz=timezone.utc).isoformat(),
            "modelVersion": self.engine.model_version,
            "evidenceJpegB64": scene,
            "evidenceFaceJpegB64": face,
        }
