import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends, Header, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.common import UserCache, paginate
from app.core.errors import Conflict, Forbidden, NotFound, field_error
from app.core.events import audit
from app.core.idempotency import run_idempotent
from app.core.security import Principal, get_principal
from app.core.timeutil import today_in, week_start
from app.db import get_db
from app.modules.agile.models import Sprint
from app.modules.identity.models import PROJECT_ROLES, ProjectMembership, User
from app.modules.meetings.models import Meeting
from app.modules.time.models import REPORTING_POLICIES, TimeEntry
from app.modules.time.service import hierarchy_totals, reporting_policy, serialize_entry
from app.modules.work import service as svc
from app.modules.work.models import (
    SERVICE_TYPES,
    TYPE_LABELS,
    Comment,
    Project,
    Watcher,
    WorkItem,
    WorkItemHistory,
    WorkItemLink,
)

router = APIRouter(tags=["work"])


# ---------------------------------------------------------------- serializers

def serialize_project(pr: Project, membership: ProjectMembership | None = None) -> dict:
    return {
        "id": str(pr.id), "key": pr.key, "name": pr.name, "description": pr.description, "kind": pr.kind,
        "methodology": pr.methodology, "status": pr.status, "color": pr.color,
        "myRole": membership.role if membership else None,
    }


def serialize_item(db: Session, item: WorkItem, project: Project, users: UserCache, totals: dict | None = None) -> dict:
    from app.modules.service_desk.sla import sla_state

    out = {
        "id": str(item.id), "key": item.key, "type": item.type, "typeLabel": TYPE_LABELS[item.type],
        "title": item.title, "status": item.status, "statusName": svc.status_name(project, item.status),
        "statusCategory": svc.status_category(project, item.status), "priority": item.priority,
        "severity": item.severity, "projectId": str(item.project_id), "projectKey": project.key,
        "projectName": project.name, "parentId": str(item.parent_id) if item.parent_id else None,
        "assignee": users.ref(item.assignee_id), "reporter": users.ref(item.reporter_id),
        "originalEstimateMinutes": item.original_estimate_minutes,
        "remainingEstimateMinutes": item.remaining_estimate_minutes,
        "estimateLocked": item.estimate_locked_at is not None,
        "storyPoints": item.story_points, "sprintId": str(item.sprint_id) if item.sprint_id else None,
        "dueDate": str(item.due_date) if item.due_date else None, "labels": item.labels or [],
        "rank": item.rank, "version": item.version, "createdAt": item.created_at, "updatedAt": item.updated_at,
        "fromMeeting": item.source_meeting_id is not None,
    }
    if item.type in SERVICE_TYPES:
        out["sla"] = sla_state(item)
        out["serviceFields"] = item.service_fields or {}
    if totals is not None:
        out["actualMinutes"] = totals.get("total", 0)
    return out


def _items_with_totals(db: Session, p: Principal, items: list[WorkItem]) -> tuple[dict, UserCache]:
    users = UserCache(db)
    users.prime([i.assignee_id for i in items] + [i.reporter_id for i in items])
    totals = hierarchy_totals(db, items, REPORTING_POLICIES[reporting_policy(p.org)])
    return totals, users


# ---------------------------------------------------------------- projects

class ProjectIn(BaseModel):
    key: str
    name: str
    description: str = ""
    kind: str = "delivery"
    color: str | None = None
    methodology: str | None = None
    settings: dict | None = None
    workflow: dict | None = None


