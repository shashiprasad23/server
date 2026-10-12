"""Authentication: dev tokens for local use, OIDC (Microsoft Entra ID) bearer validation in production."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import Unauthorized
from app.db import get_db, utcnow
from app.modules.identity.models import Organization, ProjectMembership, User

_jwks_client: jwt.PyJWKClient | None = None


@dataclass
class Principal:
    user: User
    org: Organization
    memberships: dict[uuid.UUID, ProjectMembership] = field(default_factory=dict)

    @property
    def id(self) -> uuid.UUID:
        return self.user.id

    def has_global(self, role: str) -> bool:
        return role in (self.user.global_roles or [])

    @property
    def is_admin(self) -> bool:
        return self.has_global("platform_admin")


def issue_dev_token(user: User) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.display_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=s.jwt_ttl_minutes)).timestamp()),
        "iss": "upm-dev",
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256")


def _decode(token: str) -> dict:
    s = get_settings()
    if s.auth_mode == "dev":
        return jwt.decode(token, s.jwt_secret, algorithms=["HS256"], issuer="upm-dev")
    global _jwks_client
    if not (s.oidc_jwks_url and s.oidc_issuer and s.oidc_audience):
        raise Unauthorized("OIDC is not configured")
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(s.oidc_jwks_url)
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token, signing_key.key, algorithms=["RS256"], audience=s.oidc_audience, issuer=s.oidc_issuer
    )


def _resolve_user(db: Session, claims: dict) -> User | None:
    s = get_settings()
    if s.auth_mode == "dev":
        try:
            return db.get(User, uuid.UUID(claims["sub"]))
        except (KeyError, ValueError):
            return None
    subject = claims.get(s.oidc_subject_claim) or claims.get("sub")
    return db.scalar(select(User).where(User.identity_provider_subject == subject))


def load_principal(db: Session, user: User) -> Principal:
    org = db.get(Organization, user.organization_id)
    memberships = {
        m.project_id: m
        for m in db.scalars(select(ProjectMembership).where(ProjectMembership.user_id == user.id))
    }
    return Principal(user=user, org=org, memberships=memberships)


def get_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else request.query_params.get("access_token")
    if not token:
        raise Unauthorized("Sign in required")
    try:
        claims = _decode(token)
    except jwt.PyJWTError as exc:
        raise Unauthorized(f"Invalid or expired token ({exc.__class__.__name__})") from exc
    user = _resolve_user(db, claims)
    if user is None or user.status != "active":
        raise Unauthorized("User is not provisioned or has been deactivated")
    if user.last_login_at is None or (utcnow() - user.last_login_at).total_seconds() > 3600:
        user.last_login_at = utcnow()
        db.commit()
    return load_principal(db, user)
