"""Universal time logging, timesheets and approvals (C4, BR-TIME-01..12).

One TimeEntry model powers ticket views, timesheets, approvals and reports. Every work-item type gets the
same Log Work behaviour because it is implemented here against WorkItem, not per type.
"""

import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed, field_error
from app.core.events import audit, emit
from app.core.security import Principal
from app.core.timeutil import format_minutes, parse_duration, today_in, week_start
from app.db import utcnow
from app.modules.identity.models import DEFAULT_ORG_SETTINGS, Organization, ProjectMembership, User
from app.modules.time.models import (
    APPROVED,
    DRAFT,
    PERIOD_APPROVED,
    PERIOD_LOCKED,
    PERIOD_OPEN,
    PERIOD_SUBMITTED,
    REJECTED,
    REPORTING_POLICIES,
    SUBMITTED,
    VOIDED,
    TimeEntry,
    TimeEntryCorrection,
    TimesheetPeriod,
)
from app.modules.work.models import Project, WorkItem
from app.modules.work.service import _record, descendant_ids, project_settings

REMAINING_ACTIONS = {"REDUCE_AUTOMATICALLY", "KEEP_CURRENT", "SET_NEW"}
EDITABLE_STATES = {DRAFT, SUBMITTED, REJECTED}
COUNTABLE_STATES = {DRAFT, SUBMITTED, APPROVED}  # valid entries; rejected / voided never count


def reporting_policy(org: Organization) -> str:
    policy = (org.settings or {}).get("reporting_policy") or DEFAULT_ORG_SETTINGS["reporting_policy"]
    return policy if policy in REPORTING_POLICIES else "approved_submitted"


# ---------------------------------------------------------------- periods

def get_or_create_period(db: Session, user_id: uuid.UUID, d: date) -> TimesheetPeriod:
    """Atomic upsert: concurrent requests for the same user/week never collide on the unique constraint."""
    start = week_start(d)
    db.execute(pg_insert(TimesheetPeriod).values(
        id=uuid.uuid4(), user_id=user_id, period_start=start, period_end=start + timedelta(days=6),
        state=PERIOD_OPEN, created_at=utcnow(), updated_at=utcnow(),
    ).on_conflict_do_nothing(index_elements=["user_id", "period_start"]))
    return db.scalar(select(TimesheetPeriod).where(TimesheetPeriod.user_id == user_id,
                                                   TimesheetPeriod.period_start == start))


def _assert_period_open(db: Session, user_id: uuid.UUID, d: date) -> TimesheetPeriod:
    period = get_or_create_period(db, user_id, d)
    if period.state == PERIOD_LOCKED:
        raise ValidationFailed(
            f"The period {period.period_start:%d %b}–{period.period_end:%d %b} is locked. "
            "Ask an approver to reopen it or request an amendment.",
            code="period_locked", errors={"workDate": ["Period is locked"]},
        )
    return period


# ---------------------------------------------------------------- validation

def _validate_entry_fields(db: Session, p: Principal, project: Project, user_id: uuid.UUID, work_date: date,
                           minutes: int, activity: str, description: str,
                           exclude_entry: uuid.UUID | None = None) -> None:
    rules = project_settings(project)["time"]
    errors: dict[str, list[str]] = {}
    today = today_in(p.org.timezone)
    if work_date > today + timedelta(days=rules["allow_future_days"]):
        errors.setdefault("workDate", []).append("Work date cannot be in the future")
    if work_date < today - timedelta(days=rules["backdate_days"]):
        errors.setdefault("workDate", []).append(
            f"Backdating is allowed up to {rules['backdate_days']} days for this project")
    if minutes <= 0:
        errors.setdefault("durationMinutes", []).append("Duration must be positive")
    elif minutes > rules["max_entry_minutes"]:
        errors.setdefault("durationMinutes", []).append(
            f"A single entry can be at most {format_minutes(rules['max_entry_minutes'])}")
    if activity not in rules["activity_categories"]:
        errors.setdefault("activityCategory", []).append("Choose an activity from the list")
    if len((description or "").strip()) < rules["min_description_length"]:
        errors.setdefault("description", []).append(
            f"Required by project policy · min {rules['min_description_length']} characters")
    if not errors and minutes > 0:
        q = select(func.coalesce(func.sum(TimeEntry.duration_minutes), 0)).where(
            TimeEntry.user_id == user_id, TimeEntry.work_date == work_date,
            TimeEntry.approval_status.in_(COUNTABLE_STATES))
        if exclude_entry:
            q = q.where(TimeEntry.id != exclude_entry)
        day_total = db.scalar(q) or 0
        if day_total + minutes > rules["max_daily_minutes"]:
            errors.setdefault("durationMinutes", []).append(
                f"Daily limit is {format_minutes(rules['max_daily_minutes'])}; "
                f"{format_minutes(day_total)} already logged on {work_date:%a %d %b}")
    if errors:
        raise ValidationFailed("The time entry is not valid", errors=errors)


