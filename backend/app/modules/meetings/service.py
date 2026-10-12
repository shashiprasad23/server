"""Meeting import, AI processing, human review and approved-action delivery (C8, Journey 4)."""

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import Forbidden, NotFound, ServiceUnavailable, ValidationFailed, field_error
from app.core.events import audit, emit
from app.core.security import Principal
from app.db import utcnow
from app.modules.agile.models import Sprint
from app.modules.identity.models import DEFAULT_ORG_SETTINGS, ProjectMembership, User
from app.modules.meetings import ai
from app.modules.meetings.models import (
    FAILED,
    IMPORTED,
    PROCESSING,
    PUBLISHED,
    QUEUED,
    REVIEW_REQUIRED,
    AiActionProposal,
    Meeting,
    MeetingSummary,
    TranscriptSegment,
)
from app.modules.meetings.transcript import parse_transcript
from app.modules.work.models import Project, WorkItem
from app.modules.work.service import create_work_item, status_category, update_work_item

MAX_TRANSCRIPT_CHARS = 400_000


def ai_settings(p_or_org) -> dict:
    org = getattr(p_or_org, "org", p_or_org)
    return {**DEFAULT_ORG_SETTINGS["ai"], **((org.settings or {}).get("ai") or {})}


def feature_enabled(org, flag: str) -> bool:
    flags = {**DEFAULT_ORG_SETTINGS["feature_flags"], **((org.settings or {}).get("feature_flags") or {})}
    return bool(flags.get(flag))


# ---------------------------------------------------------------- access

def meeting_access(p: Principal, m: Meeting, project: Project) -> dict:
    reviewer = access.can_review_ai(p, project.id)
    attendee = str(p.id) in (m.attendee_user_ids or [])
    member = project.id in p.memberships or p.is_admin
    transcript = reviewer or attendee
    return {
        "reviewer": reviewer,
        "transcript": transcript,
        "draft": reviewer,
        "summary": transcript or (member and m.access_scope == "project"),
    }


def get_meeting(db: Session, p: Principal, meeting_id: uuid.UUID) -> tuple[Meeting, Project, dict]:
    m = db.get(Meeting, meeting_id)
    if m is None or m.organization_id != p.org.id:
        raise NotFound("Meeting not found")
    project = db.get(Project, m.project_id)
    acc = meeting_access(p, m, project)
    # A link from a ticket never grants access to the meeting note (F4).
    if not acc["summary"]:
        raise NotFound("Meeting not found")
    return m, project, acc


# ---------------------------------------------------------------- import

def _match_user(db: Session, project_id: uuid.UUID, name: str) -> uuid.UUID | None:
    name_l = name.strip().lower()
    for u in db.scalars(select(User).join(ProjectMembership, ProjectMembership.user_id == User.id)
                        .where(ProjectMembership.project_id == project_id)):
        if u.display_name.lower() == name_l or u.email.lower() == name_l:
            return u.id
    return None


