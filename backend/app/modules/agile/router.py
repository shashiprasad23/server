import uuid

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import NotFound
from app.core.security import Principal, get_principal
from app.db import get_db
from app.modules.agile import service as svc
from app.modules.agile.models import Sprint
from app.modules.time.service import reporting_policy
from app.modules.work.models import Project, WorkItem
from app.modules.work.router import _blockers, _items_with_totals, serialize_item
from app.modules.work.service import workflow

router = APIRouter(tags=["agile"])


def _sprint(db: Session, p: Principal, sprint_id: uuid.UUID) -> tuple[Sprint, Project]:
    sprint = db.get(Sprint, sprint_id)
    if sprint is None:
        raise NotFound("Sprint not found")
    return sprint, access.get_project_for(db, p, sprint.project_id)


def serialize_sprint(s: Sprint) -> dict:
    return {"id": str(s.id), "projectId": str(s.project_id), "name": s.name, "goal": s.goal,
            "startDate": str(s.start_date), "endDate": str(s.end_date), "state": s.state,
            "committedPoints": s.committed_points}


class SprintIn(BaseModel):
    name: str | None = None
    goal: str = ""
    startDate: str
    endDate: str


@router.get("/projects/{project_id}/sprints")
def list_sprints(project_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    return [serialize_sprint(s) for s in db.scalars(select(Sprint).where(Sprint.project_id == pr.id)
                                                    .order_by(Sprint.start_date))]


@router.post("/projects/{project_id}/sprints", status_code=201)
def create_sprint(project_id: uuid.UUID, body: SprintIn, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    s = svc.create_sprint(db, p, pr, body.model_dump())
    db.commit()
    return serialize_sprint(s)


@router.patch("/sprints/{sprint_id}")
def update_sprint(sprint_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    from datetime import date

    s, pr = _sprint(db, p, sprint_id)
    access.require(access.can_manage_project(p, pr.id))
    for k, attr in (("name", "name"), ("goal", "goal")):
        if k in body:
            setattr(s, attr, body[k])
    if "endDate" in body:
        s.end_date = date.fromisoformat(body["endDate"])
    if "startDate" in body and s.state == "planned":
        s.start_date = date.fromisoformat(body["startDate"])
    db.commit()
    return serialize_sprint(s)


@router.post("/sprints/{sprint_id}/start")
def start(sprint_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    s, _ = _sprint(db, p, sprint_id)
    svc.start_sprint(db, p, s)
    db.commit()
    return serialize_sprint(s)


class CompleteIn(BaseModel):
    destination: str | None = None  # planned sprint id or "backlog"


@router.post("/sprints/{sprint_id}/complete")
def complete(sprint_id: uuid.UUID, body: CompleteIn, p: Principal = Depends(get_principal),
             db: Session = Depends(get_db)):
    s, _ = _sprint(db, p, sprint_id)
    result = svc.complete_sprint(db, p, s, body.destination)
    db.commit()
    return result


@router.get("/sprints/{sprint_id}/report")
def report(sprint_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    s, _ = _sprint(db, p, sprint_id)
    return {"sprint": serialize_sprint(s), **svc.sprint_report(db, s, reporting_policy(p.org))}


@router.get("/projects/{project_id}/board")
def board(project_id: uuid.UUID, sprint_id: uuid.UUID | None = None, p: Principal = Depends(get_principal),
          db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    sprint = db.get(Sprint, sprint_id) if sprint_id else db.scalar(
        select(Sprint).where(Sprint.project_id == pr.id, Sprint.state == "active"))
    q = select(WorkItem).where(WorkItem.project_id == pr.id, WorkItem.deleted_at.is_(None), WorkItem.type != "epic")
    q = q.where(WorkItem.sprint_id == sprint.id) if sprint else q.where(WorkItem.sprint_id.is_(None))
    items = list(db.scalars(q.order_by(WorkItem.rank, WorkItem.sequence)))
    totals, users = _items_with_totals(db, p, items)
    blockers = _blockers(db, [i.id for i in items])
    cols = []
    for st in workflow(pr)["statuses"]:
        col_items = [i for i in items if i.status == st["key"]]
        cols.append({**st, "count": len(col_items),
                     "items": [{**serialize_item(db, i, pr, users, totals.get(i.id)),
                                "blockedBy": blockers.get(i.id, [])} for i in col_items]})
    return {"sprint": serialize_sprint(sprint) if sprint else None, "columns": cols,
            "report": svc.sprint_report(db, sprint, reporting_policy(p.org)) if sprint else None}


class RankIn(BaseModel):
    orderedIds: list[str]


@router.post("/projects/{project_id}/backlog/rank")
def rank(project_id: uuid.UUID, body: RankIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    svc.rerank(db, p, pr, body.orderedIds)
    db.commit()
    return {"ok": True}
