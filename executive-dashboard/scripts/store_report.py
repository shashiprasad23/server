#!/usr/bin/env python3
"""Build today's scoped report and store it under reports/<date>/.

  python3 scripts/store_report.py [--snapshot data/snapshot] [--scope content/scope.json]

Writes
  reports/<date>/index.html          review page (links to daily.html next to it)
  reports/<date>/daily.html          day-by-day page
  reports/<date>/dashboard-data.json computed figures
  reports/<date>/snapshot.json.gz    the in-scope Jira snapshot the figures came from
  reports/history.json               one row of headline figures per stored day
  reports/index.html                 list of every stored report
Also refreshes dist/index.html and dist/daily.html (the pages that get published).
"""
import argparse
import gzip
import html
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def run(*args):
    r = subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr or r.stdout)
    print(r.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=str(ROOT / "data" / "snapshot"))
    ap.add_argument("--scope", default=str(ROOT / "content" / "scope.json"))
    a = ap.parse_args()
    snap = pathlib.Path(a.snapshot)
    date = json.loads((snap / "meta.json").read_text())["snapshotDate"]
    out = ROOT / "reports" / date
    out.mkdir(parents=True, exist_ok=True)

    # Published pages (links point at the live artifacts from curated.json)
    run("scripts/build_dashboard.py", "--snapshot", str(snap), "--scope", a.scope)
    run("scripts/build_daily.py", "--snapshot", str(snap), "--scope", a.scope)
    # Stored copies (links point at each other inside the dated folder)
    run("scripts/build_dashboard.py", "--snapshot", str(snap), "--scope", a.scope, "--out", str(out / "index.html"), "--daily-url", "daily.html")
    run("scripts/build_daily.py", "--snapshot", str(snap), "--scope", a.scope, "--out", str(out / "daily.html"), "--review-url", "index.html")

    data = json.loads((out / "dashboard-data.json").read_text())
    keep = set(data["scope"]["projects"]) if data.get("scope") else None
    bundle = {}
    for name in ("meta", "issues", "worklogs", "register"):
        obj = json.loads((snap / f"{name}.json").read_text())
        if keep is not None and name == "issues":
            obj = [i for i in obj if i["project"] in keep]
        elif keep is not None and name == "register":
            obj = [r for r in obj if r["project"] in keep]
        elif keep is not None and name == "worklogs":
            obj = {"issues": [i for i in obj["issues"] if i["project"] in keep],
                   "worklogs": [w for w in obj["worklogs"] if w["key"].split("-")[0] in keep]}
        bundle[name] = obj
    with gzip.open(out / "snapshot.json.gz", "wt", encoding="utf-8") as f:
        json.dump(bundle, f, separators=(",", ":"))

    k = data["kpis"]
    row = {"date": date, "window": data["period"]["short"], "issuesMoved30": k["issuesUpdated30"], "closed30": k["done30"],
           "closedWindow": k["doneInPeriod"], "pastDue": k["overdueOpen"], "hours": k["hoursInPeriod"],
           "registerRed": sum(1 for r in data["register"] if r["kind"] != "Epic" and r["rag"] == "red"),
           "programmes": {c["id"]: {"closed30": c["done30"], "pastDue": c["overdueCount"], "openBugs": c["openBugs"]} for c in data.get("scorecards", [])}}
    hist_p = ROOT / "reports" / "history.json"
    hist = json.loads(hist_p.read_text()) if hist_p.exists() else []
    hist = [h for h in hist if h["date"] != date] + [row]
    hist.sort(key=lambda h: h["date"])
    hist_p.write_text(json.dumps(hist, indent=1))
    write_index(hist)
    print(f"stored reports/{date}/ ({len(hist)} report(s) in history)")


def write_index(hist):
    rows = "".join(
        f"<tr><td><a href=\"{h['date']}/index.html\">{h['date']}</a></td><td>{html.escape(h['window'])}</td>"
        f"<td class=r>{h['issuesMoved30']:,}</td><td class=r>{h['closedWindow']:,}</td><td class=r>{h['pastDue']}</td>"
        f"<td class=r>{round(h['hours']):,}</td><td class=r>{h['registerRed']}</td>"
        f"<td><a href=\"{h['date']}/daily.html\">Day by day</a></td></tr>" for h in reversed(hist))
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stored Status Reports</title>
<style>
:root{{--bg:#F3F5F7;--surface:#fff;--ink:#16212C;--muted:#5E6B78;--rule:#DCE2E8;--accent:#1D5C84}}
@media (prefers-color-scheme:dark){{:root{{color-scheme:dark;--bg:#0E141A;--surface:#151D25;--ink:#E3E9EF;--muted:#93A0AD;--rule:#283540;--accent:#7DB6DC}}}}
body{{background:var(--bg);color:var(--ink);font:15px/1.5 "IBM Plex Sans",system-ui,sans-serif;padding:32px 16px;margin:0}}
main{{max-width:1000px;margin:0 auto;display:grid;gap:14px}} h1{{margin:0;font-size:30px}} p{{margin:0;color:var(--muted)}}
.t{{overflow-x:auto;background:var(--surface);border:1px solid var(--rule);border-radius:10px}}
table{{border-collapse:collapse;width:100%;font-size:14px}} th,td{{padding:10px 12px;border-bottom:1px solid var(--rule);text-align:left;white-space:nowrap}}
th{{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:500}} .r{{text-align:right;font-variant-numeric:tabular-nums}}
a{{color:var(--accent)}}
</style></head><body><main>
<h1>Stored Status Reports</h1>
<p>One report per weekday run at 7:00 PM Nepal time, newest first. Each folder holds the review page, the day-by-day page, the computed figures and the Jira snapshot they came from.</p>
<div class="t"><table><thead><tr><th>Run date</th><th>Window</th><th class=r>Issues moved, 30 d</th><th class=r>Closed in window</th><th class=r>Past due</th><th class=r>Tempo hours</th><th class=r>Red risks</th><th></th></tr></thead>
<tbody>{rows}</tbody></table></div></main></body></html>"""
    (ROOT / "reports" / "index.html").write_text(page, encoding="utf-8")


if __name__ == "__main__":
    main()
