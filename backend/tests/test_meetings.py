"""AI meeting notes — F4 scenarios: no fabrication, idempotent approval, failure recovery, permission-safe access."""

import uuid

from sqlalchemy import select, text

from app.modules.meetings import ai
from app.modules.meetings.models import Meeting
from app.modules.work.models import WorkItem


def wp_id(api):
    return next(p["id"] for p in api.get("/projects").json() if p["key"] == "WP")


def mid_point(api):
    return next(m for m in api.get("/meetings").json() if m["title"] == "Sprint 14 mid-point review")


def run_worker():
    from app.worker import dispatch_outbox, process_meetings

    process_meetings()
    dispatch_outbox()


def test_imported_transcript_is_processed_into_reviewable_proposals(as_user):
    ri = as_user("ri")
    r = ri.post("/meetings/import", json={
        "projectId": wp_id(ri), "title": "Backlog refinement", "startAt": "2026-10-08T05:00:00+00:00",
        "transcript": "00:01:00 R. Iyer: We agreed to drop IE11 support.\n"
                      "00:02:00 A. Rao: I'll update the browser matrix by tomorrow.\n"
                      "00:03:00 M. Lin: Not sure which Android versions we still test?\n"})
    assert r.status_code == 201 and r.json()["status"] == "queued"
    run_worker()
    m = ri.get(f"/meetings/{r.json()['id']}").json()
    assert m["status"] == "review_required"
    assert m["summary"]["modelName"].startswith("heuristic") and m["summary"]["promptVersion"]
    assert m["summary"]["decisions"][0]["evidence"]["start"] == 60
    action = m["proposals"][0]
    assert action["owner"]["name"] == "A. Rao" and action["dueDate"] == "2026-10-09"
    assert action["evidence"]["startLabel"] == "00:02:00"
    # Reviewers were notified through the outbox.
    assert any("Review required" in n["title"] for n in ri.get("/notifications").json()["items"])


def test_no_fabricated_owner_or_due_date_and_due_date_required_to_approve(as_user):
    """F4: transcript with no clear owner/date -> AI does not fabricate; reviewer must set the date."""
    ri = as_user("ri")
    m = ri.get(f"/meetings/{mid_point(ri)['id']}").json()
    finance = next(p for p in m["proposals"] if "Finance" in p["title"])
    assert finance["owner"] is None and finance["ownerNameRaw"] is None and finance["dueDate"] is None
    r = ri.post(f"/ai-action-proposals/{finance['id']}/decision", json={"decision": "approve"})
    assert r.status_code == 422 and r.json()["code"] == "due_date_required"
    assert ri.get("/work-items/WP-1064").status_code == 404  # nothing created


def test_approve_replay_creates_no_duplicate_ticket(as_user, db):
    """F4 / AC-06/07/09: approve an AI action, replay the approval, verify exactly one ticket with provenance."""
    ri = as_user("ri")
    m = ri.get(f"/meetings/{mid_point(ri)['id']}").json()
    finance = next(p for p in m["proposals"] if "Finance" in p["title"])
    members = {x["name"]: x["id"] for x in m["members"]}
    body = {"decision": "approve", "edits": {"dueDate": "2026-10-16", "ownerUserId": members["M. Shah"]}}
    key = uuid.uuid4().hex
    first = ri.post(f"/ai-action-proposals/{finance['id']}/decision", json=body, headers={"Idempotency-Key": key})
    assert first.status_code == 200, first.text
    replay = ri.post(f"/ai-action-proposals/{finance['id']}/decision", json=body, headers={"Idempotency-Key": key})
    assert replay.headers.get("Idempotent-Replay") == "true"
    # A retry without the key (e.g. a re-delivered event) is still idempotent at the domain level.
    again = ri.post(f"/ai-action-proposals/{finance['id']}/decision", json={"decision": "approve"})
    assert again.status_code == 200
    created_key = first.json()["createdWorkItem"]["key"]
    assert replay.json()["createdWorkItem"]["key"] == again.json()["createdWorkItem"]["key"] == created_key
    n = db.scalar(select(text("count(*)")).select_from(WorkItem).where(WorkItem.source_proposal_id == uuid.UUID(finance["id"])))
    assert n == 1
    ticket = ri.get(f"/work-items/{created_key}").json()
    assert ticket["meetingSource"]["title"] == "Sprint 14 mid-point review"
    assert ticket["meetingSource"]["segmentStart"] == finance["evidence"]["start"]
    assert ticket["assignee"]["name"] == "M. Shah" and ticket["dueDate"] == "2026-10-16"
    audit = db.execute(text("select safe_metadata from audit_events where action='ai_proposal.approved' "
                            "and entity_id=:i"), {"i": finance["id"]}).scalar()
    assert audit["meeting_id"] and audit["evidence_start"] is not None  # AC-07 provenance retained


def test_rejected_proposal_creates_nothing(as_user):
    ri = as_user("ri")
    m = ri.get(f"/meetings/{mid_point(ri)['id']}").json()
    rejected = next(p for p in m["proposals"] if p["reviewState"] == "rejected")
    assert rejected["createdWorkItem"] is None and rejected["rejectReason"]
    pending = next(p for p in m["proposals"] if p["reviewState"] == "pending")
    assert ri.post(f"/ai-action-proposals/{pending['id']}/decision", json={"decision": "reject"}).status_code == 422
    r = ri.post(f"/ai-action-proposals/{pending['id']}/decision", json={"decision": "reject", "reason": "Not agreed"})
    assert r.status_code == 200 and r.json()["createdWorkItem"] is None


