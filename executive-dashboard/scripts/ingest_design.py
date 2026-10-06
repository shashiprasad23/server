#!/usr/bin/env python3
"""Design team boards, for the dependencies panel.

The design team (Raluca Conea and colleagues) plans its work on the Design & Creative (VTN) and
Design Marketing Development Collab (DM) boards. Their due dates are the design timelines the
Marketplace, Marketing and Services Platform teams depend on.

  python3 scripts/ingest_design.py --date 2026-10-06 --out data/snapshot/design.json FILE [FILE...]

Each FILE is a saved searchJiraIssuesUsingJql result for
  project in (DM, VTN) AND (statusCategory != Done OR updated >= -30d) ORDER BY key ASC
with the standard fields.
"""
import argparse
import html
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", default=str(ROOT / "data" / "snapshot" / "design.json"))
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    rows = {}
    for f in a.files:
        for n in json.loads(pathlib.Path(f).read_text())["issues"]["nodes"]:
            x = n["fields"]
            st = x.get("status") or {}
            par = x.get("parent") or {}
            rows[n["key"]] = {
                "key": n["key"], "project": (x.get("project") or {}).get("key") or n["key"].split("-")[0],
                "summary": html.unescape(x.get("summary") or ""), "type": (x.get("issuetype") or {}).get("name"),
                "status": st.get("name"), "statusCat": (st.get("statusCategory") or {}).get("key"),
                "assignee": (x.get("assignee") or {}).get("displayName"),
                "created": (x.get("created") or "")[:10], "updated": (x.get("updated") or "")[:10],
                "resolved": (x.get("resolutiondate") or "")[:10] or None, "due": x.get("duedate"),
                "parent": par.get("key"), "parentSummary": html.unescape((par.get("fields") or {}).get("summary") or ""),
            }
    out = {"snapshotDate": a.date, "issues": sorted(rows.values(), key=lambda r: r["key"])}
    pathlib.Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"design: {len(rows)} items")


if __name__ == "__main__":
    main()
