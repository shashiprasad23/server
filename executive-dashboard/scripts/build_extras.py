"""Review sections added after the 6 Oct feedback.

  missed_deadlines   every open ticket past its due date, re-dated tickets and the timeline impact
  design_dependencies  design team timelines (VTN and DM boards) and design feedback still pending
  key_highlights     new work, next dated milestones and undated work, per programme
  watchlist          people whose Jira and Tempo figures need a management look

All four read only the snapshot and the stored daily bundles in reports/. Judgement text comes
from content/curated.json and is merged in by the page.
"""
import collections
import datetime as dt
import gzip
import json
import pathlib
import re
import statistics

ROOT = pathlib.Path(__file__).resolve().parent.parent
_BUNDLES = {}


def day(s):
    return s[:10] if s else None


def _bundle_dues(before):
    """Due dates seen in each stored daily run before `before`: [(date, {key: due})], oldest first."""
    out = []
    for d in sorted((ROOT / "reports").glob("20??-??-??")):
        if d.name >= before:
            continue
        p = d / "snapshot.json.gz"
        if not p.exists():
            continue
        if d.name not in _BUNDLES:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                _BUNDLES[d.name] = {i["key"]: i.get("due") for i in json.load(f)["issues"]}
        out.append((d.name, _BUNDLES[d.name]))
    return out


def redates(issues, today, lookback_days=21):
    """Due dates pushed later between stored runs, within the lookback. {key: {from, to, on, slip}}."""
    seq = _bundle_dues(today) + [(today, {i["key"]: i.get("due") for i in issues})]
    since = (dt.date.fromisoformat(today) - dt.timedelta(days=lookback_days)).isoformat()
    found = {}
    for (d0, a), (d1, b) in zip(seq, seq[1:]):
        if d1 < since:
            continue
        for k, new in b.items():
            old = a.get(k)
            if old and new and new > old:
                first = found.get(k, {}).get("from", old)
                found[k] = {"from": first, "to": new, "on": d1,
                            "slip": (dt.date.fromisoformat(new) - dt.date.fromisoformat(first)).days}
    return found


def _impact(i, by_key):
    st = i.get("status") or ""
    if re.search(r"\b(in|on|deployed in) prod", st, re.I):
        return "Shipped, but the ticket is not closed: housekeeping, no delivery impact."
    par = by_key.get(i.get("parent") or "")
    if par and par.get("statusCat") != "done":
        return f"Holds up {par['key']}: {par['summary'][:90]}"
    if i.get("type") == "Bug":
        return "Defect still open past its fix date."
    if i.get("type") in ("Story", "Epic"):
        return "Feature not delivered by its date."
    return "Task still open past its date."


def missed_deadlines(issues, scope, today):
    prog = {p: g["id"] for g in scope["programmes"] for p in g["projects"]}
    by_key = {i["key"]: i for i in issues}
    d14 = (dt.date.fromisoformat(today) - dt.timedelta(days=14)).isoformat()
    rd = redates(issues, today)
    out = []
    for g in scope["programmes"]:
        xs = [i for i in issues if prog.get(i["project"]) == g["id"]]
        late = [i for i in xs if i["statusCat"] != "done" and i.get("due") and i["due"] < today]
        items = []
        for i in late:
            dl = (dt.date.fromisoformat(today) - dt.date.fromisoformat(i["due"])).days
            items.append({"key": i["key"], "summary": i["summary"], "type": i.get("type"), "status": i.get("status"),
                          "assignee": i.get("assignee"), "due": i["due"], "daysLate": dl, "parent": i.get("parent"),
                          "impact": _impact(i, by_key), "redated": rd.get(i["key"])})
        items.sort(key=lambda r: (-r["daysLate"], r["key"]))
        shipped = sum(1 for r in items if r["impact"].startswith("Shipped"))
        parents = collections.Counter(r["parent"] for r in items if r["parent"] in by_key and by_key[r["parent"]]["statusCat"] != "done")
        closed_late = [i for i in xs if i["statusCat"] == "done" and i.get("due") and i.get("resolved")
                       and day(i["resolved"]) >= d14 and day(i["resolved"]) > i["due"]]
        moved = [{"key": k, **v, "summary": by_key[k]["summary"], "status": by_key[k]["status"], "assignee": by_key[k].get("assignee")}
                 for k, v in rd.items() if k in by_key and prog.get(by_key[k]["project"]) == g["id"]]
        moved.sort(key=lambda r: (-r["slip"], r["key"]))
        moves = collections.Counter((r["from"], r["to"]) for r in moved)
        days = [r["daysLate"] for r in items]
        out.append({
            "id": g["id"], "name": g["name"], "open": len(items), "items": items,
            "maxLate": max(days) if days else 0, "medianLate": int(statistics.median(days)) if days else 0,
            "shippedNotClosed": shipped, "realLate": len(items) - shipped,
            "parents": [{"key": k, "summary": by_key[k]["summary"], "status": by_key[k]["status"], "due": by_key[k].get("due"), "late": n}
                        for k, n in parents.most_common(5)],
            "closedLate14": len(closed_late),
            "closedLateDays": int(statistics.mean([(dt.date.fromisoformat(day(i["resolved"])) - dt.date.fromisoformat(i["due"])).days for i in closed_late])) if closed_late else 0,
            "redated": moved, "redatedGroups": [{"from": a, "to": b, "count": n} for (a, b), n in moves.most_common(4)],
        })
    return out


