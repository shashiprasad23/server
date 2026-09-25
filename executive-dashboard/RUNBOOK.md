# Daily report runbook

The scheduled routine follows this file every weekday at 7:00 PM Nepal time (13:15 UTC). One run pulls Jira for the four in-scope programmes, rebuilds both pages, stores a dated copy in the repo, pushes it and updates the two live pages.

Scope comes from `content/scope.json`: Web-Marketplace (`MT`, `PC`), Web-Marketing (`MR`), Web-Uvation Services Platform (`USP`) and Uvation Conversational AI (`UC`).

## 0. Prepare

```bash
cd /home/user/server   # or wherever the repo is cloned
git fetch origin claude/executive-dashboard-jira-review-gclk36
git checkout claude/executive-dashboard-jira-review-gclk36
git pull --ff-only origin claude/executive-dashboard-jira-review-gclk36
cd executive-dashboard
DATE=$(TZ=Asia/Kathmandu date +%F)
TZ=Asia/Kathmandu date +%u    # 6 or 7 = weekend: stop here, nothing to do
W=$(mktemp -d)                # work folder for raw pages
```

If `reports/$DATE/` already exists, the run already happened today. Re-running overwrites it, which is fine.

## 1. Pull Jira through the Atlassian connector

Use `searchJiraIssuesUsingJql` with `cloudId` `09e6aef8-d8d5-492a-9b43-17decb19460a`. Page with `nextPageToken` until the ingest prints `next=NONE`, and always pass `maxResults: 100`.

**Every page must reach the ingest script.** Large results are saved to a file by the harness, and the error message names that file. Small results come back inline. Write the whole inline JSON to a file under `$W` first, then ingest it. Skipping an inline page silently drops issues. The count check in step 2 catches that.

Fields for the issues and worklog pulls:

```
["summary","status","assignee","reporter","issuetype","priority","created","updated","resolutiondate","timespent","timeoriginalestimate","timeestimate","duedate","labels","parent","project","components"]
```

| Pull | JQL | Extra | Ingest kind |
| --- | --- | --- | --- |
| Count (once) | `project in (MT, PC, MR, USP, UC) AND updated >= -30d` | `searchResultMode: "count"` | Note the total as EXPECTED |
| Open count (once) | `project in (MT, PC, MR, USP, UC) AND statusCategory != Done` | `searchResultMode: "count"` | Note as OPEN |
| Issues | `project in (MT, PC, MR, USP, UC) AND updated >= -30d ORDER BY key ASC` | fields above | `issues` |
| Worklogs | `project in (MT, PC, MR, USP, UC) AND worklogDate >= -14d ORDER BY key ASC` | fields above plus `"worklog"` | `worklogs` |
| Register | `project in (MT, PC, MR, USP, UC) AND (summary ~ "Risk" OR summary ~ "Dependency") ORDER BY key ASC` | fields above plus `"description","comment"`, `responseContentFormat: "markdown"` | `register` |

After each page:

```bash
python3 scripts/ingest_mcp.py add --work $W --kind issues <saved-or-written-file>
```

Keep the same `ORDER BY key ASC` and follow the token. Never restart a pull with a `key >` filter, because Jira sorts keys as text.

## 2. Build the snapshot

```bash
python3 scripts/ingest_mcp.py finalize --work $W --out data/snapshot --date $DATE --open-all OPEN --expected EXPECTED
```

A `WARNING: Jira count was …` line means pages are missing. Find which project is short, re-pull it, and finalize again. Do not store a short snapshot.

## 3. Refresh the narrative (judgement, keep it factual)

Read `dist/dashboard-data.json` after a first build (`python3 scripts/build_dashboard.py`). Then:

- **Headlines.** Rewrite each programme's `headline` in `content/scope.json` from its scorecard: throughput, past-due count, blocked items, open bugs by severity, and anything newly delivered. State only what the data shows. Keep it to two or three sentences.
- **Holidays.** If a weekday in the window has no worklogs from anyone, add it to `holidays` in `content/daily_events.json`.
- **Register.** If a register item moved to Done since the last run, set its `riskReview` verdict in `content/curated.json` to `Close` with a one-line reason. New register items appear as "Not reviewed". Give each a verdict only when the ticket supports it.
- **Events.** For milestones visible in ticket comments on in-scope items, such as a production move, a go-live approval or a new P1, append a dated entry to `events` in `content/daily_events.json` with its keys.
- Leave the other judgements in `curated.json` alone unless a ticket contradicts them. If one does, fix the sentence and say so in the run summary.

## 4. Store

```bash
python3 scripts/store_report.py
```

This writes `reports/$DATE/` (the review page, the day-by-day page, the figures and a gzipped in-scope snapshot), appends to `reports/history.json`, rewrites `reports/index.html` and refreshes `dist/`.

It also rebuilds the report calendar: `dist/calendar/<date>.json` (review page) and `dist/calendar/daily-<date>.json` (day-by-day page), one of each per weekday. Days with a stored evening run use that run. Other weekdays are rebuilt from the nearest later snapshot, wound back to the end of that day (`scripts/build_calendar.py`).

## 4b. Prepare the email

```bash
python3 scripts/build_email.py --to s.prasad@uvation.com
```

This writes `email.html`, `email.txt` and `email.eml` into `reports/$DATE/`. If a Gmail or Outlook connector is available in the session, send `email.html` as the body to s.prasad@uvation.com, with the subject from the `.eml`. If not, say in the summary that the email is ready in the folder and was not sent.

## 5. Commit and push

```bash
cd ..
git add executive-dashboard/data/snapshot executive-dashboard/reports executive-dashboard/dist executive-dashboard/content
git commit -m "Daily status report $DATE"
git push -u origin claude/executive-dashboard-jira-review-gclk36   # retry up to 4 times on network errors: 2s, 4s, 8s, 16s
```

## 6. Update the live pages

Read each artifact first, then publish the rebuilt file to the same URL. Both pages carry the report calendar and must be published with their calendar files, or clicking a date shows "could not be loaded":

- Review page: `files` maps `calendar/<date>.json` to `executive-dashboard/dist/calendar/<date>.json` for every date file, plus `calendar/index.json`.
- Daily page: `files` maps `calendar/daily-<date>.json` to `executive-dashboard/dist/calendar/daily-<date>.json` for every daily file, plus `calendar/index.json`.

| Page | File | URL |
| --- | --- | --- |
| Portfolio Status Review | `executive-dashboard/dist/index.html` | https://claude.ai/artifact/R9gQ2oHPXkQaj2ZgrXCEAe |
| Daily Delivery Pulse | `executive-dashboard/dist/daily.html` | https://claude.ai/artifact/K7m76XrnRRHWkGYqHtDySN |

## 7. Report back

Finish with a short summary, compared with the previous row of `reports/history.json`:

- issues moved and closed
- items past due
- Tempo hours
- red risks

Also list headline changes per programme, any warnings from the pull, and any judgement you changed.
