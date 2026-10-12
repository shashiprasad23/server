"""Global search across authorised records only (C11). Indexing never widens access."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.security import Principal, get_principal
from app.db import get_db
from app.modules.identity.models import User
from app.modules.meetings.models import Meeting, MeetingSummary
from app.modules.meetings.service import meeting_access
from app.modules.service_desk.models import ServiceOffering
from app.modules.service_desk.service import can_request
from app.modules.work.models import TYPE_LABELS, Project, WorkItem
from app.modules.work.service import status_name

router = APIRouter(tags=["search"])


@router.get("/search")
def search(q: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    q = q.strip()
    if len(q) < 2:
        return {"workItems": [], "projects": [], "people": [], "services": [], "meetings": []}
    like = f"%{q}%"
    ids = access.visible_project_ids(db, p)
    projects = {pr.id: pr for pr in db.scalars(select(Project).where(Project.id.in_(ids or [uuid.uuid4()])))}
    items = db.scalars(select(WorkItem).where(WorkItem.project_id.in_(list(projects) or [uuid.uuid4()]),
                                              WorkItem.deleted_at.is_(None),
                                              or_(WorkItem.key.ilike(like), WorkItem.title.ilike(like),
                                                  WorkItem.description.ilike(like)))
                       .order_by(WorkItem.updated_at.desc()).limit(20))
    meetings = []
    for m, s in db.execute(select(Meeting, MeetingSummary).outerjoin(MeetingSummary, MeetingSummary.meeting_id == Meeting.id)
                           .where(Meeting.organization_id == p.org.id,
                                  or_(Meeting.title.ilike(like), MeetingSummary.executive_summary.ilike(like)))
                           .limit(30)).all():
        pr = db.get(Project, m.project_id)
        acc = meeting_access(p, m, pr)
        # Only published summaries are searchable unless the user is a reviewer.
        if acc["summary"] and (acc["draft"] or (s and s.published_at)):
            meetings.append({"id": str(m.id), "title": m.title, "projectKey": pr.key, "status": m.status,
                             "decisions": [d["text"] for d in (s.decisions if s else []) if q.lower() in d["text"].lower()]})
    services = [{"id": str(o.id), "name": o.name, "category": o.category}
                for o in db.scalars(select(ServiceOffering).join(Project, Project.id == ServiceOffering.project_id)
                                    .where(Project.organization_id == p.org.id, ServiceOffering.published,
                                           or_(ServiceOffering.name.ilike(like),
                                               ServiceOffering.description.ilike(like))).limit(10))
                if can_request(p, o)]
    people = [{"id": str(u.id), "name": u.display_name, "email": u.email, "initials": u.initials}
              for u in db.scalars(select(User).where(User.organization_id == p.org.id, User.status == "active",
                                                     or_(User.display_name.ilike(like), User.email.ilike(like))).limit(10))]
    return {
        "workItems": [{"key": i.key, "title": i.title, "type": TYPE_LABELS[i.type], "projectKey": projects[i.project_id].key,
                       "status": status_name(projects[i.project_id], i.status)} for i in items],
        "projects": [{"id": str(pr.id), "key": pr.key, "name": pr.name} for pr in projects.values()
                     if q.lower() in pr.name.lower() or q.lower() in pr.key.lower()],
        "people": people, "services": services, "meetings": meetings[:10],
    }
