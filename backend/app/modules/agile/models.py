import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, TimestampMixin, fk, utcnow


class Sprint(IdMixin, TimestampMixin, Base):
    __tablename__ = "sprints"
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    name: Mapped[str] = mapped_column(String(120))
    goal: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    state: Mapped[str] = mapped_column(String(20), default="planned")  # planned | active | closed
    committed_points: Mapped[float | None] = mapped_column(Float, nullable=True)
    committed_estimate_minutes: Mapped[int | None] = mapped_column(nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SprintScopeChange(IdMixin, Base):
    """Audited scope change after sprint start (C5)."""

    __tablename__ = "sprint_scope_changes"
    sprint_id: Mapped[uuid.UUID] = fk("sprints.id", ondelete="CASCADE")
    work_item_id: Mapped[uuid.UUID] = fk("work_items.id")
    change: Mapped[str] = mapped_column(String(10))  # added | removed
    points: Mapped[float | None] = mapped_column(Float, nullable=True)
    actor_id: Mapped[uuid.UUID] = fk("users.id")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