@router.get("/projects")
def list_projects(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    ids = access.visible_project_ids(db, p)
    projects = list(db.scalars(select(Project).where(Project.id.in_(ids or [uuid.uuid4()])).order_by(Project.name)))
    counts = dict(db.execute(select(WorkItem.project_id, func.count()).where(
        WorkItem.project_id.in_(ids or [uuid.uuid4()]), WorkItem.deleted_at.is_(None)).group_by(WorkItem.project_id)).all())
    return [{**serialize_project(pr, p.memberships.get(pr.id)), "itemCount": counts.get(pr.id, 0)} for pr in projects]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    can_create = p.is_admin or any(m.role in {"project_manager", "project_admin"} for m in p.memberships.values())
    if not can_create:
        raise Forbidden("Only project managers and administrators create projects")
    project = svc.create_project(db, p, body.model_dump(exclude_none=True))
    db.commit()
    return serialize_project(project)


@router.get("/projects/{project_id}")
def get_project(project_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    members = db.execute(select(ProjectMembership, User).join(User, User.id == ProjectMembership.user_id)
                         .where(ProjectMembership.project_id == pr.id).order_by(User.display_name)).all()
    sprints = db.scalars(select(Sprint).where(Sprint.project_id == pr.id).order_by(Sprint.start_date))
    return {
        **serialize_project(pr, p.memberships.get(pr.id)),
        "workflow": svc.workflow(pr), "settings": svc.project_settings(pr),
        "members": [{"userId": str(u.id), "name": u.display_name, "initials": u.initials, "email": u.email,
                     "role": m.role, "isTimeApprover": m.is_time_approver, "isAiReviewer": m.is_ai_reviewer}
                    for m, u in members],
        "sprints": [{"id": str(s.id), "name": s.name, "state": s.state, "startDate": str(s.start_date),
                     "endDate": str(s.end_date), "goal": s.goal} for s in sprints],
        "permissions": {
            "manage": access.can_manage_project(p, pr.id), "edit": access.can_edit_work(p, pr.id),
            "logWork": access.can_log_work(p, pr.id), "approveTime": access.can_approve_time(p, pr.id),
            "reviewAi": access.can_review_ai(p, pr.id), "manageService": access.can_manage_service(p, pr.id),
            "manageAllocations": access.can_manage_allocations(p, pr.id),
        },
        "typeLabels": TYPE_LABELS,
    }


@router.patch("/projects/{project_id}")
def update_project(project_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(get_principal),
                   db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    access.require(access.can_manage_project(p, pr.id), "Only project managers change project settings")
    changed = []
    for k in ("name", "description", "color", "methodology", "status"):
        if k in body:
            setattr(pr, k, body[k])
            changed.append(k)
    if "workflow" in body:
        svc.validate_workflow(body["workflow"])
        used = set(db.scalars(select(WorkItem.status).where(WorkItem.project_id == pr.id).distinct()))
        missing = used - {s["key"] for s in body["workflow"]["statuses"]}
        if missing:
            raise field_error("workflow.statuses", f"Statuses in use cannot be removed: {', '.join(sorted(missing))}")
        pr.workflow = body["workflow"]
        changed.append("workflow")
    if "settings" in body:
        pr.settings = svc.deep_merge(svc.project_settings(pr), body["settings"])
        changed.append("settings")
    audit(db, p.id, "project.updated", "project", pr.id, org_id=p.org.id, project_id=pr.id, fields=changed)
    db.commit()
    return get_project(project_id, p, db)


class MemberIn(BaseModel):
    userId: uuid.UUID
    role: str = "contributor"
    isTimeApprover: bool = False
    isAiReviewer: bool = False


@router.put("/projects/{project_id}/members")
def upsert_member(project_id: uuid.UUID, body: MemberIn, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    access.require(access.can_manage_project(p, pr.id), "Only project managers manage membership")
    if body.role not in PROJECT_ROLES:
        raise field_error("role", f"Role must be one of {', '.join(sorted(PROJECT_ROLES))}")
    user = db.get(User, body.userId)
    if user is None or user.organization_id != p.org.id:
        raise field_error("userId", "User not found")
    m = db.scalar(select(ProjectMembership).where(ProjectMembership.project_id == pr.id,
                                                  ProjectMembership.user_id == user.id))
    before = None if m is None else {"role": m.role, "approver": m.is_time_approver, "reviewer": m.is_ai_reviewer}
    if m is None:
        m = ProjectMembership(project_id=pr.id, user_id=user.id)
        db.add(m)
    m.role, m.is_time_approver, m.is_ai_reviewer = body.role, body.isTimeApprover, body.isAiReviewer
    audit(db, p.id, "project.member_saved", "project", pr.id, org_id=p.org.id, project_id=pr.id, user_id=user.id,
          before=before, after={"role": body.role, "approver": body.isTimeApprover, "reviewer": body.isAiReviewer})
    db.commit()
    return {"ok": True}


@router.delete("/projects/{project_id}/members/{user_id}")
def remove_member(project_id: uuid.UUID, user_id: uuid.UUID, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    access.require(access.can_manage_project(p, pr.id), "Only project managers manage membership")
    m = db.scalar(select(ProjectMembership).where(ProjectMembership.project_id == pr.id,
                                                  ProjectMembership.user_id == user_id))
    if m:
        db.delete(m)
        audit(db, p.id, "project.member_removed", "project", pr.id, org_id=p.org.id, project_id=pr.id, user_id=user_id)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- work items

@router.get("/projects/{project_id}/work-items")
def list_work_items(project_id: uuid.UUID, q: str | None = None, type: str | None = None, status: str | None = None,
                    assignee: str | None = None, sprint: str | None = None, parent: str | None = None,
                    from_meeting: bool = False, blocked: bool = False, sort: str = "rank",
                    page: int = 1, page_size: int = Query(50, alias="pageSize"),
                    p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, project_id)
    query = select(WorkItem).where(WorkItem.project_id == pr.id, WorkItem.deleted_at.is_(None))
    if q:
        query = query.where(or_(WorkItem.title.ilike(f"%{q}%"), WorkItem.key.ilike(f"%{q}%")))
    if type:
        query = query.where(WorkItem.type.in_(type.split(",")))
    if status:
        query = query.where(WorkItem.status.in_(status.split(",")))
    if assignee == "me":
        query = query.where(WorkItem.assignee_id == p.id)
    elif assignee == "none":
        query = query.where(WorkItem.assignee_id.is_(None))
    elif assignee:
        query = query.where(WorkItem.assignee_id == uuid.UUID(assignee))
    if sprint == "backlog":
        query = query.where(WorkItem.sprint_id.is_(None))
    elif sprint:
        query = query.where(WorkItem.sprint_id == uuid.UUID(sprint))
    if parent:
        query = query.where(WorkItem.parent_id == uuid.UUID(parent))
    if from_meeting:
        query = query.where(WorkItem.source_meeting_id.is_not(None))
    if blocked:
        blocked_ids = select(WorkItemLink.target_id).join(WorkItem, WorkItem.id == WorkItemLink.source_id).where(
            WorkItemLink.link_type == "blocks")
        query = query.where(or_(WorkItem.status == "blocked", WorkItem.id.in_(blocked_ids)))
    order = {"rank": [WorkItem.rank, WorkItem.sequence], "key": [WorkItem.sequence],
             "updated": [WorkItem.updated_at.desc(), WorkItem.sequence], "due": [WorkItem.due_date.nulls_last(),
                                                                                   WorkItem.sequence],
             "priority": [WorkItem.priority, WorkItem.sequence]}.get(sort, [WorkItem.rank, WorkItem.sequence])
    query = query.order_by(*order)
    result = paginate(db, query, page, page_size, lambda x: x)
    items = result["items"]
    totals, users = _items_with_totals(db, p, items)
    blockers = _blockers(db, [i.id for i in items])
    result["items"] = [{**serialize_item(db, i, pr, users, totals.get(i.id)), "blockedBy": blockers.get(i.id, [])}
                       for i in items]
    return result


def _blockers(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
    if not ids:
        return {}
    rows = db.execute(select(WorkItemLink.target_id, WorkItem.key, WorkItem.status, WorkItem.project_id)
                      .join(WorkItem, WorkItem.id == WorkItemLink.source_id)
                      .where(WorkItemLink.target_id.in_(ids), WorkItemLink.link_type == "blocks")).all()
    out: dict[uuid.UUID, list[str]] = {}
    projects: dict = {}
    for tid, key, status, pid in rows:
        pr = projects.setdefault(pid, db.get(Project, pid))
        if svc.status_category(pr, status) != "done":
            out.setdefault(tid, []).append(key)
    return out


class WorkItemIn(BaseModel):
    projectId: uuid.UUID
    type: str
    title: str
    description: str | None = None
    parentId: uuid.UUID | None = None
    assigneeId: uuid.UUID | None = None
    priority: str | None = None
    severity: str | None = None
    originalEstimateMinutes: int | str | None = None
    storyPoints: float | None = None
    sprintId: uuid.UUID | None = None
    dueDate: date | None = None
    labels: list[str] | None = None
    serviceFields: dict | None = None
    slaPolicyId: uuid.UUID | None = None


@router.post("/work-items", status_code=201)
def create_item(body: WorkItemIn, idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
                p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    pr = access.get_project_for(db, p, body.projectId)
    data = body.model_dump(exclude_none=True, mode="json")

    def action():
        item = svc.create_work_item(db, p, pr, data)
        db.flush()
        return serialize_item(db, item, pr, UserCache(db))

    return run_idempotent(db, p.id, "work_items.create", idempotency_key, data, action)


@router.get("/work-items/{key}")
def get_work_item(key: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    pr = db.get(Project, item.project_id)
    users = UserCache(db)
    policy = reporting_policy(p.org)
    states = REPORTING_POLICIES[policy]
    children = list(db.scalars(select(WorkItem).where(WorkItem.parent_id == item.id, WorkItem.deleted_at.is_(None))
                               .order_by(WorkItem.sequence)))
    totals = hierarchy_totals(db, [item, *children], states)
    entries = list(db.scalars(select(TimeEntry).where(TimeEntry.work_item_id == item.id)
                              .order_by(TimeEntry.work_date.desc(), TimeEntry.created_at.desc())))
    users.prime([e.user_id for e in entries] + [item.assignee_id, item.reporter_id] + [c.assignee_id for c in children])
    counted = [e for e in entries if e.approval_status in states]
    draft_minutes = sum(e.duration_minutes for e in entries if e.approval_status == "draft")
    parent = db.get(WorkItem, item.parent_id) if item.parent_id else None
    links = []
    for link, other, direction in (
        [(lk, db.get(WorkItem, lk.target_id), "outward") for lk in db.scalars(
            select(WorkItemLink).where(WorkItemLink.source_id == item.id))]
        + [(lk, db.get(WorkItem, lk.source_id), "inward") for lk in db.scalars(
            select(WorkItemLink).where(WorkItemLink.target_id == item.id))]):
        other_pr = db.get(Project, other.project_id)
        visible = access.can_view_project(p, other_pr)
        label = {("blocks", "outward"): "Blocks", ("blocks", "inward"): "Blocked by",
                 ("duplicates", "outward"): "Duplicates", ("duplicates", "inward"): "Duplicated by"}.get(
            (link.link_type, direction), "Relates to")
        links.append({"id": str(link.id), "label": label, "key": other.key if visible else "Restricted",
                      "title": other.title if visible else None,
                      "statusCategory": svc.status_category(other_pr, other.status) if visible else None})
    meeting_source = None
    if item.source_meeting_id:
        from app.modules.meetings.service import meeting_access

        m = db.get(Meeting, item.source_meeting_id)
        acc = meeting_access(p, m, db.get(Project, m.project_id)) if m else {"summary": False}
        meeting_source = ({"id": str(m.id), "title": m.title, "segmentStart": item.source_segment_start,
                           "proposalId": str(item.source_proposal_id) if item.source_proposal_id else None}
                          if acc["summary"] else {"restricted": True})
    watching = db.scalar(select(Watcher.id).where(Watcher.work_item_id == item.id, Watcher.user_id == p.id)) is not None
    sprint = db.get(Sprint, item.sprint_id) if item.sprint_id else None
    from app.modules.time.models import TimeEntryCorrection

    pending = {c.time_entry_id for c in db.scalars(select(TimeEntryCorrection).where(
        TimeEntryCorrection.time_entry_id.in_([e.id for e in entries] or [uuid.uuid4()]),
        TimeEntryCorrection.state == "requested"))}
    settings = svc.project_settings(pr)
    today = today_in(p.org.timezone)
    return {
        **serialize_item(db, item, pr, users),
        "description": item.description, "components": item.components or [], "fixVersion": item.fix_version,
        "parent": {"id": str(parent.id), "key": parent.key, "title": parent.title, "type": parent.type,
                   "typeLabel": TYPE_LABELS[parent.type]} if parent else None,
        "sprint": {"id": str(sprint.id), "name": sprint.name, "startDate": str(sprint.start_date),
                   "endDate": str(sprint.end_date), "state": sprint.state} if sprint else None,
        "effort": {
            "policy": policy, "actualMinutes": sum(e.duration_minutes for e in counted),
            "countedEntries": len(counted), "draftMinutes": draft_minutes,
            "originalEstimateMinutes": item.original_estimate_minutes,
            "remainingEstimateMinutes": item.remaining_estimate_minutes,
        },
        "hierarchy": [
            {"id": str(x.id), "key": x.key, "title": x.title, "type": x.type, "typeLabel": TYPE_LABELS[x.type],
             "isRoot": x.id == item.id, **totals[x.id]} for x in [item, *children]],
        "children": [serialize_item(db, c, pr, users) for c in children],
        "timeEntries": [serialize_entry(e, users, amendment_pending=e.id in pending) for e in entries
                        if e.approval_status != "voided" or e.user_id == p.id],
        "links": links, "meetingSource": meeting_source, "watching": watching,
        "transitions": svc.allowed_transitions(pr, item.status, p),
        "statuses": svc.workflow(pr)["statuses"],
        "permissions": {"edit": access.can_edit_work(p, pr.id), "logWork": access.can_log_work(p, pr.id),
                        "manage": access.can_manage_project(p, pr.id)},
        "logWorkPolicy": {
            "activityCategories": settings["time"]["activity_categories"],
            "minDescriptionLength": settings["time"]["min_description_length"],
            "backdateDays": settings["time"]["backdate_days"],
            "earliestDate": str(today - timedelta(days=settings["time"]["backdate_days"])),
            "latestDate": str(today + timedelta(days=settings["time"]["allow_future_days"])),
            "maxEntryMinutes": settings["time"]["max_entry_minutes"],
            "periodStart": str(week_start(today)), "periodEnd": str(week_start(today) + timedelta(days=6)),
        },
    }


@router.patch("/work-items/{key}")
def patch_work_item(key: str, body: dict = Body(...), if_match: str | None = Header(None, alias="If-Match"),
                    p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    version = body.pop("version", None)
    if version is None and if_match:
        version = int(if_match.strip('W/"'))
    svc.update_work_item(db, p, item, body, version)
    db.commit()
    return get_work_item(item.key, p, db)


class TransitionIn(BaseModel):
    to: str
    comment: str | None = None


@router.post("/work-items/{key}/transitions")
def do_transition(key: str, body: TransitionIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    svc.transition(db, p, item, body.to, body.comment)
    if body.comment:
        db.add(Comment(work_item_id=item.id, author_id=p.id, body=body.comment))
    db.commit()
    return get_work_item(item.key, p, db)


@router.get("/work-items/{key}/history")
def history(key: str, field: str | None = None, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    pr = db.get(Project, item.project_id)
    q = select(WorkItemHistory).where(WorkItemHistory.work_item_id == item.id).order_by(WorkItemHistory.occurred_at.desc())
    if field:
        q = q.where(WorkItemHistory.field == field)
    users = UserCache(db)
    rows = list(db.scalars(q.limit(200)))
    users.prime([r.actor_id for r in rows])

    def label(fld, v):
        return svc.status_name(pr, v) if fld == "status" and v else v

    return [{"id": str(r.id), "field": r.field, "oldValue": label(r.field, r.old_value),
             "newValue": label(r.field, r.new_value), "reason": r.reason, "actor": users.ref(r.actor_id),
             "occurredAt": r.occurred_at} for r in rows]


class CommentIn(BaseModel):
    body: str


@router.get("/work-items/{key}/comments")
def list_comments(key: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    rows = list(db.scalars(select(Comment).where(Comment.work_item_id == item.id, Comment.deleted_at.is_(None))
                           .order_by(Comment.created_at)))
    users = UserCache(db)
    users.prime([c.author_id for c in rows])
    # Bodies are returned as plain text; the client renders them as text (safe rendering).
    return [{"id": str(c.id), "body": c.body, "author": users.ref(c.author_id), "createdAt": c.created_at,
             "mentions": c.mentions} for c in rows]


@router.post("/work-items/{key}/comments", status_code=201)
def add_comment(key: str, body: CommentIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    import re

    from app.modules.notifications.service import notify

    item = svc.get_item(db, p, key)
    access.require(access.can_edit_work(p, item.project_id), "You cannot comment in this project")
    text = body.body.strip()
    if not text:
        raise field_error("body", "Comment cannot be empty")
    handles = set(re.findall(r"@([\w.\-]+@[\w.\-]+|[\w.\-]+)", text))
    members = db.execute(select(User).join(ProjectMembership, ProjectMembership.user_id == User.id)
                         .where(ProjectMembership.project_id == item.project_id)).scalars().all()
    # Only project members can be mentioned, so a mention never exposes the ticket to outsiders.
    mentioned = [u for u in members if u.email in handles or u.email.split("@")[0] in handles]
    c = Comment(work_item_id=item.id, author_id=p.id, body=text, mentions=[str(u.id) for u in mentioned])
    db.add(c)
    db.flush()
    notify(db, [u.id for u in mentioned], "mention", f"{p.user.display_name} mentioned you on {item.key}",
           text[:200], f"/work-items/{item.key}", f"mention:{c.id}", exclude=p.id)
    db.commit()
    return {"id": str(c.id)}


class LinkIn(BaseModel):
    targetKey: str
    type: str


@router.post("/work-items/{key}/links", status_code=201)
def add_link(key: str, body: LinkIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    link = svc.add_link(db, p, item, body.targetKey, body.type)
    db.commit()
    return {"id": str(link.id)}


@router.delete("/work-items/{key}/links/{link_id}")
def delete_link(key: str, link_id: uuid.UUID, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    access.require(access.can_edit_work(p, item.project_id))
    link = db.get(WorkItemLink, link_id)
    if link is None or item.id not in (link.source_id, link.target_id):
        raise NotFound("Link not found")
    db.delete(link)
    audit(db, p.id, "work_item.unlinked", "work_item", item.id, org_id=p.org.id, project_id=item.project_id)
    db.commit()
    return {"ok": True}


@router.post("/work-items/{key}/watch")
def watch(key: str, on: bool = True, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    w = db.scalar(select(Watcher).where(Watcher.work_item_id == item.id, Watcher.user_id == p.id))
    if on and not w:
        db.add(Watcher(work_item_id=item.id, user_id=p.id))
    elif not on and w:
        db.delete(w)
    db.commit()
    return {"watching": on}


@router.delete("/work-items/{key}")
def delete_item(key: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = svc.get_item(db, p, key)
    access.require(access.can_manage_project(p, item.project_id), "Only project managers delete work items")
    if db.scalar(select(TimeEntry.id).where(TimeEntry.work_item_id == item.id, TimeEntry.approval_status != "voided")):
        raise Conflict("Items with logged time cannot be deleted; close them instead", code="has_time_entries")
    if db.scalar(select(WorkItem.id).where(WorkItem.parent_id == item.id, WorkItem.deleted_at.is_(None))):
        raise Conflict("Move or delete child items first", code="has_children")
    from app.db import utcnow

    item.deleted_at = utcnow()  # soft delete keeps audit and references intact
    audit(db, p.id, "work_item.deleted", "work_item", item.id, org_id=p.org.id, project_id=item.project_id, key=item.key)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- my work (cross-project home)

@router.get("/my-work")
def my_work(week: date | None = None, project_id: uuid.UUID | None = Query(None, alias="projectId"),
            p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    from app.modules.resources.service import allocation_minutes_by_project, net_capacity_by_day
    from app.modules.time.service import COUNTABLE_STATES, approvals_queue

    ws = week_start(week or today_in(p.org.timezone))
    we = ws + timedelta(days=6)
    project_ids = [pid for pid in p.memberships if project_id is None or pid == project_id]
    projects = {pr.id: pr for pr in db.scalars(select(Project).where(Project.id.in_(project_ids or [uuid.uuid4()]),
                                                                     Project.status == "active"))}
    alloc = allocation_minutes_by_project(db, p.id, ws, we)
    logged = dict(db.execute(select(TimeEntry.project_id, func.sum(TimeEntry.duration_minutes)).where(
        TimeEntry.user_id == p.id, TimeEntry.work_date.between(ws, we),
        TimeEntry.approval_status.in_(COUNTABLE_STATES)).group_by(TimeEntry.project_id)).all())
    net = sum(net_capacity_by_day(db, p.id, ws, we).values())
    items = list(db.scalars(select(WorkItem).where(WorkItem.assignee_id == p.id, WorkItem.deleted_at.is_(None),
                                                   WorkItem.project_id.in_(list(projects) or [uuid.uuid4()]))))
    items = [i for i in items if svc.status_category(projects[i.project_id], i.status) != "done"]
    users = UserCache(db)
    approver_names: dict = {}
    for m, u in db.execute(select(ProjectMembership, User).join(User, User.id == ProjectMembership.user_id).where(
            ProjectMembership.project_id.in_(list(projects) or [uuid.uuid4()]), ProjectMembership.is_time_approver)):
        if u.id != p.id:
            approver_names.setdefault(m.project_id, []).append(u.display_name)
    active_sprints = {s.project_id: s for s in db.scalars(select(Sprint).where(
        Sprint.project_id.in_(list(projects) or [uuid.uuid4()]), Sprint.state == "active"))}
    cards = []
    for pr in sorted(projects.values(), key=lambda x: x.name):
        m = p.memberships[pr.id]
        a, lg = alloc.get(pr.id, 0), int(logged.get(pr.id, 0))
        sprint = active_sprints.get(pr.id)
        cards.append({
            "project": serialize_project(pr, m), "role": m.role, "isTimeApprover": m.is_time_approver,
            "approvers": approver_names.get(pr.id, []), "allocatedMinutes": a, "loggedMinutes": lg,
            "deltaMinutes": lg - a, "openAssigned": sum(1 for i in items if i.project_id == pr.id),
            "context": (f"Sprint {sprint.name.split()[-1]} ends {sprint.end_date:%a %d %b}" if sprint else pr.methodology),
        })

    def sort_key(i: WorkItem):
        return (i.due_date or date.max, i.sequence)

    items.sort(key=sort_key)
    approvals = approvals_queue(db, p)
    return {
        "weekStart": str(ws), "weekEnd": str(we), "netCapacityMinutes": net,
        "allocatedMinutes": sum(alloc.get(pid, 0) for pid in projects),
        "loggedMinutes": int(sum(logged.get(pid, 0) for pid in projects)),
        "projects": cards,
        "assigned": [serialize_item(db, i, projects[i.project_id], users) for i in items],
        "pendingApprovals": {"count": len(approvals), "minutes": sum(a["minutes"] for a in approvals)},
    }
