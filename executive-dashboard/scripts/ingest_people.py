#!/usr/bin/env python3
"""Pull-through for the named-people panels: every ticket a named person holds or raised, in any project.

The report boards only show work assigned inside them, and Tempo credits hours to the ticket
assignee. People who plan, test or coordinate (raising tickets for others) or who work outside
the report boards are invisible there. This script records their Jira footprint.

  python3 scripts/ingest_people.py --date 2026-09-28 --out data/snapshot/people.json FILE [FILE...]

Each FILE is a saved searchJiraIssuesUsingJql result for one of:
  assignee in (<ids>) AND (updated >= -30d OR statusCategory != Done)      fields + "worklog"
  reporter in (<ids>) AND (created >= -30d OR updated >= -30d)             fields
The people and their account ids come from content/scope.json ("spotlight").
"""
import argparse
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", required=True)
    ap.add_argument("--out", default=str(ROOT / "data" / "snapshot" / "people.json"))
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    spot = json.loads((ROOT / "content" / "scope.json").read_text()).get("spotlight", [])
    ids = {p["accountId"]: p["name"] for p in spot}

    nodes = {}
    for f in a.files:
        for n in json.loads(pathlib.Path(f).read_text())["issues"]["nodes"]:
            prev = nodes.get(n["key"])
            # keep the copy that carries worklogs
            if not prev or (n["fields"].get("worklog") and not prev["fields"].get("worklog")):
                nodes[n["key"]] = n

    people = {p["name"]: {"name": p["name"], "accountId": p["accountId"], "assigned": [], "reported": []} for p in spot}
    for key, n in sorted(nodes.items()):
        f = n["fields"]
        st = f.get("status") or {}
        row = {
            "key": key, "project": (f.get("project") or {}).get("key") or key.split("-")[0],
            "summary": f.get("summary") or "", "type": (f.get("issuetype") or {}).get("name"),
            "status": st.get("name"), "statusCat": (st.get("statusCategory") or {}).get("key"),
            "created": (f.get("created") or "")[:10], "resolved": (f.get("resolutiondate") or "")[:10] or None,
            "due": f.get("duedate"), "assignee": (f.get("assignee") or {}).get("displayName"),
        }
        asg = (f.get("assignee") or {}).get("accountId")
        rep = (f.get("reporter") or {}).get("accountId")
        if asg in ids:
            wl = (f.get("worklog") or {}).get("worklogs", [])
            people[ids[asg]]["assigned"].append({**row, "spentHours": round((f.get("timespent") or 0) / 3600, 2),
                                                 "logs": [[w["started"][:10], round(w["timeSpentSeconds"] / 3600, 2)] for w in wl]})
        if rep in ids:
            people[ids[rep]]["reported"].append(row)
    out = {"snapshotDate": a.date, "people": list(people.values())}
    pathlib.Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1))
    for p in out["people"]:
        print(f"{p['name']}: {len(p['assigned'])} assigned, {len(p['reported'])} raised")


if __name__ == "__main__":
    main()
