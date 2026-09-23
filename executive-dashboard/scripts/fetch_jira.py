#!/usr/bin/env python3
"""Pull a fresh Jira (and optionally Tempo) snapshot for the executive dashboard.

Writes the same four files that scripts/build_dashboard.py reads:
  meta.json, issues.json, worklogs.json, register.json

Environment
  JIRA_SITE        e.g. uvation-devops.atlassian.net
  JIRA_EMAIL       Atlassian account email
  JIRA_API_TOKEN   Atlassian API token (id.atlassian.com > Security > API tokens)
  TEMPO_API_TOKEN  optional. When set, each worklog gets a "worker" (the real person),
                   which fixes per-person utilisation. Tempo > Settings > API integration.

Usage
  python3 scripts/fetch_jira.py [--out data/snapshot] [--days 30] [--worklog-days 14]

Only the Python standard library is used.
"""
import argparse
import base64
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIELDS = ["summary", "status", "assignee", "reporter", "issuetype", "priority", "created", "updated",
          "resolutiondate", "timespent", "timeoriginalestimate", "timeestimate", "duedate", "parent", "project"]


def env(name, required=True):
    v = os.environ.get(name)
    if required and not v:
        sys.exit(f"Set {name} first.")
    return v


def http(url, headers, body=None, method=None, tries=4):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={**headers, "Accept": "application/json",
                                                          **({"Content-Type": "application/json"} if data else {})},
                                 method=method or ("POST" if data else "GET"))
    for n in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                time.sleep(int(e.headers.get("Retry-After", 2 ** (n + 1))))
                continue
            raise SystemExit(f"{e.code} {e.reason} for {url}\n{e.read().decode()[:500]}")
    raise SystemExit(f"Gave up after {tries} tries: {url}")


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


class Jira:
    def __init__(self, site, email, token):
        self.base = f"https://{site}"
        auth = base64.b64encode(f"{email}:{token}".encode()).decode()
        self.h = {"Authorization": f"Basic {auth}"}

    def search(self, jql, fields):
        token, out = None, []
        while True:
            body = {"jql": jql, "fields": fields, "maxResults": 100}
            if token:
                body["nextPageToken"] = token
            r = http(f"{self.base}/rest/api/3/search/jql", self.h, body)
            out += r.get("issues", [])
            token = r.get("nextPageToken")
            print(f"  {len(out)} issues", file=sys.stderr)
            if not token or r.get("isLast"):
                return out

    def count(self, jql):
        r = http(f"{self.base}/rest/api/3/search/approximate-count", self.h, {"jql": jql})
        return r.get("count")

    def worklogs(self, key, started_after_ms):
        out, start = [], 0
        while True:
            q = urllib.parse.urlencode({"startAt": start, "maxResults": 5000, "startedAfter": started_after_ms})
            r = http(f"{self.base}/rest/api/3/issue/{key}/worklog?{q}", self.h)
            out += r.get("worklogs", [])
            start += len(r.get("worklogs", []))
            if start >= r.get("total", 0) or not r.get("worklogs"):
                return out, r.get("total", len(out))

    def user_name(self, account_id, cache={}):
        if account_id not in cache:
            try:
                cache[account_id] = http(f"{self.base}/rest/api/3/user?accountId={urllib.parse.quote(account_id)}", self.h).get("displayName")
            except SystemExit:
                cache[account_id] = account_id
        return cache[account_id]


def norm(it):
    f = it["fields"]
    nm = lambda x, k="name": x.get(k) if isinstance(x, dict) else None
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


