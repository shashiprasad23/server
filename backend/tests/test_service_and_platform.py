"""Service desk SLA, audit immutability, outbox, webhooks, exports, search, admin (C7, C9-C12, F1)."""

import hashlib
import hmac
import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError


def offering(api, name):
    return next(o for o in api.get("/service/catalog").json() if o["name"] == name)


def test_catalog_request_validates_form_and_starts_sla(as_user):
    dp = as_user("dp")  # any employee may request published services
    off = offering(dp, "Access provisioning")
    r = dp.post(f"/service/offerings/{off['id']}/requests", json={"answers": {"system": "Staging"}})
    assert r.status_code == 422 and "justification" in r.json()["errors"]
    r = dp.post(f"/service/offerings/{off['id']}/requests",
                json={"answers": {"system": "Mainframe", "justification": "x"}})
    assert r.status_code == 422 and "system" in r.json()["errors"]
    key = uuid.uuid4().hex
    r = dp.post(f"/service/offerings/{off['id']}/requests", headers={"Idempotency-Key": key},
                json={"answers": {"system": "Staging", "justification": "Release testing"}})
    assert r.status_code == 201
    replay = dp.post(f"/service/offerings/{off['id']}/requests", headers={"Idempotency-Key": key},
                     json={"answers": {"system": "Staging", "justification": "Release testing"}})
    assert replay.json()["key"] == r.json()["key"]
    sla = as_user("ql").get(f"/work-items/{r.json()['key']}/sla").json()
    assert sla["state"]["state"] == "running" and sla["events"][0]["kind"] == "started"


def test_incident_priority_matrix_and_sla_pause_resume(as_user):
    ql = as_user("ql")
    off = offering(ql, "Report an incident")
    r = ql.post(f"/service/offerings/{off['id']}/requests",
                json={"title": "Portal down", "answers": {"service": "Customer portal"}, "impact": "high", "urgency": "high"})
    key = r.json()["key"]
    item = ql.get(f"/work-items/{key}").json()
    assert item["priority"] == "P1" and item["serviceFields"]["severity_level"] == "Sev 1"
    ql.post(f"/work-items/{key}/transitions", json={"to": "investigating"})
    ql.post(f"/work-items/{key}/transitions", json={"to": "waiting_on_requester"})
    assert ql.get(f"/work-items/{key}/sla").json()["state"]["state"] == "paused"
    ql.post(f"/work-items/{key}/transitions", json={"to": "investigating"})
    kinds = [e["kind"] for e in ql.get(f"/work-items/{key}/sla").json()["events"]]
    assert kinds == ["started", "responded", "paused", "resumed"]
    # Sev 1 incidents need a post-incident review before closing.
    r = ql.post(f"/work-items/{key}/transitions", json={"to": "closed"})
    assert r.status_code == 422 and r.json()["code"] == "pir_required"


def test_change_request_needs_approval_by_authorised_role(as_user):
    tb, ql = as_user("tb"), as_user("ql")
    chg = next(i for i in ql.get("/service/queue?view=changes").json()["items"])
    r = tb.post(f"/work-items/{chg['key']}/transitions", json={"to": "approved"})
    assert r.status_code == 403  # service agents cannot approve their own change
    assert ql.post(f"/work-items/{chg['key']}/transitions", json={"to": "approved"}).status_code == 200
    assert tb.post(f"/work-items/{chg['key']}/transitions", json={"to": "resolved"}).status_code == 200


def test_sla_breach_sweep_flags_once_and_notifies(as_user, db):
    from app.worker import dispatch_outbox, sweep_sla

    assert sweep_sla() >= 1  # seeded P2 incident is past its target
    assert sweep_sla() == 0  # breach is recorded once
    dispatch_outbox()
    q = as_user("ql").get("/service/queue").json()
    assert q["stats"]["breached"] >= 1
    assert any("SLA breached" in n["title"] for n in as_user("ql").get("/notifications").json()["items"])


def test_audit_events_are_append_only(db):
    with pytest.raises(DBAPIError):
        db.execute(text("UPDATE audit_events SET action = 'tampered'"))
        db.commit()
    db.rollback()
    with pytest.raises(DBAPIError):
        db.execute(text("DELETE FROM audit_events"))
        db.commit()


