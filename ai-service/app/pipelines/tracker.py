"""Per-camera face tracking and temporal verification.

Faces are associated across frames by bounding-box IoU (with a centre-distance fallback for low
frame rates). Each track accumulates observations; a decision is *confirmed* when enough usable
observations inside the temporal window agree. Two fast paths keep fast-moving people from
escaping unrecorded:

* a single observation that clears the known threshold by a wide margin is confirmed at once;
* a track that leaves the frame before reaching the frame quota is finalised from whatever usable
  observations it collected (the event carries ``frames_observed`` so reviewers can weigh it).

Each track emits at most one event. Unknown faces are additionally de-duplicated against a
short-term memory of recently reported unknown embeddings on the same camera.
"""
from __future__ import annotations

import itertools
import uuid
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from app.models.schemas import Policy

TRACK_TTL_SEC = 1.5
MAX_TRACK_TTL_SEC = 8.0
TTL_FRAME_INTERVALS = 2.5  # a track survives this many missed frames at slow sampling rates
IOU_MATCH = 0.25
INSTANT_KNOWN_BOOST = 0.12  # similarity above known_threshold that confirms a match from one frame
# A name already on a track is not replaced until the new person wins this many frames in a row.
NAME_SWITCH_FRAMES = 3
# Appearance repair: only move a box off its track when the faces clearly crossed.
CROSS_GAIN = 0.35
CROSS_ACCEPT = 0.50
CROSS_KEEP = 0.45


@dataclass
class Observation:
    t: float
    label: str  # KNOWN | UNKNOWN | UNCERTAIN | LOW_QUALITY
    person_id: Optional[str]
    similarity: Optional[float]
    quality: float
    embedding: Optional[np.ndarray]


@dataclass
class Decision:
    event_type: str
    person_id: Optional[str]
    confidence: Optional[float]
    quality: float
    frames_observed: int


@dataclass
class Track:
    id: str
    bbox: tuple[int, int, int, int]
    first_seen: float
    last_seen: float
    observations: deque = field(default_factory=lambda: deque(maxlen=60))
    emitted: bool = False
    suppressed: bool = False
    best_quality: float = -1.0
    evidence_frame: Optional[np.ndarray] = None
    evidence_bbox: Optional[tuple[int, int, int, int]] = None
    shown_person_id: Optional[str] = None

    def appearance(self) -> Optional[np.ndarray]:
        """Unit mean of the recent embeddings on this track, used to keep a name on the right face."""
        embs = [o.embedding for o in self.observations if o.embedding is not None]
        if not embs:
            return None
        mean = np.mean(np.vstack(embs[-5:]), axis=0)
        norm = float(np.linalg.norm(mean))
        if norm == 0:
            return None
        return (mean / norm).astype(np.float32)

    def display_label(self) -> tuple[str, Optional[str], Optional[float]]:
        """Stable identity for the live overlay.

        A registered name is shown only for one person. A single conflicting frame does not
        replace that name with someone else's; the overlay stays Uncertain until the new
        person wins three frames in a row.
        """
        recent = [o for o in self.observations if o.label != "LOW_QUALITY"][-8:]
        if not recent:
            last = self.observations[-1] if self.observations else None
            return ("LOW_QUALITY" if last else "PENDING"), None, None
        votes = Counter((o.label, o.person_id if o.label == "KNOWN" else None) for o in recent)
        (label, person_id), _count = votes.most_common(1)[0]
        agreeing = [o for o in recent if o.label == label and (label != "KNOWN" or o.person_id == person_id)]
        similarity = agreeing[-1].similarity
        if label != "KNOWN" or not person_id:
            self.shown_person_id = None
            return label, None, similarity

        rival_votes = sum(count for (lab, pid), count in votes.items() if lab == "KNOWN" and pid and pid != person_id)
        if rival_votes >= 2:
            self.shown_person_id = None
            return "UNCERTAIN", None, similarity

        if self.shown_person_id and self.shown_person_id != person_id:
            streak = 0
            for obs in reversed(recent):
                if obs.label == "KNOWN" and obs.person_id == person_id:
                    streak += 1
                else:
                    break
            if streak < NAME_SWITCH_FRAMES:
                return "UNCERTAIN", None, similarity
        self.shown_person_id = person_id
        return "KNOWN", person_id, similarity


def iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _repair_crossed_faces(
    assigned: dict[int, "Track"],
    embeddings: list[Optional[np.ndarray]],
) -> dict[int, "Track"]:
    """Give each box back to the track whose face it matches when two people have crossed.

    Geometry alone follows the box, so after a crossing the name stays on the wrong person.
    The repair runs only when every face in the group has an embedding and a track prototype,
    and only when the appearance assignment is clearly better than the box assignment.
    """
    items = [(i, track) for i, track in sorted(assigned.items()) if i < len(embeddings)]
    if len(items) > 8:
        items = items[:8]
    n = len(items)
    if n < 2:
        return assigned
    protos = [track.appearance() for _, track in items]
    if any(proto is None for proto in protos):
        return assigned
    sims = np.zeros((n, n), dtype=np.float32)
    for row, (det_i, _) in enumerate(items):
        emb = embeddings[det_i]
        if emb is None:
            return assigned
        for col, proto in enumerate(protos):
            sims[row, col] = float(emb @ proto)  # type: ignore[operator]
    identity = float(sum(sims[i, i] for i in range(n)))
    best_perm: tuple[int, ...] = tuple(range(n))
    best = identity
    for perm in itertools.permutations(range(n)):
        score = float(sum(sims[i, perm[i]] for i in range(n)))
        if score > best:
            best = score
            best_perm = perm
    if best < identity + CROSS_GAIN or best_perm == tuple(range(n)):
        return assigned
    for row in range(n):
        col = best_perm[row]
        if sims[row, col] < CROSS_ACCEPT:
            return assigned
        if col != row and sims[row, row] > CROSS_KEEP:
            return assigned
    repaired = dict(assigned)
    for row, (det_i, _) in enumerate(items):
        repaired[det_i] = items[best_perm[row]][1]
    return repaired