def test_update_proposal_moves_ticket_to_next_sprint(as_user):
    ri = as_user("ri")
    m = ri.get(f"/meetings/{mid_point(ri)['id']}").json()
    move = next(p for p in m["proposals"] if p["kind"] == "update")
    assert move["target"]["key"] == "WP-1061"
    r = ri.post(f"/ai-action-proposals/{move['id']}/decision", json={"decision": "approve"})
    assert r.status_code == 200, r.text
    ticket = ri.get("/work-items/WP-1061").json()
    assert ticket["sprint"]["name"] == "Sprint 15"


def test_only_reviewers_approve_ai_actions(as_user):
    sp = as_user("sp")  # attendee, but not an AI reviewer
    m = sp.get(f"/meetings/{mid_point(as_user('ri'))['id']}").json()
    assert m["access"]["reviewer"] is False
    assert m["proposals"] == []  # unpublished AI content is hidden from non-reviewers
    ri_m = as_user("ri").get(f"/meetings/{m['id']}").json()
    pending = next(p for p in ri_m["proposals"] if p["reviewState"] == "pending")
    assert sp.post(f"/ai-action-proposals/{pending['id']}/decision", json={"decision": "reject", "reason": "x"}).status_code == 403


def test_provider_timeout_and_malformed_output_are_recoverable(as_user, db):
    """F4: AI timeout / malformed output -> FAILED with error, alert, then successful retry."""
    ri = as_user("ri")
    r = ri.post("/meetings/import", json={"projectId": wp_id(ri), "title": "Flaky", "process": True,
                                          "startAt": "2026-10-08T05:00:00+00:00",
                                          "transcript": "00:00:05 A. Rao: I'll fix it by Friday.\n"})
    meeting_id = uuid.UUID(r.json()["id"])

    class Broken:
        def analyze(self, ctx):
            raise ai.ProviderError("Model runtime error: ReadTimeout")

    from app.modules.meetings.service import process_meeting

    process_meeting(db, meeting_id, provider=Broken())
    m = db.get(Meeting, meeting_id)
    db.refresh(m)
    assert m.status == "failed" and "ReadTimeout" in m.error and m.retry_count == 1
    from app.worker import dispatch_outbox

    dispatch_outbox()
    assert any("Processing failed" in n["title"] for n in ri.get("/notifications").json()["items"])
    # Malformed model output is rejected by schema validation.
    try:
        ai.MeetingAnalysis.model_validate({"executive_summary": 5, "action_items": [{"confidence": 9}]})
        raise AssertionError("should not validate")
    except Exception as exc:  # noqa: BLE001
        assert "validation" in str(exc).lower()
    # Manual retry succeeds and does not duplicate proposals.
    assert ri.post(f"/meetings/{meeting_id}/process").status_code == 200
    run_worker()
    detail = ri.get(f"/meetings/{meeting_id}").json()
    assert detail["status"] == "review_required" and len(detail["proposals"]) == 1


def test_meeting_note_not_reachable_through_linked_ticket(as_user):
    """F4: a user who can see a ticket cannot read the attendee-only meeting it came from."""
    dp = as_user("dp")  # Web Portal contributor, not an attendee of the planning meeting
    ticket = dp.get("/work-items/WP-1042").json()
    assert ticket["meetingSource"] == {"restricted": True}
    planning = next(m for m in as_user("ri").get("/meetings").json() if m["title"] == "Sprint 14 planning")
    assert dp.get(f"/meetings/{planning['id']}").status_code == 404
    assert all(m["title"] != "Sprint 14 planning" for m in dp.get("/meetings").json())
    assert dp.get("/search?q=planning").json()["meetings"] == []
    sp = as_user("sp")  # attendee
    assert sp.get(f"/meetings/{planning['id']}").status_code == 200
    assert sp.get("/work-items/WP-1042").json()["meetingSource"]["title"] == "Sprint 14 planning"


def test_inaccessible_meetings_cannot_be_imported_or_searched(as_user):
    """F4: limited permissions -> cannot import into or search meetings of other projects; Teams unconfigured."""
    ml = as_user("ml")
    co = next(p["id"] for p in as_user("ko").get("/projects").json() if p["key"] == "CO")
    r = ml.post("/meetings/import", json={"projectId": co, "title": "x", "startAt": "2026-10-08T05:00:00+00:00",
                                          "transcript": "00:00:01 A: hi there"})
    assert r.status_code == 404
    r = as_user("ri").post("/meetings/import", json={"projectId": wp_id(as_user("ri")), "source": "teams",
                                                     "externalMeetingId": "abc", "organizerId": "u1"})
    assert r.status_code == 503 and r.json()["code"] == "teams_not_configured"
    outsider = as_user("ql")  # not a Web Portal member
    assert outsider.get("/search?q=Sprint").json()["meetings"] == []


def test_publish_makes_summary_visible_to_members(as_user):
    ri, dp = as_user("ri"), as_user("dp")
    mid = mid_point(ri)["id"]
    assert dp.get(f"/meetings/{mid}").json()["summary"] is None  # unpublished AI content
    r = ri.post(f"/meetings/{mid}/publish", json={"summary": {"executiveSummary": "Reviewed summary."}})
    assert r.status_code == 200
    m = dp.get(f"/meetings/{mid}").json()
    assert m["summary"]["executiveSummary"] == "Reviewed summary." and m["summary"]["edited"] is True
    assert m["lifecycle"][4]["key"] == "published"
