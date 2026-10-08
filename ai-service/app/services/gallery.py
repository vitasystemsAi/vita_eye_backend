"""In-memory, per-organization gallery of enrolled face templates.

Templates are fetched from the backend's internal endpoint (decrypted there) and kept only in
memory. A gallery is refreshed whenever the backend reports a different gallery version.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

log = logging.getLogger("vita.gallery")


@dataclass
class Gallery:
    version: str
    matrix: np.ndarray = field(default_factory=lambda: np.zeros((0, 128), dtype=np.float32))
    template_person: np.ndarray = field(default_factory=lambda: np.zeros((0,), dtype=np.int32))
    person_ids: list[str] = field(default_factory=list)
    loaded_at: float = field(default_factory=time.time)

    @property
    def size(self) -> int:
        return int(self.matrix.shape[0])

    def match(self, embedding: np.ndarray) -> tuple[Optional[str], Optional[float], Optional[float]]:
        """Returns (best person id, best similarity, best similarity of a *different* person)."""
        if self.size == 0:
            return None, None, None
        sims = self.matrix @ embedding
        per_person = np.full(len(self.person_ids), -1.0, dtype=np.float32)
        np.maximum.at(per_person, self.template_person, sims)
        order = np.argsort(per_person)[::-1]
        best = int(order[0])
        second = float(per_person[order[1]]) if len(order) > 1 else None
        return self.person_ids[best], float(per_person[best]), second


def build_gallery(version: str, templates: list[dict], model_version: str) -> Gallery:
    person_index: dict[str, int] = {}
    rows: list[np.ndarray] = []
    owners: list[int] = []
    skipped = 0
    for t in templates:
        if t.get("modelVersion") != model_version:
            skipped += 1
            continue
        emb = np.asarray(t["embedding"], dtype=np.float32)
        n = float(np.linalg.norm(emb))
        if emb.shape != (128,) or n == 0:
            skipped += 1
            continue
        idx = person_index.setdefault(t["personId"], len(person_index))
        rows.append(emb / n)
        owners.append(idx)
    if skipped:
        log.warning("Skipped %d template(s) with incompatible model version or shape (re-enrollment required)", skipped)
    matrix = np.vstack(rows).astype(np.float32) if rows else np.zeros((0, 128), dtype=np.float32)
    persons = [None] * len(person_index)
    for pid, i in person_index.items():
        persons[i] = pid
    return Gallery(version=version, matrix=matrix, template_person=np.asarray(owners, dtype=np.int32), person_ids=persons)


class GalleryStore:
    def __init__(self, fetch: Callable[[str, Optional[str]], dict], model_version: str):
        self._fetch = fetch
        self._model_version = model_version
        self._galleries: dict[str, Gallery] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _lock(self, org: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(org, threading.Lock())

    def get(self, organization_id: str, version: str) -> Gallery:
        g = self._galleries.get(organization_id)
        if g and g.version == version:
            return g
        with self._lock(organization_id):
            g = self._galleries.get(organization_id)
            if g and g.version == version:
                return g
            data = self._fetch(organization_id, None)
            g = build_gallery(str(data["version"]), data.get("templates", []), self._model_version)
            self._galleries[organization_id] = g
            log.info("Loaded gallery for org %s: %d template(s), version %s", organization_id, g.size, g.version)
            return g

    def invalidate(self, organization_id: str) -> None:
        self._galleries.pop(organization_id, None)

    def stats(self) -> dict[str, dict]:
        return {org: {"templates": g.size, "persons": len(g.person_ids), "version": g.version} for org, g in self._galleries.items()}
