#!/usr/bin/env python3
"""Build the executive dashboard from a Jira snapshot and the curated review.

Inputs
  data/snapshot/meta.json       snapshot metadata
  data/snapshot/issues.json     every issue updated in the 30 days before the snapshot
  data/snapshot/worklogs.json   issues with worklogs in the last 14 days, plus the worklogs
  data/snapshot/register.json   risk and dependency register items
  content/curated.json          review verdicts, issues log, pipeline and notes

Output
  dist/index.html               self-contained page (data embedded)

Usage
  python3 scripts/build_dashboard.py [--snapshot data/snapshot] [--out dist/index.html] [--scope content/scope.json|all]
"""
import argparse
import collections
import datetime as dt
import html
import json
import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

PROJECT_NAMES = {
    "DM": "Design Marketing Development Collab", "DMI": "Marketing", "EN": "Web-Email Notifications",
    "HC": "Hamara CRM", "ID": "Web-Identity", "IN": "Devops", "INF": "Infrastructure-test",
    "IT": "Infrastructure", "MR": "Web-Marketing", "MT": "Web-Marketplace",
    "PC": "Web-Marketplace Product Catalog", "REW": "Web-Rewards", "SMCMDT": "Social Media Collaboration",
    "SUP": "Web-Support", "TB": "Test Board", "TEST": "Test", "UC": "Uvation Conversational AI",
    "UP": "Uvation Projects (overhead)", "USP": "Web-Uvation Services Platform", "VTN": "Design & Creative",
}


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def day(s):
    return s[:10] if s else None


