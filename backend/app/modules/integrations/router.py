"""Inbound provider webhooks (C9): HMAC-validated, de-duplicated by delivery id, recorded for replay."""

import hashlib
import hmac
import json

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.errors import Unauthorized, ValidationFailed
from app.core.models import IntegrationInbox
from app.db import get_db

router = APIRouter(tags=["integrations"])
PROVIDERS = {"teams", "azure-devops", "generic"}


@router.post("/integrations/{provider}/webhooks", status_code=202)
async def webhook(provider: str, request: Request, x_signature: str | None = Header(None, alias="X-Signature"),
                  x_delivery_id: str | None = Header(None, alias="X-Delivery-Id"), db: Session = Depends(get_db)):
    if provider not in PROVIDERS:
        raise ValidationFailed("Unknown provider")
    raw = await request.body()
    expected = hmac.new(get_settings().webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
    if not x_signature or not hmac.compare_digest(expected, x_signature.removeprefix("sha256=")):
        raise Unauthorized("Invalid webhook signature")
    if not x_delivery_id:
        raise ValidationFailed("X-Delivery-Id header is required")
    try:
        payload = json.loads(raw or b"{}")
    except json.JSONDecodeError as exc:
        raise ValidationFailed("Body must be JSON") from exc
    stmt = insert(IntegrationInbox).values(provider=provider, delivery_id=x_delivery_id[:200],
                                           event_type=str(payload.get("eventType", "unknown"))[:80],
                                           payload=payload).on_conflict_do_nothing(
        index_elements=["provider", "delivery_id"]).returning(IntegrationInbox.id)
    inserted = db.execute(stmt).scalar()
    db.commit()
    return {"accepted": True, "duplicate": inserted is None}
