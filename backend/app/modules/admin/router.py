"""Administration (C12): users and roles, org settings & feature flags, AI config, audit viewer, integration health."""

import uuid

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import access
from app.core.common import UserCache, paginate
from app.core.errors import Conflict, NotFound, field_error
from app.core.events import audit
from app.core.models import AuditEvent, IntegrationInbox, OutboxEvent
from app.core.security import Principal, get_principal
from app.db import get_db, utcnow
from app.modules.identity.models import DEFAULT_ORG_SETTINGS, GLOBAL_ROLES, User
from app.modules.work.service import deep_merge

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin(p: Principal = Depends(get_principal)) -> Principal:
    access.require(p.is_admin, "Platform administrators only")
    return p


@router.get("/users")
def users(p: Principal = Depends(_admin), db: Session = Depends(get_db)):
    from app.modules.identity.models import ProjectMembership
    from app.modules.work.models import Project

    out = []
    for u in db.scalars(select(User).where(User.organization_id == p.org.id).order_by(User.display_name)):
        ms = db.execute(select(ProjectMembership, Project).join(Project, Project.id == ProjectMembership.project_id)
                        .where(ProjectMembership.user_id == u.id)).all()
        out.append({"id": str(u.id), "name": u.display_name, "email": u.email, "status": u.status,
                    "globalRoles": u.global_roles, "lastLoginAt": u.last_login_at,
                    "memberships": [{"projectKey": pr.key, "role": m.role, "approver": m.is_time_approver}
                                    for m, pr in ms]})
    return out


@router.post("/users", status_code=201)
def create_user(body: dict = Body(...), p: Principal = Depends(_admin), db: Session = Depends(get_db)):
    email = (body.get("email") or "").strip().lower()
    if "@" not in email:
        raise field_error("email", "A valid email is required")
    if db.scalar(select(User).where(User.organization_id == p.org.id, User.email == email)):
        raise Conflict("A user with that email exists")
    roles = [r for r in body.get("globalRoles") or [] if r in GLOBAL_ROLES]
    u = User(organization_id=p.org.id, email=email, display_name=body.get("name") or email.split("@")[0],
             identity_provider_subject=body.get("identityProviderSubject"), global_roles=roles,
             timezone=body.get("timezone") or p.org.timezone)
    db.add(u)
    db.flush()
    audit(db, p.id, "user.created", "user", u.id, org_id=p.org.id, roles=roles)
    db.commit()
    return {"id": str(u.id)}


