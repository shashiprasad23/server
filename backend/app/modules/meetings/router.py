import json
import uuid

from fastapi import APIRouter, Body, Depends, File, Form, Header, UploadFile
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access
from app.core.common import UserCache
from app.core.errors import NotFound, field_error
from app.core.idempotency import run_idempotent
from app.core.security import Principal, get_principal
from app.db import get_db
from app.modules.meetings import service as svc
from app.modules.meetings.models import AiActionProposal, Meeting, MeetingSummary, TranscriptSegment
from app.modules.meetings.transcript import fmt_ts
from app.modules.work.models import Project, WorkItem

router = APIRouter(tags=["meetings"])

ALLOWED_AUDIO = {".wav", ".mp3", ".m4a", ".ogg", ".webm"}
MAX_UPLOAD = 200 * 1024 * 1024


def serialize_meeting(m: Meeting, project: Project, acc: dict | None = None, counts: dict | None = None) -> dict:
    return {"id": str(m.id), "title": m.title, "projectId": str(project.id), "projectKey": project.key,
            "projectName": project.name, "provider": m.provider, "startAt": m.start_at, "endAt": m.end_at,
            "participants": m.participants, "status": m.status, "accessScope": m.access_scope,
            "error": m.error if (acc or {}).get("reviewer") else (None if not m.error else "Processing failed"),
            "retryCount": m.retry_count, "access": acc, **(counts or {})}


def serialize_proposal(x: AiActionProposal, users: UserCache, db: Session) -> dict:
    created = db.get(WorkItem, x.created_work_item_id) if x.created_work_item_id else None
    target = db.get(WorkItem, x.target_work_item_id) if x.target_work_item_id else None
    return {"id": str(x.id), "kind": x.kind, "title": x.title, "description": x.description,
            "proposedType": x.proposed_type, "projectId": str(x.project_id),
            "owner": users.ref(x.owner_user_id), "ownerNameRaw": x.owner_name_raw,
            "dueDate": str(x.due_date) if x.due_date else None, "confidence": x.confidence,
            "evidence": {"start": x.evidence_start, "end": x.evidence_end, "startLabel": fmt_ts(x.evidence_start),
                         "endLabel": fmt_ts(x.evidence_end), "quote": x.evidence_quote,
                         "speaker": x.evidence_speaker} if x.evidence_start is not None else None,
            "reviewState": x.review_state, "reviewer": users.ref(x.reviewer_id), "reviewedAt": x.reviewed_at,
            "rejectReason": x.reject_reason, "edited": x.edited,
            "target": {"key": target.key, "title": target.title} if target else None,
            "proposedChanges": x.proposed_changes,
            "createdWorkItem": {"key": created.key, "title": created.title} if created else None}


