"""Server-side authorization rules (C2 baseline permission table). Every API and background path uses these."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Forbidden, NotFound
from app.core.security import Principal
from app.modules.work.models import Project

EDIT_ROLES = {"project_admin", "project_manager", "contributor", "qa", "service_agent", "service_owner", "approver"}
MANAGE_ROLES = {"project_admin", "project_manager"}
SERVICE_MANAGE_ROLES = {"project_admin", "project_manager", "service_owner"}


def role_in(p: Principal, project_id: uuid.UUID) -> str | None:
    m = p.memberships.get(project_id)
    return m.role if m else None


def can_view_project(p: Principal, project: Project) -> bool:
    if project.organization_id != p.org.id:
        return False
    return p.is_admin or project.id in p.memberships


def can_view_aggregates(p: Principal, project: Project) -> bool:
    """Executives read aggregate reports across the portfolio without ticket-level access."""
    return can_view_project(p, project) or (
        project.organization_id == p.org.id and p.has_global("executive_viewer")
    )


def can_edit_work(p: Principal, project_id: uuid.UUID) -> bool:
    return p.is_admin or role_in(p, project_id) in EDIT_ROLES


def can_manage_project(p: Principal, project_id: uuid.UUID) -> bool:
    return p.is_admin or role_in(p, project_id) in MANAGE_ROLES


def can_log_work(p: Principal, project_id: uuid.UUID) -> bool:
    # Entry permissions are independent from ticket-edit permissions (BR-TIME-11).
    return role_in(p, project_id) in EDIT_ROLES or p.is_admin


def can_approve_time(p: Principal, project_id: uuid.UUID) -> bool:
    m = p.memberships.get(project_id)
    return bool(m and m.is_time_approver)


def can_edit_others_time(p: Principal, project: Project) -> bool:
    if p.is_admin:
        return True  # audited exceptional permission
    policy = (project.settings or {}).get("time", {}).get("pm_can_edit_others_time", False)
    return policy and role_in(p, project.id) == "project_manager"


def can_manage_allocations(p: Principal, project_id: uuid.UUID) -> bool:
    return p.has_global("resource_manager") or p.is_admin or role_in(p, project_id) in MANAGE_ROLES


def can_review_ai(p: Principal, project_id: uuid.UUID) -> bool:
    m = p.memberships.get(project_id)
    if p.is_admin:
        return True
    return bool(m and (m.is_ai_reviewer or m.role in {"project_manager", "project_admin", "ai_reviewer"}))


def can_manage_service(p: Principal, project_id: uuid.UUID) -> bool:
    return p.is_admin or role_in(p, project_id) in SERVICE_MANAGE_ROLES


def require(condition: bool, message: str = "You do not have permission to perform this action") -> None:
    if not condition:
        raise Forbidden(message)


def get_project_for(db: Session, p: Principal, project_id: uuid.UUID, aggregates: bool = False) -> Project:
    project = db.get(Project, project_id)
    # Unauthorized projects look the same as missing ones so IDs are not disclosed (IDOR defence).
    if project is None or not (can_view_aggregates(p, project) if aggregates else can_view_project(p, project)):
        raise NotFound("Project not found")
    return project


def visible_project_ids(db: Session, p: Principal, aggregates: bool = False) -> list[uuid.UUID]:
    q = select(Project.id).where(Project.organization_id == p.org.id, Project.status != "archived")
    if not (p.is_admin or (aggregates and p.has_global("executive_viewer"))):
        q = q.where(Project.id.in_(list(p.memberships.keys()) or [uuid.uuid4()]))
    return list(db.scalars(q))
