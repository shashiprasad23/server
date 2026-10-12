import uuid
from datetime import date

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import NotFound, field_error
from app.core.events import audit
from app.core.security import Principal, get_principal
from app.core.timeutil import today_in
from app.db import get_db
from app.modules.identity.models import User
from app.modules.resources import service as svc
from app.modules.resources.models import (
    Allocation,
    CalendarException,
    Leave,
    ResourceProfile,
    WorkingCalendar,
)
from app.modules.work.models import Project

router = APIRouter(tags=["resources"])


@router.get("/resources/capacity")
def capacity(from_: date | None = Query(None, alias="from"), weeks: int = 4, team_id: uuid.UUID | None = None,
             skill: str | None = None, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return svc.capacity_grid(db, p, from_ or today_in(p.org.timezone), weeks, team_id, skill)


@router.get("/resources/teams")
def teams(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return svc.team_list(db, p)


def serialize_allocation(a: Allocation, db: Session) -> dict:
    pr = db.get(Project, a.project_id)
    u = db.get(User, a.user_id)
    return {"id": str(a.id), "userId": str(a.user_id), "user": u.display_name, "projectId": str(a.project_id),
            "projectKey": pr.key, "projectName": pr.name, "role": a.role, "startDate": str(a.start_date),
            "endDate": str(a.end_date), "unit": a.unit,
            "hoursPerWeek": (a.minutes_per_week or 0) / 60 if a.unit == "hours" else None, "percent": a.percent,
            "state": a.state, "notes": a.notes}


@router.get("/allocations")
def list_allocations(user_id: uuid.UUID | None = None, project_id: uuid.UUID | None = None,
                     p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    q = select(Allocation).join(Project, Project.id == Allocation.project_id).where(
        Project.organization_id == p.org.id, Allocation.state != "cancelled")
    if user_id:
        q = q.where(Allocation.user_id == user_id)
    if project_id:
        q = q.where(Allocation.project_id == project_id)
    out = []
    for a in db.scalars(q.order_by(Allocation.start_date)):
        pr = db.get(Project, a.project_id)
        if a.user_id == p.id or access.can_manage_allocations(p, pr.id) or access.can_view_project(p, pr):
            out.append(serialize_allocation(a, db))
    return out


@router.post("/allocations", status_code=201)
def create_allocation(body: dict = Body(...), p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    a = svc.save_allocation(db, p, body)
    db.commit()
    return serialize_allocation(a, db)


@router.patch("/allocations/{allocation_id}")
def update_allocation(allocation_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                      db: Session = Depends(get_db)):
    a = db.get(Allocation, allocation_id)
    if a is None:
        raise NotFound("Allocation not found")
    svc.save_allocation(db, p, body, a)
    db.commit()
    return serialize_allocation(a, db)


@router.get("/leaves")
def list_leaves(user_id: uuid.UUID | None = None, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    q = select(Leave).join(User, User.id == Leave.user_id).where(User.organization_id == p.org.id,
                                                                  Leave.state != "cancelled")
    if not (p.is_admin or p.has_global("resource_manager")):
        q = q.where(Leave.user_id == p.id)
    elif user_id:
        q = q.where(Leave.user_id == user_id)
    return [{"id": str(lv.id), "userId": str(lv.user_id), "user": db.get(User, lv.user_id).display_name,
             "startDate": str(lv.start_date), "endDate": str(lv.end_date), "state": lv.state, "reason": lv.reason}
            for lv in db.scalars(q.order_by(Leave.start_date))]


@router.post("/leaves", status_code=201)
def create_leave(body: dict = Body(...), p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    lv = svc.save_leave(db, p, body)
    db.commit()
    return {"id": str(lv.id), "state": lv.state}


@router.post("/leaves/{leave_id}/decision")
def decide_leave(leave_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)):
    lv = db.get(Leave, leave_id)
    if lv is None:
        raise NotFound("Leave not found")
    svc.decide_leave(db, p, lv, body.get("decision") == "approve")
    db.commit()
    return {"id": str(lv.id), "state": lv.state}


@router.get("/resources/profiles")
def profiles(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    rows = db.execute(select(User, ResourceProfile).outerjoin(ResourceProfile, ResourceProfile.user_id == User.id)
                      .where(User.organization_id == p.org.id, User.status == "active").order_by(User.display_name)).all()
    return [{"userId": str(u.id), "name": u.display_name, "initials": u.initials,
             "title": pr.title if pr else "", "skills": pr.skills if pr else [], "pools": pr.pools if pr else [],
             "teamId": str(pr.team_id) if pr and pr.team_id else None, "location": pr.location if pr else "",
             "calendarId": str(pr.calendar_id) if pr and pr.calendar_id else None,
             "reservedPercent": pr.reserved_percent if pr else 0} for u, pr in rows]


@router.put("/resources/profiles/{user_id}")
def save_profile(user_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)):
    access.require(p.is_admin or p.has_global("resource_manager"), "Only resource managers maintain profiles")
    user = db.get(User, user_id)
    if user is None or user.organization_id != p.org.id:
        raise NotFound("User not found")
    prof = db.scalar(select(ResourceProfile).where(ResourceProfile.user_id == user_id))
    if prof is None:
        prof = ResourceProfile(user_id=user_id)
        db.add(prof)
    for key, attr in (("title", "title"), ("skills", "skills"), ("pools", "pools"), ("location", "location"),
                      ("employmentType", "employment_type"), ("availabilityStatus", "availability_status")):
        if key in body:
            setattr(prof, attr, body[key])
    if "reservedPercent" in body:
        rp = int(body["reservedPercent"])
        if not 0 <= rp <= 100:
            raise field_error("reservedPercent", "Between 0 and 100")
        prof.reserved_percent = rp
    for key, attr in (("teamId", "team_id"), ("calendarId", "calendar_id")):
        if key in body:
            setattr(prof, attr, uuid.UUID(body[key]) if body[key] else None)
    audit(db, p.id, "resource_profile.saved", "resource_profile", user_id, org_id=p.org.id, fields=sorted(body))
    db.commit()
    return {"ok": True}


@router.get("/calendars")
def calendars(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    out = []
    for c in db.scalars(select(WorkingCalendar).where(WorkingCalendar.organization_id == p.org.id)):
        ex = db.scalars(select(CalendarException).where(CalendarException.calendar_id == c.id)
                        .order_by(CalendarException.date))
        out.append({"id": str(c.id), "name": c.name, "timezone": c.timezone, "weekdayMinutes": c.weekday_minutes,
                    "exceptions": [{"id": str(e.id), "date": str(e.date), "minutes": e.minutes, "reason": e.reason}
                                   for e in ex]})
    return out


@router.post("/calendars/{calendar_id}/exceptions", status_code=201)
def add_exception(calendar_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    access.require(p.is_admin or p.has_global("resource_manager"), "Only administrators maintain calendars")
    cal = db.get(WorkingCalendar, calendar_id)
    if cal is None or cal.organization_id != p.org.id:
        raise NotFound("Calendar not found")
    try:
        d = date.fromisoformat(body["date"])
    except (KeyError, ValueError) as exc:
        raise field_error("date", "Use YYYY-MM-DD") from exc
    ex = CalendarException(calendar_id=cal.id, date=d, minutes=int(body.get("minutes", 0)),
                           reason=body.get("reason") or "Holiday")
    db.add(ex)
    audit(db, p.id, "calendar.exception_added", "calendar", cal.id, org_id=p.org.id, date=d, reason=ex.reason)
    db.commit()
    return {"id": str(ex.id)}


@router.put("/calendars/{calendar_id}")
def update_calendar(calendar_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)):
    access.require(p.is_admin, "Only administrators maintain calendars")
    cal = db.get(WorkingCalendar, calendar_id)
    if cal is None or cal.organization_id != p.org.id:
        raise NotFound("Calendar not found")
    if "weekdayMinutes" in body:
        wm = [int(x) for x in body["weekdayMinutes"]]
        if len(wm) != 7 or any(x < 0 or x > 1440 for x in wm):
            raise field_error("weekdayMinutes", "Seven values between 0 and 1440")
        cal.weekday_minutes = wm
    if "name" in body:
        cal.name = body["name"]
    audit(db, p.id, "calendar.updated", "calendar", cal.id, org_id=p.org.id)
    db.commit()
    return {"ok": True}
