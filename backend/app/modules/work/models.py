import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, TimestampMixin, fk, utcnow

WORK_ITEM_TYPES = [
    "epic",
    "story",
    "task",
    "subtask",
    "bug",
    "test_task",
    "service_request",
    "incident",
    "change_request",
]

TYPE_LABELS = {
    "epic": "Epic",
    "story": "Story",
    "task": "Task",
    "subtask": "Sub-task",
    "bug": "Bug",
    "test_task": "Test / QA task",
    "service_request": "Service request",
    "incident": "Incident",
    "change_request": "Change request",
}

# Allowed parent types per child type (acyclic, constrained hierarchy - E2).
HIERARCHY_RULES: dict[str, set[str | None]] = {
    "epic": {None},
    "story": {None, "epic"},
    "task": {None, "epic", "story"},
    "bug": {None, "epic", "story"},
    "test_task": {None, "epic", "story"},
    "subtask": {"story", "task", "bug", "test_task", "service_request", "incident", "change_request"},
    "service_request": {None},
    "incident": {None},
    "change_request": {None},
}

SERVICE_TYPES = {"service_request", "incident", "change_request"}

DEFAULT_DELIVERY_WORKFLOW = {
    "statuses": [
        {"key": "todo", "name": "To do", "category": "todo"},
        {"key": "in_progress", "name": "In progress", "category": "in_progress", "wip_limit": 3},
        {"key": "in_review", "name": "In review", "category": "in_progress"},
        {"key": "blocked", "name": "Blocked", "category": "in_progress"},
        {"key": "done", "name": "Done", "category": "done"},
    ],
    # "*" means any status. Optional "roles" restricts who may execute the transition.
    "transitions": [{"from": "*", "to": "*"}],
}

DEFAULT_SERVICE_WORKFLOW = {
    "statuses": [
        {"key": "new", "name": "New", "category": "todo"},
        {"key": "open", "name": "Open", "category": "todo"},
        {"key": "investigating", "name": "Investigating", "category": "in_progress"},
        {"key": "in_progress", "name": "In progress", "category": "in_progress"},
        {"key": "waiting_on_requester", "name": "Waiting on requester", "category": "in_progress", "pauses_sla": True},
        {"key": "awaiting_approval", "name": "Awaiting approval", "category": "in_progress", "pauses_sla": True},
        {"key": "approved", "name": "Approved", "category": "in_progress"},
        {"key": "resolved", "name": "Resolved", "category": "done"},
        {"key": "closed", "name": "Closed", "category": "done"},
    ],
    "transitions": [
        {"from": "awaiting_approval", "to": "approved", "roles": ["service_owner", "project_manager", "approver"]},
        {"from": "*", "to": "*"},
    ],
}

DEFAULT_PROJECT_SETTINGS = {
    "time": {
        "backdate_days": 7,
        "allow_future_days": 0,
        "max_entry_minutes": 720,
        "max_daily_minutes": 960,
        "min_description_length": 10,
        "approval_required": True,
        "pm_can_edit_others_time": False,
        "allow_negative_remaining": False,
        "activity_categories": [
            "Development",
            "Testing / QA",
            "Analysis / Design",
            "Code review",
            "Meeting",
            "Support",
            "Other",
        ],
    },
    "estimates": {"required_types": ["story", "task", "subtask", "bug", "test_task"]},
    "required_skills": [],
    "sprint_length_days": 14,
}


class Project(IdMixin, TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("organization_id", "key"),)
    organization_id: Mapped[uuid.UUID] = fk("organizations.id")
    key: Mapped[str] = mapped_column(String(12))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(20), default="delivery")  # delivery | service
    methodology: Mapped[str] = mapped_column(String(40), default="Agile delivery")
    owner_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    color: Mapped[str] = mapped_column(String(16), default="#2F4FC9")
    workflow: Mapped[dict] = mapped_column(JSONB, default=dict)
    settings: Mapped[dict] = mapped_column(JSONB, default=dict)
    next_sequence: Mapped[int] = mapped_column(Integer, default=1)


class WorkItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "work_items"
    __table_args__ = (UniqueConstraint("project_id", "sequence"),)

    project_id: Mapped[uuid.UUID] = fk("projects.id")
    key: Mapped[str] = mapped_column(String(30), unique=True)
    sequence: Mapped[int] = mapped_column(Integer)
    parent_id: Mapped[uuid.UUID | None] = fk("work_items.id", nullable=True)
    type: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(40))
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reporter_id: Mapped[uuid.UUID] = fk("users.id")
    assignee_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    original_estimate_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remaining_estimate_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    estimate_locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    story_points: Mapped[float | None] = mapped_column(Float, nullable=True)
    sprint_id: Mapped[uuid.UUID | None] = fk("sprints.id", nullable=True)
    rank: Mapped[float] = mapped_column(Float, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    fix_version: Mapped[str | None] = mapped_column(String(60), nullable=True)
    labels: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)
    components: Mapped[list[str]] = mapped_column(ARRAY(String(60)), default=list)

    # AI / meeting provenance (C3 "Meeting source")
    source_meeting_id: Mapped[uuid.UUID | None] = fk("meetings.id", nullable=True)
    source_proposal_id: Mapped[uuid.UUID | None] = fk("ai_action_proposals.id", nullable=True, use_alter=True)
    source_segment_start: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Service management (C7)
    service_offering_id: Mapped[uuid.UUID | None] = fk("service_offerings.id", nullable=True)
    service_fields: Mapped[dict] = mapped_column(JSONB, default=dict)
    sla_policy_id: Mapped[uuid.UUID | None] = fk("sla_policies.id", nullable=True)
    sla_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_response_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_resolution_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_paused_minutes: Mapped[int] = mapped_column(Integer, default=0)
    sla_response_breached: Mapped[bool] = mapped_column(Boolean, default=False)
    sla_resolution_breached: Mapped[bool] = mapped_column(Boolean, default=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    updated_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)

    __mapper_args__ = {"version_id_col": version}


class WorkItemLink(IdMixin, Base):
    __tablename__ = "work_item_links"
    __table_args__ = (UniqueConstraint("source_id", "target_id", "link_type"),)
    source_id: Mapped[uuid.UUID] = fk("work_items.id", ondelete="CASCADE")
    target_id: Mapped[uuid.UUID] = fk("work_items.id", ondelete="CASCADE")
    link_type: Mapped[str] = mapped_column(String(20))  # blocks | relates | duplicates
    created_by: Mapped[uuid.UUID] = fk("users.id")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WorkItemHistory(IdMixin, Base):
    __tablename__ = "work_item_history"
    work_item_id: Mapped[uuid.UUID] = fk("work_items.id", ondelete="CASCADE")
    actor_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    field: Mapped[str] = mapped_column(String(60))
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Comment(IdMixin, TimestampMixin, Base):
    __tablename__ = "comments"
    work_item_id: Mapped[uuid.UUID] = fk("work_items.id", ondelete="CASCADE")
    author_id: Mapped[uuid.UUID] = fk("users.id")
    body: Mapped[str] = mapped_column(Text)
    mentions: Mapped[list[str]] = mapped_column(ARRAY(String(64)), default=list)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Watcher(IdMixin, Base):
    __tablename__ = "watchers"
    __table_args__ = (UniqueConstraint("work_item_id", "user_id"),)
    work_item_id: Mapped[uuid.UUID] = fk("work_items.id", ondelete="CASCADE")
    user_id: Mapped[uuid.UUID] = fk("users.id", ondelete="CASCADE")
