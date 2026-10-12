import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, TimestampMixin, fk

# Global (organization-scoped) roles. Project-scoped roles live on ProjectMembership.
GLOBAL_ROLES = {"platform_admin", "resource_manager", "executive_viewer"}

PROJECT_ROLES = {
    "project_admin",
    "project_manager",
    "contributor",
    "qa",
    "service_agent",
    "service_owner",
    "approver",
    "ai_reviewer",
    "viewer",
}

DEFAULT_ORG_SETTINGS = {
    "reporting_policy": "approved_submitted",
    "week_start": 0,  # Monday
    "feature_flags": {
        "ai": True,
        "live_transcription": False,
        "service_module": True,
        "azure_devops_sync": False,
        "advanced_reporting": False,
        "teams_notifications": False,
    },
    "ai": {
        "provider": "heuristic",
        "model": "heuristic-extractor",
        "prompt_version": "v3",
        "require_due_date_on_approval": True,
        "min_confidence_to_show": 0.0,
    },
    "retention_days": {"audio": 30, "transcript": 365, "summary": 1825, "audit": 2555},
}


class Organization(IdMixin, TimestampMixin, Base):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(200))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("organization_id", "email"),)
    organization_id: Mapped[uuid.UUID] = fk("organizations.id")
    identity_provider_subject: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    display_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | deactivated
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    global_roles: Mapped[list[str]] = mapped_column(ARRAY(String(40)), default=list)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def initials(self) -> str:
        parts = [p for p in self.display_name.replace(".", " ").split() if p]
        return "".join(p[0] for p in parts[:2]).upper() or "?"


class Team(IdMixin, TimestampMixin, Base):
    __tablename__ = "teams"
    organization_id: Mapped[uuid.UUID] = fk("organizations.id")
    name: Mapped[str] = mapped_column(String(200))


class TeamMembership(IdMixin, Base):
    __tablename__ = "team_memberships"
    __table_args__ = (UniqueConstraint("team_id", "user_id"),)
    team_id: Mapped[uuid.UUID] = fk("teams.id", ondelete="CASCADE")
    user_id: Mapped[uuid.UUID] = fk("users.id", ondelete="CASCADE")
    role: Mapped[str] = mapped_column(String(40), default="member")


class ProjectMembership(IdMixin, TimestampMixin, Base):
    __tablename__ = "project_memberships"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    project_id: Mapped[uuid.UUID] = fk("projects.id", ondelete="CASCADE")
    user_id: Mapped[uuid.UUID] = fk("users.id", ondelete="CASCADE")
    role: Mapped[str] = mapped_column(String(40), default="contributor")
    is_time_approver: Mapped[bool] = mapped_column(Boolean, default=False)
    is_ai_reviewer: Mapped[bool] = mapped_column(Boolean, default=False)
