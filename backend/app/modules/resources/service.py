"""Resource pool, capacity and allocation (C6).

Capacity, planned allocation and actual effort are computed independently and never substitute for each
other: logged time never fills an allocation (AC-08).
"""

import uuid
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import Forbidden, ValidationFailed, field_error
from app.core.events import audit, emit
from app.core.security import Principal
from app.core.timeutil import daterange, format_minutes, iso_week, week_start
from app.modules.identity.models import ProjectMembership, Team, User
from app.modules.resources.models import (
    Allocation,
    CalendarException,
    Leave,
    ResourceProfile,
    WorkingCalendar,
)
from app.modules.time.models import APPROVED, DRAFT, SUBMITTED, TimeEntry
from app.modules.work.models import Project
from app.modules.work.service import project_settings

DEFAULT_WEEK = [480, 480, 480, 480, 480, 0, 0]
ACTUAL_STATES = {DRAFT, SUBMITTED, APPROVED}


# ---------------------------------------------------------------- capacity primitives

def _calendar_for(db: Session, user_id: uuid.UUID) -> tuple[ResourceProfile | None, list[int], dict[date, tuple[int, str]]]:
    profile = db.scalar(select(ResourceProfile).where(ResourceProfile.user_id == user_id))
    cal = None
    if profile and profile.calendar_id:
        cal = db.get(WorkingCalendar, profile.calendar_id)
    if cal is None:
        user = db.get(User, user_id)
        cal = db.scalar(select(WorkingCalendar).where(WorkingCalendar.organization_id == user.organization_id)
                        .order_by(WorkingCalendar.created_at)) if user else None
    week = list(cal.weekday_minutes) if cal else DEFAULT_WEEK
    exceptions = {}
    if cal:
        for ex in db.scalars(select(CalendarException).where(CalendarException.calendar_id == cal.id)):
            exceptions[ex.date] = (ex.minutes, ex.reason)
    return profile, week, exceptions


def _leave_days(db: Session, user_id: uuid.UUID, start: date, end: date) -> dict[date, str]:
    out = {}
    for lv in db.scalars(select(Leave).where(Leave.user_id == user_id, Leave.state == "approved",
                                             Leave.start_date <= end, Leave.end_date >= start)):
        for d in daterange(max(lv.start_date, start), min(lv.end_date, end)):
            out[d] = lv.reason or "Leave"
    return out


def day_breakdown(db: Session, user_id: uuid.UUID, start: date, end: date) -> dict[date, dict]:
    profile, week, exceptions = _calendar_for(db, user_id)
    leave = _leave_days(db, user_id, start, end)
    reserved = (profile.reserved_percent if profile else 0) / 100
    out = {}
    for d in daterange(start, end):
        gross = week[d.weekday()]
        holiday = None
        net = gross
        if d in exceptions:
            net = exceptions[d][0]
            holiday = exceptions[d][1]
        if profile and ((profile.available_from and d < profile.available_from) or
                        (profile.available_to and d > profile.available_to)):
            net = 0
        on_leave = d in leave and gross > 0
        if on_leave:
            net = 0
        net = int(round(net * (1 - reserved)))
        out[d] = {"gross": gross, "net": net, "holiday": holiday if gross else None,
                  "leave": leave.get(d) if on_leave else None}
    return out


def net_capacity_by_day(db: Session, user_id: uuid.UUID, start: date, end: date) -> dict[date, int]:
    return {d: v["net"] for d, v in day_breakdown(db, user_id, start, end).items()}


def _allocation_day_minutes(a: Allocation, d: date, days: dict[date, dict]) -> float:
    if not (a.start_date <= d <= a.end_date) or a.state == "cancelled":
        return 0
    info = days.get(d)
    if not info or info["gross"] == 0:
        return 0
    if a.unit == "percent":
        return info["gross"] * (a.percent or 0) / 100
    ws = week_start(d)
    working = sum(1 for x in daterange(ws, ws + timedelta(days=6)) if days.get(x, {"gross": 1})["gross"] > 0) or 5
    return (a.minutes_per_week or 0) / working


def allocations_for(db: Session, user_ids: list[uuid.UUID], start: date, end: date) -> list[Allocation]:
    if not user_ids:
        return []
    return list(db.scalars(select(Allocation).where(Allocation.user_id.in_(user_ids), Allocation.state != "cancelled",
                                                    Allocation.start_date <= end, Allocation.end_date >= start)))


def allocation_minutes_by_project(db: Session, user_id: uuid.UUID, start: date, end: date) -> dict[uuid.UUID, int]:
    days = day_breakdown(db, user_id, week_start(start), week_start(end) + timedelta(days=6))
    out: dict[uuid.UUID, float] = defaultdict(float)
    for a in allocations_for(db, [user_id], start, end):
        for d in daterange(start, end):
            out[a.project_id] += _allocation_day_minutes(a, d, days)
    return {k: int(round(v)) for k, v in out.items()}