def days_between(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def resolve_period(snapshot_date, period, extra_holidays=()):
    """Fixed period from curated.json, or with "auto": the N days ending the day before the snapshot."""
    p = dict(period)
    holidays = set(p.get("holidays", [])) | set(extra_holidays)
    if p.get("auto"):
        end = dt.date.fromisoformat(snapshot_date) - dt.timedelta(days=1)
        start = end - dt.timedelta(days=int(p.get("lengthDays", 14)) - 1)
        p["start"], p["end"] = start.isoformat(), end.isoformat()
    s, e = dt.date.fromisoformat(p["start"]), dt.date.fromisoformat(p["end"])
    days = [(s + dt.timedelta(days=k)).isoformat() for k in range((e - s).days + 1)]
    work = [d for d in days if dt.date.fromisoformat(d).weekday() < 5 and d not in holidays]
    fmt = lambda d: f"{dt.date.fromisoformat(d).day} {dt.date.fromisoformat(d).strftime('%b')}"
    p.update({"workingDays": len(work), "workingDayList": work, "holidays": sorted(holidays),
              "short": f"{fmt(p['start'])}–{fmt(p['end'])}", "label": f"Window {fmt(p['start'])}–{fmt(p['end'])} {e.year}"})
    return p


def load_scope(arg):
    """Return the scope dict, or None for every project."""
    if not arg or arg == "all":
        return None
    return load(pathlib.Path(arg))


def build(snapshot_dir: pathlib.Path, scope=None):
    meta = load(snapshot_dir / "meta.json")
    issues = load(snapshot_dir / "issues.json")
    wl = load(snapshot_dir / "worklogs.json")
    register = load(snapshot_dir / "register.json")
    cur = load(ROOT / "content" / "curated.json")
    ev_path = ROOT / "content" / "daily_events.json"
    cur["period"] = resolve_period(meta["snapshotDate"], cur["period"], load(ev_path).get("holidays", []) if ev_path.exists() else [])
    # Overhead truncation is measured on the full pull: meetings sit on shared tickets outside any one project.
    truncated_all = [i["key"] for i in wl["issues"] if (i.get("worklogTotal") or 0) > (i.get("worklogsReturned") or 0)]
    for i in issues:
        i["summary"] = html.unescape(i.get("summary") or "")
    if scope:
        keep = set(scope["projects"])
        issues = [i for i in issues if i["project"] in keep]
        wl = {"issues": [i for i in wl["issues"] if i["project"] in keep],
              "worklogs": [w for w in wl["worklogs"] if w["key"].split("-")[0] in keep]}
        register = [r for r in register if r["project"] in keep]

    today = meta["snapshotDate"]
    p_start, p_end = cur["period"]["start"], cur["period"]["end"]
    d30 = (dt.date.fromisoformat(today) - dt.timedelta(days=30)).isoformat()
    cap_hours = cur["period"]["workingDays"] * cur["capacityPolicy"]["hoursPerDay"]

    by_key = {i["key"]: i for i in issues}

    # ---------- portfolio by project ----------
    projects = []
    for p in sorted({i["project"] for i in issues}):
        xs = [i for i in issues if i["project"] == p]
        open_ = [i for i in xs if i["statusCat"] != "done"]
        overdue = [i for i in open_ if i.get("due") and i["due"] < today]
        projects.append({
            "key": p, "name": PROJECT_NAMES.get(p, p),
            "updated30": len(xs),
            "created30": sum(1 for i in xs if day(i["created"]) >= d30),
            "todo": sum(1 for i in xs if i["statusCat"] == "new"),
            "inprog": sum(1 for i in xs if i["statusCat"] == "indeterminate"),
            "done": sum(1 for i in xs if i["statusCat"] == "done"),
            "doneInPeriod": sum(1 for i in xs if i["statusCat"] == "done" and i.get("resolved") and p_start <= day(i["resolved"]) <= p_end),
            "overdue": len(overdue),
            "openBugs": sum(1 for i in open_ if i["type"] == "Bug"),
            "hours": 0.0,
        })
    proj_idx = {p["key"]: p for p in projects}

    # ---------- worklogs in period ----------
    wl_issue = {i["key"]: i for i in wl["issues"]}
    logs = [w for w in wl["worklogs"] if p_start <= day(w["started"]) <= p_end]
    per = collections.defaultdict(lambda: {"hours": 0.0, "days": collections.defaultdict(float), "tickets": set(), "projects": collections.defaultdict(float)})
    unattributed = 0.0
    for w in logs:
        iss = wl_issue.get(w["key"], {})
        h = w["seconds"] / 3600
        proj = iss.get("project") or w["key"].split("-")[0]
        if proj in proj_idx:
            proj_idx[proj]["hours"] += h
        # Prefer the real Tempo worker when the snapshot has it; otherwise credit the ticket assignee.
        a = w.get("worker") or iss.get("assignee")
        if not a:
            unattributed += h
            continue
        rec = per[a]
        rec["hours"] += h
        rec["days"][day(w["started"])] += h
        rec["tickets"].add(w["key"])
        rec["projects"][proj] += h

    # ticket-level stats per assignee (from 30-day issue set)
    stat = collections.defaultdict(lambda: collections.Counter())
    for i in issues:
        a = i.get("assignee")
        if not a:
            continue
        if i["statusCat"] == "done" and i.get("resolved") and p_start <= day(i["resolved"]) <= p_end:
            stat[a]["done"] += 1
        if i["statusCat"] != "done":
            stat[a]["open"] += 1
            if i.get("due") and i["due"] < today:
                stat[a]["overdue"] += 1

    people = []
    for a in sorted(set(per) | set(stat)):
        rec = per.get(a)
        hours = round(rec["hours"], 1) if rec else 0.0
        daysd = dict(rec["days"]) if rec else {}
        max_day = max(daysd.values()) if daysd else 0
        s = stat.get(a, collections.Counter())
        flags = []
        if max_day > 10:
            flags.append("attribution")
        if 0 < hours < 0.6 * cap_hours and max_day <= 10:
            flags.append("low")
        if hours == 0 and (s["done"] or s["open"]):
            flags.append("nolog")
        people.append({
            "name": a, "hours": hours, "daysLogged": len(daysd), "maxDay": round(max_day, 1),
            "avgPerDay": round(hours / len(daysd), 1) if daysd else 0,
            "pctCapacity": round(100 * hours / cap_hours) if cap_hours else 0,
            "tickets": len(rec["tickets"]) if rec else 0,
            "doneInPeriod": s["done"], "open": s["open"], "overdue": s["overdue"],
            "projects": {k: round(v, 1) for k, v in sorted((rec["projects"] if rec else {}).items(), key=lambda x: -x[1])},
            "daily": {k: round(v, 1) for k, v in sorted(daysd.items())},
            "flags": flags,
        })
    people.sort(key=lambda r: (-r["hours"], r["name"]))

    for p in projects:
        p["hours"] = round(p["hours"], 1)

    # ---------- data quality ----------
    generic = sum(1 for w in logs if w["comment"].strip().lower() in ("", "time-tracking", "working on issue"))
    wl_with_time = [i for i in wl["issues"] if i.get("spent")]
    no_est = sum(1 for i in wl_with_time if not i.get("est"))
    truncated = truncated_all
    authors = collections.Counter(w["author"] for w in logs)
    silent_projects = [p["key"] for p in projects if p["hours"] == 0 and p["updated30"] >= 20 and p["key"] != "UP"]
    quality = {
        "worklogsInPeriod": len(logs),
        "genericDescriptions": generic,
        "worklogAuthors": dict(authors),
        "ticketsWithTime": len(wl_with_time),
        "ticketsWithTimeNoEstimate": no_est,
        "unattributedHours": round(unattributed, 1),
        "overheadTicketsTruncated": truncated,
        "projectsWithNoTempoHours": [{"key": k, "name": PROJECT_NAMES.get(k, k), "updated30": proj_idx[k]["updated30"]} for k in silent_projects],
        "totalHours": round(sum(w["seconds"] for w in logs) / 3600, 1),
    }

    # ---------- register ----------
    reg_rows = []
    for r in register:
        rv = cur["riskReview"].get(r["key"], {})
        upd = day(r["updated"])
        reg_rows.append({
            "key": r["key"], "project": r["project"], "projectName": PROJECT_NAMES.get(r["project"], r["project"]),
            "kind": r["kind"], "summary": r["summary"].split(":", 1)[-1].strip() if r["kind"] != "Epic" else r["summary"],
            "likelihood": r.get("likelihood"), "impact": r.get("impact"), "ownerTeam": r.get("ownerTeam"),
            "assignee": r.get("assignee"), "jiraStatus": r["status"], "updated": upd,
            "daysSinceUpdate": days_between(upd, today) if upd else None,
            "context": r.get("context"), "mitigation": r.get("mitigation", []), "lastComment": r.get("lastComment"),
            "verdict": rv.get("verdict", "Not reviewed"), "rag": rv.get("rag", "grey"), "why": rv.get("why"),
            "action": rv.get("action"), "suggestedOwner": rv.get("suggestedOwner"),
        })
    order = {"red": 0, "amber": 1, "green": 2, "grey": 3}
    reg_rows.sort(key=lambda r: (r["kind"] == "Epic", order.get(r["rag"], 9), r["key"]))
    items = [r for r in reg_rows if r["kind"] != "Epic"]
    reg_summary = {
        "items": len(items),
        "risks": sum(1 for r in items if r["kind"] == "Risk"),
        "dependencies": sum(1 for r in items if r["kind"] == "Dependency"),
        "unassigned": sum(1 for r in items if not r["assignee"]),
        "stale30": sum(1 for r in items if (r["daysSinceUpdate"] or 0) > 30),
        "verdicts": dict(collections.Counter(r["verdict"].split(" ")[0] for r in items)),
    }

    # ---------- headline KPIs ----------
    kpis = {
        "projectsVisible": meta["projectsVisible"],
        "projectsInScope": len(scope["projects"]) if scope else meta["projectsVisible"],
        "projectsActive": len(projects),
        "issuesUpdated30": len(issues),
        "done30": sum(1 for i in issues if i["statusCat"] == "done" and i.get("resolved") and day(i["resolved"]) >= d30),
        "doneInPeriod": sum(p["doneInPeriod"] for p in projects),
        "openAllTime": meta["counts"].get("openAllTime"),
        "overdueOpen": sum(p["overdue"] for p in projects),
        "hoursInPeriod": quality["totalHours"],
        "capacityPerPerson": cap_hours,
    }

    scorecards = build_scorecards(issues, scope, today, p_start, p_end, d30) if scope else []

    def pick(keys):
        return [{"key": k, "summary": by_key[k]["summary"], "status": by_key[k]["status"]} for k in keys if k in by_key]

    return {
        "meta": meta, "period": cur["period"], "capacityPolicy": cur["capacityPolicy"], "title": cur["reportTitle"],
        "kpis": kpis, "projects": sorted(projects, key=lambda p: -p["updated30"]),
        "register": reg_rows, "registerSummary": reg_summary,
        "reportedRisksNotInJira": cur["reportedRisksNotInJira"], "newRisks": cur["newRisks"],
        "issues": cur["issues"], "marketplace": cur["marketplace"], "marketingTesting": cur["marketingTesting"],
        "people": people, "quality": quality, "utilisationNotes": cur["utilisationNotes"],
        "jiraBase": f"https://{meta['site']}/browse/", "links": cur.get("links", {}),
        "_refs": pick(["MT-1485", "MT-1528", "MR-1179", "MR-1165"]),
        "scope": ({"label": scope["label"], "short": scope.get("short"), "note": scope.get("note"),
                   "projects": scope["projects"], "names": [PROJECT_NAMES.get(p, p) for p in scope["projects"]]} if scope else None),
        "scorecards": scorecards,
    }


def build_scorecards(issues, scope, today, p_start, p_end, d30):
    """One card per programme: throughput, delivered and in-flight stories, overdue, blocked, roll-ups, bugs."""
    by_key = {i["key"]: i for i in issues}
    cards = []
    for prog in scope.get("programmes", []):
        xs = [i for i in issues if i["project"] in prog["projects"]]
        top = [i for i in xs if not i["subtask"] and i["type"] in ("Epic", "Story", "Feature")]
        open_ = [i for i in xs if i["statusCat"] != "done"]
        def row(i):
            return {"key": i["key"], "summary": i["summary"], "status": i["status"], "assignee": i.get("assignee"), "due": i.get("due"),
                    "resolved": (i.get("resolved") or "")[:10]}
        delivered = sorted([i for i in top if i["statusCat"] == "done" and i.get("resolved") and day(i["resolved"]) >= d30],
                           key=lambda i: i["resolved"], reverse=True)
        inflight = sorted([i for i in top if i["statusCat"] == "indeterminate"], key=lambda i: (i.get("due") or "9999", i["key"]))
        planned = [i for i in top if i["statusCat"] == "new"]
        overdue = sorted([i for i in open_ if i.get("due") and i["due"] < today], key=lambda i: i["due"])
        blocked = [i for i in xs if re.search(r"block|hold", i["status"], re.I) and i["statusCat"] != "done"]
        kids = collections.defaultdict(list)
        for i in xs:
            if i.get("parent"):
                kids[i["parent"]].append(i)
        rollups = []
        for pk, ch in kids.items():
            if len(ch) < 4:
                continue
            p = by_key.get(pk)
            rollups.append({"key": pk, "summary": (p["summary"] if p else "Parent last updated before the 30-day window"),
                            "status": p["status"] if p else "", "done": sum(c["statusCat"] == "done" for c in ch), "total": len(ch)})
        rollups.sort(key=lambda r: (-r["total"], r["key"]))
        sev = collections.Counter()
        for i in open_:
            if i["type"] == "Bug":
                m = re.search(r"\[(S\d)\]", i["summary"])
                sev[m.group(1) if m else "Unrated"] += 1
        cards.append({
            "id": prog["id"], "name": prog["name"], "projects": prog["projects"], "headline": prog.get("headline", ""),
            "updated30": len(xs), "created30": sum(1 for i in xs if day(i["created"]) >= d30),
            "done30": sum(1 for i in xs if i["statusCat"] == "done" and i.get("resolved") and day(i["resolved"]) >= d30),
            "doneInPeriod": sum(1 for i in xs if i["statusCat"] == "done" and i.get("resolved") and p_start <= day(i["resolved"]) <= p_end),
            "todo": sum(1 for i in xs if i["statusCat"] == "new"), "inprog": sum(1 for i in xs if i["statusCat"] == "indeterminate"),
            "done": sum(1 for i in xs if i["statusCat"] == "done"),
            "statuses": dict(collections.Counter(i["status"] for i in open_).most_common()),
            "stories": {"delivered": len(delivered), "inflight": len(inflight), "planned": len(planned)},
            "delivered": [row(i) for i in delivered[:8]], "inflight": [row(i) for i in inflight[:8]],
            "overdue": [row(i) for i in overdue[:8]], "overdueCount": len(overdue),
            "blocked": [row(i) for i in blocked], "rollups": rollups[:6],
            "openBugs": sum(sev.values()), "bugSeverity": dict(sorted(sev.items())),
        })
    return cards


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--snapshot", default=str(ROOT / "data" / "snapshot"))
    ap.add_argument("--out", default=str(ROOT / "dist" / "index.html"))
    ap.add_argument("--scope", default=str(ROOT / "content" / "scope.json"), help="scope JSON file, or 'all' for every project")
    ap.add_argument("--daily-url", default=None, help="override the link to the day-by-day page")
    args = ap.parse_args()
    data = build(pathlib.Path(args.snapshot), load_scope(args.scope))
    if args.daily_url is not None:
        data["links"] = {**data.get("links", {}), "daily": args.daily_url}
    tpl = (ROOT / "templates" / "dashboard.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(tpl.replace("/*__DATA__*/null", payload), encoding="utf-8")
    (out.parent / "dashboard-data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    k = data["kpis"]
    print(f"wrote {out} ({out.stat().st_size // 1024} KB): {k['issuesUpdated30']} issues, "
          f"{len(data['register'])} register rows, {len(data['people'])} people, {k['hoursInPeriod']} h logged")


if __name__ == "__main__":
    main()