@router.get("/meetings")
def list_meetings(project_id: uuid.UUID | None = None, status: str | None = None,
                  p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    q = select(Meeting).where(Meeting.organization_id == p.org.id).order_by(Meeting.start_at.desc())
    if project_id:
        q = q.where(Meeting.project_id == project_id)
    if status:
        q = q.where(Meeting.status.in_(status.split(",")))
    out = []
    for m in db.scalars(q.limit(200)):
        project = db.get(Project, m.project_id)
        acc = svc.meeting_access(p, m, project)
        if not acc["summary"]:
            continue
        props = list(db.scalars(select(AiActionProposal.review_state).where(AiActionProposal.meeting_id == m.id)))
        out.append(serialize_meeting(m, project, acc, {
            "proposals": len(props), "pending": sum(1 for s in props if s == "pending"),
            "approved": sum(1 for s in props if s == "approved")}))
    return out


class ImportIn(BaseModel):
    projectId: uuid.UUID
    title: str | None = None
    startAt: str | None = None
    transcript: str | None = None
    source: str | None = None
    externalMeetingId: str | None = None
    organizerId: str | None = None
    attendees: list[str] | None = None
    accessScope: str | None = None
    process: bool = True


@router.post("/meetings/import", status_code=201)
def import_meeting(body: ImportIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
                   p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    data = body.model_dump(mode="json", exclude_none=True)

    def action():
        m = svc.import_meeting(db, p, data, raw_transcript=data.get("transcript"))
        db.flush()
        return serialize_meeting(m, db.get(Project, m.project_id))

    return run_idempotent(db, p.id, "meetings.import", idempotency_key, data, action)


@router.post("/meetings/upload", status_code=201)
async def upload_meeting(metadata: str = Form(...), file: UploadFile = File(...),
                         p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    try:
        data = json.loads(metadata)
    except json.JSONDecodeError as exc:
        raise field_error("metadata", "metadata must be JSON") from exc
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise field_error("file", "File is larger than 200 MB")
    name = (file.filename or "").lower()
    suffix = name[name.rfind("."):] if "." in name else ""
    if suffix in {".vtt", ".txt"}:
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise field_error("file", "Transcript must be UTF-8 text") from exc
        m = svc.import_meeting(db, p, {**data, "source": "upload"}, raw_transcript=text)
    elif suffix in ALLOWED_AUDIO:
        m = svc.import_meeting(db, p, {**data, "source": "upload"}, audio=(raw, suffix))
    else:
        raise field_error("file", "Upload a .vtt/.txt transcript or an audio file (.wav, .mp3, .m4a, .ogg, .webm)")
    db.commit()
    return jsonable_encoder(serialize_meeting(m, db.get(Project, m.project_id)))


@router.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    m, project, acc = svc.get_meeting(db, p, meeting_id)
    users = UserCache(db)
    summary = db.scalar(select(MeetingSummary).where(MeetingSummary.meeting_id == m.id))
    proposals = list(db.scalars(select(AiActionProposal).where(AiActionProposal.meeting_id == m.id)
                                .order_by(AiActionProposal.evidence_start.nulls_last(), AiActionProposal.created_at)))
    users.prime([x.owner_user_id for x in proposals] + [x.reviewer_id for x in proposals])
    show_summary = summary is not None and (acc["draft"] or summary.published_at is not None)
    segments = []
    if acc["transcript"]:
        segments = [{"seq": s.seq, "start": s.start_seconds, "startLabel": fmt_ts(s.start_seconds),
                     "speaker": s.speaker_name, "text": s.text}
                    for s in db.scalars(select(TranscriptSegment).where(TranscriptSegment.meeting_id == m.id)
                                        .order_by(TranscriptSegment.seq))]
    from app.modules.identity.models import ProjectMembership, User

    members = [{"id": str(u.id), "name": u.display_name} for u in db.scalars(
        select(User).join(ProjectMembership, ProjectMembership.user_id == User.id)
        .where(ProjectMembership.project_id == project.id).order_by(User.display_name))]
    return {
        **serialize_meeting(m, project, acc),
        "lifecycle": svc.lifecycle(m, proposals),
        "summary": None if not show_summary else {
            "executiveSummary": summary.executive_summary, "discussionPoints": summary.discussion_points,
            "decisions": summary.decisions, "risks": summary.risks, "blockers": summary.blockers,
            "openQuestions": summary.open_questions, "modelName": summary.model_name,
            "promptVersion": summary.prompt_version, "generatedAt": summary.generated_at,
            "processingMs": summary.processing_ms, "publishedAt": summary.published_at,
            "reviewer": users.ref(summary.reviewer_id), "edited": summary.edited_by is not None},
        "proposals": [serialize_proposal(x, users, db) for x in proposals]
        if acc["draft"] or (summary and summary.published_at) else [],
        "segments": segments,
        "members": members if acc["reviewer"] else [],
        "aiSettings": {"requireDueDate": svc.ai_settings(p).get("require_due_date_on_approval")},
    }


@router.post("/meetings/{meeting_id}/process")
def process(meeting_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    m, project, acc = svc.get_meeting(db, p, meeting_id)
    svc.require_reviewer(p, m)
    svc.enqueue(db, p, m)
    db.commit()
    return serialize_meeting(m, project, acc)


@router.get("/meetings/{meeting_id}/summary")
def summary(meeting_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    data = get_meeting(meeting_id, p, db)
    if data["summary"] is None:
        raise NotFound("No summary is available for you yet")
    return {"summary": data["summary"], "proposals": data["proposals"]}


@router.patch("/meetings/{meeting_id}/summary")
def edit_summary(meeting_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)):
    m, _, _ = svc.get_meeting(db, p, meeting_id)
    s = db.scalar(select(MeetingSummary).where(MeetingSummary.meeting_id == m.id))
    if s is None:
        raise NotFound("No summary yet")
    svc.edit_summary(db, p, s, body)
    db.commit()
    return {"ok": True}


@router.post("/meetings/{meeting_id}/publish")
def publish(meeting_id: uuid.UUID, body: dict = Body(default={}), p: Principal = Depends(get_principal),
            db: Session = Depends(get_db)):
    m, project, acc = svc.get_meeting(db, p, meeting_id)
    svc.publish(db, p, m, body.get("summary"))
    db.commit()
    return serialize_meeting(m, project, acc)


@router.patch("/ai-action-proposals/{proposal_id}")
def edit_proposal(proposal_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    prop = db.get(AiActionProposal, proposal_id)
    if prop is None:
        raise NotFound("Proposal not found")
    svc.get_meeting(db, p, prop.meeting_id)
    svc.edit_proposal(db, p, prop, body)
    db.commit()
    users = UserCache(db)
    return serialize_proposal(prop, users, db)


class DecisionIn(BaseModel):
    decision: str
    reason: str | None = None
    edits: dict | None = None


@router.post("/ai-action-proposals/{proposal_id}/decision")
def decide(proposal_id: uuid.UUID, body: DecisionIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
           p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    prop = db.get(AiActionProposal, proposal_id)
    if prop is None:
        raise NotFound("Proposal not found")
    svc.get_meeting(db, p, prop.meeting_id)
    access.require(access.can_review_ai(p, prop.project_id), "You are not a reviewer for this project")
    data = body.model_dump(exclude_none=True)

    def action():
        result = svc.decide_proposal(db, p, proposal_id, data)
        db.flush()
        return serialize_proposal(result, UserCache(db), db)

    return run_idempotent(db, p.id, f"ai.decision:{proposal_id}", idempotency_key, data, action, status_code=200)


@router.get("/meetings/{meeting_id}/transcript/search")
def search_transcript(meeting_id: uuid.UUID, q: str, p: Principal = Depends(get_principal),
                      db: Session = Depends(get_db)):
    m, _, acc = svc.get_meeting(db, p, meeting_id)
    if not acc["transcript"]:
        raise NotFound("Transcript not available")
    rows = db.scalars(select(TranscriptSegment).where(
        TranscriptSegment.meeting_id == m.id,
        TranscriptSegment.text.ilike(f"%{q}%") | TranscriptSegment.speaker_name.ilike(f"%{q}%"))
        .order_by(TranscriptSegment.seq))
    return [{"seq": s.seq, "startLabel": fmt_ts(s.start_seconds), "speaker": s.speaker_name, "text": s.text}
            for s in rows]