def _parse_minutes(value: Any, fld: str = "durationMinutes") -> int:
    if value is None or value == "":
        raise field_error(fld, "Duration is required")
    try:
        return parse_duration(value)
    except ValueError as exc:
        raise field_error(fld, str(exc)) from exc


def _parse_date(value: Any, fld: str = "workDate") -> date:
    if not value:
        raise field_error(fld, "Work date is required")
    try:
        return value if isinstance(value, date) else date.fromisoformat(str(value))
    except ValueError as exc:
        raise field_error(fld, "Use YYYY-MM-DD") from exc


# ---------------------------------------------------------------- log work

def log_work(db: Session, p: Principal, item: WorkItem, data: dict, idempotency_key: str, source: str = "web") -> TimeEntry:
    project = db.get(Project, item.project_id)
    access.require(access.can_log_work(p, project.id), "You do not have Log Work permission on this project")
    user_id = p.id
    if data.get("userId") and str(data["userId"]) != str(p.id):
        access.require(access.can_edit_others_time(p, project), "You cannot log time for another person")
        user_id = uuid.UUID(str(data["userId"]))
        if not db.scalar(select(ProjectMembership.id).where(ProjectMembership.project_id == project.id,
                                                            ProjectMembership.user_id == user_id)):
            raise field_error("userId", "Person is not a member of this project")

    # Backstop for idempotency: the DB unique constraint (user_id, idempotency_key) also enforces this.
    existing = db.scalar(select(TimeEntry).where(TimeEntry.user_id == user_id,
                                                 TimeEntry.idempotency_key == idempotency_key))
    if existing:
        return existing

    work_date = _parse_date(data.get("workDate"))
    minutes = _parse_minutes(data.get("durationMinutes", data.get("duration")))
    activity = data.get("activityCategory") or ""
    description = data.get("description") or ""
    action = data.get("remainingEstimateAction") or "REDUCE_AUTOMATICALLY"
    if action not in REMAINING_ACTIONS:
        raise field_error("remainingEstimateAction", "Choose reduce automatically, keep current or set new")
    new_remaining = None
    if action == "SET_NEW":
        new_remaining = _parse_minutes(data.get("remainingEstimateMinutes"), "remainingEstimateMinutes")
        if new_remaining < 0:
            raise field_error("remainingEstimateMinutes", "Remaining estimate cannot be negative")

    _validate_entry_fields(db, p, project, user_id, work_date, minutes, activity, description)
    period = _assert_period_open(db, user_id, work_date)

    entry = TimeEntry(
        work_item_id=item.id, project_id=project.id, user_id=user_id, work_date=work_date,
        duration_minutes=minutes, activity_category=activity, description=description.strip(),
        approval_status=DRAFT, source=source, idempotency_key=idempotency_key, created_by=p.id, updated_by=p.id,
    )
    db.add(entry)
    db.flush()
    if period.state in {PERIOD_SUBMITTED, PERIOD_APPROVED}:
        period.state = PERIOD_OPEN  # new draft time needs resubmission

    _apply_remaining(db, p, project, item, action, minutes, new_remaining)
    # BR-TIME-05: logging time never changes ticket status.
    audit(db, p.id, "time_entry.created", "time_entry", entry.id, org_id=p.org.id, project_id=project.id,
          work_item=item.key, minutes=minutes, work_date=work_date, on_behalf_of=None if user_id == p.id else user_id)
    emit(db, "TimeEntryCreated", "time_entry", entry.id, work_item_id=item.id, project_id=project.id,
         user_id=user_id, minutes=minutes)
    return entry


