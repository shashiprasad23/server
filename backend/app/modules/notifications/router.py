import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.models import Notification, NotificationPreference
from app.core.security import Principal, get_principal
from app.db import get_db, utcnow

router = APIRouter(tags=["notifications"])

KINDS = ["assigned", "work_item", "mention", "timesheet_submitted", "timesheet_decision", "amendment", "allocation",
         "meeting_review", "meeting_published", "ai_action", "sla", "service_request"]


@router.get("/notifications")
def list_notifications(unread: bool = False, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    q = select(Notification).where(Notification.user_id == p.id).order_by(Notification.created_at.desc())
    if unread:
        q = q.where(Notification.read_at.is_(None))
    rows = list(db.scalars(q.limit(50)))
    count = db.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == p.id,
                                                                          Notification.read_at.is_(None)))
    return {"unread": count, "items": [{"id": str(n.id), "kind": n.kind, "title": n.title, "body": n.body,
                                        "link": n.link, "createdAt": n.created_at, "read": n.read_at is not None}
                                       for n in rows]}


class ReadIn(BaseModel):
    ids: list[uuid.UUID] | None = None


@router.post("/notifications/read")
def mark_read(body: ReadIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    q = update(Notification).where(Notification.user_id == p.id, Notification.read_at.is_(None))
    if body.ids:
        q = q.where(Notification.id.in_(body.ids))
    db.execute(q.values(read_at=utcnow()))
    db.commit()
    return {"ok": True}


@router.get("/notification-preferences")
def prefs(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    existing = {x.kind: x for x in db.scalars(select(NotificationPreference).where(NotificationPreference.user_id == p.id))}
    return [{"kind": k, "inApp": existing[k].in_app if k in existing else True,
             "teams": existing[k].teams if k in existing else False} for k in KINDS]


class PrefIn(BaseModel):
    kind: str
    inApp: bool = True
    teams: bool = False


@router.put("/notification-preferences")
def save_pref(body: PrefIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pref = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == p.id,
                                                          NotificationPreference.kind == body.kind))
    if pref is None:
        pref = NotificationPreference(user_id=p.id, kind=body.kind)
        db.add(pref)
    pref.in_app, pref.teams = body.inApp, body.teams
    db.commit()
    return {"ok": True}
