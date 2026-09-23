#!/usr/bin/env python3
"""Build the day-wise analytics page (dist/daily.html) from the same snapshot.

Reuses build_dashboard.build() for the register and people metrics, and adds
per-issue and per-worklog rows so the page can aggregate by day in the browser.

Usage
  python3 scripts/build_daily.py [--snapshot data/snapshot] [--out dist/daily.html]
"""
import argparse
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from build_dashboard import PROJECT_NAMES, build, load  # noqa: E402

# Fixed project -> categorical slot. Colour follows the project on every chart.
SLOTS = ["MT", "USP", "MR", "DMI", "HC", "IT", "UC"]  # everything else folds to "Other"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=str(ROOT / "data" / "snapshot"))
    ap.add_argument("--out", default=str(ROOT / "dist" / "daily.html"))
    ap.add_argument("--review-url", default="", help="link back to the review page")
    a = ap.parse_args()
    snap = pathlib.Path(a.snapshot)

    review = build(snap)
    meta = load(snap / "meta.json")
    issues = load(snap / "issues.json")
    wl = load(snap / "worklogs.json")
    daily = load(ROOT / "content" / "daily_events.json")
    cur = load(ROOT / "content" / "curated.json")

    today = dt.date.fromisoformat(meta["snapshotDate"])
    win_end = today - dt.timedelta(days=1)
    win_start = today - dt.timedelta(days=30)
    eff_start, eff_end = cur["period"]["start"], cur["period"]["end"]

    rows = []
    for i in issues:
        rows.append([
            i["key"], i["project"], i["type"], i["statusCat"], i.get("assignee") or "", i["created"][:10],
            (i.get("resolved") or "")[:10], i.get("due") or "", (i.get("summary") or "")[:110],
            i.get("parent") or "", i.get("priority") or "", i.get("status") or "",
        ])

    wl_meta = {i["key"]: i for i in wl["issues"]}
    logs = []
    for w in wl["worklogs"]:
        d = w["started"][:10]
        if not (eff_start <= d <= eff_end):
            continue
        iss = wl_meta.get(w["key"], {})
        logs.append([w["key"], d, round(w["seconds"] / 3600, 2), w.get("worker") or iss.get("assignee") or "", iss.get("project") or w["key"].split("-")[0]])

    projects = sorted({i["project"] for i in issues}, key=lambda p: (SLOTS.index(p) if p in SLOTS else 99, p))
    data = {
        "meta": {
            "snapshot": meta["snapshotDate"], "site": meta["site"], "jiraBase": review["jiraBase"],
            "windowStart": win_start.isoformat(), "windowEnd": win_end.isoformat(),
            "effortStart": eff_start, "effortEnd": eff_end, "holidays": daily.get("holidays", []),
            "reviewUrl": a.review_url or cur.get("links", {}).get("review", ""), "capacityPerDay": cur["capacityPolicy"]["hoursPerDay"],
        },
        "projects": [{"key": p, "name": PROJECT_NAMES.get(p, p), "slot": (SLOTS.index(p) + 1) if p in SLOTS else 0} for p in projects],
        "issues": rows,
        "logs": logs,
        "events": daily["events"],
        "bulk": daily["bulk"],
        "pipeline": daily["pipeline"],
        "register": [{k: r[k] for k in ("key", "project", "kind", "summary", "verdict", "rag", "updated", "daysSinceUpdate", "assignee")}
                     for r in review["register"] if r["kind"] != "Epic"],
        "overheadTruncated": review["quality"]["overheadTicketsTruncated"],
    }
    tpl = (ROOT / "templates" / "daily.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(tpl.replace("/*__DATA__*/null", payload), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB): {len(rows)} issues, {len(logs)} worklogs, "
          f"{len(data['events'])} events, window {data['meta']['windowStart']}..{data['meta']['windowEnd']}")


if __name__ == "__main__":
    main()