def import_meeting(db: Session, p: Principal, data: dict, raw_transcript: str | None = None,
                   audio: tuple[bytes, str] | None = None) -> Meeting:
    if not feature_enabled(p.org, "ai"):
        raise ServiceUnavailable("AI meeting intelligence is disabled by an administrator", code="feature_disabled")
    project_id = uuid.UUID(str(data.get("projectId") or ""))
    project = access.get_project_for(db, p, project_id)
    access.require(access.can_edit_work(p, project.id), "You cannot import meetings into this project")
    source = data.get("source") or ("upload" if (raw_transcript or audio) else "manual")
    graph_meta = None
    if source == "teams":
        from app.modules.meetings.graph import GraphClient

        if not (data.get("organizerId") and data.get("externalMeetingId")):
            raise field_error("externalMeetingId", "Organizer and Teams meeting id are required")
        graph_meta, raw_transcript = GraphClient().fetch_transcript_vtt(data["organizerId"], data["externalMeetingId"])
    external_id = data.get("externalMeetingId")
    if external_id:
        existing = db.scalar(select(Meeting).where(Meeting.provider == source, Meeting.external_meeting_id == external_id))
        if existing:
            return existing  # repeated import of the same Teams meeting is idempotent
    if raw_transcript is None and audio is None:
        raise field_error("transcript", "Provide a transcript (WebVTT or 'HH:MM:SS Speaker: text') or an audio file")
    title = (data.get("title") or (graph_meta or {}).get("subject") or "").strip()
    if not title:
        raise field_error("title", "Title is required")
    try:
        start_at = datetime.fromisoformat(str(data.get("startAt") or (graph_meta or {}).get("startDateTime")))
    except (TypeError, ValueError) as exc:
        raise field_error("startAt", "Start time is required (ISO 8601)") from exc
    if start_at.tzinfo is None:
        start_at = start_at.replace(tzinfo=UTC)
    m = Meeting(organization_id=p.org.id, project_id=project.id, provider=source, external_meeting_id=external_id,
                title=title, start_at=start_at, access_scope=data.get("accessScope") or "project",
                imported_by=p.id, status=IMPORTED)
    if m.access_scope not in {"project", "attendees"}:
        raise field_error("accessScope", "Access scope must be project or attendees")
    db.add(m)
    db.flush()
    segments = []
    if raw_transcript is not None:
        if len(raw_transcript) > MAX_TRANSCRIPT_CHARS:
            raise field_error("transcript", "Transcript is too large for a single meeting")
        segments = parse_transcript(raw_transcript)
        if not segments:
            raise field_error("transcript", "No transcript lines could be read")
        m.transcript_checksum = hashlib.sha256(raw_transcript.encode()).hexdigest()
    elif audio is not None:
        from app.core.storage import storage

        ref, checksum = storage.put(audio[0], f"audio/{m.id}", audio[1])
        m.audio_ref, m.transcript_checksum = ref, checksum
    names = sorted({s.speaker for s in segments} | set(data.get("attendees") or []))
    participants = [{"name": n, "userId": str(uid) if (uid := _match_user(db, project.id, n)) else None} for n in names]
    m.participants = participants
    m.attendee_user_ids = sorted({x["userId"] for x in participants if x["userId"]} | {str(p.id)})
    if segments:
        m.end_at = start_at + timedelta(seconds=segments[-1].end)
        name_to_user = {x["name"]: x["userId"] for x in participants}
        for i, s in enumerate(segments):
            db.add(TranscriptSegment(meeting_id=m.id, seq=i, start_seconds=s.start, end_seconds=s.end,
                                     speaker_name=s.speaker, text=s.text,
                                     speaker_user_id=uuid.UUID(name_to_user[s.speaker]) if name_to_user.get(s.speaker) else None))
    retention = (p.org.settings or {}).get("retention_days", DEFAULT_ORG_SETTINGS["retention_days"])
    m.retention_until = date.today() + timedelta(days=retention.get("transcript", 365))
    audit(db, p.id, "meeting.imported", "meeting", m.id, org_id=p.org.id, project_id=project.id, source=source,
          segments=len(segments))
    emit(db, "MeetingTranscriptAvailable", "meeting", m.id, project_id=project.id)
    if data.get("process", True):
        enqueue(db, p, m)
    return m


def enqueue(db: Session, p: Principal | None, m: Meeting) -> Meeting:
    if m.status in {QUEUED, PROCESSING}:
        return m
    if m.status == PUBLISHED:
        raise ValidationFailed("Published meetings cannot be reprocessed", code="already_published")
    m.status, m.queued_at, m.error = QUEUED, utcnow(), None
    if p is not None:
        audit(db, p.id, "meeting.processing_requested", "meeting", m.id, org_id=p.org.id, project_id=m.project_id)
    return m


# ---------------------------------------------------------------- processing (background worker)

def _transcribe_audio(db: Session, m: Meeting) -> None:
    try:
        from faster_whisper import WhisperModel  # optional dependency, subject to licence review
    except ImportError as exc:
        raise ai.ProviderError("Speech-to-text engine (faster-whisper) is not installed on this worker") from exc
    from app.core.storage import storage

    model = WhisperModel("base", device="cpu", compute_type="int8")
    segs, _info = model.transcribe(str(storage.path(m.audio_ref)))
    for i, s in enumerate(segs):
        db.add(TranscriptSegment(meeting_id=m.id, seq=i, start_seconds=int(s.start), end_seconds=int(s.end),
                                 speaker_name="Speaker", text=s.text.strip()))
    db.flush()


