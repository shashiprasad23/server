"""Idempotency keys for create commands where retries could otherwise duplicate records (C1, E3, BR-TIME-08)."""

import hashlib
import json
import uuid
from collections.abc import Callable
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, ValidationFailed
from app.core.models import IdempotencyRecord


def _hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(jsonable_encoder(payload), sort_keys=True).encode()).hexdigest()


def run_idempotent(
    db: Session,
    user_id: uuid.UUID,
    scope: str,
    key: str | None,
    payload: Any,
    action: Callable[[], Any],
    *,
    required: bool = False,
    status_code: int = 201,
) -> JSONResponse:
    """Execute `action` once per (user, scope, key). Replays return the stored response with header
    `Idempotent-Replay: true`. Reusing a key with a different payload is rejected."""
    if not key:
        if required:
            raise ValidationFailed(
                "Idempotency-Key header is required for this operation", code="idempotency_key_required"
            )
        result = action()
        db.commit()
        return JSONResponse(jsonable_encoder(result), status_code=status_code)
    if len(key) > 120:
        raise ValidationFailed("Idempotency-Key must be at most 120 characters")
    request_hash = _hash(payload)

    def replay(rec: IdempotencyRecord) -> JSONResponse:
        if rec.request_hash != request_hash:
            raise Conflict(
                "This Idempotency-Key was already used with a different request", code="idempotency_key_reused"
            )
        return JSONResponse(rec.response, status_code=rec.status_code, headers={"Idempotent-Replay": "true"})

    existing = db.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.user_id == user_id, IdempotencyRecord.scope == scope, IdempotencyRecord.key == key
        )
    )
    if existing:
        return replay(existing)

    result = jsonable_encoder(action())
    db.add(
        IdempotencyRecord(
            user_id=user_id, scope=scope, key=key, request_hash=request_hash, status_code=status_code, response=result
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request with the same key won the race: discard our work and replay theirs.
        db.rollback()
        existing = db.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.user_id == user_id, IdempotencyRecord.scope == scope, IdempotencyRecord.key == key
            )
        )
        if existing is None:
            raise
        return replay(existing)
    return JSONResponse(result, status_code=status_code)
