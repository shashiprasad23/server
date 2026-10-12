"""Work management: projects, work-item hierarchy, workflow transitions and audit history (C3)."""

import copy
import uuid
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed, field_error
from app.core.events import audit, emit
from app.core.security import Principal
from app.modules.identity.models import ProjectMembership
from app.modules.work.models import (
    DEFAULT_DELIVERY_WORKFLOW,
    DEFAULT_PROJECT_SETTINGS,
    DEFAULT_SERVICE_WORKFLOW,
    HIERARCHY_RULES,
    SERVICE_TYPES,
    TYPE_LABELS,
    WORK_ITEM_TYPES,
    Project,
    WorkItem,
    WorkItemHistory,
    WorkItemLink,
)

PRIORITIES = ["lowest", "low", "medium", "high", "highest", "P1", "P2", "P3", "P4"]


def deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def project_settings(project: Project) -> dict:
    return deep_merge(DEFAULT_PROJECT_SETTINGS, project.settings or {})


def workflow(project: Project) -> dict:
    if project.workflow and project.workflow.get("statuses"):
        return project.workflow
    return DEFAULT_SERVICE_WORKFLOW if project.kind == "service" else DEFAULT_DELIVERY_WORKFLOW


def status_def(project: Project, key: str) -> dict | None:
    return next((s for s in workflow(project)["statuses"] if s["key"] == key), None)


def status_category(project: Project, key: str) -> str:
    s = status_def(project, key)
    return s["category"] if s else "todo"


def status_name(project: Project, key: str) -> str:
    s = status_def(project, key)
    return s["name"] if s else key


def validate_workflow(wf: dict) -> None:
    statuses = wf.get("statuses") or []
    keys = [s.get("key") for s in statuses]
    if not statuses or len(set(keys)) != len(keys) or not all(keys):
        raise field_error("workflow.statuses", "Statuses need unique, non-empty keys")
    for s in statuses:
        if s.get("category") not in {"todo", "in_progress", "done"}:
            raise field_error("workflow.statuses", f"Status '{s['key']}' needs category todo, in_progress or done")
    if not any(s["category"] == "done" for s in statuses):
        raise field_error("workflow.statuses", "At least one status must be in the done category")
    for t in wf.get("transitions") or []:
        for end in ("from", "to"):
            if t.get(end) != "*" and t.get(end) not in keys:
                raise field_error("workflow.transitions", f"Unknown status '{t.get(end)}' in transition")


# ---------------------------------------------------------------- projects

def create_project(db: Session, p: Principal, data: dict) -> Project:
    key = (data.get("key") or "").strip().upper()
    if not key.isalnum() or not (2 <= len(key) <= 10):
        raise field_error("key", "Project key must be 2-10 letters or digits")
    if db.scalar(select(Project).where(Project.organization_id == p.org.id, Project.key == key)):
        raise Conflict(f"Project key {key} is already in use", code="duplicate_key")
    kind = data.get("kind", "delivery")
    if kind not in {"delivery", "service"}:
        raise field_error("kind", "Kind must be delivery or service")
    wf = data.get("workflow") or (DEFAULT_SERVICE_WORKFLOW if kind == "service" else DEFAULT_DELIVERY_WORKFLOW)
    validate_workflow(wf)
    project = Project(
        organization_id=p.org.id,
        key=key,
        name=(data.get("name") or "").strip() or key,
        description=data.get("description", ""),
        kind=kind,
        methodology=data.get("methodology") or ("Service queue · SLA-driven" if kind == "service" else "Agile delivery"),
        owner_id=p.id,
        color=data.get("color") or "#2F4FC9",
        workflow=copy.deepcopy(wf),
        settings=deep_merge(DEFAULT_PROJECT_SETTINGS, data.get("settings") or {}),
    )
    db.add(project)
    db.flush()
    db.add(ProjectMembership(project_id=project.id, user_id=p.id, role="project_manager",
                             is_time_approver=True, is_ai_reviewer=True))
    audit(db, p.id, "project.created", "project", project.id, org_id=p.org.id, project_id=project.id, key=key)
    return project


# ---------------------------------------------------------------- work items