def tempo_workers(token, start, end):
    """Map Jira worklog id -> Tempo worker accountId."""
    h = {"Authorization": f"Bearer {token}"}
    url = f"https://api.tempo.io/4/worklogs?from={start}&to={end}&limit=1000"
    out = {}
    while url:
        r = http(url, h)
        for w in r.get("results", []):
            jid = w.get("jiraWorklogId")
            if jid:
                out[str(jid)] = (w.get("author") or {}).get("accountId")
        url = (r.get("metadata") or {}).get("next")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(ROOT / "data" / "snapshot"))
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--worklog-days", type=int, default=14)
    a = ap.parse_args()
    site = env("JIRA_SITE")
    jira = Jira(site, env("JIRA_EMAIL"), env("JIRA_API_TOKEN"))
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    today = dt.date.today()

    print("Issues…", file=sys.stderr)
    issues = [norm(i) for i in jira.search(f"updated >= -{a.days}d ORDER BY key ASC", FIELDS)]

    print("Worklogs…", file=sys.stderr)
    wstart = today - dt.timedelta(days=a.worklog_days)
    after_ms = int(dt.datetime.combine(wstart, dt.time()).timestamp() * 1000)
    wl_issues = [norm(i) for i in jira.search(f"worklogDate >= -{a.worklog_days}d ORDER BY key ASC", FIELDS)]
    workers = {}
    if os.environ.get("TEMPO_API_TOKEN"):
        print("Tempo workers…", file=sys.stderr)
        workers = tempo_workers(os.environ["TEMPO_API_TOKEN"], wstart.isoformat(), today.isoformat())
    logs = []
    for i in wl_issues:
        ws, total = jira.worklogs(i["key"], after_ms)
        i["worklogTotal"], i["worklogsReturned"] = total, len(ws)
        for w in ws:
            rec = {"key": i["key"], "started": w.get("started"), "seconds": w.get("timeSpentSeconds"),
                   "author": (w.get("author") or {}).get("displayName"), "comment": adf_text(w.get("comment")).strip()}
            acc = workers.get(str(w.get("id")))
            if acc:
                rec["worker"] = jira.user_name(acc)
            logs.append(rec)

    print("Register…", file=sys.stderr)
    reg_raw = jira.search('(summary ~ "Risk" OR summary ~ "Dependency") AND project != HC ORDER BY key ASC',
                          FIELDS + ["description", "comment"])
    register = []
    for it in reg_raw:
        r = norm(it)
        if not (re.match(r"^(Risk|Dependency)\s*:", r["summary"] or "") or (r["summary"] or "").strip() == "Risk and Dependency Mitigation"):
            continue
        d = adf_text(it["fields"].get("description"))
        m = re.search(r"Likelihood:\s*(\w+).*?Impact:\s*(\w+).*?Status:\s*([\w ]+?)\s*\n", d, re.S)
        o = re.search(r"Owner:\s*([^\n*]+)", d)
        mit = re.search(r"Mitigation / Acceptance Criteria\s*(.*?)Risk Register", d, re.S)
        ctx = re.search(r"Context\s*(.*?)Mitigation", d, re.S)
        cms = (it["fields"].get("comment") or {}).get("comments") or []
        last = cms[-1] if cms else None
        register.append(r | {
            "kind": "Epic" if r["summary"].startswith("Risk and") else r["summary"].split(":")[0],
            "likelihood": m.group(1) if m else None, "impact": m.group(2) if m else None,
            "registerStatus": m.group(3).strip() if m else None, "ownerTeam": o.group(1).strip() if o else None,
            "context": re.sub(r"\s+", " ", ctx.group(1)).strip() if ctx else None,
            "mitigation": [x.strip() for x in re.findall(r"\*\s+([^\n]+)", mit.group(1))] if mit else [],
            "lastComment": {"author": (last.get("author") or {}).get("displayName"), "date": (last.get("created") or "")[:10],
                            "text": re.sub(r"\s+", " ", adf_text(last.get("body")))[:400]} if last else None,
        })

    projects = http(f"{jira.base}/rest/api/3/project/search?maxResults=100", jira.h)
    meta = {"snapshotDate": today.isoformat(), "site": site, "projectsVisible": projects.get("total"),
            "queries": {"issues": f"updated >= -{a.days}d (all projects)", "worklogs": f"worklogDate >= -{a.worklog_days}d",
                        "register": "summary ~ Risk|Dependency, project != HC"},
            "counts": {"issuesUpdated30d": len(issues), "openAllTime": jira.count("statusCategory != Done"),
                       "worklogIssues": len(wl_issues), "worklogEntries": len(logs), "registerItems": len(register),
                       "tempoWorkers": bool(workers)}}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    (out / "issues.json").write_text(json.dumps(issues, separators=(",", ":")))
    (out / "worklogs.json").write_text(json.dumps({"issues": wl_issues, "worklogs": logs}, separators=(",", ":")))
    (out / "register.json").write_text(json.dumps(register, indent=1))
    print(f"Wrote {out}: {len(issues)} issues, {len(logs)} worklogs, {len(register)} register items", file=sys.stderr)
    print("Update content/curated.json (period dates, verdicts) before building.", file=sys.stderr)


if __name__ == "__main__":
    main()
