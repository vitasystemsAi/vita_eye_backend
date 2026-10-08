import numpy as np

from app.models.schemas import Policy
from app.pipelines.tracker import CameraTracker, Observation, iou

P = Policy(temporal_min_frames=3, temporal_window_sec=10, temporal_agreement=0.7, unknown_cooldown_sec=120)
BOX = (100, 100, 80, 80)


def unit(seed: int) -> np.ndarray:
    v = np.random.default_rng(seed).normal(size=128).astype(np.float32)
    return v / np.linalg.norm(v)


def feed(tracker, label, t, person=None, sim=0.6, emb=None, box=BOX):
    (track,) = tracker.assign([box], t, P)
    track.observations.append(Observation(t, label, person, sim, 0.8, emb))
    return track, tracker.evaluate(track, P, t)


def test_nearby_new_faces_get_distinct_tracks():
    tr = CameraTracker()
    # Two adjacent faces appearing together: close enough for the centre-distance fallback.
    tracks = tr.assign([(100, 100, 80, 80), (140, 100, 80, 80)], 0.0, P)
    assert len({t.id for t in tracks}) == 2
    again = tr.assign([(102, 100, 80, 80), (142, 100, 80, 80)], 0.5, P)
    assert [t.id for t in again] == [t.id for t in tracks]


def test_iou():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert iou((0, 0, 10, 10), (20, 20, 10, 10)) == 0.0


def test_known_confirmed_after_min_frames_and_emitted_once():
    tr = CameraTracker()
    _, d1 = feed(tr, "KNOWN", 0.0, "p1", sim=0.5)
    _, d2 = feed(tr, "KNOWN", 1.0, "p1", sim=0.5)
    assert d1 is None and d2 is None
    track, d3 = feed(tr, "KNOWN", 2.0, "p1", sim=0.5)
    assert d3 is not None and d3.event_type == "KNOWN" and d3.person_id == "p1"
    assert d3.frames_observed == 3
    _, d4 = feed(tr, "KNOWN", 3.0, "p1", sim=0.5)
    assert d4 is None, "a track must emit at most one event"


def test_strong_match_confirmed_from_single_frame():
    tr = CameraTracker()
    _, d = feed(tr, "KNOWN", 0.0, "p1", sim=P.known_threshold + 0.15)
    assert d is not None and d.event_type == "KNOWN" and d.person_id == "p1" and d.frames_observed == 1


def test_strong_match_not_instant_when_track_named_another_person():
    tr = CameraTracker()
    feed(tr, "KNOWN", 0.0, "p2", sim=0.5)
    _, d = feed(tr, "KNOWN", 0.1, "p1", sim=P.known_threshold + 0.15)
    assert d is None


def test_person_leaving_before_quota_is_still_reported():
    tr = CameraTracker()
    e = unit(7)
    track, d1 = feed(tr, "UNKNOWN", 0.0, sim=0.05, emb=e)
    _, d2 = feed(tr, "UNKNOWN", 0.125, sim=0.05, emb=e)
    assert d1 is None and d2 is None
    assert tr.expire(0.25, P) == []
    gone = tr.expire(5.0, P)
    assert [t.id for t in gone] == [track.id]
    d = tr.finalize(gone[0], P)
    assert d is not None and d.event_type == "UNKNOWN" and d.frames_observed == 2
    assert tr.finalize(gone[0], P) is None


def test_leaving_track_with_only_low_quality_frames_is_not_reported():
    tr = CameraTracker()
    feed(tr, "LOW_QUALITY", 0.0, sim=None)
    (gone,) = tr.expire(20.0, P)
    assert tr.finalize(gone, P) is None


def test_ttl_adapts_to_slow_sampling():
    tr = CameraTracker()
    tr.expire(0.0, P)
    tr.expire(2.0, P)
    t1, _ = feed(tr, "KNOWN", 4.0, "p1", sim=0.5)
    t2, _ = feed(tr, "KNOWN", 6.0, "p1", sim=0.5)
    t3, _ = feed(tr, "KNOWN", 8.0, "p1", sim=0.5)
    assert t1.id == t2.id == t3.id


def test_one_slow_frame_does_not_keep_departed_track_alive():
    tr = CameraTracker()
    tr.expire(0.0, P)
    a, _ = feed(tr, "KNOWN", 2.5, "p1", sim=0.5)  # first frame delayed (e.g. gallery load)
    feed(tr, "KNOWN", 2.9, "p1", sim=0.5)
    feed(tr, "KNOWN", 3.3, "p1", sim=0.5)
    b, _ = feed(tr, "UNKNOWN", 8.2, sim=0.05)
    assert a.id != b.id


def test_same_track_followed_across_small_motion():
    tr = CameraTracker()
    t1, _ = feed(tr, "KNOWN", 0.0, "p1", box=(100, 100, 80, 80))
    t2, _ = feed(tr, "KNOWN", 1.0, "p1", box=(110, 104, 80, 80))
    assert t1.id == t2.id


def test_low_quality_frames_do_not_count():
    tr = CameraTracker()
    for i in range(5):
        _, d = feed(tr, "LOW_QUALITY", float(i), sim=None)
        assert d is None


def test_disagreement_becomes_uncertain():
    tr = CameraTracker()
    labels = ["KNOWN", "UNKNOWN", "KNOWN", "UNKNOWN", "UNCERTAIN", "UNKNOWN"]
    decision = None
    for i, lab in enumerate(labels):
        _, d = feed(tr, lab, float(i), "p1" if lab == "KNOWN" else None, sim=0.3)
        decision = decision or d
    assert decision is not None and decision.event_type == "UNCERTAIN"


def test_unknown_confirmed_then_duplicate_suppressed_by_memory():
    tr = CameraTracker()
    e = unit(1)
    decision = None
    for i in range(3):
        _, d = feed(tr, "UNKNOWN", float(i), sim=0.05, emb=e)
        decision = decision or d
    assert decision is not None and decision.event_type == "UNKNOWN"

    # Same face re-appears later as a new track (after the old one expired) -> suppressed
    later = 30.0
    dup = None
    for i in range(3):
        _, d = feed(tr, "UNKNOWN", later + i, sim=0.05, emb=e, box=(400, 300, 80, 80))
        dup = dup or d
    assert dup is None

    # A different unknown face is reported
    other = None
    for i in range(3):
        _, d = feed(tr, "UNKNOWN", 60.0 + i, sim=0.05, emb=unit(2), box=(700, 300, 80, 80))
        other = other or d
    assert other is not None and other.event_type == "UNKNOWN"


def test_observations_outside_window_are_ignored():
    tr = CameraTracker()
    feed(tr, "KNOWN", 0.0, "p1")
    feed(tr, "KNOWN", 1.0, "p1")
    # Gap within track TTL is impossible here, so check evaluation window directly
    (track,) = tr.assign([BOX], 2.0, P)
    track.observations.append(Observation(20.0, "KNOWN", "p1", 0.6, 0.8, None))
    assert tr.evaluate(track, P, 20.0) is None