def _apply_remaining(db: Session, p: Principal, project: Project, item: WorkItem, action: str, minutes: int,
                     new_remaining: int | None) -> None:
    allow_negative = project_settings(project)["time"]["allow_negative_remaining"]
    old = item.remaining_estimate_minutes
    if action == "REDUCE_AUTOMATICALLY":
        if old is None:
            return
        new = old - minutes
        if not allow_negative:
            new = max(new, 0)  # BR-TIME-04 lower bound of zero
    elif action == "SET_NEW":
        new = new_remaining
    else:
        return
    if new != old:
        _record(db, item, p.id, "remaining_estimate_minutes", old, new, f"Log work · {action.lower()}")
        item.remaining_estimate_minutes = new
        item.updated_by = p.id


def _own_or_permitted(db: Session, p: Principal, entry: TimeEntry) -> Project:
    project = db.get(Project, entry.project_id)
    if not access.can_view_project(p, project):
        raise NotFound("Time entry not found")
    if entry.user_id != p.id and not access.can_edit_others_time(p, project):
        raise Forbidden("You can only change your own time entries")
    return project


def edit_entry(db: Session, p: Principal, entry: TimeEntry, changes: dict, expected_version: int | None) -> TimeEntry:
    project = _own_or_permitted(db, p, entry)
    if entry.approval_status == APPROVED:
        raise ValidationFailed("Approved entries change only through an amendment request",
                               code="amendment_required")
    if entry.approval_status not in EDITABLE_STATES:
        raise ValidationFailed("This entry can no longer be edited", code="entry_not_editable")
    if expected_version is not None and expected_version != entry.version:
        raise Conflict("This entry changed since you opened it", code="version_conflict")
    _assert_period_open(db, entry.user_id, entry.work_date)
    work_date = _parse_date(changes["workDate"]) if "workDate" in changes else entry.work_date
    minutes = _parse_minutes(changes["durationMinutes"]) if "durationMinutes" in changes else entry.duration_minutes
    activity = changes.get("activityCategory", entry.activity_category)
    description = changes.get("description", entry.description)
    _validate_entry_fields(db, p, project, entry.user_id, work_date, minutes, activity, description,
                           exclude_entry=entry.id)
    if work_date != entry.work_date:
        _assert_period_open(db, entry.user_id, work_date)
    before = {"workDate": entry.work_date, "minutes": entry.duration_minutes, "activity": entry.activity_category,
              "status": entry.approval_status}
    entry.work_date, entry.duration_minutes = work_date, minutes
    entry.activity_category, entry.description = activity, description.strip()
    if entry.approval_status == REJECTED:
        entry.approval_status = DRAFT  # corrected -> resubmit
        entry.rejection_reason = None
    entry.updated_by = p.id
    audit(db, p.id, "time_entry.updated", "time_entry", entry.id, org_id=p.org.id, project_id=project.id,
          before=before, after={"workDate": work_date, "minutes": minutes, "activity": activity,
                                "status": entry.approval_status},
          on_behalf_of=None if entry.user_id == p.id else entry.user_id)
    return entry


def void_entry(db: Session, p: Principal, entry: TimeEntry, reason: str) -> TimeEntry:
    project = _own_or_permitted(db, p, entry)
    if entry.approval_status == APPROVED:
        raise ValidationFailed("Approved entries are reversed through an amendment request",
                               code="amendment_required")
    if entry.approval_status == VOIDED:
        return entry
    _assert_period_open(db, entry.user_id, entry.work_date)
    entry.approval_status = VOIDED
    entry.voided_reason = reason or "Voided by owner"
    entry.updated_by = p.id
    audit(db, p.id, "time_entry.voided", "time_entry", entry.id, org_id=p.org.id, project_id=project.id,
          reason=entry.voided_reason)
    return entry


# ---------------------------------------------------------------- amendments

