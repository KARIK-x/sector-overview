from __future__ import annotations

import hashlib
import secrets

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from .models import AccountVault, utcnow


def new_vault_key() -> str:
    """A 256-bit bearer secret.  It is shown once and never stored in plaintext."""
    return secrets.token_urlsafe(32)


def hash_vault_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def vault_from_bearer(
    authorization: str | None,
    session: Session,
    *,
    touch: bool = True,
) -> AccountVault:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A private account key is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="A private account key is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    vault = session.scalar(
        select(AccountVault).where(AccountVault.key_hash == hash_vault_key(token.strip()))
    )
    if vault is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That account key is not recognised.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if touch:
        vault.last_seen_at = utcnow()
        session.commit()
    return vault


def require_vault(
    authorization: str | None = Header(default=None, alias="Authorization"),
    session: Session = Depends(get_session),
) -> AccountVault:
    return vault_from_bearer(authorization, session)
