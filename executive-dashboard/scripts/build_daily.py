#!/usr/bin/env python3
"""Build the day-wise analytics page (dist/daily.html) from the same snapshot.

Reuses build_dashboard.build() for the register and people metrics, and adds
per-issue and per-worklog rows so the page can aggregate by day in the browser.

Usage
  python3 scripts/build_daily.py [--snapshot data/snapshot] [--out dist/daily.html] [--no-calendar]

The page carries the same report calendar as the review page; each date loads
dist/calendar/daily-<date>.json, written by scripts/build_calendar.py.
"""
import argparse
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import html  # noqa: E402

from build_dashboard import PROJECT_NAMES, build, load, load_scope  # noqa: E402

# Fixed project -> categorical slot. Colour follows the project on every chart.
SLOTS_ALL = ["MT", "USP", "MR", "DMI", "HC", "IT", "UC"]  # everything else folds to "Other"
SLOTS_SCOPED = ["MT", "USP", "MR", "UC", "PC"]


def build_daily(snap, scope, review=None, review_url=""):
    """The page data for one snapshot. `review` is the matching build() result, when the caller already has it."""
    keep = set(scope["projects"]) if scope else None
    inscope = lambda p: keep is None or p in keep
    SLOTS = [p for p in SLOTS_SCOPED if inscope(p)] if scope else SLOTS_ALL
    review = review or build(snap, scope)
    meta = load(snap / "meta.json")
    issues = load(snap / "issues.json")
    wl = load(snap / "worklogs.json")
    daily = load(ROOT / "content" / "daily_events.json")
    cur = load(ROOT / "content" / "curated.json")

    today = dt.date.fromisoformat(meta["snapshotDate"])
    # The window runs up to and including the report day, so picking a date shows that day's own activity.
    win_end = today
    win_start = today - dt.timedelta(days=29)
    period = review["period"]
    eff_start, eff_end = period["start"], period["end"]

    rows = []
    issues = [i for i in issues if inscope(i["project"])]
    for i in issues:
        rows.append([
            i["key"], i["project"], i["type"], i["statusCat"], i.get("assignee") or "", i["created"][:10],
            (i.get("resolved") or "")[:10], i.get("due") or "", html.unescape(i.get("summary") or "")[:110],
            i.get("parent") or "", i.get("priority") or "", i.get("status") or "",
        ])

    wl_meta = {i["key"]: i for i in wl["issues"]}
    logs = []
    for w in wl["worklogs"]:
        d = w["started"][:10]
        if not (eff_start <= d <= win_end.isoformat()):
            continue
        iss = wl_meta.get(w["key"], {})
        if not inscope(iss.get("project") or w["key"].split("-")[0]):
            continue
        logs.append([w["key"], d, round(w["seconds"] / 3600, 2), w.get("worker") or iss.get("assignee") or "", iss.get("project") or w["key"].split("-")[0]])

    projects = sorted({i["project"] for i in issues}, key=lambda p: (SLOTS.index(p) if p in SLOTS else 99, p))
    data = {
        "meta": {
            "snapshot": meta["snapshotDate"], "site": meta["site"], "jiraBase": review["jiraBase"],
            "windowStart": win_start.isoformat(), "windowEnd": win_end.isoformat(),
            "effortStart": eff_start, "effortEnd": eff_end, "holidays": period["holidays"], "periodShort": period["short"],
            "reviewUrl": review_url or cur.get("links", {}).get("review", ""), "capacityPerDay": cur["capacityPolicy"]["hoursPerDay"],
            "scopeLabel": scope["label"] if scope else "", "scopeNote": (scope or {}).get("note", ""),
        },
        "projects": [{"key": p, "name": PROJECT_NAMES.get(p, p), "slot": (SLOTS.index(p) + 1) if p in SLOTS else 0} for p in projects],
        "issues": rows,
        "logs": logs,
        "events": [e for e in daily["events"] if inscope(e["project"]) and e["date"] <= today.isoformat()],
        "bulk": [b for b in daily["bulk"] if inscope(b["project"]) and b["date"] <= today.isoformat()],
        "pipeline": clip_pipeline(daily["pipeline"], today.isoformat()),
        "pipelineNote": daily.get("pipelineNote", ""),
        "register": [{k: r[k] for k in ("key", "project", "kind", "summary", "verdict", "rag", "updated", "daysSinceUpdate", "assignee")}
                     for r in review["register"] if r["kind"] != "Epic"],
        "overheadTruncated": review["quality"]["overheadTicketsTruncated"],
    }
    return data


def clip_pipeline(pipeline, x):
    """Pipeline stages as they stood at the end of day x."""
    out = []
    for g in pipeline:
        st = [{**s, "end": min(s["end"], x)} for s in g["stages"] if s["start"] <= x]
        if st:
            out.append({**g, "stages": st})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=str(ROOT / "data" / "snapshot"))
    ap.add_argument("--out", default=str(ROOT / "dist" / "daily.html"))
    ap.add_argument("--review-url", default="", help="link back to the review page")
    ap.add_argument("--scope", default=str(ROOT / "content" / "scope.json"), help="scope JSON file, or 'all'")
    ap.add_argument("--no-calendar", action="store_true", help="leave out the report calendar (for stored copies)")
    a = ap.parse_args()
    data = build_daily(pathlib.Path(a.snapshot), load_scope(a.scope), review_url=a.review_url)
    cal = []
    if not a.no_calendar:
        import build_calendar  # lists the dates the calendar offers
        cal = build_calendar.calendar_dates()
        if cal and data["meta"]["snapshot"] not in {c["date"] for c in cal}:
            cal = []
    tpl = (ROOT / "templates" / "daily.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(tpl.replace("/*__DATA__*/null", payload).replace("/*__CAL__*/[]", json.dumps(cal, separators=(",", ":"))), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB): {len(data['issues'])} issues, {len(data['logs'])} worklogs, "
          f"{len(data['events'])} events, window {data['meta']['windowStart']}..{data['meta']['windowEnd']}")


if __name__ == "__main__":
    main()