def request_amendment(db: Session, p: Principal, entry: TimeEntry, data: dict) -> TimeEntryCorrection:
    project = _own_or_permitted(db, p, entry)
    if entry.approval_status != APPROVED:
        raise ValidationFailed("Only approved entries need an amendment; edit unapproved entries directly",
                               code="not_approved")
    if db.scalar(select(TimeEntryCorrection.id).where(TimeEntryCorrection.time_entry_id == entry.id,
                                                      TimeEntryCorrection.state == "requested")):
        raise Conflict("An amendment is already pending for this entry", code="amendment_pending")
    reason = (data.get("reason") or "").strip()
    if len(reason) < 5:
        raise field_error("reason", "Explain why the approved entry needs to change")
    after: dict[str, Any] = {}
    if not data.get("reversal"):
        after = {
            "workDate": str(_parse_date(data.get("workDate", entry.work_date))),
            "durationMinutes": _parse_minutes(data.get("durationMinutes", entry.duration_minutes)),
            "activityCategory": data.get("activityCategory", entry.activity_category),
            "description": data.get("description", entry.description),
            "workItemId": str(data.get("workItemId") or entry.work_item_id),
        }
    corr = TimeEntryCorrection(
        time_entry_id=entry.id, requested_by=p.id, reason=reason,
        before_values={"workDate": str(entry.work_date), "durationMinutes": entry.duration_minutes,
                       "activityCategory": entry.activity_category, "description": entry.description,
                       "workItemId": str(entry.work_item_id)},
        after_values=after,
    )
    db.add(corr)
    db.flush()
    audit(db, p.id, "time_entry.amendment_requested", "time_entry", entry.id, org_id=p.org.id,
          project_id=project.id, correction_id=corr.id, reversal=not after)
    emit(db, "TimeAmendmentRequested", "time_entry", entry.id, project_id=project.id, correction_id=corr.id,
         user_id=entry.user_id)
    return corr


def decide_amendment(db: Session, p: Principal, corr: TimeEntryCorrection, approve: bool, reason: str | None) -> TimeEntryCorrection:
    entry = db.get(TimeEntry, corr.time_entry_id)
    project = db.get(Project, entry.project_id)
    access.require(access.can_approve_time(p, project.id), "Only the project's time approver can decide amendments")
    if entry.user_id == p.id and not p.is_admin:
        raise Forbidden("You cannot approve your own amendment")
    if corr.state != "requested":
        return corr
    corr.state = "approved" if approve else "rejected"
    corr.decided_by, corr.decided_at, corr.decision_reason = p.id, utcnow(), reason
    if approve:
        entry.approval_status = VOIDED
        entry.voided_reason = f"Superseded by amendment {corr.id}"
        if corr.after_values:
            av = corr.after_values
            target_item = db.get(WorkItem, uuid.UUID(av["workItemId"]))
            replacement = TimeEntry(
                work_item_id=target_item.id, project_id=target_item.project_id, user_id=entry.user_id,
                work_date=date.fromisoformat(av["workDate"]), duration_minutes=int(av["durationMinutes"]),
                activity_category=av["activityCategory"], description=av["description"],
                approval_status=APPROVED, approved_by=p.id, approved_at=utcnow(), submitted_at=utcnow(),
                source="amendment", idempotency_key=f"amendment:{corr.id}", corrects_entry_id=entry.id,
                created_by=p.id,
            )
            db.add(replacement)
            db.flush()
            corr.replacement_entry_id = replacement.id
    audit(db, p.id, f"time_entry.amendment_{corr.state}", "time_entry", entry.id, org_id=p.org.id,
          project_id=project.id, correction_id=corr.id, reason=reason)
    emit(db, "TimeAmendmentDecided", "time_entry", entry.id, user_id=entry.user_id, state=corr.state,
         project_id=project.id)
    return corr


# ---------------------------------------------------------------- submit / approve / lock

def expected_minutes_by_day(db: Session, user_id: uuid.UUID, start: date, end: date) -> dict[date, int]:
    from app.modules.resources.service import net_capacity_by_day

    return net_capacity_by_day(db, user_id, start, end)


