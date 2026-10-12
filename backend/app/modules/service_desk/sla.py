"""SLA timers. Pauses only happen in statuses explicitly configured with pauses_sla; every change is audited."""

from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.events import audit, emit
from app.db import utcnow
from app.modules.service_desk.models import SlaEvent, SlaPolicy
from app.modules.work.models import Project, WorkItem
from app.modules.work.service import status_category, status_def


def _targets(db: Session, item: WorkItem) -> dict | None:
    if not item.sla_policy_id:
        return None
    policy = db.get(SlaPolicy, item.sla_policy_id)
    return (policy.targets or {}).get(item.priority) if policy else None


def _event(db: Session, item: WorkItem, kind: str, detail: str, actor=None) -> None:
    db.add(SlaEvent(work_item_id=item.id, kind=kind, detail=detail, actor_id=actor))


def start_sla(db: Session, item: WorkItem, actor) -> None:
    if not item.sla_policy_id:
        return
    now = utcnow()
    t = _targets(db, item)
    item.sla_started_at = now
    if t:
        item.sla_response_due_at = now + timedelta(minutes=t["response"])
        item.sla_resolution_due_at = now + timedelta(minutes=t["resolution"])
    _event(db, item, "started", f"{item.priority} policy applied", actor)


def recalculate_for_priority(db: Session, item: WorkItem, actor) -> None:
    t = _targets(db, item)
    if not (t and item.sla_started_at):
        return
    shift = timedelta(minutes=item.sla_paused_minutes)
    item.sla_response_due_at = item.sla_started_at + timedelta(minutes=t["response"]) + shift
    item.sla_resolution_due_at = item.sla_started_at + timedelta(minutes=t["resolution"]) + shift
    _event(db, item, "retargeted", f"Priority {item.priority}", actor)


def mark_responded(db: Session, item: WorkItem, actor) -> None:
    if item.sla_started_at and not item.sla_responded_at:
        item.sla_responded_at = utcnow()
        met = item.sla_response_due_at is None or item.sla_responded_at <= item.sla_response_due_at
        _event(db, item, "responded", "Response SLA met" if met else "Response after target", actor)


def on_transition(db: Session, project: Project, item: WorkItem, old: str, new: str, actor) -> None:
    if not item.sla_started_at:
        return
    now = utcnow()
    old_def, new_def = status_def(project, old) or {}, status_def(project, new) or {}
    if old_def.get("pauses_sla") and item.sla_paused_at:
        paused = int((now - item.sla_paused_at).total_seconds() // 60)
        item.sla_paused_minutes += paused
        for attr in ("sla_response_due_at", "sla_resolution_due_at"):
            if getattr(item, attr) and not (attr == "sla_response_due_at" and item.sla_responded_at):
                setattr(item, attr, getattr(item, attr) + timedelta(minutes=paused))
        item.sla_paused_at = None
        _event(db, item, "resumed", f"Resumed after {paused}m in {old_def.get('name', old)}", actor)
    if new_def.get("pauses_sla") and not item.sla_paused_at:
        item.sla_paused_at = now
        _event(db, item, "paused", f"Paused · {new_def.get('name', new)}", actor)
    if status_category(project, old) == "todo" and status_category(project, new) != "todo":
        mark_responded(db, item, actor)
    if status_category(project, new) == "done" and not item.resolved_at:
        item.resolved_at = now
        met = item.sla_resolution_due_at is None or now <= item.sla_resolution_due_at
        _event(db, item, "resolved", "Resolution SLA met" if met else "Resolved after target", actor)
    elif status_category(project, new) != "done" and item.resolved_at:
        item.resolved_at = None
        _event(db, item, "reopened", "Reopened", actor)


def sla_state(item: WorkItem, now: datetime | None = None) -> dict:
    now = now or utcnow()
    if not item.sla_started_at:
        return {"state": "none", "label": "No SLA"}
    if item.resolved_at:
        met = item.sla_resolution_due_at is None or item.resolved_at <= item.sla_resolution_due_at
        return {"state": "met" if met else "breached", "label": "Resolved · met" if met else "Resolved · breached"}
    if item.sla_paused_at:
        return {"state": "paused", "label": "Paused"}
    due = item.sla_resolution_due_at
    if due is None:
        return {"state": "none", "label": "No target"}
    remaining = int((due - now).total_seconds() // 60)
    if remaining < 0 or item.sla_resolution_breached:
        return {"state": "breached", "label": f"Breached · {_fmt(-remaining)}", "minutes": remaining}
    return {"state": "due_soon" if remaining <= 240 else "running", "label": f"Resolve in {_fmt(remaining)}",
            "minutes": remaining}


def _fmt(minutes: int) -> str:
    d, rem = divmod(max(minutes, 0), 1440)
    h, m = divmod(rem, 60)
    return f"{d}d {h}h" if d else f"{h}h {m:02d}m"


def sweep_breaches(db: Session) -> int:
    """Background job: flag breaches once, audit them and notify."""
    now = utcnow()
    items = list(db.scalars(select(WorkItem).where(
        WorkItem.sla_started_at.is_not(None), WorkItem.resolved_at.is_(None), WorkItem.sla_paused_at.is_(None),
        or_((WorkItem.sla_resolution_due_at < now) & (WorkItem.sla_resolution_breached.is_(False)),
            (WorkItem.sla_response_due_at < now) & (WorkItem.sla_responded_at.is_(None))
            & (WorkItem.sla_response_breached.is_(False))))))
    for item in items:
        if item.sla_response_due_at and item.sla_response_due_at < now and not item.sla_responded_at \
                and not item.sla_response_breached:
            item.sla_response_breached = True
            _event(db, item, "breached", "Response SLA breached")
        if item.sla_resolution_due_at and item.sla_resolution_due_at < now and not item.sla_resolution_breached:
            item.sla_resolution_breached = True
            _event(db, item, "breached", "Resolution SLA breached")
        audit(db, None, "sla.breached", "work_item", item.id, project_id=item.project_id, key=item.key)
        emit(db, "SlaBreached", "work_item", item.id, key=item.key, project_id=item.project_id,
             assignee_id=item.assignee_id, title=item.title)
    db.commit()
    return len(items)
