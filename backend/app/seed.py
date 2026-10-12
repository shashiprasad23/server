"""Demo data mirroring the UX blueprint scenario (Web Portal / Checkout v2 / Application Support).

Dates are relative to the current week so the demo always looks current. Run: `python -m app.seed [--reset]`.
Business records go through the domain services (same validation as the API) except back-dated time entries,
which are inserted directly because they fall outside the normal backdating window.
"""

import sys
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

import app.models  # noqa: F401
from app.core.security import load_principal
from app.core.timeutil import today_in, week_start
from app.db import get_engine, session_factory, utcnow
from app.modules.agile.service import create_sprint, start_sprint
from app.modules.identity.models import DEFAULT_ORG_SETTINGS, Organization, ProjectMembership, Team, User
from app.modules.meetings import service as meetings
from app.modules.meetings.models import AiActionProposal
from app.modules.resources.models import Allocation, CalendarException, Leave, ResourceProfile, WorkingCalendar
from app.modules.service_desk.models import SlaPolicy
from app.modules.service_desk.service import save_offering, submit_request
from app.modules.time.models import APPROVED, DRAFT, PERIOD_LOCKED, REJECTED, SUBMITTED, TimeEntry, TimesheetPeriod
from app.modules.work.models import WorkItem, WorkItemLink
from app.modules.work.service import create_project, create_work_item, transition

TZ = "Asia/Kolkata"

PEOPLE = [
    # key, name, email, title, skills, global roles
    ("sp", "S. Prasad", "s.prasad@example.com", "Frontend", ["React", "TypeScript"], []),
    ("ri", "R. Iyer", "r.iyer@example.com", "Project manager", ["Delivery", "Agile"], []),
    ("ko", "K. Osei", "k.osei@example.com", "Tech lead", [".NET", "Architecture"], []),
    ("ar", "A. Rao", "a.rao@example.com", "Backend", [".NET", "PostgreSQL", "Python"], []),
    ("dp", "D. Patel", "d.patel@example.com", "Frontend", ["React"], []),
    ("ml", "M. Lin", "m.lin@example.com", "QA", ["QA automation", "Playwright"], []),
    ("ms", "M. Shah", "m.shah@example.com", "Full-stack", [".NET", "React"], []),
    ("tb", "T. Becker", "t.becker@example.com", "DevOps", ["Azure", "CI/CD"], []),
    ("ql", "L. Fernandes", "l.fernandes@example.com", "Queue lead", ["ITSM"], []),
    ("rm", "N. Kapoor", "n.kapoor@example.com", "Resource manager", [], ["resource_manager"]),
    ("ex", "E. Grant", "e.grant@example.com", "Portfolio director", [], ["executive_viewer"]),
    ("ad", "Platform Admin", "admin@example.com", "Administrator", [], ["platform_admin"]),
]

TRANSCRIPT = """00:12:41 R. Iyer: So we agree — every payment field gets validated on the server too, no exceptions.
00:14:22 A. Rao: I'll add the CVV length check on the server side before Friday.
00:22:10 S. Prasad: Client-side rules are done; error copy is in review.
00:31:05 M. Shah: Someone needs to check with Finance how JPY and KWD should round.
00:38:20 M. Lin: I've asked for the 13th and 14th off, so the regression pack might slip.
00:42:10 D. Patel: If 1042 isn't done by Monday, let's push saved cards to next sprint.
00:47:02 T. Becker: Maybe at some point we could load test checkout.
"""


def reset() -> None:
    eng = get_engine()
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    import os

    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(os.path.dirname(__file__)), "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(os.path.dirname(__file__)), "alembic"))
    with eng.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")