def submit_period(db: Session, p: Principal, user_id: uuid.UUID, start: date, confirm_missing: bool) -> dict:
    if user_id != p.id and not p.is_admin:
        raise Forbidden("You can only submit your own timesheet")
    period = get_or_create_period(db, user_id, start)
    if period.state == PERIOD_LOCKED:
        raise ValidationFailed("This period is locked", code="period_locked")
    entries = list(db.scalars(select(TimeEntry).where(
        TimeEntry.user_id == user_id, TimeEntry.work_date.between(period.period_start, period.period_end))))
    rejected = [e for e in entries if e.approval_status == REJECTED]
    if rejected:
        raise ValidationFailed(
            f"{len(rejected)} rejected entr{'y' if len(rejected) == 1 else 'ies'} must be corrected or voided first",
            code="rejected_entries_outstanding", errors={"entries": [str(e.id) for e in rejected]})
    expected = expected_minutes_by_day(db, user_id, period.period_start, period.period_end)
    logged: dict[date, int] = defaultdict(int)
    for e in entries:
        if e.approval_status in COUNTABLE_STATES:
            logged[e.work_date] += e.duration_minutes
    missing = {d: expected[d] - logged[d] for d in expected if expected[d] > logged[d]}
    if missing and not confirm_missing:
        raise ValidationFailed(
            f"{format_minutes(sum(missing.values()))} is missing against your work calendar. "
            "Log it or confirm to submit anyway.",
            code="missing_time", errors={str(d): [format_minutes(m) + " missing"] for d, m in sorted(missing.items())})
    drafts = [e for e in entries if e.approval_status == DRAFT]
    if not drafts and not any(e.approval_status == SUBMITTED for e in entries):
        raise ValidationFailed("There is nothing to submit for this period", code="nothing_to_submit")
    now = utcnow()
    by_project: dict[uuid.UUID, list[TimeEntry]] = defaultdict(list)
    for e in drafts:
        e.approval_status = SUBMITTED
        e.submitted_at = now
        by_project[e.project_id].append(e)
    for project_id, es in by_project.items():
        project = db.get(Project, project_id)
        if not project_settings(project)["time"]["approval_required"]:
            for e in es:
                e.approval_status, e.approved_at = APPROVED, now
        emit(db, "TimeEntrySubmitted", "timesheet_period", period.id, user_id=user_id, project_id=project_id,
             count=len(es), minutes=sum(e.duration_minutes for e in es), period_start=period.period_start)
    period.state = PERIOD_SUBMITTED
    period.submitted_at = now
    _refresh_period_state(db, period)
    audit(db, p.id, "timesheet.submitted", "timesheet_period", period.id, org_id=p.org.id,
          entries=len(drafts), missing_minutes=sum(missing.values()), confirmed_missing=bool(missing))
    return {"periodId": str(period.id), "submitted": len(drafts), "state": period.state,
            "missingMinutes": sum(missing.values())}


def _refresh_period_state(db: Session, period: TimesheetPeriod) -> None:
    if period.state == PERIOD_LOCKED:
        return
    db.flush()
    states = set(db.scalars(select(TimeEntry.approval_status).where(
        TimeEntry.user_id == period.user_id, TimeEntry.work_date.between(period.period_start, period.period_end),
        TimeEntry.approval_status != VOIDED)))
    if states and states == {APPROVED}:
        period.state = PERIOD_APPROVED
        period.approved_at = period.approved_at or utcnow()
    elif DRAFT in states or REJECTED in states:
        period.state = PERIOD_OPEN
    elif SUBMITTED in states:
        period.state = PERIOD_SUBMITTED


def decide_period(db: Session, p: Principal, period: TimesheetPeriod, data: dict) -> dict:
    project_id = uuid.UUID(str(data.get("projectId") or ""))
    project = db.get(Project, project_id)
    if project is None:
        raise field_error("projectId", "Project not found")
    access.require(access.can_approve_time(p, project_id), "You are not the time approver for this project")
    if period.user_id == p.id and not p.is_admin:
        raise Forbidden("You cannot approve your own time")
    decision = data.get("decision")
    if decision not in {"approve", "reject", "request_correction"}:
        raise field_error("decision", "Decision must be approve, reject or request_correction")
    reason = (data.get("reason") or "").strip()
    if decision != "approve" and not reason:
        raise field_error("reason", "A reason is mandatory when rejecting")
    q = select(TimeEntry).where(
        TimeEntry.user_id == period.user_id, TimeEntry.project_id == project_id,
        TimeEntry.work_date.between(period.period_start, period.period_end), TimeEntry.approval_status == SUBMITTED)
    if data.get("entryIds"):
        q = q.where(TimeEntry.id.in_([uuid.UUID(str(i)) for i in data["entryIds"]]))
    entries = list(db.scalars(q))
    if not entries:
        raise ValidationFailed("No submitted entries to decide for this project and period", code="nothing_to_decide")
    now = utcnow()
    for e in entries:
        # Bulk approval still records one outcome per entry.
        if decision == "approve":
            e.approval_status, e.approved_by, e.approved_at = APPROVED, p.id, now
        else:
            e.approval_status, e.rejection_reason, e.approved_by = REJECTED, reason, p.id
        audit(db, p.id, f"time_entry.{'approved' if decision == 'approve' else 'rejected'}", "time_entry", e.id,
              org_id=p.org.id, project_id=project_id, minutes=e.duration_minutes, reason=reason or None)
    emit(db, "TimeEntryApproved" if decision == "approve" else "TimeEntryRejected", "timesheet_period", period.id,
         user_id=period.user_id, project_id=project_id, count=len(entries), reason=reason or None,
         approver_id=p.id, period_start=period.period_start)
    period.approver_id = p.id
    _refresh_period_state(db, period)
    return {"decided": len(entries), "decision": decision, "periodState": period.state}


