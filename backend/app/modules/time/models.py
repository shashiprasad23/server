import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, TimestampMixin, fk

# Time-entry approval states (C4 approval workflow)
DRAFT = "draft"
SUBMITTED = "submitted"
APPROVED = "approved"
REJECTED = "rejected"
VOIDED = "voided"
ENTRY_STATES = {DRAFT, SUBMITTED, APPROVED, REJECTED, VOIDED}

# Which entry states count toward "actual effort" under each reporting policy (BR-TIME-02).
REPORTING_POLICIES: dict[str, set[str]] = {
    "approved": {APPROVED},
    "approved_submitted": {APPROVED, SUBMITTED},
    "all_valid": {APPROVED, SUBMITTED, DRAFT},
}

POLICY_LABELS = {
    "approved": "Approved entries",
    "approved_submitted": "Approved + submitted entries",
    "all_valid": "All valid entries (incl. draft)",
}

# Timesheet period states
PERIOD_OPEN = "open"
PERIOD_SUBMITTED = "submitted"
PERIOD_APPROVED = "approved"
PERIOD_LOCKED = "locked"


class TimeEntry(IdMixin, TimestampMixin, Base):
    __tablename__ = "time_entries"
    __table_args__ = (UniqueConstraint("user_id", "idempotency_key"),)

    work_item_id: Mapped[uuid.UUID] = fk("work_items.id")
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    user_id: Mapped[uuid.UUID] = fk("users.id")
    work_date: Mapped[date] = mapped_column(Date, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    activity_category: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text, default="")
    approval_status: Mapped[str] = mapped_column(String(20), default=DRAFT, index=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(30), default="web")  # web | api | import | mobile | integration:<name>
    idempotency_key: Mapped[str] = mapped_column(String(120))
    corrects_entry_id: Mapped[uuid.UUID | None] = fk("time_entries.id", nullable=True)
    voided_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = fk("users.id")
    updated_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)

    __mapper_args__ = {"version_id_col": version}


class TimeEntryCorrection(IdMixin, TimestampMixin, Base):
    """Amendment request for an approved entry; the original stays auditable (BR-TIME-06/07)."""

    __tablename__ = "time_entry_corrections"
    time_entry_id: Mapped[uuid.UUID] = fk("time_entries.id")
    requested_by: Mapped[uuid.UUID] = fk("users.id")
    reason: Mapped[str] = mapped_column(Text)
    before_values: Mapped[dict] = mapped_column(JSONB)
    after_values: Mapped[dict] = mapped_column(JSONB)  # empty dict == reversal
    state: Mapped[str] = mapped_column(String(20), default="requested")  # requested | approved | rejected
    decided_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    replacement_entry_id: Mapped[uuid.UUID | None] = fk("time_entries.id", nullable=True)


class TimesheetPeriod(IdMixin, TimestampMixin, Base):
    __tablename__ = "timesheet_periods"
    __table_args__ = (UniqueConstraint("user_id", "period_start"),)
    user_id: Mapped[uuid.UUID] = fk("users.id")
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    state: Mapped[str] = mapped_column(String(20), default=PERIOD_OPEN)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approver_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    reopen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
