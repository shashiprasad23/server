"""Background worker: outbox dispatch, AI meeting processing, SLA sweeps, Teams delivery (D2, D6).

Runs in-process for development (UPM_RUN_WORKER_IN_PROCESS=true) or standalone: `python -m app.worker`.
Claims work with FOR UPDATE SKIP LOCKED so several workers can run safely.
"""

import logging
import threading
import time
from datetime import timedelta

from sqlalchemy import select

from app.config import get_settings
from app.core.events import emit
from app.core.models import OutboxEvent
from app.db import session_factory, utcnow
from app.modules.meetings.models import FAILED, QUEUED, Meeting

log = logging.getLogger("upm.worker")
MAX_AUTO_RETRIES = 2


def dispatch_outbox(batch: int = 50) -> int:
    from app.modules.notifications.service import handle

    s = get_settings()
    db = session_factory()()
    done = 0
    try:
        events = list(db.scalars(select(OutboxEvent).where(
            OutboxEvent.published_at.is_(None), OutboxEvent.dead_lettered.is_(False),
            OutboxEvent.next_attempt_at <= utcnow()).order_by(OutboxEvent.created_at).limit(batch)
            .with_for_update(skip_locked=True)))
        for ev in events:
            try:
                with db.begin_nested():
                    handle(db, ev)
                ev.published_at = utcnow()
                done += 1
            except Exception as exc:  # noqa: BLE001
                ev.attempts += 1
                ev.last_error = f"{exc.__class__.__name__}: {exc}"[:1000]
                ev.next_attempt_at = utcnow() + timedelta(seconds=min(2 ** ev.attempts * 5, 3600))
                if ev.attempts >= s.outbox_max_attempts:
                    ev.dead_lettered = True
                    emit(db, "IntegrationDeliveryFailed", "outbox_event", ev.id, error=ev.last_error,
                         failed_event_type=ev.event_type)
                log.warning("outbox event %s failed: %s", ev.id, exc)
        db.commit()
    finally:
        db.close()
    return done


def process_meetings() -> int:
    from app.modules.meetings.service import process_meeting

    db = session_factory()()
    count = 0
    try:
        # Automatic retries with backoff; after that a reviewer retries or corrects manually.
        for m in db.scalars(select(Meeting).where(Meeting.status == FAILED, Meeting.retry_count <= MAX_AUTO_RETRIES,
                                                  Meeting.updated_at < utcnow() - timedelta(seconds=30))):
            m.status = QUEUED
        db.commit()
        ids = list(db.scalars(select(Meeting.id).where(Meeting.status == QUEUED).order_by(Meeting.queued_at).limit(5)))
        for mid in ids:
            process_meeting(db, mid)
            count += 1
    finally:
        db.close()
    return count


def sweep_sla() -> int:
    from app.modules.service_desk.sla import sweep_breaches

    db = session_factory()()
    try:
        return sweep_breaches(db)
    finally:
        db.close()


def deliver_teams() -> int:
    from app.modules.notifications.service import deliver_teams as _deliver

    db = session_factory()()
    try:
        return _deliver(db)
    finally:
        db.close()


def run_once() -> dict:
    return {"meetings": process_meetings(), "outbox": dispatch_outbox(), "sla": sweep_sla(), "teams": deliver_teams()}


class Worker(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="upm-worker")
        self._stop_event = threading.Event()

    def run(self) -> None:
        interval = get_settings().worker_poll_seconds
        while not self._stop_event.is_set():
            try:
                run_once()
            except Exception:  # noqa: BLE001
                log.exception("worker iteration failed")
            self._stop_event.wait(interval)

    def stop(self) -> None:
        self._stop_event.set()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    log.info("worker started")
    while True:
        run_once()
        time.sleep(get_settings().worker_poll_seconds)