def lock_period(db: Session, p: Principal, period: TimesheetPeriod) -> TimesheetPeriod:
    project_ids = set(db.scalars(select(TimeEntry.project_id).where(
        TimeEntry.user_id == period.user_id, TimeEntry.work_date.between(period.period_start, period.period_end),
        TimeEntry.approval_status != VOIDED)))
    if not (p.is_admin or (project_ids and all(access.can_approve_time(p, pid) for pid in project_ids))):
        raise Forbidden("Only approvers for every project in this period (or an admin) can lock it")
    _refresh_period_state(db, period)
    if period.state != PERIOD_APPROVED:
        raise ValidationFailed("Only fully approved periods can be locked", code="not_approved")
    period.state, period.locked_at, period.locked_by = PERIOD_LOCKED, utcnow(), p.id
    audit(db, p.id, "timesheet.locked", "timesheet_period", period.id, org_id=p.org.id)
    return period


def reopen_period(db: Session, p: Principal, period: TimesheetPeriod, reason: str) -> TimesheetPeriod:
    # Privileged, audited reopen (BR-TIME-07).
    access.require(p.is_admin or p.has_global("resource_manager"), "Reopening a locked period is a privileged action")
    if not reason or len(reason.strip()) < 5:
        raise field_error("reason", "A reason is required to reopen a locked period")
    if period.state != PERIOD_LOCKED:
        raise ValidationFailed("Period is not locked", code="not_locked")
    period.state, period.reopen_reason, period.locked_at = PERIOD_APPROVED, reason.strip(), None
    audit(db, p.id, "timesheet.reopened", "timesheet_period", period.id, org_id=p.org.id, reason=reason.strip())
    return period


# ---------------------------------------------------------------- read models

def effort_for_items(db: Session, item_ids: list[uuid.UUID], states: set[str]) -> dict[uuid.UUID, int]:
    if not item_ids:
        return {}
    rows = db.execute(select(TimeEntry.work_item_id, func.sum(TimeEntry.duration_minutes))
                      .where(TimeEntry.work_item_id.in_(item_ids), TimeEntry.approval_status.in_(states))
                      .group_by(TimeEntry.work_item_id)).all()
    return {r[0]: int(r[1]) for r in rows}


def hierarchy_totals(db: Session, items: list[WorkItem], states: set[str],
                     date_from: date | None = None, date_to: date | None = None) -> dict[uuid.UUID, dict]:
    """Direct + descendant + total per item, each entry counted exactly once (BR-TIME-09/10)."""
    roots = [i.id for i in items]
    desc = descendant_ids(db, roots)
    all_ids = set(roots) | {d for ds in desc.values() for d in ds}
    q = select(TimeEntry.work_item_id, func.sum(TimeEntry.duration_minutes)).where(
        TimeEntry.work_item_id.in_(all_ids), TimeEntry.approval_status.in_(states))
    if date_from:
        q = q.where(TimeEntry.work_date >= date_from)
    if date_to:
        q = q.where(TimeEntry.work_date <= date_to)
    direct = {r[0]: int(r[1]) for r in db.execute(q.group_by(TimeEntry.work_item_id)).all()}
    out = {}
    for root in roots:
        d = direct.get(root, 0)
        ds = sum(direct.get(x, 0) for x in set(desc.get(root, [])))
        out[root] = {"direct": d, "descendants": ds, "total": d + ds}
    return out


