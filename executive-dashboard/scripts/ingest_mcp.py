#!/usr/bin/env python3
"""Turn Atlassian-connector Jira search results into a dashboard snapshot.

The scheduled run pulls Jira through the Atlassian connector (searchJiraIssuesUsingJql).
Large results are saved to a file by the harness; small ones come back inline and must be
written to a file first. This script accumulates those files, then writes the snapshot.

  # after each search page (prints the next page token, or NONE)
  python3 scripts/ingest_mcp.py add --work /tmp/pull --kind issues   <result-file> [more files]
  python3 scripts/ingest_mcp.py add --work /tmp/pull --kind worklogs <result-file>
  python3 scripts/ingest_mcp.py add --work /tmp/pull --kind register <result-file>

  # when every page is in
  python3 scripts/ingest_mcp.py finalize --work /tmp/pull --out data/snapshot \\
      --date 2026-09-23 --projects-visible 20 --open-all 1850

  # check coverage against Jira's own count
  python3 scripts/ingest_mcp.py status --work /tmp/pull
"""
import argparse
import json
import pathlib
import re
import sys

KINDS = ("issues", "worklogs", "register")


def adf_text(n):
    if n is None:
        return ""
    if isinstance(n, str):
        return n
    if isinstance(n, list):
        return "".join(adf_text(i) for i in n)
    t = n.get("text", "")
    if n.get("type") == "listItem":
        t = "* " + t
    sep = "\n" if n.get("type") in ("paragraph", "heading", "listItem", "bulletList", "orderedList", "tableRow") else ""
    return t + adf_text(n.get("content", [])) + sep


def nm(x, k="name"):
    return x.get(k) if isinstance(x, dict) else None


def norm(it):
    f = it.get("fields") or {}
    return {
        "key": it["key"], "project": (f.get("project") or {}).get("key") or it["key"].split("-")[0],
        "summary": f.get("summary"), "type": nm(f.get("issuetype")), "subtask": (f.get("issuetype") or {}).get("subtask"),
        "status": nm(f.get("status")), "statusCat": nm((f.get("status") or {}).get("statusCategory") or {}, "key"),
        "priority": nm(f.get("priority")), "assignee": nm(f.get("assignee"), "displayName"),
        "reporter": nm(f.get("reporter"), "displayName"), "created": f.get("created"), "updated": f.get("updated"),
        "resolved": f.get("resolutiondate"), "due": f.get("duedate"), "spent": f.get("timespent"),
        "est": f.get("timeoriginalestimate"), "remaining": f.get("timeestimate"),
        "parent": (f.get("parent") or {}).get("key"),
    }


def read_result(path):
    d = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if isinstance(d, list):  # some harnesses wrap the payload as [{"type":"text","text": "..."}]
        d = json.loads(d[0]["text"])
    issues = d.get("issues") or {}
    nodes = issues.get("nodes") if isinstance(issues, dict) else issues
    info = issues.get("pageInfo") or {} if isinstance(issues, dict) else {}
    return nodes or [], (info.get("endCursor") if info.get("hasNextPage") else None), issues.get("webUrl", "") if isinstance(issues, dict) else ""


def store_path(work, kind):
    return pathlib.Path(work) / f"{kind}.json"


def cmd_add(a):
    work = pathlib.Path(a.work)
    work.mkdir(parents=True, exist_ok=True)
    sp = store_path(work, a.kind)
    store = json.loads(sp.read_text()) if sp.exists() else {}
    for fpath in a.files:
        nodes, nxt, url = read_result(fpath)
        before = len(store)
        for it in nodes:
            rec = norm(it)
            f = it.get("fields") or {}
            if a.kind == "worklogs":
                wlf = f.get("worklog") or {}
                rec["worklogTotal"] = wlf.get("total")
                rec["worklogs"] = [{"started": w.get("started"), "seconds": w.get("timeSpentSeconds"),
                                    "author": nm(w.get("author"), "displayName"),
                                    "comment": adf_text(w.get("comment")).strip()[:300]} for w in wlf.get("worklogs", [])]
            if a.kind == "register":
                desc = f.get("description")
                rec["desc"] = desc if isinstance(desc, str) else adf_text(desc)
                cms = (f.get("comment") or {}).get("comments") or []
                rec["comments"] = [{"author": nm(c.get("author"), "displayName"), "created": c.get("created"),
                                    "body": c["body"] if isinstance(c.get("body"), str) else adf_text(c.get("body"))} for c in cms[-3:]]
            store[rec["key"]] = rec
        sp.write_text(json.dumps(store))
        print(f"{a.kind}: +{len(nodes)} ({len(store) - before} new) -> {len(store)} | next={nxt or 'NONE'}")


