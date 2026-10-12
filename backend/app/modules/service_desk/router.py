import uuid

from fastapi import APIRouter, Body, Depends, Header
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.common import UserCache
from app.core.errors import NotFound, field_error
from app.core.events import audit
from app.core.idempotency import run_idempotent
from app.core.security import Principal, get_principal
from app.db import get_db, utcnow
from app.modules.service_desk import service as svc
from app.modules.service_desk.models import ServiceOffering, SlaEvent, SlaPolicy
from app.modules.service_desk.sla import sla_state
from app.modules.time.models import TimeEntry
from app.modules.time.service import COUNTABLE_STATES
from app.modules.work.models import SERVICE_TYPES, Project, WorkItem
from app.modules.work.router import serialize_item
from app.modules.work.service import get_item, status_category

router = APIRouter(tags=["service"])


def serialize_offering(o: ServiceOffering, db: Session) -> dict:
    pr = db.get(Project, o.project_id)
    policy = db.get(SlaPolicy, o.sla_policy_id) if o.sla_policy_id else None
    return {"id": str(o.id), "projectId": str(o.project_id), "projectName": pr.name, "name": o.name,
            "description": o.description, "category": o.category, "requestType": o.request_type,
            "ownerId": str(o.owner_id) if o.owner_id else None, "supportGroup": o.support_group,
            "eligibility": o.eligibility, "formSchema": o.form_schema, "defaultPriority": o.default_priority,
            "approvalRequired": o.approval_required, "published": o.published,
            "slaPolicy": {"id": str(policy.id), "name": policy.name, "targets": policy.targets} if policy else None,
            "routing": o.routing}


@router.get("/service/catalog")
def catalog(include_unpublished: bool = False, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    q = select(ServiceOffering).join(Project, Project.id == ServiceOffering.project_id).where(
        Project.organization_id == p.org.id).order_by(ServiceOffering.category, ServiceOffering.name)
    out = []
    for o in db.scalars(q):
        if o.published and svc.can_request(p, o):
            out.append(serialize_offering(o, db))
        elif include_unpublished and access.can_manage_service(p, o.project_id):
            out.append(serialize_offering(o, db))
    return out


@router.post("/service/offerings", status_code=201)
def create_offering(body: dict = Body(...), p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    o = svc.save_offering(db, p, body)
    db.commit()
    return serialize_offering(o, db)


@router.patch("/service/offerings/{offering_id}")
def update_offering(offering_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)):
    o = db.get(ServiceOffering, offering_id)
    if o is None:
        raise NotFound("Offering not found")
    svc.save_offering(db, p, body, o)
    db.commit()
    return serialize_offering(o, db)


class RequestIn(BaseModel):
    title: str | None = None
    description: str | None = None
    answers: dict = {}
    impact: str | None = None
    urgency: str | None = None


@router.post("/service/offerings/{offering_id}/requests", status_code=201)
def submit(offering_id: uuid.UUID, body: RequestIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
           p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_none=True)

    def action():
        item = svc.submit_request(db, p, offering_id, data)
        db.flush()
        return {"key": item.key, "id": str(item.id)}

    return run_idempotent(db, p.id, f"service.request:{offering_id}", idempotency_key, data, action)


@router.get("/service/queue")
def queue(project_id: uuid.UUID | None = None, view: str = "queue", p: Principal = Depends(get_principal),
          db: Session = Depends(get_db)):
    ids = [pid for pid in access.visible_project_ids(db, p)]
    projects = {pr.id: pr for pr in db.scalars(select(Project).where(Project.id.in_(ids or [uuid.uuid4()]),
                                                                     Project.kind == "service"))}
    if project_id:
        projects = {k: v for k, v in projects.items() if k == project_id}
    types = {"queue": SERVICE_TYPES, "incidents": {"incident"}, "changes": {"change_request"},
             "requests": {"service_request"}}.get(view, SERVICE_TYPES)
    items = list(db.scalars(select(WorkItem).where(WorkItem.project_id.in_(list(projects) or [uuid.uuid4()]),
                                                   WorkItem.type.in_(types), WorkItem.deleted_at.is_(None))))
    open_items = [i for i in items if status_category(projects[i.project_id], i.status) != "done"]
    users = UserCache(db)
    users.prime([i.assignee_id for i in open_items])
    logged = dict(db.execute(select(TimeEntry.work_item_id, func.sum(TimeEntry.duration_minutes)).where(
        TimeEntry.work_item_id.in_([i.id for i in open_items] or [uuid.uuid4()]),
        TimeEntry.approval_status.in_(COUNTABLE_STATES)).group_by(TimeEntry.work_item_id)).all())
    now = utcnow()
    rows = []
    for i in open_items:
        st = sla_state(i, now)
        rows.append({**serialize_item(db, i, projects[i.project_id], users), "sla": st,
                     "loggedMinutes": int(logged.get(i.id, 0)),
                     "offering": (i.service_fields or {}).get("offering") or (i.service_fields or {}).get("service")})
    order = {"breached": 0, "due_soon": 1, "running": 2, "paused": 3, "none": 4, "met": 5}
    rows.sort(key=lambda r: (order.get(r["sla"]["state"], 9), r["priority"], r["sla"].get("minutes") or 10 ** 9))
    return {
        "projects": [{"id": str(pr.id), "name": pr.name, "key": pr.key} for pr in projects.values()],
        "stats": {"open": len(rows), "dueWithin4h": sum(1 for r in rows if r["sla"]["state"] == "due_soon"),
                  "breached": sum(1 for r in rows if r["sla"]["state"] == "breached"),
                  "paused": sum(1 for r in rows if r["sla"]["state"] == "paused")},
        "items": rows,
    }


@router.get("/work-items/{key}/sla")
def sla_timeline(key: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = get_item(db, p, key)
    users = UserCache(db)
    events = list(db.scalars(select(SlaEvent).where(SlaEvent.work_item_id == item.id).order_by(SlaEvent.occurred_at)))
    users.prime([e.actor_id for e in events])
    return {"state": sla_state(item), "responseDueAt": item.sla_response_due_at,
            "resolutionDueAt": item.sla_resolution_due_at, "respondedAt": item.sla_responded_at,
            "pausedMinutes": item.sla_paused_minutes,
            "events": [{"kind": e.kind, "detail": e.detail, "at": e.occurred_at, "actor": users.ref(e.actor_id)}
                       for e in events]}


class EscalateIn(BaseModel):
    reason: str
    priority: str | None = None


@router.post("/work-items/{key}/escalate")
def escalate(key: str, body: EscalateIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = get_item(db, p, key)
    svc.escalate(db, p, item, body.reason, body.priority)
    db.commit()
    return {"ok": True}


@router.get("/service/sla-policies")
def policies(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return [{"id": str(x.id), "name": x.name, "targets": x.targets, "calendar": x.calendar}
            for x in svc.sla_policies(db, p)]


@router.post("/service/sla-policies", status_code=201)
def create_policy(body: dict = Body(...), p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    access.require(p.is_admin, "Only administrators configure SLA policies")
    targets = body.get("targets") or {}
    for prio, t in targets.items():
        if prio not in {"P1", "P2", "P3", "P4"} or not all(int(t.get(k, 0)) > 0 for k in ("response", "resolution")):
            raise field_error("targets", "Each P1-P4 target needs positive response and resolution minutes")
    pol = SlaPolicy(organization_id=p.org.id, name=body.get("name") or "SLA policy", targets=targets)
    db.add(pol)
    db.flush()
    audit(db, p.id, "sla_policy.created", "sla_policy", pol.id, org_id=p.org.id)
    db.commit()
    return {"id": str(pol.id)}