def week_view(db: Session, p: Principal, user: User, start: date) -> dict:
    from app.modules.resources.service import allocation_minutes_by_project

    start = week_start(start)
    end = start + timedelta(days=6)
    period = db.scalar(select(TimesheetPeriod).where(TimesheetPeriod.user_id == user.id,
                                                     TimesheetPeriod.period_start == start))
    entries = list(db.scalars(select(TimeEntry).where(
        TimeEntry.user_id == user.id, TimeEntry.work_date.between(start, end),
        TimeEntry.approval_status != VOIDED).order_by(TimeEntry.work_date, TimeEntry.created_at)))
    item_ids = {e.work_item_id for e in entries}
    items = {i.id: i for i in db.scalars(select(WorkItem).where(WorkItem.id.in_(item_ids)))} if item_ids else {}
    project_ids = {e.project_id for e in entries}
    projects = {pr.id: pr for pr in db.scalars(select(Project).where(Project.id.in_(project_ids)))} if project_ids else {}
    expected = expected_minutes_by_day(db, user.id, start, end)
    alloc = allocation_minutes_by_project(db, user.id, start, end)
    pending_corr = {c.time_entry_id for c in db.scalars(select(TimeEntryCorrection).where(
        TimeEntryCorrection.time_entry_id.in_([e.id for e in entries] or [uuid.uuid4()]),
        TimeEntryCorrection.state == "requested"))}

    approvers: dict[uuid.UUID, list[str]] = defaultdict(list)
    for m, u in db.execute(select(ProjectMembership, User).join(User, User.id == ProjectMembership.user_id).where(
            ProjectMembership.project_id.in_(project_ids or [uuid.uuid4()]), ProjectMembership.is_time_approver)):
        approvers[m.project_id].append(u.display_name)

    days = [start + timedelta(days=i) for i in range(7)]
    groups: dict[uuid.UUID, dict] = {}
    totals = defaultdict(int)
    day_logged = defaultdict(int)
    day_states: dict[date, set] = defaultdict(set)
    for e in entries:
        item = items[e.work_item_id]
        pr = projects[e.project_id]
        g = groups.setdefault(pr.id, {
            "project": {"id": str(pr.id), "key": pr.key, "name": pr.name, "kind": pr.kind, "color": pr.color},
            "approvers": approvers.get(pr.id, []),
            "allocatedMinutes": alloc.get(pr.id, 0), "loggedMinutes": 0, "rows": {}})
        row = g["rows"].setdefault(item.id, {
            "workItem": {"id": str(item.id), "key": item.key, "title": item.title, "type": item.type},
            "cells": {str(d): {"minutes": 0, "entries": []} for d in days}, "totalMinutes": 0})
        cell = row["cells"][str(e.work_date)]
        cell["entries"].append(serialize_entry(e, amendment_pending=e.id in pending_corr))
        if e.approval_status in COUNTABLE_STATES:
            cell["minutes"] += e.duration_minutes
            row["totalMinutes"] += e.duration_minutes
            g["loggedMinutes"] += e.duration_minutes
            day_logged[e.work_date] += e.duration_minutes
        totals[e.approval_status] += e.duration_minutes
        day_states[e.work_date].add(e.approval_status)

    for pid, minutes in alloc.items():
        if pid not in groups and minutes:
            pr = db.get(Project, pid)
            groups[pid] = {"project": {"id": str(pr.id), "key": pr.key, "name": pr.name, "kind": pr.kind,
                                       "color": pr.color},
                           "approvers": approvers.get(pid, []), "allocatedMinutes": minutes, "loggedMinutes": 0,
                           "rows": {}}

    def day_status(d: date) -> dict:
        exp = expected.get(d, 0)
        st = day_states.get(d, set())
        if exp == 0 and not st:
            return {"label": "Non-working", "tone": "muted"}
        if REJECTED in st:
            n = sum(1 for e in entries if e.work_date == d and e.approval_status == REJECTED)
            return {"label": f"{n} rejected", "tone": "danger"}
        if day_logged[d] < exp and d <= today_in(p.org.timezone):
            return {"label": f"{format_minutes(exp - day_logged[d])} missing", "tone": "warning"}
        if st and st <= {APPROVED}:
            return {"label": "Approved", "tone": "success"}
        if SUBMITTED in st and DRAFT not in st:
            return {"label": "Submitted", "tone": "info"}
        if DRAFT in st:
            return {"label": "Draft", "tone": "neutral"}
        return {"label": "Open", "tone": "neutral"}

    logged = sum(day_logged.values())
    exp_total = sum(expected.values())
    rejected_entries = [
        {**serialize_entry(e), "workItem": {"key": items[e.work_item_id].key, "title": items[e.work_item_id].title}}
        for e in entries if e.approval_status == REJECTED]
    tz = p.org.timezone
    return {
        "user": {"id": str(user.id), "name": user.display_name},
        "periodStart": str(start), "periodEnd": str(end),
        "period": {"id": str(period.id) if period else None, "state": period.state if period else PERIOD_OPEN,
                   "submittedAt": period.submitted_at if period else None,
                   "lockedAt": period.locked_at if period else None},
        "dueDate": str(end + timedelta(days=1)),
        "timezone": tz,
        "days": [{"date": str(d), "expectedMinutes": expected.get(d, 0), "loggedMinutes": day_logged.get(d, 0),
                  "status": day_status(d)} for d in days],
        "summary": {"logged": logged, "expected": exp_total, "missing": max(exp_total - logged, 0),
                    "approved": totals[APPROVED], "submitted": totals[SUBMITTED], "draft": totals[DRAFT],
                    "rejected": totals[REJECTED]},
        "groups": [{**g, "rows": list(g["rows"].values())} for g in groups.values()],
        "rejectedEntries": rejected_entries,
    }