def process_meeting(db: Session, meeting_id: uuid.UUID, provider=None) -> Meeting:
    m = db.scalar(select(Meeting).where(Meeting.id == meeting_id).with_for_update(skip_locked=True))
    if m is None or m.status != QUEUED:
        return m
    m.status = PROCESSING
    db.commit()
    try:
        segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.meeting_id == m.id)
                                   .order_by(TranscriptSegment.seq)))
        if not segments and m.audio_ref:
            _transcribe_audio(db, m)
            segments = list(db.scalars(select(TranscriptSegment).where(TranscriptSegment.meeting_id == m.id)
                                       .order_by(TranscriptSegment.seq)))
        project = db.get(Project, m.project_id)
        tickets = [{"key": w.key, "title": w.title, "status": w.status} for w in db.scalars(
            select(WorkItem).where(WorkItem.project_id == project.id, WorkItem.deleted_at.is_(None))
            .order_by(WorkItem.updated_at.desc()).limit(200)) if status_category(project, w.status) != "done"]
        ctx = ai.MeetingContext(
            title=m.title, meeting_date=m.start_at.date(), project_key=project.key,
            segments=[ai.SegmentIn(s.seq, s.start_seconds, s.speaker_name, s.text) for s in segments],
            attendees=[x["name"] for x in m.participants or []], tickets=tickets)
        provider = provider or ai.get_provider()
        result = provider.analyze(ctx)
        analysis = ai.ground(result.analysis, ctx)
        _persist(db, m, project, segments, analysis, result)
        m.status, m.processed_at, m.error = REVIEW_REQUIRED, utcnow(), None
        audit(db, None, "meeting.processed", "meeting", m.id, org_id=m.organization_id, project_id=m.project_id,
              model=result.model_name, actions=len(analysis.action_items), elapsed_ms=result.elapsed_ms)
        emit(db, "MeetingSummaryGenerated", "meeting", m.id, project_id=m.project_id, title=m.title,
             actions=len(analysis.action_items))
        db.commit()
    except Exception as exc:  # noqa: BLE001 - any provider failure must leave the meeting recoverable
        db.rollback()
        m = db.get(Meeting, meeting_id)
        m.retry_count += 1
        m.status, m.error = FAILED, str(exc)[:1000]
        audit(db, None, "meeting.processing_failed", "meeting", m.id, org_id=m.organization_id,
              project_id=m.project_id, error=m.error, retry=m.retry_count)
        emit(db, "MeetingProcessingFailed", "meeting", m.id, project_id=m.project_id, title=m.title, error=m.error)
        db.commit()
    return m


def _persist(db: Session, m: Meeting, project: Project, segments: list[TranscriptSegment],
             analysis: ai.MeetingAnalysis, result: ai.ProviderResult) -> None:
    by_seq = {s.seq: s for s in segments}

    def ev(e: ai.Evidence | None) -> dict | None:
        if e is None or e.segment not in by_seq:
            return None
        s = by_seq[e.segment]
        return {"segment": s.seq, "start": s.start_seconds, "end": s.end_seconds, "speaker": s.speaker_name,
                "quote": e.quote}

    def findings(items):
        return [{"text": f.text, "evidence": ev(f.evidence)} for f in items]

    settings = ai_settings(_org(db, m))
    db.execute(delete(MeetingSummary).where(MeetingSummary.meeting_id == m.id))
    db.add(MeetingSummary(
        meeting_id=m.id, executive_summary=analysis.executive_summary, discussion_points=analysis.discussion_points,
        decisions=findings(analysis.decisions), risks=findings(analysis.risks), blockers=findings(analysis.blockers),
        open_questions=findings(analysis.open_questions), model_name=result.model_name,
        prompt_version=settings.get("prompt_version", ai.PROMPT_VERSION), generated_at=utcnow(),
        processing_ms=result.elapsed_ms))
    # Reprocessing replaces only undecided proposals; approved/rejected ones and their tickets are kept.
    db.execute(delete(AiActionProposal).where(AiActionProposal.meeting_id == m.id,
                                              AiActionProposal.review_state == "pending"))
    decided_quotes = {(x.evidence_start, x.title) for x in db.scalars(
        select(AiActionProposal).where(AiActionProposal.meeting_id == m.id))}
    for a in analysis.action_items:
        e = ev(a.evidence)
        if (e and e["start"], a.title) in decided_quotes:
            continue
        target = db.scalar(select(WorkItem).where(WorkItem.key == a.target_key)) if a.target_key else None
        owner_id = None
        if a.owner_name:
            owner_id = next((uuid.UUID(x["userId"]) for x in m.participants if x["name"] == a.owner_name and x["userId"]),
                            None)
        db.add(AiActionProposal(
            meeting_id=m.id, project_id=project.id, kind=a.kind, title=a.title, description=a.description,
            proposed_type=a.proposed_type, target_work_item_id=target.id if target else None,
            proposed_changes=a.changes, owner_user_id=owner_id, owner_name_raw=a.owner_name, due_date=a.due_date,
            confidence=round(a.confidence, 2), evidence_start=e["start"] if e else None,
            evidence_end=e["end"] if e else None, evidence_quote=e["quote"] if e else None,
            evidence_speaker=e["speaker"] if e else None))


