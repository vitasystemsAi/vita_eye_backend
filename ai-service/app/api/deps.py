from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, Request, status

from app.config.settings import get_settings


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    expected = get_settings().internal_service_token
    if not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal service token")


def state(request: Request):
    return request.app.state
