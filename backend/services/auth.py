"""
Signed session tokens.

The app has no login — a visitor enters a display name and the backend issues a
short-lived, HMAC-signed token bound to a `user_id` + `session_id`. Clients send
this token on the WebSocket connection and on REST calls that touch a user's
orders or flagged sessions; the backend verifies the signature and scopes those
operations to the token's `user_id`, so a client cannot act as another user.

This is deliberately lightweight (stdlib `hmac`, no external JWT dependency) and
stateless: no server-side session store, the token carries its own claims and
expiry. Rotate `AUTH_SECRET` to invalidate all outstanding tokens.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Optional

from backend.config import settings


class AuthError(Exception):
    """Raised when a token is missing, malformed, tampered, or expired."""


@dataclass(frozen=True)
class SessionClaims:
    user_id: str
    session_id: str
    exp: int  # unix seconds


def _secret() -> bytes:
    if not settings.auth_secret:
        raise AuthError("AUTH_SECRET is not configured")
    return settings.auth_secret.encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def issue_token(
    user_id: str,
    session_id: str,
    ttl_seconds: Optional[int] = None,
) -> str:
    """Create a signed token binding `user_id` + `session_id` with an expiry."""
    ttl = ttl_seconds if ttl_seconds is not None else settings.session_token_ttl
    payload = {
        "user_id": user_id,
        "session_id": session_id,
        "exp": int(time.time()) + ttl,
    }
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(signature)}"


def verify_token(token: str) -> SessionClaims:
    """Verify a token's signature and expiry, returning its claims.

    Raises AuthError on any problem. Uses a constant-time signature compare.
    """
    if not token:
        raise AuthError("missing token")
    try:
        body, provided_sig = token.split(".", 1)
    except ValueError:
        raise AuthError("malformed token")

    expected_sig = hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest()
    try:
        provided = _b64url_decode(provided_sig)
    except Exception:
        raise AuthError("malformed signature")
    if not hmac.compare_digest(expected_sig, provided):
        raise AuthError("invalid signature")

    try:
        payload = json.loads(_b64url_decode(body))
    except Exception:
        raise AuthError("malformed payload")

    if int(payload.get("exp", 0)) < int(time.time()):
        raise AuthError("token expired")

    return SessionClaims(
        user_id=str(payload["user_id"]),
        session_id=str(payload["session_id"]),
        exp=int(payload["exp"]),
    )
