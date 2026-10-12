import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access
from app.core.common import UserCache
from app.core.errors import Forbidden, NotFound
from app.core.idempotency import run_idempotent
from app.core.security import Principal, get_principal
from app.core.timeutil import today_in
from app.db import get_db
from app.modules.identity.models import User
from app.modules.time import service as svc
from app.modules.time.models import TimeEntry, TimeEntryCorrection, TimesheetPeriod
from app.modules.work.models import Project
from app.modules.work.service import get_item

router = APIRouter(tags=["time"])


class LogWorkIn(BaseModel):
    workDate: date
    durationMinutes: int | str
    activityCategory: str
    description: str = ""
    remainingEstimateAction: str = "REDUCE_AUTOMATICALLY"
    remainingEstimateMinutes: int | str | None = None
    userId: uuid.UUID | None = None


@router.post("/work-items/{key}/time-entries", status_code=201)
def log_work(key: str, body: LogWorkIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
             x_source: str | None = Header(None, alias="X-Source"),
             p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = get_item(db, p, key)
    data = body.model_dump(mode="json", exclude_none=True)
    source = x_source if x_source in {"web", "api", "mobile", "import"} else "api"

    def action():
        entry = svc.log_work(db, p, item, data, idempotency_key, source=source)
        db.flush()
        return {**svc.serialize_entry(entry), "remainingEstimateMinutes": item.remaining_estimate_minutes}

    return run_idempotent(db, p.id, f"time_entries.create:{item.id}", idempotency_key, data, action, required=True)


@router.get("/work-items/{key}/time-entries")
def list_entries(key: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = get_item(db, p, key)
    entries = list(db.scalars(select(TimeEntry).where(TimeEntry.work_item_id == item.id)
                              .order_by(TimeEntry.work_date.desc(), TimeEntry.created_at.desc())))
    users = UserCache(db)
    users.prime([e.user_id for e in entries])
    return [svc.serialize_entry(e, users) for e in entries]


def _entry(db: Session, p: Principal, entry_id: uuid.UUID) -> TimeEntry:
    e = db.get(TimeEntry, entry_id)
    if e is None or not access.can_view_project(p, db.get(Project, e.project_id)):
        raise NotFound("Time entry not found")
    return e


class EntryPatch(BaseModel):
    workDate: date | None = None
    durationMinutes: int | str | None = None
    activityCategory: str | None = None
    description: str | None = None
    version: int | None = None


@router.patch("/time-entries/{entry_id}")
def edit_entry(entry_id: uuid.UUID, body: EntryPatch, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)):
    e = _entry(db, p, entry_id)
    data = body.model_dump(mode="json", exclude_none=True)
    version = data.pop("version", None)
    svc.edit_entry(db, p, e, data, version)
    db.commit()
    return svc.serialize_entry(e)


class ReasonIn(BaseModel):
    reason: str = ""


@router.post("/time-entries/{entry_id}/void")
def void_entry(entry_id: uuid.UUID, body: ReasonIn, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)):
    e = _entry(db, p, entry_id)
    svc.void_entry(db, p, e, body.reason)
    db.commit()
    return svc.serialize_entry(e)


class AmendmentIn(BaseModel):
    reason: str
    reversal: bool = False
    workDate: date | None = None
    durationMinutes: int | str | None = None
    activityCategory: str | None = None
    description: str | None = None
    workItemId: uuid.UUID | None = None


@router.post("/time-entries/{entry_id}/amendments", status_code=201)
def request_amendment(entry_id: uuid.UUID, body: AmendmentIn, p: Principal = Depends(get_principal),
                      db: Session = Depends(get_db)):
    e = _entry(db, p, entry_id)
    corr = svc.request_amendment(db, p, e, body.model_dump(mode="json", exclude_none=True))
    db.commit()
    return {"id": str(corr.id), "state": corr.state}


@router.get("/amendments")
def list_amendments(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return svc.pending_amendments(db, p)


class DecisionIn(BaseModel):
    decision: str
    reason: str | None = None


@router.post("/amendments/{corr_id}/decision")
def decide_amendment(corr_id: uuid.UUID, body: DecisionIn, p: Principal = Depends(get_principal),
                     db: Session = Depends(get_db)):
    corr = db.get(TimeEntryCorrection, corr_id)
    if corr is None:
        raise NotFound("Amendment not found")
    _entry(db, p, corr.time_entry_id)
    svc.decide_amendment(db, p, corr, body.decision == "approve", body.reason)
    db.commit()
    return {"id": str(corr.id), "state": corr.state}


# ---------------------------------------------------------------- timesheets

def _target_user(db: Session, p: Principal, user_id: uuid.UUID | None) -> User:
    if user_id is None or user_id == p.id:
        return p.user
    if not (p.is_admin or p.has_global("resource_manager")):
        raise Forbidden("You can only view your own timesheet; approvers use the approvals queue")
    u = db.get(User, user_id)
    if u is None or u.organization_id != p.org.id:
        raise NotFound("User not found")
    return u


@router.get("/timesheets/week")
def week(start: date | None = None, user_id: uuid.UUID | None = None, p: Principal = Depends(get_principal),
         db: Session = Depends(get_db)):
    user = _target_user(db, p, user_id)
    result = svc.week_view(db, p, user, start or today_in(p.org.timezone))
    db.commit()
    return result


class SubmitIn(BaseModel):
    weekStart: date
    confirmMissing: bool = False


@router.post("/timesheets/submit")
def submit(body: SubmitIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    result = svc.submit_period(db, p, p.id, body.weekStart, body.confirmMissing)
    db.commit()
    return result


def _period(db: Session, p: Principal, period_id: uuid.UUID) -> TimesheetPeriod:
    period = db.get(TimesheetPeriod, period_id)
    if period is None:
        raise NotFound("Timesheet period not found")
    owner = db.get(User, period.user_id)
    if owner.organization_id != p.org.id:
        raise NotFound("Timesheet period not found")
    return period


@router.post("/timesheets/{period_id}/submit")
def submit_period(period_id: uuid.UUID, confirm_missing: bool = False, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    period = _period(db, p, period_id)
    result = svc.submit_period(db, p, period.user_id, period.period_start, confirm_missing)
    db.commit()
    return result


class PeriodDecisionIn(BaseModel):
    projectId: uuid.UUID
    decision: str
    reason: str | None = None
    entryIds: list[uuid.UUID] | None = None


@router.post("/timesheets/{period_id}/decision")
def decide(period_id: uuid.UUID, body: PeriodDecisionIn, p: Principal = Depends(get_principal),
           db: Session = Depends(get_db)):
    period = _period(db, p, period_id)
    result = svc.decide_period(db, p, period, body.model_dump(mode="json", exclude_none=True))
    db.commit()
    return result


@router.post("/timesheets/{period_id}/lock")
def lock(period_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    period = svc.lock_period(db, p, _period(db, p, period_id))
    db.commit()
    return {"state": period.state}


@router.post("/timesheets/{period_id}/reopen")
def reopen(period_id: uuid.UUID, body: ReasonIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    period = svc.reopen_period(db, p, _period(db, p, period_id), body.reason)
    db.commit()
    return {"state": period.state}


@router.get("/timesheets/approvals")
def approvals(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return {"queue": svc.approvals_queue(db, p), "amendments": svc.pending_amendments(db, p)}
