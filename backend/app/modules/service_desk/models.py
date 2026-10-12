import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, TimestampMixin, fk, utcnow

PRIORITIES = ["P1", "P2", "P3", "P4"]

# Impact x urgency -> priority (incident triage matrix)
PRIORITY_MATRIX = {
    ("high", "high"): "P1",
    ("high", "medium"): "P2",
    ("medium", "high"): "P2",
    ("high", "low"): "P3",
    ("medium", "medium"): "P3",
    ("low", "high"): "P3",
    ("medium", "low"): "P4",
    ("low", "medium"): "P4",
    ("low", "low"): "P4",
}


class SlaPolicy(IdMixin, TimestampMixin, Base):
    __tablename__ = "sla_policies"
    organization_id: Mapped[uuid.UUID] = fk("organizations.id")
    name: Mapped[str] = mapped_column(String(120))
    # {"P1": {"response": 15, "resolution": 240}, ...} minutes
    targets: Mapped[dict] = mapped_column(JSONB, default=dict)
    calendar: Mapped[str] = mapped_column(String(20), default="24x7")


class ServiceOffering(IdMixin, TimestampMixin, Base):
    __tablename__ = "service_offerings"
    project_id: Mapped[uuid.UUID] = fk("projects.id")  # the service queue
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(80), default="General")
    request_type: Mapped[str] = mapped_column(String(30), default="service_request")
    owner_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    support_group: Mapped[str] = mapped_column(String(120), default="")
    eligibility: Mapped[str] = mapped_column(String(40), default="all")  # all | project_members
    # [{"key","label","type":"text|textarea|select|date","required":bool,"options":[...]}]
    form_schema: Mapped[list] = mapped_column(JSONB, default=list)
    default_priority: Mapped[str] = mapped_column(String(4), default="P3")
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False)
    sla_policy_id: Mapped[uuid.UUID | None] = fk("sla_policies.id", nullable=True)
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    routing: Mapped[dict] = mapped_column(JSONB, default=dict)  # {"default_assignee_id": ...}


class SlaEvent(IdMixin, Base):
    """Every SLA start, pause, resume, breach and escalation is auditable (C7)."""

    __tablename__ = "sla_events"
    work_item_id: Mapped[uuid.UUID] = fk("work_items.id", ondelete="CASCADE")
    kind: Mapped[str] = mapped_column(String(30))
    detail: Mapped[str] = mapped_column(Text, default="")
    actor_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