# ---------------------------------------------------------------- capacity grid

def _visible_people(db: Session, p: Principal) -> list[User]:
    q = select(User).where(User.organization_id == p.org.id, User.status == "active").order_by(User.display_name)
    if p.is_admin or p.has_global("resource_manager"):
        return list(db.scalars(q))
    managed = [pid for pid, m in p.memberships.items() if m.role in {"project_manager", "project_admin"}]
    member_ids = {p.id}
    if managed:
        member_ids |= set(db.scalars(select(ProjectMembership.user_id).where(ProjectMembership.project_id.in_(managed))))
    return list(db.scalars(q.where(User.id.in_(member_ids))))


def capacity_grid(db: Session, p: Principal, start: date, weeks: int, team_id: uuid.UUID | None = None,
                  skill: str | None = None, user_ids: list[uuid.UUID] | None = None) -> dict:
    start = week_start(start)
    weeks = max(1, min(weeks, 12))
    end = start + timedelta(days=7 * weeks - 1)
    people = _visible_people(db, p)
    profiles = {pr.user_id: pr for pr in db.scalars(select(ResourceProfile).where(
        ResourceProfile.user_id.in_([u.id for u in people] or [uuid.uuid4()])))}
    # The resource pool is people with a resource profile (plus yourself, so everyone can see their own load).
    people = [u for u in people if u.id in profiles or u.id == p.id]
    if team_id:
        people = [u for u in people if profiles.get(u.id) and profiles[u.id].team_id == team_id]
    if skill:
        people = [u for u in people if profiles.get(u.id) and skill.lower() in [s.lower() for s in profiles[u.id].skills]]
    if user_ids:
        people = [u for u in people if u.id in user_ids]
    ids = [u.id for u in people]
    allocs = allocations_for(db, ids, start, end)
    project_ids = {a.project_id for a in allocs}
    projects = {pr.id: pr for pr in db.scalars(select(Project).where(Project.id.in_(project_ids or [uuid.uuid4()])))}
    actual_rows = db.execute(select(TimeEntry.user_id, TimeEntry.work_date, TimeEntry.project_id,
                                    TimeEntry.duration_minutes).where(
        TimeEntry.user_id.in_(ids or [uuid.uuid4()]), TimeEntry.work_date.between(start, end),
        TimeEntry.approval_status.in_(ACTUAL_STATES))).all()
    actual: dict[tuple, int] = defaultdict(int)
    actual_by_project: dict[tuple, int] = defaultdict(int)
    for uid, d, pid, m in actual_rows:
        actual[(uid, week_start(d))] += m
        actual_by_project[(uid, week_start(d), pid)] += m

    week_starts = [start + timedelta(days=7 * i) for i in range(weeks)]
    rows = []
    conflicts = []
    team_totals = {str(w): {"net": 0, "planned": 0, "actual": 0} for w in week_starts}
    for u in people:
        days = day_breakdown(db, u.id, start, end)
        prof = profiles.get(u.id)
        cells = []
        my_allocs = [a for a in allocs if a.user_id == u.id]
        for ws in week_starts:
            we = ws + timedelta(days=6)
            wdays = [days[d] for d in daterange(ws, we)]
            gross = sum(x["gross"] for x in wdays)
            net = sum(x["net"] for x in wdays)
            by_project: dict[uuid.UUID, dict] = {}
            planned = tentative = 0.0
            for a in my_allocs:
                m = sum(_allocation_day_minutes(a, d, days) for d in daterange(ws, we))
                if m <= 0:
                    continue
                entry = by_project.setdefault(a.project_id, {"planned": 0.0, "tentative": 0.0})
                if a.state == "tentative":
                    entry["tentative"] += m
                    tentative += m
                else:
                    entry["planned"] += m
                    planned += m
            planned_i = int(round(planned))
            act = actual.get((u.id, ws), 0)
            ratio = (planned_i / net) if net else None
            util = (act / net) if net else None
            leave_days = [str(d) for d in daterange(ws, we) if days[d]["leave"]]
            holidays = [{"date": str(d), "reason": days[d]["holiday"]} for d in daterange(ws, we) if days[d]["holiday"]]
            flags = []
            if (net == 0 and planned_i > 0) or (ratio is not None and ratio > 1.0001):
                over = planned_i - net
                flags.append({"kind": "over_allocated", "label": f"Over by {format_minutes(over)}"})
                if leave_days:
                    flags.append({"kind": "leave_conflict", "label": f"Leave {len(leave_days)} day(s)"})
                elif holidays:
                    flags.append({"kind": "holiday_conflict", "label": f"Holiday {holidays[0]['reason']}"})
            elif ratio is not None and 0 < ratio < 0.5:
                flags.append({"kind": "under_allocated", "label": "Under-allocated"})
            cell = {
                "weekStart": str(ws), "week": iso_week(ws), "gross": gross, "net": net, "planned": planned_i,
                "tentative": int(round(tentative)), "available": net - planned_i, "actual": act,
                "allocationRatio": ratio, "utilization": util, "leaveDays": leave_days, "holidays": holidays,
                "flags": flags,
                "byProject": [{"projectId": str(pid), "key": projects[pid].key, "name": projects[pid].name,
                               "color": projects[pid].color, "planned": int(round(v["planned"])),
                               "tentative": int(round(v["tentative"])),
                               "actual": actual_by_project.get((u.id, ws, pid), 0)}
                              for pid, v in by_project.items()],
            }
            cells.append(cell)
            t = team_totals[str(ws)]
            t["net"] += net
            t["planned"] += planned_i
            t["actual"] += act
            kinds = {f["kind"] for f in flags}
            if "over_allocated" in kinds:
                pct = "∞" if ratio is None else f"{round(ratio * 100)}%"
                conflicts.append({
                    "kind": "leave_conflict" if "leave_conflict" in kinds else "over_allocated",
                    "userId": str(u.id), "user": u.display_name, "weekStart": str(ws), "week": iso_week(ws),
                    "ratio": ratio, "title": f"{u.display_name} · W{iso_week(ws)} at {pct}",
                    "detail": _conflict_detail(cell, projects),
                })
        rows.append({
            "user": {"id": str(u.id), "name": u.display_name, "initials": u.initials},
            "profile": {"title": prof.title if prof else "", "skills": prof.skills if prof else [],
                        "teamId": str(prof.team_id) if prof and prof.team_id else None,
                        "location": prof.location if prof else ""},
            "weeks": cells,
        })
    conflicts.extend(_skills_gaps(db, p, people, profiles, projects))
    return {
        "from": str(start), "to": str(end),
        "weeks": [{"weekStart": str(w), "week": iso_week(w), "label": f"W{iso_week(w)} · "
                   f"{w:%-d}–{(w + timedelta(days=6)):%-d %b}"} for w in week_starts],
        "rows": rows,
        "teamTotals": [{"weekStart": k, **v, "ratio": (v["planned"] / v["net"]) if v["net"] else None}
                       for k, v in team_totals.items()],
        "conflicts": conflicts,
        "definitions": {
            "netCapacity": "calendar hours − approved leave − holidays − reserved time",
            "allocationRatio": "planned ÷ net; over 100% is over-allocation",
            "utilization": "actual ÷ net; N/A when net is zero",
        },
    }


