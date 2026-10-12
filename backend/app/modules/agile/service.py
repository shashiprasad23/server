"""Backlog, sprint planning, board and sprint reporting (C5). Story points are never converted to time."""

import uuid
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import ValidationFailed, field_error
from app.core.events import audit
from app.core.security import Principal
from app.core.timeutil import daterange
from app.db import utcnow
from app.modules.agile.models import Sprint, SprintScopeChange
from app.modules.time.models import REPORTING_POLICIES, TimeEntry
from app.modules.work.models import TYPE_LABELS, Project, WorkItem, WorkItemHistory
from app.modules.work.service import _record, project_settings, status_category, workflow


def assign_to_sprint(db: Session, p: Principal, item: WorkItem, sprint_id: uuid.UUID | None) -> None:
    old = item.sprint_id
    if old == sprint_id:
        return
    if sprint_id is not None:
        sprint = db.get(Sprint, sprint_id)
        if sprint is None or sprint.project_id != item.project_id:
            raise field_error("sprintId", "Sprint must belong to the same project")
        if sprint.state == "closed":
            raise field_error("sprintId", "Cannot add work to a closed sprint")
        if sprint.state == "active":
            db.add(SprintScopeChange(sprint_id=sprint.id, work_item_id=item.id, change="added",
                                     points=item.story_points, actor_id=p.id))
    if old is not None:
        old_sprint = db.get(Sprint, old)
        if old_sprint and old_sprint.state == "active":
            db.add(SprintScopeChange(sprint_id=old_sprint.id, work_item_id=item.id, change="removed",
                                     points=item.story_points, actor_id=p.id))
    _record(db, item, p.id, "sprint", old, sprint_id)
    item.sprint_id = sprint_id


def create_sprint(db: Session, p: Principal, project: Project, data: dict) -> Sprint:
    access.require(access.can_manage_project(p, project.id), "Only project managers plan sprints")
    try:
        start = date.fromisoformat(data["startDate"])
        end = date.fromisoformat(data["endDate"])
    except (KeyError, ValueError) as exc:
        raise field_error("startDate", "Start and end dates are required (YYYY-MM-DD)") from exc
    if end < start:
        raise field_error("endDate", "End must be after start")
    name = (data.get("name") or "").strip()
    if not name:
        count = len(list(db.scalars(select(Sprint.id).where(Sprint.project_id == project.id))))
        name = f"Sprint {count + 1}"
    sprint = Sprint(project_id=project.id, name=name, goal=data.get("goal") or "", start_date=start, end_date=end)
    db.add(sprint)
    db.flush()
    audit(db, p.id, "sprint.created", "sprint", sprint.id, org_id=p.org.id, project_id=project.id, name=name)
    return sprint


def start_sprint(db: Session, p: Principal, sprint: Sprint) -> Sprint:
    project = db.get(Project, sprint.project_id)
    access.require(access.can_manage_project(p, project.id), "Only project managers start sprints")
    if sprint.state != "planned":
        raise ValidationFailed("Only planned sprints can be started", code="sprint_not_planned")
    if db.scalar(select(Sprint.id).where(Sprint.project_id == project.id, Sprint.state == "active")):
        raise ValidationFailed("Another sprint is already active in this project", code="sprint_active")
    items = list(db.scalars(select(WorkItem).where(WorkItem.sprint_id == sprint.id, WorkItem.deleted_at.is_(None))))
    required = set(project_settings(project)["estimates"]["required_types"])
    missing = [i.key for i in items if i.type in required and i.original_estimate_minutes is None]
    if missing:
        raise ValidationFailed(
            f"{len(missing)} item(s) need an original estimate before sprint commitment",
            code="estimate_required", errors={"items": missing})
    now = utcnow()
    sprint.state, sprint.started_at = "active", now
    sprint.committed_points = sum(i.story_points or 0 for i in items)
    sprint.committed_estimate_minutes = sum(i.original_estimate_minutes or 0 for i in items)
    for i in items:
        i.estimate_locked_at = now  # Original estimate becomes the baseline (BR-TIME-03)
    audit(db, p.id, "sprint.started", "sprint", sprint.id, org_id=p.org.id, project_id=project.id,
          committed_points=sprint.committed_points, items=len(items))
    return sprint


