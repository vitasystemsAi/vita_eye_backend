"""HTTP client for the backend's internal (service-to-service) endpoints."""
from __future__ import annotations

import base64
import logging
from typing import Any, Optional

import httpx

log = logging.getLogger("vita.backend")


class BackendClient:
    def __init__(self, base_url: str, token: str, timeout: float = 10.0):
        self._client = httpx.Client(
            base_url=base_url.rstrip("/") + "/api/v1/internal",
            headers={"X-Internal-Token": token},
            timeout=timeout,
        )

    def fetch_gallery(self, organization_id: str, known_version: Optional[str] = None) -> dict[str, Any]:
        params = {"knownVersion": known_version} if known_version else None
        r = self._client.get(f"/gallery/{organization_id}", params=params)
        r.raise_for_status()
        return r.json()["data"]

    def post_detections(self, payload: dict[str, Any]) -> None:
        r = self._client.post("/detections", json=payload, timeout=30.0)
        r.raise_for_status()

    def post_camera_status(
        self, camera_id: str, status: str, error: Optional[str] = None, organization_id: Optional[str] = None
    ) -> None:
        payload: dict[str, Any] = {"status": status, "error": error}
        if organization_id:
            payload["organizationId"] = organization_id
        try:
            r = self._client.post(f"/cameras/{camera_id}/status", json=payload)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            log.warning("Failed to report camera %s status %s: %s", camera_id, status, exc)

    def post_preview(
        self,
        camera_id: str,
        organization_id: str,
        jpeg: Optional[bytes] = None,
        faces: Optional[list[dict[str, Any]]] = None,
        frame_size: Optional[list[int]] = None,
    ) -> int:
        """Returns how many browsers are watching. Omit jpeg to probe without uploading a frame."""
        payload: dict[str, Any] = {"organizationId": organization_id}
        if jpeg is not None:
            payload["imageJpegB64"] = base64.b64encode(jpeg).decode()
            payload["faces"] = faces or []
            if frame_size is not None:
                payload["frameSize"] = frame_size
        try:
            r = self._client.post(f"/cameras/{camera_id}/preview", json=payload, timeout=1.0)
            r.raise_for_status()
            data = r.json().get("data") or {}
            return int(data.get("viewers") or 0)
        except httpx.HTTPError as exc:
            log.debug("Preview for camera %s failed: %s", camera_id, exc)
            return 0

    def close(self) -> None:
        self._client.close()
