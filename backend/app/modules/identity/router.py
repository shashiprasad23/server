from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import Forbidden, Unauthorized
from app.core.events import audit
from app.core.security import Principal, get_principal, issue_dev_token
from app.db import get_db
from app.modules.identity.models import DEFAULT_ORG_SETTINGS, ProjectMembership, User
from app.modules.work.models import Project

router = APIRouter(tags=["identity"])


class DevLogin(BaseModel):
    email: str


@router.get("/auth/config")
def auth_config():
    s = get_settings()
    return {"mode": s.auth_mode, "issuer": s.oidc_issuer, "audience": s.oidc_audience}


@router.get("/auth/dev-users")
def dev_users(db: Session = Depends(get_db)):
    """Seeded personas for local sign-in. Disabled outside dev auth mode."""
    if get_settings().auth_mode != "dev":
        raise Forbidden("Dev sign-in is disabled")
    users = db.scalars(select(User).where(User.status == "active").order_by(User.display_name))
    out = []
    for u in users:
        roles = list(db.scalars(select(ProjectMembership.role).where(ProjectMembership.user_id == u.id)))
        out.append({"email": u.email, "name": u.display_name, "initials": u.initials,
                    "globalRoles": u.global_roles, "projectRoles": sorted(set(roles))})
    return out


@router.post("/auth/dev-login")
def dev_login(body: DevLogin, db: Session = Depends(get_db)):
    if get_settings().auth_mode != "dev":
        raise Forbidden("Dev sign-in is disabled; use your organisation's single sign-on")
    user = db.scalar(select(User).where(User.email == body.email.strip().lower(), User.status == "active"))
    if user is None:
        raise Unauthorized("Unknown or deactivated user")
    audit(db, user.id, "auth.dev_login", "user", user.id, org_id=user.organization_id)
    db.commit()
    return {"accessToken": issue_dev_token(user), "tokenType": "Bearer"}


@router.get("/me")
def me(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    projects = {pr.id: pr for pr in db.scalars(select(Project).where(Project.id.in_(list(p.memberships.keys()) or [p.id])))}
    settings = {**DEFAULT_ORG_SETTINGS, **(p.org.settings or {})}
    return {
        "id": str(p.user.id), "name": p.user.display_name, "email": p.user.email, "initials": p.user.initials,
        "timezone": p.user.timezone, "globalRoles": p.user.global_roles,
        "organization": {"id": str(p.org.id), "name": p.org.name, "timezone": p.org.timezone,
                         "featureFlags": {**DEFAULT_ORG_SETTINGS["feature_flags"], **settings.get("feature_flags", {})},
                         "reportingPolicy": settings.get("reporting_policy")},
        "memberships": [
            {"projectId": str(pid), "projectKey": projects[pid].key, "projectName": projects[pid].name,
             "projectKind": projects[pid].kind, "color": projects[pid].color, "role": m.role,
             "isTimeApprover": m.is_time_approver, "isAiReviewer": m.is_ai_reviewer}
            for pid, m in p.memberships.items() if pid in projects and projects[pid].status == "active"
        ],
    }


@router.get("/users")
def list_users(q: str | None = None, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    query = select(User).where(User.organization_id == p.org.id, User.status == "active").order_by(User.display_name)
    if q:
        query = query.where(User.display_name.ilike(f"%{q}%") | User.email.ilike(f"%{q}%"))
    return [{"id": str(u.id), "name": u.display_name, "email": u.email, "initials": u.initials}
            for u in db.scalars(query.limit(100))]