def _conflict_detail(cell: dict, projects: dict) -> str:
    parts = [f"{projects[uuid.UUID(b['projectId'])].name} {format_minutes(b['planned'])}" for b in cell["byProject"]]
    if cell["leaveDays"]:
        reason = (f"Approved leave on {len(cell['leaveDays'])} day(s) drops net capacity to "
                  f"{format_minutes(cell['net'])}; {format_minutes(cell['planned'])} is still allocated.")
    elif cell["holidays"]:
        reason = (f"Holiday ({cell['holidays'][0]['reason']}) drops net capacity to {format_minutes(cell['net'])}; "
                  f"move {format_minutes(cell['planned'] - cell['net'])} or reassign.")
    else:
        reason = f"Allocations overlap: {', '.join(parts)} against {format_minutes(cell['net'])} net."
    return reason


def _skills_gaps(db: Session, p: Principal, people: list[User], profiles: dict, projects: dict) -> list[dict]:
    pool_skills = {s.lower() for u in people if profiles.get(u.id) for s in profiles[u.id].skills}
    out = []
    candidate_projects = list(db.scalars(select(Project).where(Project.organization_id == p.org.id,
                                                               Project.status == "active")))
    for pr in candidate_projects:
        if not access.can_view_aggregates(p, pr) and not p.has_global("resource_manager"):
            continue
        for skill in project_settings(pr).get("required_skills") or []:
            if skill.lower() not in pool_skills:
                out.append({"kind": "skills_gap", "projectId": str(pr.id),
                            "title": f"{pr.name} needs {skill}",
                            "detail": "No one in the selected pool lists this skill. Request from another pool."})
    return out


# ---------------------------------------------------------------- commands

def _parse_d(v, fld) -> date:
    try:
        return date.fromisoformat(str(v))
    except (TypeError, ValueError) as exc:
        raise field_error(fld, "Use YYYY-MM-DD") from exc


