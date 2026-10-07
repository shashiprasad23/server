#!/usr/bin/env python3
"""Milestone tracks for the day-by-day page: USP's open epics, the Conversational AI roadmap and Atlas CRM.

The epics and their children are mostly older than the 30-day issues pull, so they come from their own query:

  project in (UC, ATLAS) OR parent in (<open USP epics>) OR (project = USP AND issuetype = Epic AND statusCategory != Done)

with fields summary, status, assignee, issuetype, created, updated, resolutiondate, duedate, customfield_10015 (start date),
parent, project. List the open USP epics first with `project = USP AND issuetype = Epic AND statusCategory != Done`.

  python3 scripts/ingest_milestones.py --date 2026-10-07 --out data/snapshot/milestones.json FILE [FILE...]
"""
import argparse
import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", default=str(ROOT / "data" / "snapshot" / "milestones.json"))
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    rows = {}
    for f in a.files:
        for n in json.loads(pathlib.Path(f).read_text())["issues"]["nodes"]:
            x = n["fields"]
            st = x.get("status") or {}
            rows[n["key"]] = {
                "key": n["key"], "project": (x.get("project") or {}).get("key") or n["key"].split("-")[0],
                "summary": html.unescape(x.get("summary") or ""), "type": (x.get("issuetype") or {}).get("name"),
                "status": st.get("name"), "statusCat": (st.get("statusCategory") or {}).get("key"),
                "assignee": (x.get("assignee") or {}).get("displayName"),
                "created": (x.get("created") or "")[:10], "updated": (x.get("updated") or "")[:10],
                "resolved": (x.get("resolutiondate") or "")[:10] or None, "due": x.get("duedate"),
                "start": x.get("customfield_10015"), "parent": (x.get("parent") or {}).get("key"),
            }
    out = {"snapshotDate": a.date, "issues": sorted(rows.values(), key=lambda r: r["key"])}
    pathlib.Path(a.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"milestones: {len(rows)} items")


if __name__ == "__main__":
    main()