def _allocate_key(db: Session, project_id: uuid.UUID) -> tuple[int, str]:
    project = db.scalar(select(Project).where(Project.id == project_id).with_for_update())
    seq = project.next_sequence
    project.next_sequence = seq + 1
    return seq, f"{project.key}-{seq}"


def _record(db: Session, item: WorkItem, actor: uuid.UUID | None, fld: str, old: Any, new: Any,
            reason: str | None = None) -> None:
    db.add(WorkItemHistory(work_item_id=item.id, actor_id=actor, field=fld,
                           old_value=None if old is None else str(old),
                           new_value=None if new is None else str(new), reason=reason))


def _check_member(db: Session, project_id: uuid.UUID, user_id: uuid.UUID | None, fld: str) -> None:
    if user_id is None:
        return
    if not db.scalar(select(ProjectMembership.id).where(ProjectMembership.project_id == project_id,
                                                        ProjectMembership.user_id == user_id)):
        raise field_error(fld, "Person must be a member of the project")


def _check_parent(db: Session, project: Project, item_type: str, parent_id: uuid.UUID | None,
                  self_id: uuid.UUID | None = None) -> WorkItem | None:
    allowed = HIERARCHY_RULES[item_type]
    if parent_id is None:
        if None not in allowed:
            raise field_error("parentId", f"A {TYPE_LABELS[item_type]} needs a parent")
        return None
    parent = db.get(WorkItem, parent_id)
    if parent is None or parent.deleted_at or parent.project_id != project.id:
        raise field_error("parentId", "Parent must be an existing item in the same project")
    if parent.type not in allowed:
        raise field_error("parentId", f"A {TYPE_LABELS[item_type]} cannot sit under a {TYPE_LABELS[parent.type]}")
    # Acyclic: walk up from the new parent; it must never reach the item itself.
    cursor, depth = parent, 0
    while cursor is not None and depth < 50:
        if self_id is not None and cursor.id == self_id:
            raise field_error("parentId", "That parent would create a cycle")
        cursor = db.get(WorkItem, cursor.parent_id) if cursor.parent_id else None
        depth += 1
    return parent


def create_work_item(db: Session, p: Principal, project: Project, data: dict, *, actor_id: uuid.UUID | None = None,
                     check_permission: bool = True) -> WorkItem:
    if check_permission:
        access.require(access.can_edit_work(p, project.id), "You cannot create work in this project")
    item_type = data.get("type")
    if item_type not in WORK_ITEM_TYPES:
        raise field_error("type", f"Type must be one of: {', '.join(WORK_ITEM_TYPES)}")
    if item_type in SERVICE_TYPES and project.kind != "service":
        raise field_error("type", "Service requests, incidents and changes belong to a service project")
    title = (data.get("title") or "").strip()
    if not title:
        raise field_error("title", "Title is required")
    if len(title) > 300:
        raise field_error("title", "Title must be at most 300 characters")
    parent_id = _uuid_or_none(data.get("parentId"))
    _check_parent(db, project, item_type, parent_id)
    assignee_id = _uuid_or_none(data.get("assigneeId"))
    _check_member(db, project.id, assignee_id, "assigneeId")
    original = _minutes_or_none(data.get("originalEstimateMinutes"), "originalEstimateMinutes")
    priority = data.get("priority") or ("P3" if item_type in SERVICE_TYPES else "medium")
    if priority not in PRIORITIES:
        raise field_error("priority", "Unknown priority")
    sprint_id = _uuid_or_none(data.get("sprintId"))
    seq, key = _allocate_key(db, project.id)
    first_status = workflow(project)["statuses"][0]["key"]
    max_rank = db.scalar(select(func.max(WorkItem.rank)).where(WorkItem.project_id == project.id)) or 0
    item = WorkItem(
        project_id=project.id,
        key=key,
        sequence=seq,
        parent_id=parent_id,
        type=item_type,
        title=title,
        description=data.get("description") or "",
        status=first_status,
        priority=priority,
        severity=data.get("severity"),
        reporter_id=actor_id or p.id,
        assignee_id=assignee_id,
        original_estimate_minutes=original,
        remaining_estimate_minutes=original,
        story_points=data.get("storyPoints"),
        due_date=_date_or_none(data.get("dueDate"), "dueDate"),
        labels=list(data.get("labels") or []),
        components=list(data.get("components") or []),
        service_fields=dict(data.get("serviceFields") or {}),
        service_offering_id=_uuid_or_none(data.get("serviceOfferingId")),
        sla_policy_id=_uuid_or_none(data.get("slaPolicyId")),
        source_meeting_id=_uuid_or_none(data.get("sourceMeetingId")),
        source_proposal_id=_uuid_or_none(data.get("sourceProposalId")),
        source_segment_start=data.get("sourceSegmentStart"),
        rank=max_rank + 1000,
        created_by=actor_id or p.id,
        updated_by=actor_id or p.id,
    )
    db.add(item)
    db.flush()
    if sprint_id:
        from app.modules.agile.service import assign_to_sprint

        assign_to_sprint(db, p, item, sprint_id)
    _record(db, item, p.id, "created", None, key)
    if item_type in SERVICE_TYPES:
        from app.modules.service_desk.sla import start_sla

        start_sla(db, item, p.id)
    audit(db, p.id, "work_item.created", "work_item", item.id, org_id=p.org.id, project_id=project.id,
          key=key, type=item_type)
    emit(db, "WorkItemCreated", "work_item", item.id, key=key, project_id=project.id,
         assignee_id=assignee_id, actor_id=p.id, title=title)
    return item