DESIGN_PROG = [
    ("Rewards", r"\brewards\b"),
    ("MT", r"marketplace|\brma\b|product overview|product page|\boem\b|banner"),
    ("MR", r"marketing|website|gdpr|blog|seo|\bh1\b|\b404\b|case stud|article|email|uvation\.com|newsletter|yt video|social media|alt text|redirect"),
    ("USP", r"\busp\b|dashboard|communication hub|support hub|ai factory|pricing page|subscription|kyc|billing|credit card|invoice|services for mob|managed .* operations"),
]
REVIEW_RX = re.compile(r"review|waiting", re.I)


def _design_prog(r):
    t = f"{r['summary']} {r.get('parentSummary') or ''}".lower()
    for pid, rx in DESIGN_PROG:
        if re.search(rx, t):
            return pid
    return "Other"


def design_dependencies(snapshot_dir, issues, scope, today):
    p = pathlib.Path(snapshot_dir) / "design.json"
    if not p.exists():
        return None
    rows = json.loads(p.read_text())["issues"]
    d30 = (dt.date.fromisoformat(today) - dt.timedelta(days=30)).isoformat()
    d60 = (dt.date.fromisoformat(today) - dt.timedelta(days=60)).isoformat()
    rows = [r for r in rows if r["created"] <= today]
    # The design team is whoever holds work on the Design & Creative board; DM items count only when one of them holds it.
    team = {r["assignee"] for r in rows if r["project"] == "VTN" and r["assignee"]}
    rows = [r for r in rows if (r["project"] == "VTN" or r["assignee"] in team) and (r["status"] or "").upper() != "RECURRING"]
    live, stale = [], []
    for r in rows:
        if r["type"] == "Epic":
            continue
        r = dict(r, prog=_design_prog(r))
        if r["statusCat"] == "done":
            if r["resolved"] and d30 <= r["resolved"] <= today:
                live.append(r)
        elif r["updated"] >= d60 or (r["due"] and r["due"] >= d60):
            live.append(r)
        else:
            stale.append(r)
    names = {g["id"]: g["name"] for g in scope["programmes"]}
    names.update({"Rewards": "Rewards (outside report scope)", "Other": "Other design work"})
    groups = []
    for pid in ["MT", "MR", "USP", "Rewards", "Other"]:
        xs = [r for r in live if r["prog"] == pid]
        if not xs:
            continue
        open_ = [r for r in xs if r["statusCat"] != "done"]
        done = [r for r in xs if r["statusCat"] == "done"]
        for r in open_:
            r["daysLate"] = (dt.date.fromisoformat(today) - dt.date.fromisoformat(r["due"])).days if r["due"] and r["due"] < today else 0
        open_.sort(key=lambda r: (r["due"] or "9999", r["key"]))
        late_done = [r for r in done if r["due"] and r["resolved"] > r["due"]]
        nxt = [r for r in open_ if r["due"] and r["due"] >= today]
        groups.append({
            "id": pid, "name": names.get(pid, pid), "open": open_,
            "pastDue": sum(1 for r in open_ if r["daysLate"] > 0),
            "noDate": sum(1 for r in open_ if not r["due"]),
            "inReview": sum(1 for r in open_ if REVIEW_RX.search(r["status"] or "")),
            "blocked": sum(1 for r in open_ if re.search("block", r["status"] or "", re.I)),
            "done30": len(done), "doneLate30": len(late_done),
            "doneLateDays": int(statistics.mean([(dt.date.fromisoformat(r["resolved"]) - dt.date.fromisoformat(r["due"])).days for r in late_done])) if late_done else 0,
            "next": {"key": nxt[0]["key"], "summary": nxt[0]["summary"], "due": nxt[0]["due"], "assignee": nxt[0]["assignee"]} if nxt else None,
        })
    owners = collections.defaultdict(lambda: {"open": 0, "pastDue": 0, "done30": 0})
    for r in live:
        o = owners[r["assignee"] or "Unassigned"]
        if r["statusCat"] == "done":
            o["done30"] += 1
        else:
            o["open"] += 1
            if r["due"] and r["due"] < today:
                o["pastDue"] += 1
    keep = set(scope["projects"])
    fb_rx = re.compile(r"design gap|design feedback|raluca|design review|waiting (for|on) design", re.I)
    waiting = [{"key": i["key"], "summary": i["summary"], "status": i["status"], "assignee": i.get("assignee"), "due": i.get("due")}
               for i in issues if i["project"] in keep and i["statusCat"] != "done" and fb_rx.search(i["summary"])
               and not re.search(r"ready|prod|done|uat", i.get("status") or "", re.I)]
    return {"groups": groups, "staleCount": len(stale),
            "owners": sorted([{"name": k, **v} for k, v in owners.items()], key=lambda o: (-o["pastDue"], -o["open"])),
            "waitingOnDesign": waiting,
            "boards": sorted({r["project"] for r in rows}), "team": sorted(team)}