def complete_sprint(db: Session, p: Principal, sprint: Sprint, destination: str | None) -> dict:
    project = db.get(Project, sprint.project_id)
    access.require(access.can_manage_project(p, project.id), "Only project managers complete sprints")
    if sprint.state != "active":
        raise ValidationFailed("Only the active sprint can be completed", code="sprint_not_active")
    items = list(db.scalars(select(WorkItem).where(WorkItem.sprint_id == sprint.id, WorkItem.deleted_at.is_(None))))
    unfinished = [i for i in items if status_category(project, i.status) != "done"]
    dest_id = None
    if unfinished:
        if not destination:
            raise ValidationFailed(
                f"{len(unfinished)} unfinished item(s) need an explicit destination: a planned sprint or the backlog",
                code="destination_required", errors={"items": [i.key for i in unfinished]})
        if destination != "backlog":
            dest = db.get(Sprint, uuid.UUID(destination))
            if dest is None or dest.project_id != project.id or dest.state != "planned":
                raise field_error("destination", "Destination must be a planned sprint in this project")
            dest_id = dest.id
    sprint.state, sprint.closed_at = "closed", utcnow()
    for i in unfinished:
        _record(db, i, p.id, "sprint", sprint.id, dest_id, "Sprint completed")
        i.sprint_id = dest_id
    audit(db, p.id, "sprint.completed", "sprint", sprint.id, org_id=p.org.id, project_id=project.id,
          moved=len(unfinished), destination=destination)
    return {"completed": len(items) - len(unfinished), "moved": len(unfinished), "destination": destination}


def sprint_report(db: Session, sprint: Sprint, policy: str) -> dict:
    project = db.get(Project, sprint.project_id)
    items = list(db.scalars(select(WorkItem).where(WorkItem.sprint_id == sprint.id, WorkItem.deleted_at.is_(None))))
    done = [i for i in items if status_category(project, i.status) == "done"]
    changes = list(db.scalars(select(SprintScopeChange).where(SprintScopeChange.sprint_id == sprint.id)))
    added = sum(c.points or 0 for c in changes if c.change == "added")
    removed = sum(c.points or 0 for c in changes if c.change == "removed")
    states = REPORTING_POLICIES[policy]
    ids = [i.id for i in items]
    actual = 0
    if ids:
        actual = sum(db.scalars(select(TimeEntry.duration_minutes).where(
            TimeEntry.work_item_id.in_(ids), TimeEntry.approval_status.in_(states))))
    original = sum(i.original_estimate_minutes or 0 for i in items)

    # Burndown: remaining points per day, reconstructed from status history into a done category.
    done_keys = {s["key"] for s in workflow(project)["statuses"] if s["category"] == "done"}
    done_on: dict[uuid.UUID, date] = {}
    for h in db.scalars(select(WorkItemHistory).where(WorkItemHistory.work_item_id.in_(ids or [uuid.uuid4()]),
                                                      WorkItemHistory.field == "status")
                        .order_by(WorkItemHistory.occurred_at)):
        if h.new_value in done_keys:
            done_on[h.work_item_id] = h.occurred_at.date()
        else:
            done_on.pop(h.work_item_id, None)
    total = sum(i.story_points or 0 for i in items)
    burndown = []
    today = date.today()
    for d in daterange(sprint.start_date, sprint.end_date):
        if d > today:
            burndown.append({"date": str(d), "remaining": None})
            continue
        completed = sum(i.story_points or 0 for i in items if i.id in done_on and done_on[i.id] <= d)
        burndown.append({"date": str(d), "remaining": total - completed})
    blocked = [i.key for i in items if i.status == "blocked"]
    committed = sprint.committed_points if sprint.committed_points is not None else total
    return {
        "committedPoints": committed,
        "completedPoints": sum(i.story_points or 0 for i in done),
        "scopeChange": {"addedPoints": added, "removedPoints": removed,
                        "addedItems": sum(1 for c in changes if c.change == "added"),
                        "removedItems": sum(1 for c in changes if c.change == "removed")},
        "originalEstimateMinutes": original,
        "actualMinutes": actual,
        "varianceMinutes": actual - original,
        "daysLeft": max((sprint.end_date - today).days, 0) if sprint.state == "active" else 0,
        "blocked": blocked,
        "burndown": burndown,
        "byType": _by_type(items),
    }


def _by_type(items: list[WorkItem]) -> list[dict]:
    agg = defaultdict(lambda: {"count": 0, "points": 0.0})
    for i in items:
        agg[i.type]["count"] += 1
        agg[i.type]["points"] += i.story_points or 0
    return [{"type": t, "label": TYPE_LABELS[t], **v} for t, v in agg.items()]


def rerank(db: Session, p: Principal, project: Project, ordered_ids: list[str]) -> None:
    access.require(access.can_edit_work(p, project.id))
    for idx, iid in enumerate(ordered_ids):
        item = db.get(WorkItem, uuid.UUID(iid))
        if item and item.project_id == project.id:
            item.rank = (idx + 1) * 1000


def default_sprint_window(project: Project, after: date | None = None) -> tuple[date, date]:
    start = (after or date.today()) + timedelta(days=1)
    return start, start + timedelta(days=project_settings(project)["sprint_length_days"] - 1)