def run() -> None:
    db = session_factory()()
    if db.scalar(select(Organization)):
        print("Seed data already present (use --reset to rebuild).")
        return
    today = today_in(TZ)
    this_monday = week_start(today)
    last_monday = this_monday - timedelta(days=7)  # the blueprint's "week 41"

    org = Organization(name="Demo Organization", timezone=TZ, settings=DEFAULT_ORG_SETTINGS)
    db.add(org)
    db.flush()
    cal = WorkingCalendar(organization_id=org.id, name="India · 40h week", timezone=TZ,
                          weekday_minutes=[480] * 5 + [0, 0])
    db.add(cal)
    db.flush()
    db.add(CalendarException(calendar_id=cal.id, date=this_monday + timedelta(days=10), minutes=0,
                             reason="Public holiday"))
    team = Team(organization_id=org.id, name="Payments")
    db.add(team)
    db.flush()
    u: dict[str, User] = {}
    for key, name, email, title, skills, roles in PEOPLE:
        user = User(organization_id=org.id, display_name=name, email=email, global_roles=roles, timezone=TZ,
                    identity_provider_subject=f"demo-{key}")
        db.add(user)
        db.flush()
        u[key] = user
        if key not in {"ex", "ad"}:
            db.add(ResourceProfile(user_id=user.id, team_id=team.id if key not in {"ql", "rm"} else None, title=title,
                                   skills=skills, pools=["Payments"], location="Bengaluru", calendar_id=cal.id))
    db.commit()

    def P(k):
        return load_principal(db, u[k])

    # ---------------------------------------------------------------- projects & membership
    wp = create_project(db, P("ad"), {"key": "WP", "name": "Web Portal", "color": "#2F4FC9",
                                      "description": "Customer web portal: payment form hardening and saved cards."})
    co = create_project(db, P("ad"), {"key": "CO", "name": "Checkout v2", "color": "#0F766E",
                                      "methodology": "Discovery · architecture spike",
                                      "settings": {"required_skills": ["Azure Service Bus"]}})
    asp = create_project(db, P("ad"), {"key": "AS", "name": "Application Support", "kind": "service",
                                       "color": "#7C3AED"})
    db.flush()
    for pr in (wp, co, asp):  # the admin created them; hand ownership to the real managers
        db.execute(text("DELETE FROM project_memberships WHERE project_id = :p"), {"p": pr.id})

    def member(pr, k, role, approver=False, reviewer=False):
        db.add(ProjectMembership(project_id=pr.id, user_id=u[k].id, role=role, is_time_approver=approver,
                                 is_ai_reviewer=reviewer))

    member(wp, "ri", "project_manager", approver=True, reviewer=True)
    for k in ("sp", "ar", "dp", "ms", "tb"):
        member(wp, k, "contributor")
    member(wp, "ml", "qa")
    member(co, "ko", "project_manager", approver=True, reviewer=True)
    for k in ("sp", "ar", "tb"):
        member(co, k, "contributor")
    member(asp, "ql", "service_owner", approver=True)
    for k in ("sp", "ar", "ml", "tb"):
        member(asp, k, "service_agent")
    member(asp, "ri", "viewer")
    wp.owner_id, co.owner_id, asp.owner_id = u["ri"].id, u["ko"].id, u["ql"].id
    db.commit()

    # ---------------------------------------------------------------- sprints & work items
    s13 = create_sprint(db, P("ri"), wp, {"name": "Sprint 13", "goal": "Card masking and analytics",
                                          "startDate": str(today - timedelta(days=25)),
                                          "endDate": str(today - timedelta(days=12))})
    s14 = create_sprint(db, P("ri"), wp, {
        "name": "Sprint 14", "startDate": str(today - timedelta(days=11)), "endDate": str(today + timedelta(days=2)),
        "goal": "Payment form rejects invalid input on client and server, with regression coverage."})
    s15 = create_sprint(db, P("ri"), wp, {"name": "Sprint 15", "goal": "Saved cards",
                                          "startDate": str(today + timedelta(days=3)),
                                          "endDate": str(today + timedelta(days=16))})
    s13.state, s13.committed_points, s13.closed_at = "closed", 21, utcnow()
    db.commit()
    items: dict[str, WorkItem] = {}

    def item(pr, seq, actor, **data):
        pr.next_sequence = seq
        it = create_work_item(db, P(actor), pr, data)
        db.flush()
        items[it.key] = it
        return it

    epic = item(wp, 980, "ri", type="epic", title="Payment form hardening",
                description="Harden the payment form: validation, masking, rounding and regression coverage.")
    item(wp, 1039, "ri", type="story", title="Card number masking", parentId=epic.id, storyPoints=8,
         originalEstimateMinutes=720, assigneeId=u["dp"].id, sprintId=s14.id)
    item(wp, 1040, "ri", type="task", title="Payment form analytics events", parentId=epic.id, storyPoints=3,
         originalEstimateMinutes=300, assigneeId=u["ar"].id, sprintId=s14.id)
    s1042 = item(wp, 1042, "ri", type="story", title="Validate payment form inputs before submission",
                 parentId=epic.id, storyPoints=5, originalEstimateMinutes=480, assigneeId=u["sp"].id,
                 sprintId=s14.id, priority="high", dueDate=str(today + timedelta(days=2)),
                 description="Reject invalid card number, expiry, CVV and amount on both client and server.")
    item(wp, 1043, "ri", type="subtask", title="Client-side field rules", parentId=s1042.id, storyPoints=1,
         originalEstimateMinutes=180, assigneeId=u["sp"].id, sprintId=s14.id)
    item(wp, 1044, "ri", type="subtask", title="Error message copy", parentId=s1042.id, storyPoints=1,
         originalEstimateMinutes=60, assigneeId=u["sp"].id, sprintId=s14.id)
    item(wp, 1047, "ri", type="task", title="Server-side validation rules", parentId=epic.id, storyPoints=3,
         originalEstimateMinutes=480, assigneeId=u["ar"].id, sprintId=s14.id)
    b1051 = item(wp, 1051, "ri", type="bug", title="Currency field rounds incorrectly", parentId=epic.id,
                 storyPoints=2, originalEstimateMinutes=240, assigneeId=u["ms"].id, sprintId=s14.id, priority="high")
    item(wp, 1052, "ri", type="subtask", title="Fix rounding in currency formatter", parentId=b1051.id,
         storyPoints=1, originalEstimateMinutes=120, assigneeId=u["ms"].id, sprintId=s14.id)
    item(wp, 1060, "ri", type="test_task", title="Regression pack — payments", parentId=epic.id, storyPoints=3,
         originalEstimateMinutes=480, assigneeId=u["ml"].id, sprintId=s14.id)
    s1061 = item(wp, 1061, "ri", type="story", title="Show saved cards on payment step", storyPoints=5,
                 originalEstimateMinutes=360, assigneeId=u["dp"].id, sprintId=s14.id)
    item(wp, 1070, "ri", type="story", title="Remember preferred payment method", storyPoints=3,
         originalEstimateMinutes=300)
    item(wp, 1071, "ri", type="bug", title="Expiry field accepts past months", originalEstimateMinutes=90)
    db.add(WorkItemLink(source_id=s1042.id, target_id=s1061.id, link_type="blocks", created_by=u["ri"].id))
    db.commit()
    start_sprint(db, P("ri"), s14)
    db.commit()
    for key, status in [("WP-1039", "done"), ("WP-1040", "done"), ("WP-1044", "done"), ("WP-1042", "in_progress"),
                        ("WP-1047", "in_progress"), ("WP-1051", "in_progress"), ("WP-1043", "in_review"),
                        ("WP-1060", "in_review")]:
        if key in {"WP-1044", "WP-1043"}:
            transition(db, P("sp"), items[key], "in_progress")
        if status == "done" and key != "WP-1044":
            transition(db, P("ri"), items[key], "in_progress")
        transition(db, P("ri"), items[key], status)
    db.commit()
    # Back-date "done" history so the burndown shows progress over the sprint.
    db.execute(text("UPDATE work_item_history SET occurred_at = :d WHERE field='status' AND new_value='done' "
                    "AND work_item_id = :i"), {"d": datetime.combine(today - timedelta(days=6), datetime.min.time(), UTC),
                                               "i": items["WP-1039"].id})
    db.execute(text("UPDATE work_item_history SET occurred_at = :d WHERE field='status' AND new_value='done' "
                    "AND work_item_id = :i"), {"d": datetime.combine(today - timedelta(days=3), datetime.min.time(), UTC),
                                               "i": items["WP-1040"].id})

    for key, remaining in {"WP-1039": 0, "WP-1040": 0, "WP-1042": 210, "WP-1043": 0, "WP-1044": 0, "WP-1047": 60,
                           "WP-1051": 90, "WP-1060": 120}.items():
        items[key].remaining_estimate_minutes = remaining
    db.commit()

    co12 = item(co, 12, "ko", type="task", title="Spike: Service Bus retry and dead-letter handling",
                originalEstimateMinutes=240, assigneeId=u["sp"].id, dueDate=str(today + timedelta(days=4)))
    transition(db, P("ko"), co12, "in_progress")
    item(co, 13, "ko", type="story", title="Idempotent payment capture API", originalEstimateMinutes=960,
         storyPoints=8)
    db.commit()

    # ---------------------------------------------------------------- service desk
    sla = SlaPolicy(organization_id=org.id, name="Standard support", targets={
        "P1": {"response": 15, "resolution": 240}, "P2": {"response": 60, "resolution": 480},
        "P3": {"response": 240, "resolution": 4320}, "P4": {"response": 480, "resolution": 7200}})
    db.add(sla)
    db.flush()
    off = {}
    for name, cat, rtype, prio, schema in [
        ("Access provisioning", "Access", "service_request", "P3",
         [{"key": "system", "label": "System", "type": "select", "required": True,
           "options": ["QA environment", "Staging", "Production read-only"]},
          {"key": "justification", "label": "Business justification", "type": "textarea", "required": True}]),
        ("New test environment", "Environments", "service_request", "P2",
         [{"key": "project", "label": "Project", "type": "text", "required": True},
          {"key": "needed_by", "label": "Needed by", "type": "date", "required": False}]),
        ("Reset test data", "Test data", "service_request", "P4",
         [{"key": "dataset", "label": "Dataset", "type": "text", "required": True}]),
        ("Report an incident", "Incidents", "incident", "P3",
         [{"key": "service", "label": "Affected service", "type": "select", "required": True,
           "options": ["Online payments", "Notifications", "Customer portal"]}]),
        ("Standard change", "Changes", "change_request", "P3",
         [{"key": "implementation_plan", "label": "Implementation plan", "type": "textarea", "required": True},
          {"key": "rollback_plan", "label": "Rollback plan", "type": "textarea", "required": True},
          {"key": "maintenance_window", "label": "Maintenance window", "type": "text", "required": True}]),
    ]:
        off[name] = save_offering(db, P("ql"), {
            "projectId": str(asp.id), "name": name, "category": cat, "requestType": rtype, "defaultPriority": prio,
            "formSchema": schema, "slaPolicyId": str(sla.id), "ownerId": str(u["ql"].id), "published": True,
            "supportGroup": "Application Support", "description": f"{name} for delivery teams."})
    db.commit()

    def req(offering, actor, title, answers, assignee=None, status=None, age_minutes=0, **kw):
        it = submit_request(db, P(actor), off[offering].id, {"title": title, "answers": answers, **kw})
        db.flush()
        if age_minutes:
            # Shift the SLA clock back to model an older ticket.
            delta = timedelta(minutes=age_minutes)
            for attr in ("sla_started_at", "sla_response_due_at", "sla_resolution_due_at"):
                if getattr(it, attr):
                    setattr(it, attr, getattr(it, attr) - delta)
            it.created_at = it.created_at - delta
        if assignee:
            it.assignee_id = u[assignee].id
        if status:
            for st in status:
                transition(db, P("ql"), it, st)
        items[it.key] = it
        return it

    req("Report an incident", "dp", "Payment receipt email delayed", {"service": "Notifications"},
        impact="medium", urgency="high", age_minutes=600)
    inc = req("Report an incident", "tb", "Checkout latency spike", {"service": "Online payments"},
              impact="high", urgency="high", assignee="sp", status=["investigating"], age_minutes=140)
    inc.service_fields = {**inc.service_fields, "severity_level": "Sev 2"}
    req("Standard change", "tb", "Deploy validation rules to production",
        {"implementation_plan": "Blue/green deploy of API v1.8 with feature flag", "rollback_plan": "Flip flag, redeploy v1.7",
         "maintenance_window": "Wed 22:00–23:00 IST"}, assignee="tb", status=["awaiting_approval"],
        change_type="Standard", risk="Low")
    req("New test environment", "ko", "New test environment for Checkout v2", {"project": "Checkout v2"},
        assignee="ar", status=["in_progress"], age_minutes=200)
    req("Access provisioning", "ml", "Access provisioning — QA environment",
        {"system": "QA environment", "justification": "Regression pack needs QA DB read access"},
        assignee="sp", status=["in_progress", "waiting_on_requester"], age_minutes=1500)
    req("Reset test data", "ml", "Reset test card data", {"dataset": "Test cards v3"}, assignee="ml",
        status=["open"])
    db.commit()

    # ---------------------------------------------------------------- allocations, leave
    w = [this_monday + timedelta(days=7 * i) for i in range(-1, 4)]  # W41 (last week) .. W45

    def alloc(k, pr, hours, start, end, state="confirmed"):
        db.add(Allocation(user_id=u[k].id, project_id=pr.id, start_date=start, end_date=end, unit="hours",
                          minutes_per_week=int(hours * 60), state=state, created_by=u["rm"].id,
                          role="Contributor"))

    def wk(i):  # start/end of week i (0 == last week)
        return w[i], w[i] + timedelta(days=6)

    for i, (wph, coh, ash) in enumerate([(24, 4, 8), (28, 4, 8), (20, 8, 4), (8, 12, 4)]):
        alloc("sp", wp, wph, *wk(i))
        alloc("sp", co, coh, *wk(i))
        alloc("sp", asp, ash, *wk(i))
    for i, h in enumerate([40, 32, 40, 30]):
        alloc("ar", wp, h, *wk(i))
    alloc("ar", asp, 12, *wk(1))
    for i, h in enumerate([32, 40, 40, 36]):
        alloc("dp", wp, h, *wk(i))
    for i, h in enumerate([36, 40, 32, 20]):
        alloc("ml", wp, h, *wk(i))
    for i, h in enumerate([40, 36, 40, 40]):
        alloc("ms", wp, h, *wk(i))
    for i, h in enumerate([20, 20, 16, 16]):
        alloc("tb", wp, h, *wk(i))
    alloc("ko", co, 30, w[0], w[3] + timedelta(days=6), state="tentative")
    db.add(Leave(user_id=u["ml"].id, start_date=this_monday + timedelta(days=1), end_date=this_monday + timedelta(days=2),
                 state="approved", reason="Personal leave", created_by=u["rm"].id))
    db.commit()

    # ---------------------------------------------------------------- time entries
    def entry(k, key, d, minutes, activity, desc, status, reason=None):
        it = items[key]
        e = TimeEntry(work_item_id=it.id, project_id=it.project_id, user_id=u[k].id, work_date=d,
                      duration_minutes=minutes, activity_category=activity, description=desc, approval_status=status,
                      source="web", idempotency_key=f"seed-{uuid.uuid4()}", created_by=u[k].id)
        if status in {SUBMITTED, APPROVED, REJECTED}:
            e.submitted_at = utcnow()
        if status == APPROVED:
            e.approved_at, e.approved_by = utcnow(), u["ri"].id
        if status == REJECTED:
            e.rejection_reason, e.approved_by = reason, u["ri"].id
        db.add(e)

    L = last_monday
    mon, tue, wed, thu, fri = (L + timedelta(days=i) for i in range(5))
    sp_rows = [
        ("WP-1042", [(mon, 120, APPROVED, "Development", "Form field validators scaffolded."),
                     (tue, 90, APPROVED, "Code review", "Review of validation schema PR."),
                     (thu, 150, SUBMITTED, "Development", "Server-side checks for card expiry and CVV."),
                     (fri, 90, DRAFT, "Development", "Wired validation errors into the form state.")]),
        ("WP-1043", [(mon, 60, APPROVED, "Development", "Card number and expiry client rules."),
                     (wed, 90, SUBMITTED, "Development", "CVV and amount client rules.")]),
        ("WP-1044", [(tue, 45, APPROVED, "Analysis / Design", "Drafted error copy with UX."),
                     (wed, 30, SUBMITTED, "Development", "Applied reviewed copy to the form.")]),
        ("WP-1047", [(mon, 120, APPROVED, "Development", "Pair-programmed validation middleware."),
                     (tue, 120, APPROVED, "Development", "Server-side amount limits."),
                     (wed, 180, SUBMITTED, "Development", "Validation rule engine integration.")]),
        ("WP-1051", [(mon, 60, APPROVED, "Analysis / Design", "Reproduced rounding defect."),
                     (tue, 60, REJECTED, "Development", "Currency rounding investigation.",
                      "This was spent on the currency rounding sub-task — log it against WP-1052."),
                     (wed, 120, SUBMITTED, "Development", "Rounding fix for two-decimal currencies."),
                     (thu, 90, SUBMITTED, "Testing / QA", "Verified rounding across locales.")]),
        ("WP-1060", [(mon, 60, APPROVED, "Testing / QA", "Regression pack plan."),
                     (wed, 60, SUBMITTED, "Testing / QA", "Automated card validation cases."),
                     (thu, 30, SUBMITTED, "Testing / QA", "Added CVV edge cases.")]),
        ("CO-12", [(mon, 60, APPROVED, "Analysis / Design", "Read Service Bus retry docs."),
                   (wed, 60, SUBMITTED, "Development", "Prototype dead-letter consumer.")]),
    ]
    for key, rows in sp_rows:
        for d, m, st, act, desc, *reason in rows:
            entry("sp", key, d, m, act, desc, st, reason[0] if reason else None)
    sr = [x for x in items.values() if x.title.startswith("Access provisioning")][0]
    entry("sp", sr.key, mon, 60, "Support", "Requested DB role from platform team.", APPROVED)
    entry("sp", sr.key, tue, 90, "Support", "Configured QA database access group.", APPROVED)
    entry("sp", sr.key, wed, 60, "Support", "Follow-up with requester on scope.", SUBMITTED)
    entry("sp", inc.key, tue, 120, "Support", "Initial triage of latency alerts.", APPROVED)
    entry("sp", inc.key, thu, 210, "Support", "Traced latency to connection pool exhaustion.", SUBMITTED)
    # This week so far: drafts
    entry("sp", "WP-1042", this_monday, 60, "Development", "Server-side validation for amount field.", DRAFT)
    entry("sp", inc.key, this_monday, 90, "Support", "Applied pool sizing hotfix in staging.", DRAFT)

    # Teammates (week 41) so compliance and capacity reports have data.
    for k, key, per_day, st in [("ar", "WP-1047", [480, 480, 480, 480, 360], APPROVED),
                                ("dp", "WP-1039", [480, 480, 480, 360, 0], SUBMITTED),
                                ("ml", "WP-1060", [480, 480, 480, 480, 240], SUBMITTED),
                                ("ms", "WP-1051", [480, 480, 480, 480, 420], APPROVED),
                                ("tb", "WP-1040", [300, 300, 240, 180, 300], DRAFT)]:
        for i, m in enumerate(per_day):
            if m:
                entry(k, key, L + timedelta(days=i), m, "Development" if k != "ml" else "Testing / QA",
                      "Sprint 14 delivery work.", st)
    # Week 40 approved & locked for S. Prasad (shows locked-period behaviour).
    w40 = L - timedelta(days=7)
    for i in range(5):
        entry("sp", "WP-1039" if i < 2 else "WP-1040", w40 + timedelta(days=i), 480, "Development",
              "Sprint 13 delivery work.", APPROVED)
    db.add(TimesheetPeriod(user_id=u["sp"].id, period_start=w40, period_end=w40 + timedelta(days=6),
                           state=PERIOD_LOCKED, approved_at=utcnow(), locked_at=utcnow(), locked_by=u["ri"].id))
    db.add(TimesheetPeriod(user_id=u["sp"].id, period_start=L, period_end=L + timedelta(days=6), state="open"))
    db.commit()

    # ---------------------------------------------------------------- meeting + AI review (real pipeline)
    wp.next_sequence = 1063
    db.commit()
    m = meetings.import_meeting(db, P("ri"), {
        "projectId": str(wp.id), "title": "Sprint 14 mid-point review",
        "startAt": datetime.combine(tue, datetime.min.time(), UTC).replace(hour=4, minute=30).isoformat(),
        "attendees": ["R. Iyer", "A. Rao", "S. Prasad", "M. Shah", "M. Lin", "D. Patel", "T. Becker"],
        "source": "upload"}, raw_transcript=TRANSCRIPT)
    db.commit()
    meetings.process_meeting(db, m.id)
    db.refresh(m)
    props = list(db.scalars(select(AiActionProposal).where(AiActionProposal.meeting_id == m.id)))
    for prop in props:
        if "CVV" in prop.title:
            meetings.decide_proposal(db, P("ri"), prop.id, {"decision": "approve"})
        elif "load test" in prop.title.lower():
            meetings.decide_proposal(db, P("ri"), prop.id, {"decision": "reject",
                                                            "reason": "Raised as an idea, not agreed"})
    db.commit()
    # Planning meeting that the story 1042 originated from (attendee-scoped, published).
    m2 = meetings.import_meeting(db, P("ri"), {
        "projectId": str(wp.id), "title": "Sprint 14 planning", "accessScope": "attendees",
        "startAt": datetime.combine(today - timedelta(days=11), datetime.min.time(), UTC).replace(hour=4).isoformat(),
        "attendees": ["R. Iyer", "S. Prasad", "A. Rao"], "source": "upload"},
        raw_transcript="00:12:41 R. Iyer: We agreed the payment form must validate every input before submission.\n"
                       "00:13:30 S. Prasad: I'll take the validation story and split client and server rules.\n")
    db.commit()
    meetings.process_meeting(db, m2.id)
    meetings.publish(db, P("ri"), db.get(type(m2), m2.id))
    s1042.source_meeting_id, s1042.source_segment_start = m2.id, 761
    db.commit()

    # Outbox events from seeding are historical; mark them published so the demo inbox starts clean.
    db.execute(text("UPDATE outbox_events SET published_at = now()"))
    db.commit()
    print(f"Seeded demo organization with {len(u)} users, 3 projects, {len(items)} work items. "
          f"Sprint 15 id {s15.id}. Sign in as {u['sp'].email}.")


if __name__ == "__main__":
    if "--reset" in sys.argv:
        reset()
    run()