UPDATABLE = {
    "title", "description", "priority", "severity", "assigneeId", "originalEstimateMinutes",
    "remainingEstimateMinutes", "storyPoints", "dueDate", "labels", "components", "parentId",
    "sprintId", "fixVersion", "serviceFields",
}


def update_work_item(db: Session, p: Principal, item: WorkItem, changes: dict, expected_version: int | None) -> WorkItem:
    project = db.get(Project, item.project_id)
    access.require(access.can_edit_work(p, project.id), "You cannot edit work in this project")
    if expected_version is None:
        raise ValidationFailed("Provide the version you edited (If-Match or body.version)", code="version_required")
    if expected_version != item.version:
        raise Conflict("This ticket changed since you opened it. Reload and try again.", code="version_conflict")
    unknown = set(changes) - UPDATABLE - {"version", "estimateChangeReason"}
    if unknown:
        raise ValidationFailed(f"Fields cannot be updated here: {', '.join(sorted(unknown))}")
    reason = changes.get("estimateChangeReason")
    changed: list[str] = []

    def setf(attr: str, value: Any, label: str | None = None):
        old = getattr(item, attr)
        if old != value:
            _record(db, item, p.id, label or attr, old, value,
                    reason if attr.endswith("estimate_minutes") else None)
            setattr(item, attr, value)
            changed.append(label or attr)

    if "title" in changes:
        title = (changes["title"] or "").strip()
        if not title:
            raise field_error("title", "Title is required")
        setf("title", title)
    if "description" in changes:
        setf("description", changes["description"] or "")
    if "priority" in changes:
        if changes["priority"] not in PRIORITIES:
            raise field_error("priority", "Unknown priority")
        setf("priority", changes["priority"])
    if "severity" in changes:
        setf("severity", changes["severity"])
    if "assigneeId" in changes:
        aid = _uuid_or_none(changes["assigneeId"])
        _check_member(db, project.id, aid, "assigneeId")
        setf("assignee_id", aid)
    if "originalEstimateMinutes" in changes:
        new = _minutes_or_none(changes["originalEstimateMinutes"], "originalEstimateMinutes")
        if item.estimate_locked_at and new != item.original_estimate_minutes:
            # Baseline is locked at sprint start; only managers may re-baseline, with a reason (BR-TIME-03).
            if not access.can_manage_project(p, project.id):
                raise Forbidden("Original estimate is locked as the sprint baseline")
            if not reason:
                raise field_error("estimateChangeReason", "A reason is required to change a locked baseline")
        if item.remaining_estimate_minutes is None and new is not None:
            item.remaining_estimate_minutes = new
        setf("original_estimate_minutes", new)
    if "remainingEstimateMinutes" in changes:
        new = _minutes_or_none(changes["remainingEstimateMinutes"], "remainingEstimateMinutes")
        setf("remaining_estimate_minutes", new)
    if "storyPoints" in changes:
        sp = changes["storyPoints"]
        if sp is not None and (not isinstance(sp, (int, float)) or sp < 0):
            raise field_error("storyPoints", "Story points must be a non-negative number")
        setf("story_points", sp)
    if "dueDate" in changes:
        setf("due_date", _date_or_none(changes["dueDate"], "dueDate"))
    if "labels" in changes:
        setf("labels", list(changes["labels"] or []))
    if "components" in changes:
        setf("components", list(changes["components"] or []))
    if "fixVersion" in changes:
        setf("fix_version", changes["fixVersion"])
    if "serviceFields" in changes:
        setf("service_fields", {**(item.service_fields or {}), **(changes["serviceFields"] or {})})
    if "parentId" in changes:
        pid = _uuid_or_none(changes["parentId"])
        _check_parent(db, project, item.type, pid, self_id=item.id)
        setf("parent_id", pid)
    if "sprintId" in changes:
        from app.modules.agile.service import assign_to_sprint

        assign_to_sprint(db, p, item, _uuid_or_none(changes["sprintId"]))
        changed.append("sprint")
    if changed:
        item.updated_by = p.id
        audit(db, p.id, "work_item.updated", "work_item", item.id, org_id=p.org.id, project_id=project.id,
              fields=changed)
        emit(db, "WorkItemUpdated", "work_item", item.id, key=item.key, project_id=project.id, fields=changed,
             assignee_id=item.assignee_id, actor_id=p.id, title=item.title)
    return item


