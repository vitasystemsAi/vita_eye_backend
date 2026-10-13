"""Single-observation classification against the enrolled gallery."""
from __future__ import annotations

import math
from typing import Optional

from app.models.schemas import Policy


def required_margin(policy: Policy, person_count: int) -> float:
    """Lead the best person must have over the next person.

    The configured margin is the floor. It widens with gallery size so a lookalike is not
    named once thousands of people are enrolled: +0 at 10 people, about +0.06 at 10,000.
    """
    extra = 0.02 * math.log10(max(int(person_count), 10) / 10.0)
    return min(0.20, policy.match_margin + extra)


def classify(
    quality_ok: bool,
    best_similarity: Optional[float],
    second_similarity: Optional[float],
    policy: Policy,
    person_count: int = 1,
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
        margin = required_margin(policy, person_count)
        if second_similarity is None or (best_similarity - second_similarity) >= margin:
            return "KNOWN"
        return "UNCERTAIN"
    if best_similarity < policy.unknown_threshold:
        return "UNKNOWN"
    return "UNCERTAIN"