def save_allocation(db: Session, p: Principal, data: dict, allocation: Allocation | None = None) -> Allocation:
    project_id = uuid.UUID(str(data.get("projectId") or (allocation.project_id if allocation else "")))
    project = db.get(Project, project_id)
    if project is None or project.organization_id != p.org.id:
        raise field_error("projectId", "Project not found")
    access.require(access.can_manage_allocations(p, project_id),
                   "Only the project's manager or a resource manager can allocate people to this project")
    user_id = uuid.UUID(str(data.get("userId") or (allocation.user_id if allocation else "")))
    user = db.get(User, user_id)
    if user is None or user.organization_id != p.org.id:
        raise field_error("userId", "Person not found")
    start = _parse_d(data.get("startDate", allocation.start_date if allocation else None), "startDate")
    end = _parse_d(data.get("endDate", allocation.end_date if allocation else None), "endDate")
    if end < start:
        raise field_error("endDate", "End date must be on or after start date")
    unit = data.get("unit", allocation.unit if allocation else "hours")
    if unit not in {"hours", "percent"}:
        raise field_error("unit", "Unit must be hours or percent")
    state = data.get("state", allocation.state if allocation else "confirmed")
    if state not in {"tentative", "confirmed", "cancelled"}:
        raise field_error("state", "State must be tentative, confirmed or cancelled")
    errors = {}
    minutes_per_week = percent = None
    if unit == "hours":
        try:
            minutes_per_week = int(round(float(data.get("hoursPerWeek", (allocation.minutes_per_week or 0) / 60
                                                         if allocation else 0)) * 60))
        except (TypeError, ValueError):
            minutes_per_week = -1
        if minutes_per_week <= 0 or minutes_per_week > 80 * 60:
            errors["hoursPerWeek"] = ["Enter between 0.5 and 80 hours per week"]
    else:
        try:
            percent = int(data.get("percent", allocation.percent if allocation else 0))
        except (TypeError, ValueError):
            percent = -1
        if not 1 <= percent <= 100:
            errors["percent"] = ["Enter a percentage between 1 and 100"]
    if errors:
        raise ValidationFailed("The allocation is not valid", errors=errors)
    is_new = allocation is None
    if is_new:
        allocation = Allocation(created_by=p.id, user_id=user_id, project_id=project_id)
        db.add(allocation)
    before = None if is_new else {"start": allocation.start_date, "end": allocation.end_date,
                                  "mpw": allocation.minutes_per_week, "pct": allocation.percent,
                                  "state": allocation.state}
    allocation.user_id, allocation.project_id = user_id, project_id
    allocation.start_date, allocation.end_date, allocation.unit = start, end, unit
    allocation.minutes_per_week, allocation.percent, allocation.state = minutes_per_week, percent, state
    allocation.role = data.get("role", allocation.role or "")
    allocation.notes = data.get("notes", allocation.notes or "")
    sid = data.get("sprintId")
    allocation.sprint_id = uuid.UUID(str(sid)) if sid else allocation.sprint_id
    db.flush()
    audit(db, p.id, "allocation.created" if is_new else "allocation.updated", "allocation", allocation.id,
          org_id=p.org.id, project_id=project_id, user_id=user_id, before=before, state=state,
          minutes_per_week=minutes_per_week, percent=percent, start=start, end=end)
    emit(db, "AllocationChanged", "allocation", allocation.id, user_id=user_id, project_id=project_id,
         actor_id=p.id, state=state)
    return allocation


def save_leave(db: Session, p: Principal, data: dict) -> Leave:
    user_id = uuid.UUID(str(data.get("userId") or p.id))
    privileged = p.is_admin or p.has_global("resource_manager")
    if user_id != p.id and not privileged:
        raise Forbidden("You can only record your own leave")
    start, end = _parse_d(data.get("startDate"), "startDate"), _parse_d(data.get("endDate"), "endDate")
    if end < start:
        raise field_error("endDate", "End date must be on or after start date")
    state = "approved" if privileged else "requested"
    lv = Leave(user_id=user_id, start_date=start, end_date=end, state=state, reason=data.get("reason") or "Leave",
               created_by=p.id)
    db.add(lv)
    db.flush()
    audit(db, p.id, "leave.created", "leave", lv.id, org_id=p.org.id, user_id=user_id, state=state)
    emit(db, "AllocationChanged", "leave", lv.id, user_id=user_id, actor_id=p.id, state=state)
    return lv


def decide_leave(db: Session, p: Principal, lv: Leave, approve: bool) -> Leave:
    access.require(p.is_admin or p.has_global("resource_manager"), "Only resource managers approve leave")
    lv.state = "approved" if approve else "cancelled"
    audit(db, p.id, f"leave.{lv.state}", "leave", lv.id, org_id=p.org.id)
    return lv


def team_list(db: Session, p: Principal) -> list[dict]:
    return [{"id": str(t.id), "name": t.name} for t in db.scalars(
        select(Team).where(Team.organization_id == p.org.id).order_by(Team.name))]
