"""Audit trail and transactional outbox. Both are written in the caller's transaction (D6)."""

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import correlation_id_var
from app.core.models import AuditEvent, OutboxEvent


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def audit(
    db: Session,
    actor_id: uuid.UUID | None,
    action: str,
    entity_type: str,
    entity_id: Any,
    *,
    org_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    **metadata: Any,
) -> None:
    db.add(
        AuditEvent(
            organization_id=org_id,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            project_id=project_id,
            correlation_id=correlation_id_var.get(),
            safe_metadata=_jsonable(metadata),
        )
    )


def emit(db: Session, event_type: str, aggregate_type: str, aggregate_id: Any, **payload: Any) -> None:
    db.add(
        OutboxEvent(
            event_type=event_type,
            aggregate_type=aggregate_type,
            aggregate_id=str(aggregate_id),
            payload=_jsonable(payload),
            correlation_id=correlation_id_var.get(),
        )
    )
