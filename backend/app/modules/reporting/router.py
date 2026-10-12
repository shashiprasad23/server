"""Reporting read models (C10). Computed from source records on request (near-real-time), so totals always
reconcile with the underlying time entries for the same filter and policy."""

import csv
import io
import uuid
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import field_error
from app.core.events import audit
from app.core.security import Principal, get_principal
from app.core.timeutil import daterange, format_minutes, today_in, week_start
from app.db import get_db, utcnow
from app.modules.agile.models import Sprint, SprintScopeChange
from app.modules.identity.models import ProjectMembership, User
from app.modules.meetings.models import AiActionProposal, Meeting, MeetingSummary
from app.modules.resources.service import net_capacity_by_day
from app.modules.service_desk.models import SlaEvent
from app.modules.time.models import (
    POLICY_LABELS,
    REJECTED,
    REPORTING_POLICIES,
    TimeEntry,
    TimesheetPeriod,
)
from app.modules.time.service import COUNTABLE_STATES, reporting_policy
from app.modules.work.models import SERVICE_TYPES, TYPE_LABELS, Project, WorkItem
from app.modules.work.service import project_settings, status_category

router = APIRouter(prefix="/reports", tags=["reports"])


def _meta(p: Principal, policy: str, **filters) -> dict:
    return {"refreshedAt": utcnow(), "mode": "real-time", "timezone": p.org.timezone, "policy": policy,
            "policyLabel": POLICY_LABELS[policy], "filters": {k: str(v) if v is not None else None
                                                              for k, v in filters.items()}}


def _policy(p: Principal, policy: str | None) -> str:
    if policy and policy not in REPORTING_POLICIES:
        raise field_error("policy", f"Policy must be one of {', '.join(REPORTING_POLICIES)}")
    return policy or reporting_policy(p.org)


def _csv(db: Session, p: Principal, name: str, header: list[str], rows: list[list]) -> Response:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        # Neutralise spreadsheet formula injection in exported text.
        w.writerow([("'" + c) if isinstance(c, str) and c[:1] in "=+-@" else c for c in r])
    audit(db, p.id, "report.exported", "report", name, org_id=p.org.id, rows=len(rows))
    db.commit()
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}-{date.today()}.csv"'})


def _projects(db: Session, p: Principal, project_id: uuid.UUID | None) -> list[Project]:
    if project_id:
        return [access.get_project_for(db, p, project_id, aggregates=True)]
    ids = access.visible_project_ids(db, p, aggregates=True)
    return list(db.scalars(select(Project).where(Project.id.in_(ids or [uuid.uuid4()])).order_by(Project.name)))


def _tree_order(items: list[WorkItem]) -> list[tuple[WorkItem, int]]:
    by_parent: dict = defaultdict(list)
    ids = {i.id for i in items}
    for i in items:
        by_parent[i.parent_id if i.parent_id in ids else None].append(i)
    out = []

    def walk(parent, depth):
        for i in sorted(by_parent.get(parent, []), key=lambda x: x.sequence):
            out.append((i, depth))
            walk(i.id, depth + 1)

    walk(None, 0)
    return out


