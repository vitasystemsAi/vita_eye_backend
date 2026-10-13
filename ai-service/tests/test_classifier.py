from app.models.schemas import Policy
from app.pipelines.classifier import classify, required_margin

P = Policy(known_threshold=0.42, unknown_threshold=0.28, match_margin=0.05)


def test_low_quality_is_never_unknown():
    assert classify(False, None, None, P) == "LOW_QUALITY"
    assert classify(False, 0.01, None, P) == "LOW_QUALITY"


def test_empty_gallery_is_unknown():
    assert classify(True, None, None, P) == "UNKNOWN"


def test_known_requires_threshold_and_margin():
    assert classify(True, 0.60, 0.20, P) == "KNOWN"
    assert classify(True, 0.60, None, P) == "KNOWN"
    # ambiguous between two enrolled people -> uncertain, not a guess
    assert classify(True, 0.60, 0.58, P) == "UNCERTAIN"


def test_unknown_below_threshold():
    assert classify(True, 0.10, 0.05, P) == "UNKNOWN"


def test_grey_zone_is_uncertain():
    assert classify(True, 0.35, 0.10, P) == "UNCERTAIN"
    assert classify(True, 0.28, 0.10, P) == "UNCERTAIN"


def test_margin_widens_for_a_large_gallery():
    assert required_margin(P, 10) == P.match_margin
    assert required_margin(P, 10_000) > required_margin(P, 100) > P.match_margin
    assert required_margin(P, 10_000) <= 0.20
    # A 0.06 lead is enough among a handful of people, and not enough among 10,000.
    assert classify(True, 0.60, 0.54, P, person_count=10) == "KNOWN"
    assert classify(True, 0.60, 0.54, P, person_count=10_000) == "UNCERTAIN"
