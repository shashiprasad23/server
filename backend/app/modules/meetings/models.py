import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, IdMixin, TimestampMixin, fk

# Meeting lifecycle (C8)
IMPORTED = "imported"
QUEUED = "queued"
PROCESSING = "processing"
REVIEW_REQUIRED = "review_required"
PUBLISHED = "published"
FAILED = "failed"
ARCHIVED = "archived"


class Meeting(IdMixin, TimestampMixin, Base):
    __tablename__ = "meetings"
    __table_args__ = (UniqueConstraint("provider", "external_meeting_id"),)
    organization_id: Mapped[uuid.UUID] = fk("organizations.id")
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    provider: Mapped[str] = mapped_column(String(20))  # teams | upload | manual
    external_meeting_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    participants: Mapped[list] = mapped_column(JSONB, default=list)  # [{"name","user_id"}]
    attendee_user_ids: Mapped[list[str]] = mapped_column(ARRAY(String(36)), default=list)
    # attendees: only attendees, AI reviewers and project managers; project: every project member
    access_scope: Mapped[str] = mapped_column(String(20), default="project")
    status: Mapped[str] = mapped_column(String(30), default=IMPORTED)
    transcript_language: Mapped[str] = mapped_column(String(10), default="en")
    transcript_checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audio_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)  # restricted storage
    retention_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    imported_by: Mapped[uuid.UUID] = fk("users.id")


class TranscriptSegment(IdMixin, Base):
    __tablename__ = "transcript_segments"
    meeting_id: Mapped[uuid.UUID] = fk("meetings.id", ondelete="CASCADE")
    seq: Mapped[int] = mapped_column(Integer)
    start_seconds: Mapped[int] = mapped_column(Integer)
    end_seconds: Mapped[int] = mapped_column(Integer)
    speaker_name: Mapped[str] = mapped_column(String(200), default="Unknown")
    speaker_user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    text: Mapped[str] = mapped_column(Text)


class MeetingSummary(IdMixin, TimestampMixin, Base):
    __tablename__ = "meeting_summaries"
    meeting_id: Mapped[uuid.UUID] = fk("meetings.id", ondelete="CASCADE")
    executive_summary: Mapped[str] = mapped_column(Text, default="")
    discussion_points: Mapped[list] = mapped_column(JSONB, default=list)
    # Items: {"text", "evidence": {"start","end","quote"} | null}
    decisions: Mapped[list] = mapped_column(JSONB, default=list)
    risks: Mapped[list] = mapped_column(JSONB, default=list)
    blockers: Mapped[list] = mapped_column(JSONB, default=list)
    open_questions: Mapped[list] = mapped_column(JSONB, default=list)
    model_name: Mapped[str] = mapped_column(String(120))
    prompt_version: Mapped[str] = mapped_column(String(40))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    processing_ms: Mapped[int] = mapped_column(Integer, default=0)
    edited_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    reviewer_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AiActionProposal(IdMixin, TimestampMixin, Base):
    __tablename__ = "ai_action_proposals"
    meeting_id: Mapped[uuid.UUID] = fk("meetings.id", ondelete="CASCADE")
    project_id: Mapped[uuid.UUID] = fk("projects.id")
    kind: Mapped[str] = mapped_column(String(10), default="create")  # create | update
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    proposed_type: Mapped[str] = mapped_column(String(30), default="task")
    target_work_item_id: Mapped[uuid.UUID | None] = fk("work_items.id", nullable=True)
    proposed_changes: Mapped[dict] = mapped_column(JSONB, default=dict)
    owner_user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    owner_name_raw: Mapped[str | None] = mapped_column(String(200), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    evidence_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    evidence_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    evidence_quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_speaker: Mapped[str | None] = mapped_column(String(200), nullable=True)
    review_state: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | rejected
    reviewer_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_work_item_id: Mapped[uuid.UUID | None] = fk("work_items.id", nullable=True)
    edited: Mapped[bool] = mapped_column(default=False)
