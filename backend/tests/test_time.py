"""Universal time logging, timesheets and approvals — F4 mandatory scenarios and BR-TIME rules."""

import uuid
from datetime import timedelta

from sqlalchemy import select, text

from app.core.timeutil import today_in, week_start
from app.modules.time.models import TimeEntry

TZ = "Asia/Kolkata"


def today():
    return today_in(TZ)


def create(api, project_key, type_, title, **extra):
    projects = {p["key"]: p["id"] for p in api.get("/projects").json()}
    r = api.post("/work-items", json={"projectId": projects[project_key], "type": type_, "title": title,
                                      "originalEstimateMinutes": 120, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_log_work_on_every_ticket_type(as_user):
    """F4: log time on Epic, Story, Task, Sub-task, Bug, Service Request, Incident, Change Request, Test/QA task."""
    ri, ql = as_user("ri"), as_user("ql")
    epic = create(ri, "WP", "epic", "Epic for logging")
    story = create(ri, "WP", "story", "Story", parentId=epic["id"])
    keys = [epic["key"], story["key"],
            create(ri, "WP", "task", "Task")["key"],
            create(ri, "WP", "subtask", "Sub-task", parentId=story["id"])["key"],
            create(ri, "WP", "bug", "Bug")["key"],
            create(ri, "WP", "test_task", "QA task")["key"],
            create(ql, "AS", "service_request", "SR")["key"],
            create(ql, "AS", "incident", "INC")["key"],
            create(ql, "AS", "change_request", "CHG")["key"]]
    for key in keys:
        api = ql if key.startswith("AS") else ri
        r = api.log(key, 30)
        assert r.status_code == 201, (key, r.text)
        detail = api.get(f"/work-items/{key}").json()
        assert any(e["durationMinutes"] == 30 for e in detail["timeEntries"])  # AC-01 work history visible


def test_idempotent_log_work_creates_exactly_one_entry(as_user, db):
    """F4: retry the same Log Work request several times with the same key -> one entry (BR-TIME-08, AC-09)."""
    sp = as_user("sp")
    key = uuid.uuid4().hex
    responses = [sp.log("WP-1042", 45, key_=key) for _ in range(4)]
    assert {r.status_code for r in responses} == {201}
    assert responses[1].headers.get("Idempotent-Replay") == "true"
    assert len({r.json()["id"] for r in responses}) == 1
    n = db.scalar(select(text("count(*)")).select_from(TimeEntry).where(TimeEntry.idempotency_key == key))
    assert n == 1
    # Same key with a different payload is refused rather than silently ignored.
    r = sp.log("WP-1042", 50, key_=key)
    assert r.status_code == 409 and r.json()["code"] == "idempotency_key_reused"


def test_idempotency_key_is_required(as_user):
    sp = as_user("sp")
    r = sp.post("/work-items/WP-1042/time-entries", json={"workDate": str(today()), "durationMinutes": 30,
                                                          "activityCategory": "Development",
                                                          "description": "Some valid description"})
    assert r.status_code == 422 and r.json()["code"] == "idempotency_key_required"


def test_auto_reduce_remaining_estimate_with_floor_and_audit(as_user):
    sp = as_user("sp")
    before = sp.get("/work-items/WP-1042").json()
    assert before["remainingEstimateMinutes"] == 210
    r = sp.log("WP-1042", 90, remainingEstimateAction="REDUCE_AUTOMATICALLY")
    assert r.status_code == 201 and r.json()["remainingEstimateMinutes"] == 120
    r = sp.log("WP-1042", 500, remainingEstimateAction="REDUCE_AUTOMATICALLY")
    assert r.json()["remainingEstimateMinutes"] == 0  # BR-TIME-04 lower bound of zero
    after = sp.get("/work-items/WP-1042").json()
    assert after["originalEstimateMinutes"] == before["originalEstimateMinutes"]  # BR-TIME-03 baseline kept
    assert after["status"] == before["status"]  # BR-TIME-05 logging never changes status
    hist = sp.get("/work-items/WP-1042/history?field=remaining_estimate_minutes").json()
    assert hist and hist[0]["newValue"] == "0"
    r = sp.log("WP-1042", 30, remainingEstimateAction="SET_NEW", remainingEstimateMinutes="2h")
    assert r.json()["remainingEstimateMinutes"] == 120


def test_parent_and_child_totals_count_each_entry_once(as_user):
    """F4 / BR-TIME-09/10: parent total = direct + descendants, each entry once."""
    ri = as_user("ri")
    parent = create(ri, "WP", "story", "Hierarchy parent")
    child = create(ri, "WP", "subtask", "Hierarchy child", parentId=parent["id"])
    grandchild_parent = create(ri, "WP", "task", "Other branch")
    assert ri.log(parent["key"], 60).status_code == 201
    assert ri.log(child["key"], 45).status_code == 201
    assert ri.log(grandchild_parent["key"], 15).status_code == 201
    # Totals are computed under the reporting policy; submit to count them.
    ri.post("/timesheets/submit", json={"weekStart": str(week_start(today())), "confirmMissing": True})
    detail = ri.get(f"/work-items/{parent['key']}").json()
    root = next(h for h in detail["hierarchy"] if h["isRoot"])
    assert (root["direct"], root["descendants"], root["total"]) == (60, 45, 105)
    report = ri.get(f"/reports/estimate-vs-actual?projectId={detail['projectId']}").json()
    rows = {r["key"]: r for r in report["rows"]}
    assert rows[parent["key"]]["total"] == 105 and rows[child["key"]]["total"] == 45
    # The report grand total sums direct time only, so nothing is double counted.
    assert report["totals"]["actual"] == sum(r["direct"] for r in report["rows"])


def test_date_window_and_locked_period_are_rejected_with_clear_errors(as_user):
    """F4: outside the allowed date window and in a locked period -> rejection with clear errors."""
    sp = as_user("sp")
    r = sp.log("WP-1042", 30, work_date=today() + timedelta(days=1))
    assert r.status_code == 422 and "future" in r.json()["errors"]["workDate"][0]
    r = sp.log("WP-1042", 30, work_date=today() - timedelta(days=30))
    assert r.status_code == 422 and "Backdating" in r.json()["errors"]["workDate"][0]
    r = sp.log("WP-1042", 30, description="short")
    assert r.status_code == 422 and "min 10 characters" in r.json()["errors"]["description"][0]
    r = sp.log("WP-1042", 0)
    assert r.status_code == 422 and "durationMinutes" in r.json()["errors"]
    # Week 40 is locked in the seed; widen the window so only the lock applies.
    ri = as_user("ri")
    project_id = sp.get("/work-items/WP-1042").json()["projectId"]
    ri.patch(f"/projects/{project_id}", json={"settings": {"time": {"backdate_days": 60}}})
    locked_day = week_start(today()) - timedelta(days=14)
    r = sp.log("WP-1042", 30, work_date=locked_day)
    assert r.status_code == 422 and r.json()["code"] == "period_locked"


def test_daily_maximum_is_enforced(as_user):
    sp = as_user("sp")
    assert sp.log("WP-1042", 700).status_code == 201
    r = sp.log("WP-1042", 400)
    assert r.status_code == 422 and "Daily limit" in r.json()["errors"]["durationMinutes"][0]


def test_edit_own_unapproved_entry_but_approved_needs_amendment(as_user):
    """F4: edit own unapproved entry; editing an approved entry requires the correction flow."""
    sp, ri = as_user("sp"), as_user("ri")
    entry = sp.log("WP-1042", 30).json()
    r = sp.patch(f"/time-entries/{entry['id']}", json={"durationMinutes": 45, "version": entry["version"]})
    assert r.status_code == 200 and r.json()["durationMinutes"] == 45
    # Someone else cannot edit it (BR-TIME-11).
    assert as_user("ar").patch(f"/time-entries/{entry['id']}", json={"durationMinutes": 10}).status_code == 403

    approved = next(e for e in sp.get("/work-items/WP-1042").json()["timeEntries"] if e["approvalStatus"] == "approved")
    r = sp.patch(f"/time-entries/{approved['id']}", json={"durationMinutes": 10})
    assert r.status_code == 422 and r.json()["code"] == "amendment_required"
    r = sp.post(f"/time-entries/{approved['id']}/amendments", json={"reason": "Logged against the wrong day",
                                                                    "durationMinutes": 100})
    assert r.status_code == 201
    corr_id = r.json()["id"]
    assert sp.post(f"/time-entries/{approved['id']}/amendments", json={"reason": "again please"}).status_code == 409
    assert sp.post(f"/amendments/{corr_id}/decision", json={"decision": "approve"}).status_code == 403  # not approver
    r = ri.post(f"/amendments/{corr_id}/decision", json={"decision": "approve"})
    assert r.status_code == 200 and r.json()["state"] == "approved"
    entries = {e["id"]: e for e in sp.get("/work-items/WP-1042").json()["timeEntries"]}
    assert entries[approved["id"]]["approvalStatus"] == "voided"  # original kept, auditable
    replacement = next(e for e in entries.values() if e["correctsEntryId"] == approved["id"])
    assert replacement["durationMinutes"] == 100 and replacement["approvalStatus"] == "approved"


def test_submit_and_approve_timesheet_updates_reports_once_and_is_audited(as_user, db):
    """F4: submit and approve a timesheet; reports update exactly once and approvals are audited."""
    sp, ri, ko = as_user("sp"), as_user("ri"), as_user("ko")
    last_week = week_start(today()) - timedelta(days=7)
    project_id = sp.get("/work-items/WP-1042").json()["projectId"]

    def approved_actual():
        rep = ri.get(f"/reports/estimate-vs-actual?projectId={project_id}&policy=approved").json()
        return rep["totals"]["actual"]

    # Rejected entries must be corrected before resubmitting.
    r = sp.post("/timesheets/submit", json={"weekStart": str(last_week), "confirmMissing": True})
    assert r.status_code == 422 and r.json()["code"] == "rejected_entries_outstanding"
    week = sp.get(f"/timesheets/week?start={last_week}").json()
    rejected = week["rejectedEntries"][0]
    assert "WP-1052" in rejected["rejectionReason"]
    assert sp.post(f"/time-entries/{rejected['id']}/void", json={"reason": "Re-logged on WP-1052"}).status_code == 200

    r = sp.post("/timesheets/submit", json={"weekStart": str(last_week)})
    assert r.status_code == 422 and r.json()["code"] == "missing_time"  # validates missing time
    r = sp.post("/timesheets/submit", json={"weekStart": str(last_week), "confirmMissing": True})
    assert r.status_code == 200, r.text

    queue = ri.get("/timesheets/approvals").json()["queue"]
    mine = next(q for q in queue if q["user"]["name"] == "S. Prasad" and q["project"]["key"] == "WP")
    # Approvers see only their own project's slice.
    assert all(q["project"]["key"] == "WP" for q in queue)
    assert all(q["project"]["key"] != "WP" for q in ko.get("/timesheets/approvals").json()["queue"])

    before = approved_actual()
    period = mine["periodId"]
    assert sp.post(f"/timesheets/{period}/decision", json={"projectId": project_id, "decision": "approve"}).status_code == 403
    assert ri.post(f"/timesheets/{period}/decision", json={"projectId": project_id, "decision": "reject"}).status_code == 422
    r = ri.post(f"/timesheets/{period}/decision", json={"projectId": project_id, "decision": "approve"})
    assert r.status_code == 200 and r.json()["decided"] == mine["count"]
    after = approved_actual()
    assert after - before == mine["minutes"]  # exactly once
    # Re-approving is a no-op, not a double count.
    r = ri.post(f"/timesheets/{period}/decision", json={"projectId": project_id, "decision": "approve"})
    assert r.status_code == 422 and approved_actual() == after
    audits = db.execute(text("select count(*) from audit_events where action='time_entry.approved'")).scalar()
    assert audits >= mine["count"]  # one audit event per entry, even for bulk approval


def test_reject_with_reason_then_correct_and_resubmit(as_user):
    sp, ri = as_user("sp"), as_user("ri")
    this_week = week_start(today())
    sp.log("WP-1042", 60)
    sp.post("/timesheets/submit", json={"weekStart": str(this_week), "confirmMissing": True})
    project_id = sp.get("/work-items/WP-1042").json()["projectId"]
    period = next(q for q in ri.get("/timesheets/approvals").json()["queue"]
                  if q["periodStart"] == str(this_week) and q["user"]["name"] == "S. Prasad")
    r = ri.post(f"/timesheets/{period['periodId']}/decision",
                json={"projectId": project_id, "decision": "reject", "reason": "Split by sub-task please"})
    assert r.status_code == 200
    rejected = sp.get(f"/timesheets/week?start={this_week}").json()["rejectedEntries"]
    assert rejected and all(e["rejectionReason"] == "Split by sub-task please" for e in rejected)
    r = sp.post("/timesheets/submit", json={"weekStart": str(this_week), "confirmMissing": True})
    assert r.status_code == 422 and r.json()["code"] == "rejected_entries_outstanding"
    for entry in rejected:
        r = sp.patch(f"/time-entries/{entry['id']}", json={"description": "Validation work on amount field, split"})
        assert r.json()["approvalStatus"] == "draft"  # corrected -> resubmit
    assert sp.post("/timesheets/submit", json={"weekStart": str(this_week), "confirmMissing": True}).status_code == 200


def test_lock_and_privileged_reopen_is_audited(as_user, db):
    """Multi-project week: each approver decides their own slice; a fully approved period can then be locked."""
    sp, ri, ql, ad = as_user("sp"), as_user("ri"), as_user("ql"), as_user("ad")
    this_week = week_start(today())
    sp.log("WP-1042", 60)
    assert sp.post("/timesheets/submit", json={"weekStart": str(this_week), "confirmMissing": True}).status_code == 200
    projects = {p["key"]: p["id"] for p in ri.get("/projects").json()}
    as_project = next(p["id"] for p in ql.get("/projects").json() if p["key"] == "AS")
    pid = next(q for q in ri.get("/timesheets/approvals").json()["queue"]
               if q["periodStart"] == str(this_week) and q["user"]["name"] == "S. Prasad")["periodId"]
    assert ri.post(f"/timesheets/{pid}/decision", json={"projectId": projects["WP"], "decision": "approve"}).status_code == 200
    # Web Portal approved, Application Support still pending: not lockable yet.
    assert ad.post(f"/timesheets/{pid}/lock").json()["code"] == "not_approved"
    assert ql.post(f"/timesheets/{pid}/decision", json={"projectId": as_project, "decision": "approve"}).status_code == 200
    assert sp.post(f"/timesheets/{pid}/lock").status_code == 403
    assert ri.post(f"/timesheets/{pid}/lock").status_code == 403  # not approver for every project in the week
    r = ad.post(f"/timesheets/{pid}/lock")
    assert r.status_code == 200 and r.json()["state"] == "locked", r.text
    assert sp.log("WP-1042", 30).json()["code"] == "period_locked"
    assert ri.post(f"/timesheets/{pid}/reopen", json={"reason": "needs fix"}).status_code == 403
    r = ad.post(f"/timesheets/{pid}/reopen", json={"reason": "Correction requested by finance"})
    assert r.status_code == 200
    assert db.execute(text("select count(*) from audit_events where action='timesheet.reopened'")).scalar() == 1
    assert sp.log("WP-1042", 30).status_code == 201


def test_cannot_log_or_view_outside_authorized_scope(as_user):
    """AC-05 / BR-TIME-11: users cannot view or log time on projects they are not members of."""
    ml = as_user("ml")  # QA in WP and service agent in AS; not a member of CO
    assert ml.get("/work-items/CO-12").status_code == 404
    assert ml.log("CO-12", 30).status_code == 404
    ex = as_user("ex")  # executive: aggregate reports only
    assert ex.get("/work-items/WP-1042").status_code == 404
    project_id = as_user("ri").get("/work-items/WP-1042").json()["projectId"]
    rep = ex.get(f"/reports/estimate-vs-actual?projectId={project_id}").json()
    assert rep["detailRestricted"] is True and rep["rows"] == [] and rep["totals"]["original"] > 0


def test_viewer_role_cannot_log_work(as_user):
    ri = as_user("ri")  # viewer in Application Support
    sr = next(i for i in as_user("ql").get("/service/queue").json()["items"])
    assert ri.log(sr["key"], 30).status_code == 403


def test_concurrent_period_creation_does_not_collide(fresh_db):
    """Regression: parallel requests for the same user/week used to race on the period's unique key."""
    from concurrent.futures import ThreadPoolExecutor

    from app.db import session_factory
    from app.modules.identity.models import User
    from app.modules.time.service import get_or_create_period

    with session_factory()() as s:
        user_id = s.scalar(select(User.id).where(User.email == "a.rao@example.com"))
    day = week_start(today()) + timedelta(days=21)

    def create(_):
        with session_factory()() as s:
            period = get_or_create_period(s, user_id, day)
            s.commit()
            return period.id

    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = set(pool.map(create, range(16)))
    assert len(ids) == 1
