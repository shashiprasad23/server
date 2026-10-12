"""Service catalog, request submission, escalation (C7)."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import access
from app.core.errors import NotFound, ValidationFailed, field_error
from app.core.events import audit, emit
from app.core.security import Principal
from app.modules.service_desk.models import PRIORITIES, PRIORITY_MATRIX, ServiceOffering, SlaEvent, SlaPolicy
from app.modules.service_desk.sla import recalculate_for_priority
from app.modules.work.models import Project, WorkItem
from app.modules.work.service import _record, create_work_item

FIELD_TYPES = {"text", "textarea", "select", "date", "number"}


def validate_form_schema(schema: list) -> None:
    keys = set()
    for f in schema or []:
        if not f.get("key") or not f.get("label"):
            raise field_error("formSchema", "Every field needs a key and label")
        if f["key"] in keys:
            raise field_error("formSchema", f"Duplicate field key '{f['key']}'")
        keys.add(f["key"])
        if f.get("type", "text") not in FIELD_TYPES:
            raise field_error("formSchema", f"Field type must be one of {', '.join(sorted(FIELD_TYPES))}")
        if f.get("type") == "select" and not f.get("options"):
            raise field_error("formSchema", f"Select field '{f['key']}' needs options")


def save_offering(db: Session, p: Principal, data: dict, offering: ServiceOffering | None = None) -> ServiceOffering:
    project_id = uuid.UUID(str(data.get("projectId") or (offering.project_id if offering else "")))
    project = db.get(Project, project_id)
    if project is None or project.kind != "service" or project.organization_id != p.org.id:
        raise field_error("projectId", "Offerings belong to a service project")
    access.require(access.can_manage_service(p, project.id), "Only service owners publish offerings")
    schema = data.get("formSchema", offering.form_schema if offering else [])
    validate_form_schema(schema)
    if data.get("defaultPriority", "P3") not in PRIORITIES:
        raise field_error("defaultPriority", "Priority must be P1-P4")
    if data.get("requestType", "service_request") not in {"service_request", "incident", "change_request"}:
        raise field_error("requestType", "Unsupported request type")
    is_new = offering is None
    if is_new:
        offering = ServiceOffering(project_id=project.id)
        db.add(offering)
    for attr, key in [("name", "name"), ("description", "description"), ("category", "category"),
                      ("request_type", "requestType"), ("support_group", "supportGroup"),
                      ("eligibility", "eligibility"), ("default_priority", "defaultPriority"),
                      ("approval_required", "approvalRequired"), ("published", "published"),
                      ("routing", "routing")]:
        if key in data:
            setattr(offering, attr, data[key])
    offering.form_schema = schema
    if "slaPolicyId" in data:
        offering.sla_policy_id = uuid.UUID(data["slaPolicyId"]) if data["slaPolicyId"] else None
    if "ownerId" in data:
        offering.owner_id = uuid.UUID(data["ownerId"]) if data["ownerId"] else None
    if not (offering.name or "").strip():
        raise field_error("name", "Name is required")
    db.flush()
    audit(db, p.id, "service_offering.saved", "service_offering", offering.id, org_id=p.org.id,
          project_id=project.id, published=offering.published, created=is_new)
    return offering


def can_request(p: Principal, offering: ServiceOffering) -> bool:
    if not offering.published:
        return access.can_manage_service(p, offering.project_id)
    return offering.eligibility == "all" or offering.project_id in p.memberships or p.is_admin


def submit_request(db: Session, p: Principal, offering_id: uuid.UUID, data: dict) -> WorkItem:
    offering = db.get(ServiceOffering, offering_id)
    if offering is None or not can_request(p, offering):
        raise NotFound("Service offering not found")
    project = db.get(Project, offering.project_id)
    if project.organization_id != p.org.id:
        raise NotFound("Service offering not found")
    answers = data.get("answers") or {}
    errors = {}
    for f in offering.form_schema or []:
        v = answers.get(f["key"])
        if f.get("required") and (v is None or str(v).strip() == ""):
            errors[f["key"]] = [f"{f['label']} is required"]
        if v and f.get("type") == "select" and v not in f.get("options", []):
            errors[f["key"]] = [f"Choose one of: {', '.join(f['options'])}"]
    title = (data.get("title") or "").strip() or offering.name
    if errors:
        raise ValidationFailed("Please complete the required fields", errors=errors)
    priority = offering.default_priority
    service_fields = {"answers": answers, "offering": offering.name}
    if offering.request_type == "incident":
        impact, urgency = data.get("impact", "medium"), data.get("urgency", "medium")
        priority = PRIORITY_MATRIX.get((impact, urgency), priority)
        service_fields.update({"impact": impact, "urgency": urgency,
                               "severity_level": {"P1": "Sev 1", "P2": "Sev 2"}.get(priority, "Sev 3"),
                               "service": answers.get("service") or offering.name})
    if offering.request_type == "change_request":
        service_fields.update({k: data.get(k) or answers.get(k) for k in (
            "change_type", "risk", "implementation_plan", "rollback_plan", "maintenance_window")})
    routing = offering.routing or {}
    item = create_work_item(db, p, project, {
        "type": offering.request_type, "title": title, "description": data.get("description") or "",
        "priority": priority, "serviceFields": service_fields, "serviceOfferingId": str(offering.id),
        "assigneeId": routing.get("default_assignee_id"),
        "slaPolicyId": str(offering.sla_policy_id) if offering.sla_policy_id else None,
    }, check_permission=False)
    emit(db, "ServiceRequestSubmitted", "work_item", item.id, key=item.key, project_id=project.id,
         offering=offering.name, owner_id=offering.owner_id, title=item.title)
    return item


def escalate(db: Session, p: Principal, item: WorkItem, reason: str, priority: str | None) -> WorkItem:
    access.require(access.can_edit_work(p, item.project_id), "You cannot escalate this ticket")
    if not reason:
        raise field_error("reason", "Escalation needs a reason")
    if priority:
        if priority not in PRIORITIES:
            raise field_error("priority", "Priority must be P1-P4")
        if priority != item.priority:
            _record(db, item, p.id, "priority", item.priority, priority, "Escalation")
            item.priority = priority
            recalculate_for_priority(db, item, p.id)
    db.add(SlaEvent(work_item_id=item.id, kind="escalated", detail=reason, actor_id=p.id))
    audit(db, p.id, "work_item.escalated", "work_item", item.id, org_id=p.org.id, project_id=item.project_id,
          reason=reason, priority=priority)
    offering = db.get(ServiceOffering, item.service_offering_id) if item.service_offering_id else None
    emit(db, "WorkItemEscalated", "work_item", item.id, key=item.key, project_id=item.project_id,
         owner_id=offering.owner_id if offering else None, reason=reason, title=item.title)
    return item


def sla_policies(db: Session, p: Principal) -> list[SlaPolicy]:
    return list(db.scalars(select(SlaPolicy).where(SlaPolicy.organization_id == p.org.id).order_by(SlaPolicy.name)))
