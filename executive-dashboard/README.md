# Executive dashboard: portfolio status review

A single-page dashboard that answers the four review points raised on the last status report, using data pulled from every Jira project on `uvation-devops.atlassian.net`.

| Review point | Where it is answered |
| --- | --- |
| 1. Risks: impact, mitigation, owner, status; stale items | **Risks** section. All 25 register items with a keep, close, re-assess or escalate verdict. The "Product Catalog hire" risk is assessed separately. |
| 2. Issues and preventive actions, including the UAT policy change | **Issues & prevention** section. Eleven issues, each with impact, root cause, action taken and prevention. |
| 3. Project-wise accomplishments | **Project progress** section. The Marketplace brand pipeline runs from research through UAT and production to live. Web-Marketing testing is measured against total scope. Every active project is included. |
| 4. Resource utilisation | **Resource utilisation** section. Hours per person against capacity, plus deep dives on the two examples raised and the data-quality gaps. |

Open `dist/index.html` in a browser. It is self-contained, apart from Google Fonts.

## Scope

Both pages are scoped by `content/scope.json` to four programmes: Web-Marketplace (with Web-Marketplace Product Catalog), Web-Marketing, Web-Uvation Services Platform and Uvation Conversational AI. Every figure is filtered to those boards, including the risk register and hours. The review page adds one scorecard per programme: throughput, stories delivered and in flight, items past due, blocked items, parent roll-ups and open bugs by severity. To rebuild for every project, pass `--scope all` to either build script.

`dist/daily.html` is the day-by-day companion page. It covers issues created and resolved per day across all projects, Tempo hours per day by project and by person, per-person throughput heatmaps, a day explorer, small multiples per project, the Marketplace pipeline timeline, the category-disable burn-up, Figma defects raised against fixed, risk-register age and a dated event log. It loads ECharts 5.5.0 from cdnjs. Dated milestones live in `content/daily_events.json`.

## Scheduled daily run

A routine runs every weekday (Monday to Friday) at 7:00 PM Nepal time and follows `RUNBOOK.md`. Each run:

1. Pulls the in-scope Jira data through the Atlassian connector.
2. Turns it into a snapshot with `scripts/ingest_mcp.py`.
3. Refreshes the programme headlines.
4. Stores the day's report with `scripts/store_report.py`.
5. Commits and pushes to this branch.
6. Updates the two live pages.

Stored reports live in `reports/<date>/`, and `reports/index.html` lists them all with their headline figures. The report window rolls forward on its own: the 14 days ending the day before the run, less weekends and listed holidays.

## Snapshot used

`data/snapshot/` holds the Jira pull taken on 23 Sep 2026:

- `issues.json`: all 2,422 issues updated in the previous 30 days, across all 20 projects. This matches Jira's own count.
- `worklogs.json`: 379 issues with worklogs dated in the last 14 days, and their worklogs.
- `register.json`: the risk and dependency register, parsed for likelihood, impact, owner team and mitigation.
- `meta.json`: queries and counts.

`content/curated.json` holds the review layer: risk verdicts, the issues log, the Marketplace product pipeline, testing scope and utilisation notes. Every judgement cites the tickets it rests on. Confirm verdicts and suggested owners with each owner before circulating.

## Refresh

```bash
export JIRA_SITE=uvation-devops.atlassian.net
export JIRA_EMAIL=you@uvation.com
export JIRA_API_TOKEN=...          # id.atlassian.com > Security > API tokens
export TEMPO_API_TOKEN=...         # optional; gives true per-person hours
python3 scripts/fetch_jira.py      # writes data/snapshot/
# edit content/curated.json: period dates, verdicts, issues
python3 scripts/build_dashboard.py # writes dist/index.html and dist/dashboard-data.json
python3 scripts/build_daily.py     # writes dist/daily.html
```

`fetch_jira.py` uses only the standard library. It has not yet been run against the live site, because this snapshot was pulled through the Atlassian connector. Check its first run.

## Known limits

- **Who logged the time.** Tempo writes every worklog under its own app account, so Jira cannot tell who worked an hour. Without `TEMPO_API_TOKEN`, hours are credited to the ticket's current assignee. That inflates QA engineers who hold developers' tickets in testing. With the Tempo token, the real worker is used.
- **Overhead time.** Meetings and leave are logged on 13 shared overhead tickets in Uvation Projects. The Jira search API returns only the oldest 20 worklogs on each ticket. `fetch_jira.py` pages the worklog endpoint to get all of them.
- **Outside Jira.** The status-report risk list and Anmol Srivastava's testing report are not in Jira or Confluence, so they are referenced, not measured.