def test_outbox_failures_retry_then_dead_letter_and_replay(as_user, db, monkeypatch):
    from app import worker
    from app.modules.notifications import service as notifications

    as_user("sp").log("WP-1042", 30)  # emits TimeEntryCreated
    db.execute(text("UPDATE outbox_events SET event_type = 'WorkItemCreated', payload = '{\"assignee_id\": \"x\"}' "
                    "WHERE published_at IS NULL"))
    db.commit()

    def boom(*a, **k):
        raise RuntimeError("downstream unavailable")

    monkeypatch.setattr(notifications, "handle", boom)
    for _ in range(6):
        db.execute(text("UPDATE outbox_events SET next_attempt_at = now() - interval '1 second'"))
        db.commit()
        worker.dispatch_outbox()
    dead = db.execute(text("SELECT id FROM outbox_events WHERE dead_lettered")).scalars().all()
    assert dead
    health = as_user("ad").get("/admin/integrations/health").json()
    assert health["outbox"]["deadLettered"] >= 1
    monkeypatch.undo()
    assert as_user("ad").post(f"/admin/integrations/dead-letters/{dead[0]}/replay").status_code == 200


def test_webhook_signature_and_dedup(client):
    body = json.dumps({"eventType": "workitem.updated", "id": 7}).encode()
    sig = hmac.new(b"dev-webhook-secret", body, hashlib.sha256).hexdigest()
    url = "/api/v1/integrations/azure-devops/webhooks"
    assert client.post(url, content=body, headers={"X-Signature": "bad", "X-Delivery-Id": "d1"}).status_code == 401
    first = client.post(url, content=body, headers={"X-Signature": f"sha256={sig}", "X-Delivery-Id": "d1"})
    second = client.post(url, content=body, headers={"X-Signature": sig, "X-Delivery-Id": "d1"})
    assert first.json() == {"accepted": True, "duplicate": False}
    assert second.json() == {"accepted": True, "duplicate": True}


def test_csv_export_is_audited_and_neutralises_formulas(as_user, db):
    ri = as_user("ri")
    wp = next(p["id"] for p in ri.get("/projects").json() if p["key"] == "WP")
    item = ri.get("/work-items/WP-1071").json()
    ri.patch("/work-items/WP-1071", json={"title": "=HYPERLINK(\"http://evil\")", "version": item["version"]})
    r = ri.get(f"/reports/estimate-vs-actual?projectId={wp}&format=csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "'=HYPERLINK" in r.text
    assert db.execute(text("select count(*) from audit_events where action='report.exported'")).scalar() == 1


def test_reports_carry_refresh_metadata_and_compliance(as_user):
    ri = as_user("ri")
    comp = ri.get("/reports/timesheet-compliance").json()
    assert comp["mode"] == "real-time" and comp["refreshedAt"] and comp["timezone"] == "Asia/Kolkata"
    assert {r["user"]["name"] for r in comp["rows"]} >= {"S. Prasad", "A. Rao"}
    assert as_user("sp").get("/reports/timesheet-compliance").json()["rows"] == []  # contributors see no one else
    assert ri.get("/reports/ai-actions").json()["approved"] >= 1
    assert ri.get("/reports/project-health").json()["projects"]


def test_search_respects_permissions(as_user):
    assert as_user("sp").get("/search?q=CVV").json()["workItems"]
    assert as_user("ql").get("/search?q=CVV").json()["workItems"] == []  # not a Web Portal member
    assert as_user("ql").get("/search?q=Service Bus").json()["workItems"] == []  # Checkout v2 only
    assert as_user("sp").get("/search?q=Service Bus").json()["workItems"]


def test_admin_only_settings_and_audited_role_changes(as_user, db):
    sp, ad = as_user("sp"), as_user("ad")
    assert sp.get("/admin/settings").status_code == 403
    r = ad.patch("/admin/settings", json={"settings": {"feature_flags": {"ai": False}}})
    assert r.status_code == 200 and r.json()["settings"]["feature_flags"]["ai"] is False
    wp = next(p["id"] for p in ad.get("/projects").json() if p["key"] == "WP")
    r = as_user("ri").post("/meetings/import", json={"projectId": wp, "title": "x", "startAt": "2026-10-08T05:00:00",
                                                     "transcript": "00:00:01 A: hello there"})
    assert r.status_code == 503 and r.json()["code"] == "feature_disabled"
    users = {u["name"]: u["id"] for u in ad.get("/admin/users").json()}
    assert ad.patch(f"/admin/users/{users['T. Becker']}", json={"status": "deactivated"}).status_code == 200
    assert db.execute(text("select count(*) from audit_events where action='user.access_changed'")).scalar() == 1
    assert ad.get("/admin/audit?action=user.").json()["total"] >= 1


def test_errors_have_consistent_shape_and_correlation_id(client):
    r = client.get("/api/v1/me", headers={"X-Correlation-ID": "abc123"})
    assert r.status_code == 401
    assert r.json()["code"] == "unauthorized" and r.json()["correlationId"] == "abc123"
    assert r.headers["X-Correlation-ID"] == "abc123"