@router.patch("/users/{user_id}")
def update_user(user_id: uuid.UUID, body: dict = Body(...), p: Principal = Depends(_admin),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None or u.organization_id != p.org.id:
        raise NotFound("User not found")
    before = {"status": u.status, "roles": list(u.global_roles or [])}
    if "globalRoles" in body:
        bad = set(body["globalRoles"]) - GLOBAL_ROLES
        if bad:
            raise field_error("globalRoles", f"Unknown roles: {', '.join(bad)}")
        if u.id == p.id and "platform_admin" not in body["globalRoles"]:
            raise field_error("globalRoles", "You cannot remove your own administrator role")
        u.global_roles = body["globalRoles"]
    if "status" in body:
        if body["status"] not in {"active", "deactivated"}:
            raise field_error("status", "Status must be active or deactivated")
        u.status = body["status"]
    if "name" in body:
        u.display_name = body["name"]
    audit(db, p.id, "user.access_changed", "user", u.id, org_id=p.org.id, before=before,
          after={"status": u.status, "roles": u.global_roles})
    db.commit()
    return {"ok": True}


@router.get("/settings")
def get_settings_(p: Principal = Depends(_admin)):
    return {"name": p.org.name, "timezone": p.org.timezone, "settings": deep_merge(DEFAULT_ORG_SETTINGS, p.org.settings or {})}


@router.patch("/settings")
def patch_settings(body: dict = Body(...), p: Principal = Depends(_admin), db: Session = Depends(get_db)):
    org = p.org
    new = deep_merge(deep_merge(DEFAULT_ORG_SETTINGS, org.settings or {}), body.get("settings") or {})
    from app.modules.time.models import REPORTING_POLICIES

    if new.get("reporting_policy") not in REPORTING_POLICIES:
        raise field_error("settings.reporting_policy", "Unknown reporting policy")
    if new["ai"].get("provider") not in {"heuristic", "ollama"}:
        raise field_error("settings.ai.provider", "Provider must be heuristic or ollama")
    before = org.settings
    org.settings = new
    if "timezone" in body:
        org.timezone = body["timezone"]
    audit(db, p.id, "org.settings_changed", "organization", org.id, org_id=org.id,
          changed=sorted((body.get("settings") or {}).keys()), before_flags=(before or {}).get("feature_flags"))
    db.commit()
    return get_settings_(p)


@router.get("/audit")
def audit_log(action: str | None = None, entity_type: str | None = None, entity_id: str | None = None,
              actor_id: uuid.UUID | None = None, page: int = 1, page_size: int = Query(50, alias="pageSize"),
              p: Principal = Depends(_admin), db: Session = Depends(get_db)):
    q = select(AuditEvent).where(AuditEvent.organization_id == p.org.id).order_by(AuditEvent.occurred_at.desc(),
                                                                                 AuditEvent.id)
    if action:
        q = q.where(AuditEvent.action.ilike(f"{action}%"))
    if entity_type:
        q = q.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        q = q.where(AuditEvent.entity_id == entity_id)
    if actor_id:
        q = q.where(AuditEvent.actor_id == actor_id)
    users = UserCache(db)
    result = paginate(db, q, page, page_size, lambda x: x)
    users.prime([a.actor_id for a in result["items"]])
    result["items"] = [{"id": str(a.id), "action": a.action, "entityType": a.entity_type, "entityId": a.entity_id,
                        "actor": users.ref(a.actor_id), "occurredAt": a.occurred_at, "correlationId": a.correlation_id,
                        "metadata": a.safe_metadata} for a in result["items"]]
    return result


@router.get("/integrations/health")
def integration_health(p: Principal = Depends(_admin), db: Session = Depends(get_db)):
    from app.config import get_settings

    s = get_settings()
    pending = db.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.published_at.is_(None),
                                                                            OutboxEvent.dead_lettered.is_(False)))
    oldest = db.scalar(select(func.min(OutboxEvent.created_at)).where(OutboxEvent.published_at.is_(None),
                                                                      OutboxEvent.dead_lettered.is_(False)))
    dead = list(db.scalars(select(OutboxEvent).where(OutboxEvent.dead_lettered).order_by(OutboxEvent.created_at.desc())
                           .limit(50)))
    inbox = list(db.scalars(select(IntegrationInbox).order_by(IntegrationInbox.received_at.desc()).limit(20)))
    return {
        "connectors": [
            {"name": "Microsoft Teams (Graph transcripts)", "configured": bool(s.graph_client_id),
             "detail": "Tenant consent and application access policy required" if not s.graph_client_id else "Configured"},
            {"name": "Teams notifications (webhook)", "configured": bool(s.teams_webhook_url), "detail": ""},
            {"name": f"AI provider · {s.ai_provider}", "configured": True,
             "detail": s.ollama_url if s.ai_provider == "ollama" else "Local rule-based extractor"},
            {"name": "Azure DevOps sync", "configured": False, "detail": "Define field ownership before enabling"},
        ],
        "outbox": {"pending": pending, "oldestPendingAt": oldest,
                   "oldestAgeSeconds": int((utcnow() - oldest).total_seconds()) if oldest else 0,
                   "deadLettered": len(dead)},
        "deadLetters": [{"id": str(e.id), "eventType": e.event_type, "attempts": e.attempts, "error": e.last_error,
                         "createdAt": e.created_at, "correlationId": e.correlation_id} for e in dead],
        "inbox": [{"provider": i.provider, "eventType": i.event_type, "status": i.status, "receivedAt": i.received_at,
                   "error": i.error} for i in inbox],
    }


@router.post("/integrations/dead-letters/{event_id}/replay")
def replay(event_id: uuid.UUID, p: Principal = Depends(_admin), db: Session = Depends(get_db)):
    ev = db.get(OutboxEvent, event_id)
    if ev is None or not ev.dead_lettered:
        raise NotFound("Dead-lettered event not found")
    ev.dead_lettered, ev.attempts, ev.next_attempt_at = False, 0, utcnow()
    audit(db, p.id, "integration.replayed", "outbox_event", ev.id, org_id=p.org.id, event_type=ev.event_type)
    db.commit()
    return {"ok": True}
