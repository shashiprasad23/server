#!/usr/bin/env python3
"""Build one report per weekday for the calendar on the review page.

  python3 scripts/build_calendar.py [--scope content/scope.json] [--start 2026-09-01]

A day with a stored evening run (reports/<date>/) uses that report unchanged.
Any other weekday is rebuilt: the nearest stored snapshot taken on or after that day is
rewound to the end of the day (issues created later are dropped, issues resolved later
are reopened, worklogs after the day are dropped), then run through build_dashboard.
The narrative (verdicts, issues log, programme notes) comes from that snapshot's report.

Writes
  dist/calendar/<date>.json   one report per weekday, loaded when the date is clicked
  dist/calendar/index.json    the list of dates and how each one was made
"""
import argparse
import datetime as dt
import gzip
import json
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_dashboard as bd  # noqa: E402

ROOT = bd.ROOT
OUT = ROOT / "dist" / "calendar"
NARRATIVE = ("reportedRisksNotInJira", "newRisks", "issues", "marketplace", "marketingTesting", "utilisationNotes")
LOOKBACK_DAYS = 25  # how far before the oldest snapshot the calendar reaches


def day(s):
    return s[:10] if s else None


def stored_runs():
    """Dates with a stored evening run, oldest first: {date: (snapshot bundle path, dashboard-data path)}."""
    runs = {}
    for d in sorted((ROOT / "reports").glob("20??-??-??")):
        snap, data = d / "snapshot.json.gz", d / "dashboard-data.json"
        if snap.exists() and data.exists():
            runs[d.name] = (snap, data)
    return runs


def holidays():
    p = ROOT / "content" / "daily_events.json"
    return set(json.loads(p.read_text()).get("holidays", [])) if p.exists() else set()


def calendar_dates(start=None):
    """Every weekday from the start to the newest stored run, and how its report is made."""
    runs = stored_runs()
    if not runs:
        return []
    first, last = min(runs), max(runs)
    s = dt.date.fromisoformat(start) if start else dt.date.fromisoformat(first) - dt.timedelta(days=LOOKBACK_DAYS)
    e = dt.date.fromisoformat(last)
    hol = holidays()
    out = []
    while s <= e:
        d = s.isoformat()
        if s.weekday() < 5 and d not in hol:
            base = next(r for r in sorted(runs) if r >= d)
            out.append({"date": d, "kind": "run" if d in runs else "rebuilt", "base": base})
        s += dt.timedelta(days=1)
    return out


def rewind(bundle, x, all_worklogs):
    """The snapshot as it would have looked at the end of day x."""
    issues = []
    for i in bundle["issues"]:
        if day(i["created"]) > x:
            continue
        j = dict(i)
        if j.get("resolved") and day(j["resolved"]) > x:
            j.update(resolved=None, statusCat="indeterminate", status="Open")
        if day(j.get("updated")) and day(j["updated"]) > x:
            j["updated"] = x + "T23:59:00.000+0545"
        issues.append(j)
    d30 = (dt.date.fromisoformat(x) - dt.timedelta(days=30)).isoformat()
    issues = [i for i in issues if day(i["updated"]) >= d30]

    register = []
    for r in bundle["register"]:
        if day(r["created"]) > x:
            continue
        j = dict(r)
        if j.get("resolved") and day(j["resolved"]) > x:
            j.update(resolved=None, statusCat="indeterminate", status="Open")
        if day(j.get("updated")) and day(j["updated"]) > x:
            known = [day(j["created"])]
            lc = j.get("lastComment") or {}
            if lc.get("date") and day(lc["date"]) <= x:
                known.append(day(lc["date"]))
            j["updated"] = max(known) + "T12:00:00.000+0545"
            if lc.get("date") and day(lc["date"]) > x:
                j["lastComment"] = None
        register.append(j)

    wl_issues = {i["key"]: i for i in bundle["worklogs"]["issues"]}
    worklogs = {"issues": list(wl_issues.values()),
                "worklogs": [w for w in all_worklogs if day(w["started"]) <= x]}
    meta = json.loads(json.dumps(bundle["meta"]))
    meta["snapshotDate"] = x
    meta.setdefault("counts", {})
    meta["counts"].update(issuesUpdated30d=len(issues), openAllTime=None, expectedIssues=None)
    return meta, issues, worklogs, register


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scope", default=str(ROOT / "content" / "scope.json"))
    ap.add_argument("--start", default=None, help="first calendar date (default: 25 days before the oldest stored run)")
    a = ap.parse_args()
    scope = bd.load_scope(a.scope)
    runs = stored_runs()
    dates = calendar_dates(a.start)
    if not dates:
        sys.exit("no stored reports yet: run scripts/store_report.py first")
    links = json.loads((ROOT / "content" / "curated.json").read_text()).get("links", {})

    bundles = {d: json.load(gzip.open(p, "rt", encoding="utf-8")) for d, (p, _) in runs.items()}
    reports = {d: json.loads(p.read_text()) for d, (_, p) in runs.items()}
    # Worklogs from every stored snapshot together reach further back than any one of them.
    seen, all_wl = set(), []
    for d in sorted(bundles):
        for w in bundles[d]["worklogs"]["worklogs"]:
            k = (w["key"], w["started"], w["seconds"], w.get("comment", ""))
            if k not in seen:
                seen.add(k)
                all_wl.append(w)
    hours_from = min((dt.date.fromisoformat(d) - dt.timedelta(days=14)).isoformat() for d in bundles)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    for c in dates:
        x, base = c["date"], c["base"]
        if c["kind"] == "run":
            data = dict(reports[x])
            data["asOf"] = {"kind": "run", "date": x}
        else:
            meta, issues, wl, reg = rewind(bundles[base], x, all_wl)
            with tempfile.TemporaryDirectory() as tmp:
                t = pathlib.Path(tmp)
                for name, obj in (("meta", meta), ("issues", issues), ("worklogs", wl), ("register", reg)):
                    (t / f"{name}.json").write_text(json.dumps(obj))
                data = bd.build(t, scope)
            src = reports[base]
            for k in NARRATIVE:
                if k in src:
                    data[k] = src[k]
            verdicts = {r["key"]: r for r in src.get("register", [])}
            for r in data["register"]:
                v = verdicts.get(r["key"])
                if v:
                    for k in ("verdict", "rag", "why", "action", "suggestedOwner"):
                        r[k] = v.get(k)
            heads = {s["id"]: s.get("headline", "") for s in src.get("scorecards", [])}
            for s in data.get("scorecards", []):
                s["headline"] = heads.get(s["id"], s.get("headline", ""))
            p = data["period"]
            data["asOf"] = {"kind": "rebuilt", "date": x, "base": base,
                            "hoursPartial": p["start"] < hours_from, "hoursFrom": hours_from,
                            "issuesFrom": (dt.date.fromisoformat(base) - dt.timedelta(days=30)).isoformat()}
        data["links"] = {**data.get("links", {}), **links}
        (OUT / f"{x}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "index.json").write_text(json.dumps(dates, indent=1))
    n_run = sum(c["kind"] == "run" for c in dates)
    print(f"wrote {len(dates)} calendar reports to {OUT.relative_to(ROOT)}/ ({n_run} daily runs, {len(dates) - n_run} rebuilt), "
          f"{dates[0]['date']} to {dates[-1]['date']}")


if __name__ == "__main__":
    main()
