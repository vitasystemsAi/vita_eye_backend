"""Single-observation classification against the enrolled gallery."""
from __future__ import annotations

from typing import Optional

from app.models.schemas import Policy


def classify(
    quality_ok: bool,
    best_similarity: Optional[float],
    second_similarity: Optional[float],
    policy: Policy,
) -> str:
    """Classify one face observation.

    * LOW_QUALITY - unusable face; never counted as unknown.
    * KNOWN       - similarity >= known threshold AND clearly better than any other person (margin).
    * UNKNOWN     - similarity below the unknown threshold (or empty gallery).
    * UNCERTAIN   - everything in between, including ambiguous matches between two people.
    """
    if not quality_ok:
        return "LOW_QUALITY"
    if best_similarity is None:
        return "UNKNOWN"
    if best_similarity >= policy.known_threshold:
        if second_similarity is None or (best_similarity - second_similarity) >= policy.match_margin:
            return "KNOWN"
        return "UNCERTAIN"
    if best_similarity < policy.unknown_threshold:
        return "UNKNOWN"
    return "UNCERTAIN"
