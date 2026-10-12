import uuid
from datetime import date

from sqlalchemy import Date, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, TimestampMixin, fk


class WorkingCalendar(IdMixin, TimestampMixin, Base):
    __tablename__ = "working_calendars"
    organization_id: Mapped[uuid.UUID] = fk("organizations.id")
    name: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    # Minutes of working time per weekday, Monday..Sunday.
    weekday_minutes: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=lambda: [480] * 5 + [0, 0])


class CalendarException(IdMixin, Base):
    """Holiday or non-standard day on a calendar."""

    __tablename__ = "calendar_exceptions"
    calendar_id: Mapped[uuid.UUID] = fk("working_calendars.id", ondelete="CASCADE")
    date: Mapped[date] = mapped_column(Date)
    minutes: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[str] = mapped_column(String(200))


class ResourceProfile(IdMixin, TimestampMixin, Base):
    __tablename__ = "resource_profiles"
    user_id: Mapped[uuid.UUID] = fk("users.id", ondelete="CASCADE")
    team_id: Mapped[uuid.UUID | None] = fk("teams.id", nullable=True)
    title: Mapped[str] = mapped_column(String(120), default="")
    skills: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)
    pools: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)
    location: Mapped[str] = mapped_column(String(120), default="")
    calendar_id: Mapped[uuid.UUID | None] = fk("working_calendars.id", nullable=True)
    employment_type: Mapped[str] = mapped_column(String(30), default="employee")
    availability_status: Mapped[str] = mapped_column(String(30), default="available")
    reserved_percent: Mapped[int] = mapped_column(Integer, default=0)
    available_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    available_to: Mapped[date | None] = mapped_column(Date, nullable=True)


class Leave(IdMixin, TimestampMixin, Base):
    __tablename__ = "leaves"
    user_id: Mapped[uuid.UUID] = fk("users.id")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    state: Mapped[str] = mapped_column(String(20), default="approved")  # requested | approved | cancelled
    reason: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = fk("users.id")


class Allocation(IdMixin, TimestampMixin, Base):
    __tablename__ = "allocations"
    user_id: Mapped[uuid.UUID] = fk("users.id")
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    sprint_id: Mapped[uuid.UUID | None] = fk("sprints.id", nullable=True)
    role: Mapped[str] = mapped_column(String(80), default="")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    unit: Mapped[str] = mapped_column(String(10), default="hours")  # hours (minutes per week) | percent
    minutes_per_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    state: Mapped[str] = mapped_column(String(20), default="confirmed")  # tentative | confirmed | cancelled
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID] = fk("users.id")
    extra: Mapped[dict] = mapped_column(JSONB, default=dict)