def centre_close(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    acx, acy = a[0] + a[2] / 2, a[1] + a[3] / 2
    bcx, bcy = b[0] + b[2] / 2, b[1] + b[3] / 2
    dist = ((acx - bcx) ** 2 + (acy - bcy) ** 2) ** 0.5
    return dist < 0.6 * max(a[2], a[3], b[2], b[3])


class CameraTracker:
    def __init__(self) -> None:
        self.tracks: dict[str, Track] = {}
        self.unknown_memory: deque[tuple[float, np.ndarray]] = deque(maxlen=200)
        self._last_frame_t: Optional[float] = None
        self._intervals: deque[float] = deque(maxlen=9)

    @property
    def ttl(self) -> float:
        # Median of *previous* frame gaps: robust to a single slow frame and never inflated by the
        # gap currently being judged.
        interval = float(np.median(self._intervals)) if self._intervals else 0.0
        return min(MAX_TRACK_TTL_SEC, max(TRACK_TTL_SEC, TTL_FRAME_INTERVALS * interval))

    def expire(self, now: float, policy: Policy) -> list[Track]:
        """Removes tracks not seen within the TTL and returns them (the person left the frame)."""
        ttl = self.ttl
        if self._last_frame_t is not None and now > self._last_frame_t:
            self._intervals.append(now - self._last_frame_t)
        self._last_frame_t = now
        gone = [t for t in self.tracks.values() if now - t.last_seen > ttl]
        for t in gone:
            del self.tracks[t.id]
        horizon = now - policy.unknown_cooldown_sec
        while self.unknown_memory and self.unknown_memory[0][0] < horizon:
            self.unknown_memory.popleft()
        return gone

    def assign(
        self,
        bboxes: list[tuple[int, int, int, int]],
        now: float,
        policy: Policy,
        embeddings: Optional[list[Optional[np.ndarray]]] = None,
    ) -> list[Track]:
        """Greedy IoU association, then an appearance check so crossed faces keep their own names."""
        if self._last_frame_t != now:
            self.expire(now, policy)
        candidates = sorted(
            ((iou(b, t.bbox), i, tid) for (i, b), (tid, t) in itertools.product(enumerate(bboxes), self.tracks.items())),
            reverse=True,
        )
        assigned: dict[int, Track] = {}
        used: set[str] = set()
        for score, i, tid in candidates:
            if i in assigned or tid in used:
                continue
            if score >= IOU_MATCH or (score > 0 and centre_close(bboxes[i], self.tracks[tid].bbox)):
                assigned[i] = self.tracks[tid]
                used.add(tid)
        for i, b in enumerate(bboxes):
            if i not in assigned:
                # Centre-distance fallback for sparse sampling where boxes no longer overlap.
                fallback = next(
                    (t for tid, t in self.tracks.items() if tid not in used and centre_close(b, t.bbox)),
                    None,
                )
                if fallback:
                    assigned[i] = fallback
                    used.add(fallback.id)
                else:
                    t = Track(id=uuid.uuid4().hex[:16], bbox=b, first_seen=now, last_seen=now)
                    self.tracks[t.id] = t
                    used.add(t.id)
                    assigned[i] = t
        if embeddings is not None and len(bboxes) >= 2:
            assigned = _repair_crossed_faces(assigned, embeddings)
        for i, b in enumerate(bboxes):
            assigned[i].bbox = b
            assigned[i].last_seen = now
        return [assigned[i] for i in range(len(bboxes))]

    def evaluate(self, track: Track, policy: Policy, now: float) -> Optional[Decision]:
        if track.emitted:
            return None
        usable = [o for o in track.observations if now - o.t <= policy.temporal_window_sec and o.label != "LOW_QUALITY"]
        if not usable:
            return None

        last = usable[-1]
        if (
            last.label == "KNOWN"
            and last.similarity is not None
            and last.similarity >= policy.known_threshold + INSTANT_KNOWN_BOOST
            and not any(o.label == "KNOWN" and o.person_id != last.person_id for o in usable)
        ):
            return self._decide(track, usable, policy, now, final=True)

        if len(usable) < policy.temporal_min_frames:
            return None
        return self._decide(track, usable, policy, now, final=len(usable) >= 2 * policy.temporal_min_frames)

    def finalize(self, track: Track, policy: Policy) -> Optional[Decision]:
        """Decision for a track that left the frame before it was confirmed."""
        if track.emitted:
            return None
        usable = [o for o in track.observations if track.last_seen - o.t <= policy.temporal_window_sec and o.label != "LOW_QUALITY"]
        if not usable:
            return None
        return self._decide(track, usable, policy, track.last_seen, final=True)

    def _decide(self, track: Track, usable: list[Observation], policy: Policy, now: float, final: bool) -> Optional[Decision]:
        """Majority vote over usable observations. ``final`` routes persistent disagreement to UNCERTAIN."""
        votes = Counter((o.label, o.person_id if o.label == "KNOWN" else None) for o in usable)
        (label, person_id), count = votes.most_common(1)[0]
        ratio = count / len(usable)
        agreeing = [o for o in usable if o.label == label and (label != "KNOWN" or o.person_id == person_id)]

        if ratio >= policy.temporal_agreement:
            sims = [o.similarity for o in agreeing if o.similarity is not None]
            confidence = float(np.mean(sims)) if sims else None
            track.emitted = True
            if label == "UNKNOWN" and self._recently_reported_unknown(agreeing, policy, now):
                track.suppressed = True
                return None
            mean_q = float(np.mean([o.quality for o in agreeing]))
            return Decision(label, person_id if label == "KNOWN" else None, confidence, mean_q, len(usable))

        if not final:
            return None
        # Persistent disagreement: route to human review rather than guessing.
        sims = [o.similarity for o in usable if o.similarity is not None]
        track.emitted = True
        return Decision(
            "UNCERTAIN",
            None,
            float(np.mean(sims)) if sims else None,
            float(np.mean([o.quality for o in usable])),
            len(usable),
        )

    def _recently_reported_unknown(self, observations: list[Observation], policy: Policy, now: float) -> bool:
        embs = [o.embedding for o in observations if o.embedding is not None]
        if not embs:
            return False
        mean = np.mean(np.vstack(embs), axis=0)
        n = float(np.linalg.norm(mean))
        if n == 0:
            return False
        mean = mean / n
        for _, prev in self.unknown_memory:
            if float(prev @ mean) >= policy.known_threshold:
                return True
        self.unknown_memory.append((now, mean))
        return False