def _org(db: Session, m: Meeting):
    from app.modules.identity.models import Organization

    return db.get(Organization, m.organization_id)


# ---------------------------------------------------------------- review

def edit_proposal(db: Session, p: Principal, prop: AiActionProposal, data: dict) -> AiActionProposal:
    access.require(access.can_review_ai(p, prop.project_id), "You are not a reviewer for this project")
    if prop.review_state != "pending":
        raise ValidationFailed("Only pending proposals can be edited", code="already_decided")
    if "title" in data:
        if not (data["title"] or "").strip():
            raise field_error("title", "Title is required")
        prop.title = data["title"].strip()[:300]
    if "description" in data:
        prop.description = data["description"] or ""
    if "ownerUserId" in data:
        oid = uuid.UUID(data["ownerUserId"]) if data["ownerUserId"] else None
        if oid and not db.scalar(select(ProjectMembership.id).where(ProjectMembership.project_id == prop.project_id,
                                                                    ProjectMembership.user_id == oid)):
            raise field_error("ownerUserId", "Owner must be a member of the project")
        prop.owner_user_id = oid
    if "dueDate" in data:
        try:
            prop.due_date = date.fromisoformat(data["dueDate"]) if data["dueDate"] else None
        except ValueError as exc:
            raise field_error("dueDate", "Use YYYY-MM-DD") from exc
    if "proposedType" in data:
        if data["proposedType"] not in {"task", "story", "bug", "test_task"}:
            raise field_error("proposedType", "Unsupported type")
        prop.proposed_type = data["proposedType"]
    prop.edited = True
    audit(db, p.id, "ai_proposal.edited", "ai_action_proposal", prop.id, org_id=p.org.id, project_id=prop.project_id,
          fields=sorted(data.keys()))
    return prop


def decide_proposal(db: Session, p: Principal, proposal_id: uuid.UUID, data: dict) -> AiActionProposal:
    # Row lock serialises concurrent approvals; a replayed approval returns the original outcome (AC-09).
    prop = db.scalar(select(AiActionProposal).where(AiActionProposal.id == proposal_id).with_for_update())
    if prop is None:
        raise NotFound("Proposal not found")
    meeting = db.get(Meeting, prop.meeting_id)
    if meeting.organization_id != p.org.id:
        raise NotFound("Proposal not found")
    access.require(access.can_review_ai(p, prop.project_id), "You are not a reviewer for this project")
    decision = data.get("decision")
    if decision not in {"approve", "reject"}:
        raise field_error("decision", "Decision must be approve or reject")
    if prop.review_state != "pending":
        if prop.review_state == ("approved" if decision == "approve" else "rejected"):
            return prop
        raise ValidationFailed(f"Proposal was already {prop.review_state}", code="already_decided")
    if data.get("edits"):
        edit_proposal(db, p, prop, data["edits"])
    if decision == "reject":
        reason = (data.get("reason") or "").strip()
        if not reason:
            raise field_error("reason", "Give a reason so the model can be evaluated")
        prop.review_state, prop.reject_reason = "rejected", reason
        prop.reviewer_id, prop.reviewed_at = p.id, utcnow()
        audit(db, p.id, "ai_proposal.rejected", "ai_action_proposal", prop.id, org_id=p.org.id,
              project_id=prop.project_id, meeting_id=meeting.id, reason=reason)
        return prop

    settings = ai_settings(p)
    project = db.get(Project, prop.project_id)
    if prop.kind == "create":
        if settings.get("require_due_date_on_approval") and prop.due_date is None:
            raise ValidationFailed("Set a due date before approving", code="due_date_required",
                                   errors={"dueDate": ["Not stated in transcript — set before approving"]})
        description = prop.description or ""
        if prop.evidence_quote:
            description = (f"{description}\n\n> “{prop.evidence_quote}” — {prop.evidence_speaker}\n\n"
                           f"Source: {meeting.title}").strip()
        item = create_work_item(db, p, project, {
            "type": prop.proposed_type, "title": prop.title, "description": description,
            "assigneeId": str(prop.owner_user_id) if prop.owner_user_id else None,
            "dueDate": prop.due_date.isoformat() if prop.due_date else None,
            "sourceMeetingId": str(meeting.id), "sourceProposalId": str(prop.id),
            "sourceSegmentStart": prop.evidence_start, "labels": ["from-meeting"],
        })
        prop.created_work_item_id = item.id
    else:
        target = db.get(WorkItem, prop.target_work_item_id) if prop.target_work_item_id else None
        if target is None:
            raise ValidationFailed("The target ticket no longer exists", code="target_missing")
        changes: dict = {}
        for k, v in (prop.proposed_changes or {}).items():
            if k == "sprint" and v == "next":
                nxt = db.scalar(select(Sprint).where(Sprint.project_id == project.id, Sprint.state == "planned")
                                .order_by(Sprint.start_date))
                if nxt is None:
                    raise ValidationFailed("There is no planned sprint to move this ticket to", code="no_next_sprint")
                changes["sprintId"] = str(nxt.id)
            elif k in {"dueDate", "assigneeId", "priority"}:
                changes[k] = v
        if prop.due_date:
            changes["dueDate"] = prop.due_date.isoformat()
        if changes:
            update_work_item(db, p, target, changes, target.version)
        if target.source_meeting_id is None:
            target.source_meeting_id, target.source_proposal_id = meeting.id, prop.id
        prop.created_work_item_id = target.id
    prop.review_state, prop.reviewer_id, prop.reviewed_at = "approved", p.id, utcnow()
    audit(db, p.id, "ai_proposal.approved", "ai_action_proposal", prop.id, org_id=p.org.id,
          project_id=prop.project_id, meeting_id=meeting.id, work_item_id=prop.created_work_item_id,
          evidence_start=prop.evidence_start, kind=prop.kind)
    emit(db, "AIActionApproved", "ai_action_proposal", prop.id, project_id=prop.project_id,
         work_item_id=prop.created_work_item_id, owner_id=prop.owner_user_id, title=prop.title)
    return prop