def serialize_entry(e: TimeEntry, users=None, amendment_pending: bool = False) -> dict:
    return {
        "id": str(e.id), "workItemId": str(e.work_item_id), "projectId": str(e.project_id),
        "userId": str(e.user_id), "user": users.ref(e.user_id) if users else None,
        "workDate": str(e.work_date), "durationMinutes": e.duration_minutes,
        "activityCategory": e.activity_category, "description": e.description,
        "approvalStatus": e.approval_status, "submittedAt": e.submitted_at, "approvedAt": e.approved_at,
        "approvedBy": str(e.approved_by) if e.approved_by else None,
        "rejectionReason": e.rejection_reason, "source": e.source, "createdAt": e.created_at,
        "correctsEntryId": str(e.corrects_entry_id) if e.corrects_entry_id else None,
        "voidedReason": e.voided_reason, "amendmentPending": amendment_pending, "version": e.version,
    }


def approvals_queue(db: Session, p: Principal) -> list[dict]:
    project_ids = [pid for pid, m in p.memberships.items() if m.is_time_approver]
    if not project_ids:
        return []
    rows = db.execute(
        select(TimeEntry.user_id, TimeEntry.project_id, func.min(TimeEntry.work_date),
               func.sum(TimeEntry.duration_minutes), func.count())
        .where(TimeEntry.project_id.in_(project_ids), TimeEntry.approval_status == SUBMITTED,
               TimeEntry.user_id != p.id)
        .group_by(TimeEntry.user_id, TimeEntry.project_id,
                  func.date_trunc("week", TimeEntry.work_date))).all()
    out = []
    for user_id, project_id, first_day, minutes, count in rows:
        period = get_or_create_period(db, user_id, first_day)
        user = db.get(User, user_id)
        project = db.get(Project, project_id)
        entries = list(db.scalars(select(TimeEntry).where(
            TimeEntry.user_id == user_id, TimeEntry.project_id == project_id,
            TimeEntry.approval_status == SUBMITTED,
            TimeEntry.work_date.between(period.period_start, period.period_end)).order_by(TimeEntry.work_date)))
        items = {i.id: i for i in db.scalars(select(WorkItem).where(WorkItem.id.in_({e.work_item_id for e in entries})))}
        out.append({
            "periodId": str(period.id), "periodStart": str(period.period_start), "periodEnd": str(period.period_end),
            "user": {"id": str(user.id), "name": user.display_name, "initials": user.initials},
            "project": {"id": str(project.id), "key": project.key, "name": project.name},
            "minutes": int(minutes), "count": count,
            "entries": [{**serialize_entry(e), "workItem": {"key": items[e.work_item_id].key,
                                                            "title": items[e.work_item_id].title,
                                                            "type": items[e.work_item_id].type}} for e in entries],
        })
    db.commit()
    return sorted(out, key=lambda r: (r["periodStart"], r["user"]["name"]))


def pending_amendments(db: Session, p: Principal) -> list[dict]:
    project_ids = [pid for pid, m in p.memberships.items() if m.is_time_approver]
    if not project_ids:
        return []
    rows = db.execute(select(TimeEntryCorrection, TimeEntry).join(TimeEntry, TimeEntry.id == TimeEntryCorrection.time_entry_id)
                      .where(TimeEntryCorrection.state == "requested", TimeEntry.project_id.in_(project_ids))).all()
    out = []
    for corr, entry in rows:
        item = db.get(WorkItem, entry.work_item_id)
        user = db.get(User, entry.user_id)
        out.append({"id": str(corr.id), "reason": corr.reason, "before": corr.before_values,
                    "after": corr.after_values, "reversal": not corr.after_values, "createdAt": corr.created_at,
                    "user": {"id": str(user.id), "name": user.display_name},
                    "workItem": {"key": item.key, "title": item.title}})
    return out
