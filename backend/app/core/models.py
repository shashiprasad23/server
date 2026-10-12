"""Cross-cutting persistence: audit, outbox, idempotency, notifications, integrations."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, fk, utcnow


class AuditEvent(IdMixin, Base):
    """Append-only; a database trigger rejects UPDATE/DELETE (E2)."""

    __tablename__ = "audit_events"
    organization_id: Mapped[uuid.UUID | None] = fk("organizations.id", nullable=True)
    actor_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(60), index=True)
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[uuid.UUID | None] = fk("projects.id", nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    safe_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)


class OutboxEvent(IdMixin, Base):
    __tablename__ = "outbox_events"
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    aggregate_type: Mapped[str] = mapped_column(String(60))
    aggregate_id: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    dead_lettered: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class IdempotencyRecord(IdMixin, Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("user_id", "scope", "key"),)
    user_id: Mapped[uuid.UUID] = fk("users.id")
    scope: Mapped[str] = mapped_column(String(120))
    key: Mapped[str] = mapped_column(String(120))
    request_hash: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int] = mapped_column(Integer)
    response: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Notification(IdMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key"),)
    user_id: Mapped[uuid.UUID] = fk("users.id")
    kind: Mapped[str] = mapped_column(String(60))
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(300), default="")
    dedupe_key: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    teams_delivery: Mapped[str] = mapped_column(String(20), default="not_requested")


class NotificationPreference(IdMixin, Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", "kind"),)
    user_id: Mapped[uuid.UUID] = fk("users.id")
    kind: Mapped[str] = mapped_column(String(60))
    in_app: Mapped[bool] = mapped_column(Boolean, default=True)
    teams: Mapped[bool] = mapped_column(Boolean, default=False)


class IntegrationMapping(IdMixin, Base):
    __tablename__ = "integration_mappings"
    __table_args__ = (
        UniqueConstraint("provider", "external_id"),
        UniqueConstraint("provider", "internal_type", "internal_id"),
    )
    provider: Mapped[str] = mapped_column(String(40))
    external_id: Mapped[str] = mapped_column(String(300))
    internal_type: Mapped[str] = mapped_column(String(60))
    internal_id: Mapped[str] = mapped_column(String(64))
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_state: Mapped[str] = mapped_column(String(20), default="ok")
    version: Mapped[str | None] = mapped_column(String(60), nullable=True)


class IntegrationInbox(IdMixin, Base):
    """Inbound webhook deliveries, de-duplicated by provider + delivery id."""

    __tablename__ = "integration_inbox"
    __table_args__ = (UniqueConstraint("provider", "delivery_id"),)
    provider: Mapped[str] = mapped_column(String(40))
    delivery_id: Mapped[str] = mapped_column(String(200))
    event_type: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="received")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
