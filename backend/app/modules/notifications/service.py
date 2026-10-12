"""Notifications: in-app with deduplication, optional Teams delivery with minimal content (C9, C11)."""

import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.models import Notification, NotificationPreference, OutboxEvent
from app.modules.identity.models import ProjectMembership


def notify(db: Session, user_ids, kind: str, title: str, body: str, link: str, dedupe_key: str,
           exclude: uuid.UUID | str | None = None) -> int:
    """Insert one notification per recipient. Re-delivery of the same event is a no-op (dedupe_key)."""
    sent = 0
    for uid in {str(u) for u in user_ids if u}:
        if exclude and uid == str(exclude):
            continue
        pref = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == uuid.UUID(uid),
                                                              NotificationPreference.kind == kind))
        if pref is not None and not pref.in_app:
            continue
        teams = "pending" if (pref is not None and pref.teams and get_settings().teams_webhook_url) else "not_requested"
        stmt = insert(Notification).values(
            id=uuid.uuid4(), user_id=uuid.UUID(uid), kind=kind, title=title[:300], body=body[:1000], link=link,
            dedupe_key=dedupe_key[:200], teams_delivery=teams,
        ).on_conflict_do_nothing(index_elements=["user_id", "dedupe_key"]).returning(Notification.id)
        sent += 1 if db.execute(stmt).scalar() is not None else 0
    return sent


def _members(db: Session, project_id, *, approvers=False, reviewers=False, roles: set[str] | None = None):
    q = select(ProjectMembership).where(ProjectMembership.project_id == uuid.UUID(str(project_id)))
    out = []
    for m in db.scalars(q):
        if approvers and not m.is_time_approver:
            continue
        if reviewers and not (m.is_ai_reviewer or m.role in {"project_manager", "ai_reviewer"}):
            continue
        if roles and m.role not in roles:
            continue
        out.append(m.user_id)
    return out


def handle(db: Session, ev: OutboxEvent) -> None:
    """Outbox consumer that turns domain events into notifications. Must be idempotent."""
    pl = ev.payload or {}
    key = f"{ev.event_type}:{ev.id}"
    t = ev.event_type
    if t == "WorkItemCreated" and pl.get("assignee_id"):
        notify(db, [pl["assignee_id"]], "assigned", f"{pl['key']} assigned to you", pl.get("title", ""),
               f"/work-items/{pl['key']}", key, exclude=pl.get("actor_id"))
    elif t == "WorkItemUpdated" and pl.get("assignee_id") and ("assignee_id" in pl.get("fields", [])
                                                                or "status" in pl.get("fields", [])):
        what = "status changed" if "status" in pl.get("fields", []) else "assigned to you"
        notify(db, [pl["assignee_id"]], "work_item", f"{pl['key']} {what}", pl.get("title", ""),
               f"/work-items/{pl['key']}", key, exclude=pl.get("actor_id"))
    elif t == "TimeEntrySubmitted":
        notify(db, _members(db, pl["project_id"], approvers=True), "timesheet_submitted",
               "Timesheet submitted for approval", f"{pl.get('count')} entries · week of {pl.get('period_start')}",
               "/timesheets/approvals", key, exclude=pl.get("user_id"))
    elif t in {"TimeEntryApproved", "TimeEntryRejected"}:
        approved = t == "TimeEntryApproved"
        notify(db, [pl["user_id"]], "timesheet_decision",
               f"Time {'approved' if approved else 'rejected'} · week of {pl.get('period_start')}",
               "" if approved else f"Reason: {pl.get('reason')}", f"/timesheets?week={pl.get('period_start')}", key)
    elif t == "TimeAmendmentRequested":
        notify(db, _members(db, pl["project_id"], approvers=True), "amendment", "Amendment requested",
               "An approved time entry needs a correction", "/timesheets/approvals", key, exclude=pl.get("user_id"))
    elif t == "TimeAmendmentDecided":
        notify(db, [pl["user_id"]], "amendment", f"Amendment {pl.get('state')}", "", "/timesheets", key)
    elif t == "AllocationChanged" and pl.get("user_id"):
        notify(db, [pl["user_id"]], "allocation", "Your allocation changed", f"State: {pl.get('state')}",
               "/resources", key, exclude=pl.get("actor_id"))
    elif t == "MeetingSummaryGenerated":
        notify(db, _members(db, pl["project_id"], reviewers=True), "meeting_review",
               f"Review required · {pl.get('title')}", f"{pl.get('actions')} proposed actions",
               f"/meetings/{ev.aggregate_id}", key)
    elif t == "MeetingProcessingFailed":
        notify(db, _members(db, pl["project_id"], reviewers=True), "meeting_failed",
               f"Processing failed · {pl.get('title')}", "Retry or review the transcript manually",
               f"/meetings/{ev.aggregate_id}", key)
    elif t == "MeetingPublished":
        notify(db, pl.get("attendees") or [], "meeting_published", f"Meeting notes published · {pl.get('title')}",
               "", f"/meetings/{ev.aggregate_id}", key)
    elif t == "AIActionApproved" and pl.get("owner_id"):
        notify(db, [pl["owner_id"]], "ai_action", "New action from a meeting", pl.get("title", ""),
               f"/work-items/{pl.get('work_item_id')}", key)
    elif t in {"SlaBreached", "WorkItemEscalated"}:
        recipients = [pl.get("assignee_id"), pl.get("owner_id")] + _members(
            db, pl["project_id"], roles={"service_owner", "project_manager"})
        notify(db, recipients, "sla", f"{pl['key']} {'SLA breached' if t == 'SlaBreached' else 'escalated'}",
               pl.get("title", ""), f"/work-items/{pl['key']}", key)
    elif t == "ServiceRequestSubmitted":
        notify(db, [pl.get("owner_id")] + _members(db, pl["project_id"], roles={"service_agent"}), "service_request",
               f"New request {pl['key']}", pl.get("title", ""), f"/work-items/{pl['key']}", key)
    elif t == "IntegrationDeliveryFailed":
        from app.modules.identity.models import User

        admins = db.scalars(select(User.id).where(User.global_roles.any("platform_admin")))
        notify(db, list(admins), "integration", "Integration delivery failed", pl.get("error", "")[:300],
               "/admin/integrations", key)


def deliver_teams(db: Session) -> int:
    """Send pending Teams notifications: minimal text plus a deep link, never transcript content."""
    url = get_settings().teams_webhook_url
    if not url:
        return 0
    pending = list(db.scalars(select(Notification).where(Notification.teams_delivery == "pending").limit(20)))
    for n in pending:
        try:
            r = httpx.post(url, json={"text": f"{n.title} — open in Unified PM: {n.link}"}, timeout=10)
            n.teams_delivery = "sent" if r.status_code < 300 else "failed"
        except httpx.HTTPError:
            n.teams_delivery = "failed"
    db.commit()
    return len(pending)