def allowed_transitions(project: Project, from_status: str, p: Principal) -> list[dict]:
    wf = workflow(project)
    role = access.role_in(p, project.id)
    out: dict[str, dict] = {}
    for t in wf.get("transitions") or []:
        if t.get("from") not in {"*", from_status}:
            continue
        targets = [s["key"] for s in wf["statuses"]] if t.get("to") == "*" else [t["to"]]
        for target in targets:
            if target == from_status or target in out:
                continue
            roles = t.get("roles")
            out[target] = {
                "to": target,
                "name": status_name(project, target),
                "allowed": not roles or p.is_admin or role in roles,
                "roles": roles or [],
            }
    return list(out.values())


def transition(db: Session, p: Principal, item: WorkItem, to_status: str, comment: str | None = None) -> WorkItem:
    project = db.get(Project, item.project_id)
    access.require(access.can_edit_work(p, project.id), "You cannot change status in this project")
    if status_def(project, to_status) is None:
        raise field_error("to", f"Unknown status '{to_status}'")
    if to_status == item.status:
        return item
    options = {t["to"]: t for t in allowed_transitions(project, item.status, p)}
    if to_status not in options:
        raise ValidationFailed(
            f"Cannot move from {status_name(project, item.status)} to {status_name(project, to_status)}",
            code="transition_not_allowed",
        )
    if not options[to_status]["allowed"]:
        raise Forbidden(f"Only {', '.join(options[to_status]['roles'])} may make this transition")

    target_cat = status_category(project, to_status)
    settings = project_settings(project)
    # Validators: estimates before active work; required approvals before closing.
    if target_cat in {"in_progress", "done"} and item.type in settings["estimates"]["required_types"]:
        if item.original_estimate_minutes is None:
            raise ValidationFailed(
                f"{TYPE_LABELS[item.type]} needs an original estimate before work starts",
                code="estimate_required", errors={"originalEstimateMinutes": ["Required before active work"]},
            )
    if target_cat == "done" and item.type == "change_request":
        approved = db.scalar(select(WorkItemHistory.id).where(
            WorkItemHistory.work_item_id == item.id, WorkItemHistory.field == "status",
            WorkItemHistory.new_value == "approved"))
        sf = item.service_fields or {}
        missing = [f for f in ("implementation_plan", "rollback_plan") if not sf.get(f)]
        if not approved or missing:
            raise ValidationFailed("A change must be approved and have implementation and rollback plans before closing",
                                   code="change_not_approved", errors={f: ["Required"] for f in missing})
    if target_cat == "done" and to_status == "closed" and item.type == "incident":
        if (item.service_fields or {}).get("severity_level") in {"Sev 1", "Sev 2"} and not (
            item.service_fields or {}
        ).get("post_incident_review"):
            raise ValidationFailed("Sev 1/2 incidents need a post-incident review link before closing",
                                   code="pir_required", errors={"post_incident_review": ["Required"]})

    old = item.status
    _record(db, item, p.id, "status", old, to_status, comment)
    item.status = to_status
    item.updated_by = p.id
    if item.type in {"service_request", "incident", "change_request"}:
        from app.modules.service_desk.sla import on_transition

        on_transition(db, project, item, old, to_status, p.id)
    audit(db, p.id, "work_item.transitioned", "work_item", item.id, org_id=p.org.id, project_id=project.id,
          from_status=old, to_status=to_status)
    emit(db, "WorkItemUpdated", "work_item", item.id, key=item.key, project_id=project.id, fields=["status"],
         status=to_status, assignee_id=item.assignee_id, actor_id=p.id, title=item.title)
    return item