def publish(db: Session, p: Principal, m: Meeting, summary_edits: dict | None = None) -> Meeting:
    access.require(access.can_review_ai(p, m.project_id), "You are not a reviewer for this project")
    if m.status not in {REVIEW_REQUIRED, PUBLISHED}:
        raise ValidationFailed("Only reviewed meetings can be published", code="not_reviewable")
    summary = db.scalar(select(MeetingSummary).where(MeetingSummary.meeting_id == m.id))
    if summary is None:
        raise ValidationFailed("No summary to publish", code="no_summary")
    if summary_edits:
        edit_summary(db, p, summary, summary_edits)
    summary.reviewer_id, summary.published_at = p.id, utcnow()
    m.status = PUBLISHED
    audit(db, p.id, "meeting.published", "meeting", m.id, org_id=p.org.id, project_id=m.project_id)
    emit(db, "MeetingPublished", "meeting", m.id, project_id=m.project_id, title=m.title,
         attendees=m.attendee_user_ids)
    return m


def edit_summary(db: Session, p: Principal, summary: MeetingSummary, data: dict) -> MeetingSummary:
    meeting = db.get(Meeting, summary.meeting_id)
    access.require(access.can_review_ai(p, meeting.project_id), "You are not a reviewer for this project")
    for key, attr in [("executiveSummary", "executive_summary"), ("decisions", "decisions"), ("risks", "risks"),
                      ("openQuestions", "open_questions"), ("discussionPoints", "discussion_points")]:
        if key in data:
            setattr(summary, attr, data[key])
    summary.edited_by = p.id
    audit(db, p.id, "meeting.summary_edited", "meeting", meeting.id, org_id=p.org.id, project_id=meeting.project_id,
          fields=sorted(data.keys()))
    return summary


def lifecycle(m: Meeting, proposals: list[AiActionProposal]) -> list[dict]:
    order = ["imported", "transcribed", "ai_processed", "review_required", "published", "linked_actions"]
    reached = {"imported"}
    if m.status != IMPORTED or m.audio_ref is None:
        reached.add("transcribed")
    if m.status in {REVIEW_REQUIRED, PUBLISHED}:
        reached |= {"ai_processed", "review_required"}
    if m.status == PUBLISHED:
        reached.add("published")
        if any(x.created_work_item_id for x in proposals):
            reached.add("linked_actions")
    labels = {"imported": "Imported", "transcribed": "Transcribed", "ai_processed": "AI processed",
              "review_required": "Review required", "published": "Published", "linked_actions": "Linked actions"}
    current = {QUEUED: "ai_processed", PROCESSING: "ai_processed", FAILED: "ai_processed",
               REVIEW_REQUIRED: "review_required", PUBLISHED: "published" if "linked_actions" not in reached
               else "linked_actions"}.get(m.status, "transcribed")
    return [{"key": k, "label": labels[k], "done": k in reached and k != current, "current": k == current,
             "failed": m.status == FAILED and k == "ai_processed"} for k in order]


def require_reviewer(p: Principal, m: Meeting) -> None:
    if not access.can_review_ai(p, m.project_id):
        raise Forbidden("You are not a reviewer for this project")
