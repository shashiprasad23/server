"""Work management, workflow validators, agile sprints, optimistic concurrency."""

from datetime import timedelta

from app.core.timeutil import today_in


def projects(api):
    return {p["key"]: p["id"] for p in api.get("/projects").json()}


def test_hierarchy_rules_and_cycles(as_user):
    ri = as_user("ri")
    wp = projects(ri)["WP"]
    r = ri.post("/work-items", json={"projectId": wp, "type": "subtask", "title": "Orphan"})
    assert r.status_code == 422 and "parentId" in r.json()["errors"]
    epic = ri.get("/work-items/WP-980").json()
    r = ri.post("/work-items", json={"projectId": wp, "type": "subtask", "title": "Bad parent", "parentId": epic["id"]})
    assert r.status_code == 422
    r = ri.post("/work-items", json={"projectId": wp, "type": "incident", "title": "Wrong project kind"})
    assert r.status_code == 422
    story = ri.get("/work-items/WP-1042").json()
    child = ri.get("/work-items/WP-1043").json()
    # Moving the story under its own sub-task is rejected (subtask can't parent a story anyway); test a real cycle:
    task = ri.post("/work-items", json={"projectId": wp, "type": "task", "title": "Parent task"}).json()
    sub = ri.post("/work-items", json={"projectId": wp, "type": "subtask", "title": "Sub", "parentId": task["id"]}).json()
    assert ri.patch(f"/work-items/{task['key']}", json={"parentId": sub["id"], "version": task["version"]}).status_code == 422
    assert story["parentId"] == epic["id"] and child["parentId"] == story["id"]


def test_estimate_required_before_active_work_and_transitions_recorded(as_user):
    ri = as_user("ri")
    item = ri.post("/work-items", json={"projectId": projects(ri)["WP"], "type": "story", "title": "No estimate"}).json()
    r = ri.post(f"/work-items/{item['key']}/transitions", json={"to": "in_progress"})
    assert r.status_code == 422 and r.json()["code"] == "estimate_required"
    ri.patch(f"/work-items/{item['key']}", json={"originalEstimateMinutes": "2h", "version": item["version"]})
    r = ri.post(f"/work-items/{item['key']}/transitions", json={"to": "in_progress", "comment": "Starting"})
    assert r.status_code == 200 and r.json()["statusName"] == "In progress"
    hist = ri.get(f"/work-items/{item['key']}/history?field=status").json()
    assert hist[0]["oldValue"] == "To do" and hist[0]["newValue"] == "In progress" and hist[0]["actor"]["name"]


def test_optimistic_concurrency(as_user):
    ri, sp = as_user("ri"), as_user("sp")
    item = ri.get("/work-items/WP-1071").json()
    assert ri.patch("/work-items/WP-1071", json={"title": "First", "version": item["version"]}).status_code == 200
    r = sp.patch("/work-items/WP-1071", json={"title": "Second", "version": item["version"]})
    assert r.status_code == 409 and r.json()["code"] == "version_conflict"
    assert sp.patch("/work-items/WP-1071", json={"title": "No version"}).status_code == 422


def test_locked_baseline_needs_manager_and_reason(as_user):
    sp, ri = as_user("sp"), as_user("ri")
    item = sp.get("/work-items/WP-1042").json()
    assert item["estimateLocked"]
    assert sp.patch("/work-items/WP-1042", json={"originalEstimateMinutes": 600, "version": item["version"]}).status_code == 403
    assert ri.patch("/work-items/WP-1042", json={"originalEstimateMinutes": 600, "version": item["version"]}).status_code == 422
    r = ri.patch("/work-items/WP-1042", json={"originalEstimateMinutes": 600, "version": item["version"],
                                             "estimateChangeReason": "Scope added in review"})
    assert r.status_code == 200 and r.json()["originalEstimateMinutes"] == 600


def test_sprint_complete_requires_destination(as_user):
    ri = as_user("ri")
    board = ri.get(f"/projects/{projects(ri)['WP']}/board").json()
    sprint = board["sprint"]
    assert sprint["name"] == "Sprint 14" and board["report"]["committedPoints"] > 0
    assert {c["key"] for c in board["columns"]} >= {"todo", "in_progress", "done"}
    r = ri.post(f"/sprints/{sprint['id']}/complete", json={})
    assert r.status_code == 422 and r.json()["code"] == "destination_required"
    nxt = next(s for s in ri.get(f"/projects/{projects(ri)['WP']}/sprints").json() if s["name"] == "Sprint 15")
    r = ri.post(f"/sprints/{sprint['id']}/complete", json={"destination": nxt["id"]})
    assert r.status_code == 200 and r.json()["moved"] > 0
    assert ri.get("/work-items/WP-1042").json()["sprint"]["name"] == "Sprint 15"
    assert ri.get("/work-items/WP-1039").json()["sprint"]["name"] == "Sprint 14"  # done work stays


def test_scope_change_after_sprint_start_is_audited(as_user):
    ri = as_user("ri")
    wp = projects(ri)["WP"]
    sprint = ri.get(f"/projects/{wp}/board").json()["sprint"]
    item = ri.get("/work-items/WP-1070").json()
    ri.patch("/work-items/WP-1070", json={"sprintId": sprint["id"], "version": item["version"]})
    report = ri.get(f"/sprints/{sprint['id']}/report").json()
    assert report["scopeChange"]["addedItems"] == 1 and report["scopeChange"]["addedPoints"] == 3


def test_contributor_cannot_plan_sprints_and_my_work(as_user):
    sp = as_user("sp")
    wp = projects(sp)["WP"]
    today = today_in("Asia/Kolkata")
    r = sp.post(f"/projects/{wp}/sprints", json={"startDate": str(today), "endDate": str(today + timedelta(days=10))})
    assert r.status_code == 403
    mw = sp.get("/my-work").json()
    assert {c["project"]["key"] for c in mw["projects"]} == {"WP", "CO", "AS"}
    roles = {c["project"]["key"]: c["role"] for c in mw["projects"]}
    assert roles["AS"] == "service_agent" and roles["WP"] == "contributor"
    assert mw["assigned"] and all(i["assignee"]["name"] == "S. Prasad" for i in mw["assigned"])


def test_comments_mentions_notify_only_members(as_user):
    from app.worker import dispatch_outbox

    sp = as_user("sp")
    assert sp.post("/work-items/WP-1042/comments", json={"body": "@a.rao please review, also @l.fernandes"}).status_code == 201
    dispatch_outbox()
    assert any("mentioned you" in n["title"] for n in as_user("ar").get("/notifications").json()["items"])
    assert not any("mentioned you" in n["title"] for n in as_user("ql").get("/notifications").json()["items"])