def add_link(db: Session, p: Principal, item: WorkItem, target_key: str, link_type: str) -> WorkItemLink:
    if link_type not in {"blocks", "relates", "duplicates"}:
        raise field_error("type", "Link type must be blocks, relates or duplicates")
    target = db.scalar(select(WorkItem).where(WorkItem.key == target_key.upper(), WorkItem.deleted_at.is_(None)))
    if target is None or not access.can_view_project(p, db.get(Project, target.project_id)):
        raise field_error("targetKey", "Target ticket not found")
    if target.id == item.id:
        raise field_error("targetKey", "An item cannot link to itself")
    access.require(access.can_edit_work(p, item.project_id))
    if db.scalar(select(WorkItemLink).where(WorkItemLink.source_id == item.id, WorkItemLink.target_id == target.id,
                                            WorkItemLink.link_type == link_type)):
        raise Conflict("That link already exists")
    link = WorkItemLink(source_id=item.id, target_id=target.id, link_type=link_type, created_by=p.id)
    db.add(link)
    _record(db, item, p.id, "link", None, f"{link_type} {target.key}")
    audit(db, p.id, "work_item.linked", "work_item", item.id, org_id=p.org.id, project_id=item.project_id,
          link_type=link_type, target=target.key)
    return link


def get_item(db: Session, p: Principal, key_or_id: str) -> WorkItem:
    item = None
    try:
        item = db.get(WorkItem, uuid.UUID(key_or_id))
    except ValueError:
        item = db.scalar(select(WorkItem).where(WorkItem.key == key_or_id.upper()))
    if item is None or item.deleted_at is not None:
        raise NotFound("Work item not found")
    project = db.get(Project, item.project_id)
    if not access.can_view_project(p, project):
        raise NotFound("Work item not found")
    return item


def descendant_ids(db: Session, root_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Map each root to all of its descendants (recursive, each once)."""
    if not root_ids:
        return {}
    rows = db.execute(
        select(WorkItem.id, WorkItem.parent_id).where(WorkItem.deleted_at.is_(None),
                                                      WorkItem.project_id.in_(
                                                          select(WorkItem.project_id).where(WorkItem.id.in_(root_ids))))
    ).all()
    children: dict[uuid.UUID, list[uuid.UUID]] = {}
    for cid, pid in rows:
        if pid:
            children.setdefault(pid, []).append(cid)
    out = {}
    for root in root_ids:
        seen: list[uuid.UUID] = []
        stack = list(children.get(root, []))
        visited = set()
        while stack:
            n = stack.pop()
            if n in visited:
                continue
            visited.add(n)
            seen.append(n)
            stack.extend(children.get(n, []))
        out[root] = seen
    return out


# ---------------------------------------------------------------- parsing helpers

def _uuid_or_none(v: Any) -> uuid.UUID | None:
    if v in (None, ""):
        return None
    if isinstance(v, uuid.UUID):
        return v
    try:
        return uuid.UUID(str(v))
    except ValueError as exc:
        raise ValidationFailed(f"Invalid id '{v}'") from exc


def _minutes_or_none(v: Any, fld: str) -> int | None:
    if v in (None, ""):
        return None
    from app.core.timeutil import parse_duration

    try:
        minutes = parse_duration(v)
    except ValueError as exc:
        raise field_error(fld, str(exc)) from exc
    if minutes < 0:
        raise field_error(fld, "Estimate cannot be negative")
    return minutes


def _date_or_none(v: Any, fld: str) -> date | None:
    if v in (None, ""):
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v))
    except ValueError as exc:
        raise field_error(fld, "Use YYYY-MM-DD") from exc