@router.get("/estimate-vs-actual")
def estimate_vs_actual(project_id: uuid.UUID = Query(..., alias="projectId"),
                       sprint_id: uuid.UUID | None = Query(None, alias="sprintId"), type: str | None = None,
                       assignee_id: uuid.UUID | None = Query(None, alias="assigneeId"),
                       from_: date | None = Query(None, alias="from"), to: date | None = None,
                       policy: str | None = None, format: str = "json",
                       p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr = _projects(db, p, project_id)[0]
    detail = access.can_view_project(p, pr)
    policy = _policy(p, policy)
    sprint = db.get(Sprint, sprint_id) if sprint_id else None
    if sprint and not from_:
        from_, to = sprint.start_date, to or sprint.end_date
    q = select(WorkItem).where(WorkItem.project_id == pr.id, WorkItem.deleted_at.is_(None))
    if sprint:
        sprint_items = select(WorkItem.id).where(WorkItem.sprint_id == sprint.id)
        parents = select(WorkItem.parent_id).where(WorkItem.sprint_id == sprint.id)
        q = q.where(WorkItem.id.in_(sprint_items) | WorkItem.id.in_(parents) |
                    WorkItem.parent_id.in_(sprint_items))
    if type:
        q = q.where(WorkItem.type.in_(type.split(",")))
    if assignee_id:
        q = q.where(WorkItem.assignee_id == assignee_id)
    items = list(db.scalars(q))
    ids = [i.id for i in items]
    eq = select(TimeEntry.work_item_id, func.sum(TimeEntry.duration_minutes)).where(
        TimeEntry.work_item_id.in_(ids or [uuid.uuid4()]), TimeEntry.approval_status.in_(REPORTING_POLICIES[policy]))
    if from_:
        eq = eq.where(TimeEntry.work_date >= from_)
    if to:
        eq = eq.where(TimeEntry.work_date <= to)
    direct = {k: int(v) for k, v in db.execute(eq.group_by(TimeEntry.work_item_id)).all()}

    estimated = [i for i in items if i.original_estimate_minutes is not None]
    original_total = sum(i.original_estimate_minutes for i in estimated)
    actual_total = sum(direct.values())  # each entry exactly once
    actual_on_estimated = sum(direct.get(i.id, 0) for i in estimated)
    required = set(project_settings(pr)["estimates"]["required_types"])
    eligible = [i for i in items if i.type in required]
    with_est = [i for i in eligible if i.original_estimate_minutes is not None]
    by_type = defaultdict(lambda: {"original": 0, "actual": 0, "count": 0})
    for i in items:
        bt = by_type[i.type]
        bt["count"] += 1
        bt["original"] += i.original_estimate_minutes or 0
        bt["actual"] += direct.get(i.id, 0)

    children = defaultdict(list)
    for i in items:
        if i.parent_id:
            children[i.parent_id].append(i.id)

    def desc_total(iid):
        return sum(direct.get(c, 0) + desc_total(c) for c in children.get(iid, []))

    rows = []
    for i, depth in _tree_order(items):
        d = direct.get(i.id, 0)
        ds = desc_total(i.id)
        rows.append({"key": i.key, "title": i.title, "type": i.type, "typeLabel": TYPE_LABELS[i.type],
                     "depth": depth, "original": i.original_estimate_minutes,
                     "remaining": i.remaining_estimate_minutes, "direct": d, "descendants": ds, "total": d + ds,
                     "variance": (d + ds - i.original_estimate_minutes) if i.original_estimate_minutes is not None
                     else None})
    if format == "csv":
        if not detail:
            raise field_error("format", "Ticket-level export requires project access")
        return _csv(db, p, "estimate-vs-actual",
                    ["Key", "Type", "Title", "Original (min)", "Remaining (min)", "Direct (min)",
                     "Descendants (min)", "Total (min)", "Variance (min)"],
                    [[r["key"], r["typeLabel"], r["title"], r["original"], r["remaining"], r["direct"],
                      r["descendants"], r["total"], r["variance"]] for r in rows])
    return {
        **_meta(p, policy, project=pr.name, sprint=sprint.name if sprint else None, type=type, from_=from_, to=to),
        "project": {"id": str(pr.id), "name": pr.name, "key": pr.key},
        "sprint": {"id": str(sprint.id), "name": sprint.name} if sprint else None,
        "totals": {"original": original_total, "actual": actual_total, "actualOnEstimated": actual_on_estimated,
                   "variance": actual_on_estimated - original_total,
                   "variancePct": ((actual_on_estimated - original_total) / original_total * 100)
                   if original_total else None,
                   "remaining": sum(i.remaining_estimate_minutes or 0 for i in items),
                   "estimateCoverage": {"withEstimate": len(with_est), "eligible": len(eligible),
                                        "pct": (len(with_est) / len(eligible) * 100) if eligible else None}},
        "byType": [{"type": t, "label": TYPE_LABELS[t], **v, "variance": v["actual"] - v["original"]}
                   for t, v in sorted(by_type.items(), key=lambda kv: list(TYPE_LABELS).index(kv[0]))],
        "rows": rows if detail else [],
        "detailRestricted": not detail,
    }


@router.get("/time-by-ticket")
def time_by_ticket(project_id: uuid.UUID = Query(..., alias="projectId"), from_: date | None = Query(None, alias="from"),
                   to: date | None = None, policy: str | None = None, format: str = "json",
                   p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    policy = _policy(p, policy)
    q = select(TimeEntry, WorkItem).join(WorkItem, WorkItem.id == TimeEntry.work_item_id).where(
        TimeEntry.project_id == pr.id, TimeEntry.approval_status.in_(REPORTING_POLICIES[policy]))
    if from_:
        q = q.where(TimeEntry.work_date >= from_)
    if to:
        q = q.where(TimeEntry.work_date <= to)
    by_activity = defaultdict(int)
    by_person = defaultdict(int)
    by_item: dict = defaultdict(lambda: defaultdict(int))
    total = 0
    for e, i in db.execute(q).all():
        by_activity[e.activity_category] += e.duration_minutes
        by_person[e.user_id] += e.duration_minutes
        by_item[i.key][e.activity_category] += e.duration_minutes
        total += e.duration_minutes
    names = {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(list(by_person) or [uuid.uuid4()])))}
    if format == "csv":
        rows = [[k, act, m] for k, acts in sorted(by_item.items()) for act, m in sorted(acts.items())]
        return _csv(db, p, "time-by-ticket", ["Key", "Activity", "Minutes"], rows)
    return {**_meta(p, policy, project=pr.name, from_=from_, to=to), "totalMinutes": total,
            "byActivity": [{"activity": k, "minutes": v} for k, v in sorted(by_activity.items(), key=lambda x: -x[1])],
            "byPerson": [{"user": names.get(k, "?"), "minutes": v} for k, v in sorted(by_person.items(), key=lambda x: -x[1])]}


