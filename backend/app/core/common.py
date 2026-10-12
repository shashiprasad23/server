"""Shared helpers: pagination envelope and compact user references."""

import uuid
from collections.abc import Iterable

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.modules.identity.models import User

MAX_PAGE_SIZE = 200


def paginate(db: Session, query: Select, page: int, page_size: int, serialize) -> dict:
    page = max(page, 1)
    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    rows = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [serialize(r) for r in rows], "total": total, "page": page, "pageSize": page_size}


def user_ref(user: User | None) -> dict | None:
    if user is None:
        return None
    return {"id": str(user.id), "name": user.display_name, "initials": user.initials, "email": user.email}


class UserCache:
    """Resolves user ids to compact refs with one query per batch."""

    def __init__(self, db: Session):
        self.db = db
        self._cache: dict[uuid.UUID, User] = {}

    def prime(self, ids: Iterable[uuid.UUID | None]) -> None:
        missing = {i for i in ids if i and i not in self._cache}
        if missing:
            for u in self.db.scalars(select(User).where(User.id.in_(missing))):
                self._cache[u.id] = u

    def ref(self, user_id: uuid.UUID | None) -> dict | None:
        if user_id is None:
            return None
        if user_id not in self._cache:
            self.prime([user_id])
        return user_ref(self._cache.get(user_id))
