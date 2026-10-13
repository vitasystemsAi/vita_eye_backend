import numpy as np

from app.services.gallery import GalleryStore, build_gallery

MV = "test-model"


def unit(seed: int) -> list[float]:
    v = np.random.default_rng(seed).normal(size=128)
    return (v / np.linalg.norm(v)).tolist()


def test_match_uses_best_template_per_person_and_second_best_other_person():
    a1, a2, b = unit(1), unit(2), unit(3)
    g = build_gallery(
        "v1",
        [
            {"personId": "A", "modelVersion": MV, "embedding": a1},
            {"personId": "A", "modelVersion": MV, "embedding": a2},
            {"personId": "B", "modelVersion": MV, "embedding": b},
        ],
        MV,
    )
    assert g.size == 3 and sorted(g.person_ids) == ["A", "B"]
    person, best, second = g.match(np.asarray(a2, dtype=np.float32))
    assert person == "A"
    assert best is not None and best > 0.6
    assert second is not None and best > second + 0.2


def test_outlier_template_cannot_steal_another_persons_identity():
    """A photo of A stored by mistake under B must not make a probe of A identify as B."""
    a = np.asarray(unit(1), dtype=np.float32)
    b = np.asarray(unit(2), dtype=np.float32)
    b = b - a * float(a @ b)
    b = b / np.linalg.norm(b)
    g = build_gallery(
        "v1",
        [
            {"personId": "A", "modelVersion": MV, "embedding": a.tolist(), "qualityScore": 0.9},
            {"personId": "A", "modelVersion": MV, "embedding": a.tolist(), "qualityScore": 0.9},
            {"personId": "B", "modelVersion": MV, "embedding": b.tolist(), "qualityScore": 0.9},
            {"personId": "B", "modelVersion": MV, "embedding": a.tolist(), "qualityScore": 0.4},
        ],
        MV,
    )
    person, best, second = g.match(a)
    assert person == "A"
    assert best is not None and second is not None
    assert best > 0.9 and best - second > 0.15


def test_exact_single_template_scores_one():
    a = unit(4)
    g = build_gallery("v1", [{"personId": "A", "personName": "Ada", "modelVersion": MV, "embedding": a}], MV)
    person, best, second = g.match(np.asarray(a, dtype=np.float32))
    assert person == "A" and g.name_for("A") == "Ada"
    assert best is not None and abs(best - 1.0) < 1e-5
    assert second is None


def test_incompatible_model_versions_are_skipped():
    g = build_gallery("v1", [{"personId": "A", "modelVersion": "old", "embedding": unit(1)}], MV)
    assert g.size == 0
    assert g.match(np.asarray(unit(1), dtype=np.float32)) == (None, None, None)


def test_store_refetches_only_on_version_change():
    calls = []

    def fetch(org, known):
        calls.append(org)
        return {"version": f"v{len(calls)}", "templates": [{"personId": "A", "modelVersion": MV, "embedding": unit(1)}]}

    store = GalleryStore(fetch, MV)
    g1 = store.get("org", "v1")
    assert store.get("org", "v1") is g1
    assert len(calls) == 1
    store.get("org", "v2")
    assert len(calls) == 2