def key_highlights(issues, scope, today):
    prog = {p: g["id"] for g in scope["programmes"] for p in g["projects"]}
    d7 = (dt.date.fromisoformat(today) - dt.timedelta(days=7)).isoformat()
    out = {}
    for g in scope["programmes"]:
        xs = [i for i in issues if prog.get(i["project"]) == g["id"] and not i.get("subtask")]
        new = sorted([i for i in xs if day(i["created"]) >= d7 and i.get("type") in ("Story", "Epic", "Task")], key=lambda i: i["created"], reverse=True)
        nxt = sorted([i for i in xs if i["statusCat"] != "done" and i.get("due") and i["due"] >= today], key=lambda i: (i["due"], i["key"]))
        undated = [i for i in xs if i["statusCat"] == "indeterminate" and not i.get("due") and i.get("type") in ("Story", "Epic")]
        row = lambda i: {"key": i["key"], "summary": i["summary"], "status": i["status"], "due": i.get("due"), "assignee": i.get("assignee"), "created": day(i["created"])}
        out[g["id"]] = {"new": [row(i) for i in new[:6]], "newCount": len(new), "next": [row(i) for i in nxt[:5]],
                        "undatedInProgress": len(undated)}
    return out


def watchlist(people, issues, scope, period, notes, exclude=()):
    ps, pe = period["start"], period["end"]
    raised = collections.Counter(i.get("reporter") for i in issues if ps <= day(i["created"]) <= pe)
    bugs = collections.Counter(i.get("reporter") for i in issues if ps <= day(i["created"]) <= pe and i.get("type") == "Bug")
    skip = set(exclude)
    out = []
    for p in people:
        if p["name"] in skip:
            continue
        flags = []
        if p["hours"] == 0 and p["open"]:
            flags.append(["grey", "No Tempo hours on own tickets"])
        elif 0 < p["pctCapacity"] < 60:
            flags.append(["amber", f"{p['pctCapacity']}% of capacity logged"])
        if p["open"] and p["doneInPeriod"] == 0:
            flags.append(["amber", "Nothing closed in the window"])
        if p["overdue"] >= 3:
            flags.append(["red", f"{p['overdue']} items past due"])
        if p["maxDay"] > 12:
            flags.append(["grey", f"Hours not credible: a {p['maxDay']} h day"])
        note = notes.get(p["name"])
        if not note and not any(f[0] != "grey" or f[1].startswith("No Tempo") for f in flags):
            continue
        out.append({"name": p["name"], "hours": p["hours"], "pctCapacity": p["pctCapacity"], "daysLogged": p["daysLogged"],
                    "done": p["doneInPeriod"], "open": p["open"], "overdue": p["overdue"],
                    "raised": raised.get(p["name"], 0), "bugsRaised": bugs.get(p["name"], 0),
                    "flags": flags, "note": note})
    rank = {"red": 0, "amber": 1, "grey": 2, "green": 3}
    out.sort(key=lambda r: (0 if r["note"] else 1, rank.get((r["note"] or {}).get("rag", "amber"), 1),
                            -sum(1 for f in r["flags"] if f[0] != "grey"), r["pctCapacity"]))
    return out
