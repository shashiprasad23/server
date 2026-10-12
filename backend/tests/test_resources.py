"""Resource capacity and allocation — F4: over-allocate, add leave, change calendar, verify recalculation (AC-08)."""

from datetime import timedelta

from app.core.timeutil import today_in, week_start


def monday(offset_weeks=0):
    return week_start(today_in("Asia/Kolkata")) + timedelta(days=7 * offset_weeks)


def cell(grid, name, week_start_):
    row = next(r for r in grid["rows"] if r["user"]["name"] == name)
    return next(c for c in row["weeks"] if c["weekStart"] == str(week_start_))


def grid(api, start=None, weeks=4):
    return api.get(f"/resources/capacity?from={start or monday(-1)}&weeks={weeks}").json()


def test_capacity_allocation_and_actual_are_separate_measures(as_user):
    rm = as_user("rm")
    g = grid(rm)
    sp = cell(g, "S. Prasad", monday(-1))
    assert sp["net"] == 2400 and sp["planned"] == 36 * 60  # 24h + 4h + 8h across three projects
    assert sp["actual"] > 0 and sp["actual"] != sp["planned"]  # logged time never fills allocation
    assert {b["key"] for b in sp["byProject"]} == {"WP", "CO", "AS"}
    assert round(sp["allocationRatio"], 2) == 0.9
    assert g["definitions"]["utilization"].startswith("actual")


def test_leave_and_holiday_create_conflicts(as_user):
    g = grid(as_user("rm"))
    ml = cell(g, "M. Lin", monday(0))  # approved leave Tue-Wed this week
    assert ml["net"] == 3 * 480 and ml["leaveDays"]
    assert any(f["kind"] == "leave_conflict" for f in ml["flags"])
    dp = cell(g, "D. Patel", monday(1))  # public holiday next week
    assert dp["net"] == 4 * 480 and dp["holidays"]
    assert any(c["kind"] == "skills_gap" and "Azure Service Bus" in c["title"] for c in g["conflicts"])
    assert any(c["kind"] == "leave_conflict" and c["user"] == "M. Lin" for c in g["conflicts"])


def test_over_allocate_add_leave_change_calendar_recalculates(as_user):
    """F4: over-allocate a resource, add leave, change a calendar; capacity recalculates correctly."""
    rm, ad = as_user("rm"), as_user("ad")
    wp = next(p["id"] for p in rm.get("/projects").json() if p["key"] == "WP") if rm.get("/projects").json() else None
    wp = wp or next(p["id"] for p in ad.get("/projects").json() if p["key"] == "WP")
    users = {u["name"]: u["id"] for u in rm.get("/users").json()}
    week = monday(2)
    before = cell(grid(rm), "M. Shah", week)
    r = rm.post("/allocations", json={"userId": users["M. Shah"], "projectId": wp, "startDate": str(week),
                                      "endDate": str(week + timedelta(days=6)), "unit": "hours", "hoursPerWeek": 10})
    assert r.status_code == 201, r.text
    after = cell(grid(rm), "M. Shah", week)
    assert after["planned"] == before["planned"] + 600
    assert any(f["kind"] == "over_allocated" for f in after["flags"])

    assert rm.post("/leaves", json={"userId": users["M. Shah"], "startDate": str(week),
                                    "endDate": str(week)}).status_code == 201
    with_leave = cell(grid(rm), "M. Shah", week)
    assert with_leave["net"] == after["net"] - 480
    assert any(f["kind"] == "leave_conflict" for f in with_leave["flags"])

    cal = ad.get("/calendars").json()[0]
    assert ad.put(f"/calendars/{cal['id']}", json={"weekdayMinutes": [420] * 5 + [0, 0]}).status_code == 200
    recalculated = cell(grid(rm), "M. Shah", week)
    assert recalculated["gross"] == 5 * 420 and recalculated["net"] == 4 * 420


def test_percent_allocation_and_validation(as_user):
    rm = as_user("rm")
    users = {u["name"]: u["id"] for u in rm.get("/users").json()}
    co = next(p["id"] for p in as_user("ko").get("/projects").json() if p["key"] == "CO")
    r = rm.post("/allocations", json={"userId": users["T. Becker"], "projectId": co, "startDate": str(monday(3)),
                                      "endDate": str(monday(3) + timedelta(days=6)), "unit": "percent", "percent": 50})
    assert r.status_code == 201
    assert cell(grid(rm, monday(3), 1), "T. Becker", monday(3))["byProject"][-1]["planned"] == 1200
    bad = rm.post("/allocations", json={"userId": users["T. Becker"], "projectId": co, "startDate": str(monday(3)),
                                        "endDate": str(monday(2)), "unit": "percent", "percent": 150})
    assert bad.status_code == 422 and "endDate" in bad.json()["errors"]


def test_allocation_permissions(as_user):
    """Contributors cannot allocate; a PM allocates only within their own project."""
    sp, ri = as_user("sp"), as_user("ri")
    users = {u["name"]: u["id"] for u in sp.get("/users").json()}
    projects = {p["key"]: p["id"] for p in as_user("ad").get("/projects").json()}
    body = {"userId": users["A. Rao"], "startDate": str(monday(2)), "endDate": str(monday(2) + timedelta(days=6)),
            "unit": "hours", "hoursPerWeek": 4}
    assert sp.post("/allocations", json={**body, "projectId": projects["WP"]}).status_code == 403
    assert ri.post("/allocations", json={**body, "projectId": projects["WP"]}).status_code == 201
    assert ri.post("/allocations", json={**body, "projectId": projects["CO"]}).status_code == 403


def test_contributor_sees_only_own_capacity(as_user):
    g = grid(as_user("sp"))
    assert [r["user"]["name"] for r in g["rows"]] == ["S. Prasad"]