@router.get("/timesheet-compliance")
def compliance(week: date | None = None, project_id: uuid.UUID | None = Query(None, alias="projectId"),
               format: str = "json", p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    ws = week_start(week or today_in(p.org.timezone))
    we = ws + timedelta(days=6)
    today = today_in(p.org.timezone)
    if p.is_admin or p.has_global("resource_manager") or p.has_global("executive_viewer"):
        q = select(User).where(User.organization_id == p.org.id, User.status == "active")
        if project_id:
            q = q.join(ProjectMembership, ProjectMembership.user_id == User.id).where(
                ProjectMembership.project_id == project_id)
    else:
        managed = [pid for pid, m in p.memberships.items()
                   if m.is_time_approver or m.role in {"project_manager", "project_admin"}]
        if project_id:
            managed = [x for x in managed if x == project_id]
        q = select(User).join(ProjectMembership, ProjectMembership.user_id == User.id).where(
            ProjectMembership.project_id.in_(managed or [uuid.uuid4()]))
    people = list(db.scalars(q.distinct().order_by(User.display_name)))
    rows = []
    for u in people:
        exp = net_capacity_by_day(db, u.id, ws, we)
        entries = list(db.scalars(select(TimeEntry).where(TimeEntry.user_id == u.id,
                                                          TimeEntry.work_date.between(ws, we))))
        logged_by_day = defaultdict(int)
        for e in entries:
            if e.approval_status in COUNTABLE_STATES:
                logged_by_day[e.work_date] += e.duration_minutes
        missing_days = sum(1 for d in daterange(ws, min(we, today)) if exp.get(d, 0) > logged_by_day[d])
        period = db.scalar(select(TimesheetPeriod).where(TimesheetPeriod.user_id == u.id,
                                                         TimesheetPeriod.period_start == ws))
        rows.append({"user": {"id": str(u.id), "name": u.display_name, "initials": u.initials},
                     "logged": sum(logged_by_day.values()), "expected": sum(exp.values()),
                     "missingDays": missing_days,
                     "rejected": sum(1 for e in entries if e.approval_status == REJECTED),
                     "submitted": sum(e.duration_minutes for e in entries if e.approval_status in {"submitted", "approved"}),
                     "periodState": period.state if period else "open"})
    expected = sum(r["expected"] for r in rows)
    submitted = sum(r["submitted"] for r in rows)
    if format == "csv":
        return _csv(db, p, "timesheet-compliance", ["Person", "Logged (min)", "Expected (min)", "Missing days",
                                                    "Rejected", "Period"],
                    [[r["user"]["name"], r["logged"], r["expected"], r["missingDays"], r["rejected"], r["periodState"]]
                     for r in rows])
    return {**_meta(p, reporting_policy(p.org), week=ws, project=project_id), "weekStart": str(ws),
            "rows": rows, "team": {"logged": sum(r["logged"] for r in rows), "expected": expected,
                                   "missingDays": sum(r["missingDays"] for r in rows),
                                   "rejected": sum(r["rejected"] for r in rows),
                                   "submittedPct": (submitted / expected * 100) if expected else None,
                                   "loggedPct": (sum(r["logged"] for r in rows) / expected * 100) if expected else None},
            "target": 95}


@router.get("/project-health")
def project_health(project_id: uuid.UUID | None = Query(None, alias="projectId"),
                   p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    today = today_in(p.org.timezone)
    out = []
    for pr in _projects(db, p, project_id):
        items = list(db.scalars(select(WorkItem).where(WorkItem.project_id == pr.id, WorkItem.deleted_at.is_(None))))
        done = [i for i in items if status_category(pr, i.status) == "done"]
        open_ = [i for i in items if status_category(pr, i.status) != "done"]
        overdue = [i for i in open_ if i.due_date and i.due_date < today]
        sprint = db.scalar(select(Sprint).where(Sprint.project_id == pr.id, Sprint.state == "active"))
        scope = list(db.scalars(select(SprintScopeChange).where(SprintScopeChange.sprint_id == sprint.id))) if sprint else []
        risks = []
        for s in db.scalars(select(MeetingSummary).join(Meeting, Meeting.id == MeetingSummary.meeting_id).where(
                Meeting.project_id == pr.id, MeetingSummary.published_at.is_not(None))
                .order_by(MeetingSummary.published_at.desc()).limit(3)):
            risks.extend(r["text"] for r in s.risks)
        out.append({"project": {"id": str(pr.id), "name": pr.name, "key": pr.key, "kind": pr.kind},
                    "progressPct": (len(done) / len(items) * 100) if items else None, "open": len(open_),
                    "done": len(done), "overdue": len(overdue), "blocked": sum(1 for i in open_ if i.status == "blocked"),
                    "scopeChangeItems": len(scope),
                    "activeSprint": {"name": sprint.name, "endDate": str(sprint.end_date)} if sprint else None,
                    "risks": risks[:5] if access.can_view_project(p, pr) else []})
    return {**_meta(p, reporting_policy(p.org)), "projects": out}


@router.get("/service-performance")
def service_performance(project_id: uuid.UUID | None = Query(None, alias="projectId"),
                        p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    now = utcnow()
    out = []
    for pr in [x for x in _projects(db, p, project_id) if x.kind == "service"]:
        items = list(db.scalars(select(WorkItem).where(WorkItem.project_id == pr.id, WorkItem.type.in_(SERVICE_TYPES),
                                                       WorkItem.deleted_at.is_(None))))
        open_ = [i for i in items if not i.resolved_at]
        resolved = [i for i in items if i.resolved_at]
        responded = [i for i in items if i.sla_responded_at and i.sla_response_due_at]
        aging = {"<1d": 0, "1-3d": 0, "3-7d": 0, ">7d": 0}
        for i in open_:
            age = (now - i.created_at).days
            aging["<1d" if age < 1 else "1-3d" if age < 3 else "3-7d" if age < 7 else ">7d"] += 1
        by_priority = defaultdict(int)
        for i in open_:
            by_priority[i.priority] += 1
        out.append({"project": {"id": str(pr.id), "name": pr.name},
                    "openBacklog": len(open_), "byPriority": dict(by_priority), "aging": aging,
                    "breaches": sum(1 for i in items if i.sla_resolution_breached or i.sla_response_breached),
                    "responseMetPct": (sum(1 for i in responded if i.sla_responded_at <= i.sla_response_due_at)
                                       / len(responded) * 100) if responded else None,
                    "resolutionMetPct": (sum(1 for i in resolved if not i.sla_resolution_due_at
                                             or i.resolved_at <= i.sla_resolution_due_at) / len(resolved) * 100)
                    if resolved else None,
                    "pauses": db.scalar(select(func.count()).select_from(SlaEvent).where(
                        SlaEvent.work_item_id.in_([i.id for i in items] or [uuid.uuid4()]),
                        SlaEvent.kind == "paused"))})
    return {**_meta(p, reporting_policy(p.org)), "services": out}


@router.get("/ai-actions")
def ai_actions(project_id: uuid.UUID | None = Query(None, alias="projectId"),
               p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    today = today_in(p.org.timezone)
    projects = [pr for pr in _projects(db, p, project_id) if access.can_view_project(p, pr)]
    props = list(db.scalars(select(AiActionProposal).where(
        AiActionProposal.project_id.in_([pr.id for pr in projects] or [uuid.uuid4()]))))
    approved = [x for x in props if x.review_state == "approved"]
    decided = [x for x in props if x.review_state != "pending"]
    created = [db.get(WorkItem, x.created_work_item_id) for x in approved if x.created_work_item_id]
    pmap = {pr.id: pr for pr in projects}
    overdue = [w for w in created if w and w.due_date and w.due_date < today
               and status_category(pmap[w.project_id], w.status) != "done"]
    with_owner_due = [x for x in approved if x.owner_user_id and x.due_date]
    meetings = list(db.scalars(select(Meeting).where(Meeting.project_id.in_(list(pmap) or [uuid.uuid4()]))))
    summaries = list(db.scalars(select(MeetingSummary).where(MeetingSummary.meeting_id.in_([m.id for m in meetings]
                                                                                          or [uuid.uuid4()]))))
    return {**_meta(p, reporting_policy(p.org)),
            "proposals": len(props), "pending": len(props) - len(decided), "approved": len(approved),
            "rejected": len(decided) - len(approved),
            "approvalRatePct": (len(approved) / len(decided) * 100) if decided else None,
            "ownerAndDueDatePct": (len(with_owner_due) / len(approved) * 100) if approved else None,
            "overdueActions": [{"key": w.key, "title": w.title, "dueDate": str(w.due_date)} for w in overdue],
            "unresolvedDecisions": sum(len(s.open_questions) for s in summaries if s.published_at),
            "quality": {"meetings": len(meetings), "failed": sum(1 for m in meetings if m.status == "failed"),
                        "retries": sum(m.retry_count for m in meetings),
                        "avgProcessingMs": (sum(s.processing_ms for s in summaries) / len(summaries)) if summaries else None,
                        "edited": sum(1 for x in props if x.edited),
                        "models": sorted({f"{s.model_name} · prompt {s.prompt_version}" for s in summaries})}}


@router.get("/capacity")
def capacity_report(from_: date | None = Query(None, alias="from"), weeks: int = 4,
                    p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    from app.modules.resources.service import capacity_grid

    grid = capacity_grid(db, p, from_ or today_in(p.org.timezone), weeks)
    return {**_meta(p, reporting_policy(p.org)), "weeks": grid["weeks"], "teamTotals": grid["teamTotals"],
            "people": [{"user": r["user"], "weeks": [{k: c[k] for k in ("weekStart", "net", "planned", "actual",
                                                                       "allocationRatio", "utilization")}
                                                     for c in r["weeks"]]} for r in grid["rows"]]}


__all__ = ["router", "format_minutes"]