def parse_register(rec):
    d = rec.get("desc") or ""
    m = re.search(r"Likelihood:\s*(\w+).*?Impact:\s*(\w+).*?Status:\s*([\w ]+?)\s*\n", d, re.S)
    o = re.search(r"Owner:\s*([^\n*]+)", d)
    mit = re.search(r"Mitigation / Acceptance Criteria\**\s*(.*?)\**Risk Register", d, re.S)
    ctx = re.search(r"\**Context\**\s*(.*?)\**Mitigation", d, re.S)
    last = (rec.get("comments") or [None])[-1]
    out = {k: rec.get(k) for k in ("key", "project", "summary", "type", "subtask", "status", "statusCat", "priority", "assignee",
                                    "reporter", "created", "updated", "resolved", "due", "spent", "est", "remaining", "parent")}
    out.update({
        "kind": "Epic" if (rec["summary"] or "").startswith("Risk and") else rec["summary"].split(":")[0],
        "likelihood": m.group(1) if m else None, "impact": m.group(2) if m else None,
        "registerStatus": m.group(3).strip() if m else None, "ownerTeam": o.group(1).strip() if o else None,
        "context": re.sub(r"\s+", " ", ctx.group(1)).strip() if ctx else None,
        "mitigation": [x.strip() for x in re.findall(r"\*\s+([^\n]+)", mit.group(1))] if mit else [],
        "lastComment": ({"author": last["author"], "date": (last["created"] or "")[:10],
                         "text": re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", last["body"] or ""))[:400]} if last else None),
    })
    return out


def cmd_finalize(a):
    work, out = pathlib.Path(a.work), pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    load = lambda k: json.loads(store_path(work, k).read_text()) if store_path(work, k).exists() else {}
    issues, wls, reg = load("issues"), load("worklogs"), load("register")
    if not issues:
        sys.exit("No issues ingested. Run the issues pull first.")
    keep = ("key", "project", "summary", "type", "subtask", "status", "statusCat", "priority", "assignee", "reporter",
            "created", "updated", "resolved", "due", "spent", "est", "remaining", "parent")
    issue_rows = [{k: v.get(k) for k in keep} for v in sorted(issues.values(), key=lambda x: x["key"])]
    wl_issues, logs = [], []
    for k, v in sorted(wls.items()):
        wl_issues.append({kk: v.get(kk) for kk in keep} | {"worklogTotal": v.get("worklogTotal"), "worklogsReturned": len(v.get("worklogs", []))})
        for w in v.get("worklogs", []):
            logs.append({"key": k, "started": w["started"], "seconds": w["seconds"], "author": w["author"], "comment": w["comment"]})
    register = [parse_register(r) for r in sorted(reg.values(), key=lambda x: x["key"])
                if re.match(r"^(Risk|Dependency)\s*:", r.get("summary") or "") or (r.get("summary") or "").strip() == "Risk and Dependency Mitigation"]
    meta = {"snapshotDate": a.date, "site": a.site, "projectsVisible": a.projects_visible,
            "queries": {"issues": f"updated >= -30d ({a.scope_note})", "worklogs": "worklogDate >= -14d", "register": "summary ~ Risk|Dependency"},
            "counts": {"issuesUpdated30d": len(issue_rows), "openAllTime": a.open_all, "worklogIssues": len(wl_issues),
                       "worklogEntries": len(logs), "registerItems": len(register), "expectedIssues": a.expected}}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    (out / "issues.json").write_text(json.dumps(issue_rows, separators=(",", ":")))
    (out / "worklogs.json").write_text(json.dumps({"issues": wl_issues, "worklogs": logs}, separators=(",", ":")))
    (out / "register.json").write_text(json.dumps(register, indent=1))
    msg = f"snapshot {a.date}: {len(issue_rows)} issues, {len(wl_issues)} worklog issues / {len(logs)} worklogs, {len(register)} register items"
    if a.expected and a.expected != len(issue_rows):
        msg += f"  WARNING: Jira count was {a.expected}, ingested {len(issue_rows)}"
    print(msg)


def cmd_status(a):
    for k in KINDS:
        sp = store_path(a.work, k)
        n = len(json.loads(sp.read_text())) if sp.exists() else 0
        print(f"{k}: {n}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("add")
    p.add_argument("--work", required=True)
    p.add_argument("--kind", choices=KINDS, required=True)
    p.add_argument("files", nargs="+")
    p = sub.add_parser("finalize")
    p.add_argument("--work", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--date", required=True)
    p.add_argument("--site", default="uvation-devops.atlassian.net")
    p.add_argument("--projects-visible", type=int, default=20)
    p.add_argument("--open-all", type=int, default=None)
    p.add_argument("--expected", type=int, default=None, help="Jira's own count for the issues query")
    p.add_argument("--scope-note", default="in-scope projects")
    p = sub.add_parser("status")
    p.add_argument("--work", required=True)
    a = ap.parse_args()
    {"add": cmd_add, "finalize": cmd_finalize, "status": cmd_status}[a.cmd](a)


if __name__ == "__main__":
    main()
