from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from .config import settings


def require_token(x_print_ms_token: str = Header(default="")) -> None:
    """Every route (except /health) requires the per-launch token issued at
    startup. This is not meant to defend against a remote attacker — the
    server only ever binds to loopback — it stops any other local process
    or browser tab from silently talking to the backend."""
    if not hmac.compare_digest(x_print_ms_token, settings.token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing token.")
