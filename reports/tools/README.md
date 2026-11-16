# Daily Sprint Status Report – Runbook

This folder holds everything needed to regenerate the **Daily Sprint Status Report** and the
**Clarification Requests** document from Jira, from any Claude account.

## 1. Prerequisites (in the Claude account that will run it)

1. **GitHub** connected in claude.ai → Settings → Connectors, with access to
   `shashiprasad23/server` (branch `claude/sleepy-ramanujan-njq2mz`).
2. **Atlassian (Jira)** connector added from Claude's connector directory and signed in with a
   user who can see site `uvation-devops` (cloudId `09e6aef8-d8d5-492a-9b43-17decb19460a`) and
   projects MT, MR, USP, ID, ATLAS, PULSE, UC, AFVU.
3. *(Optional)* An **Outlook / Microsoft 365** mail connector if the clarification emails should
   actually be sent. Without it they are saved as a Word document.
4. Python 3 with `python-docx`; LibreOffice (`soffice`) and `poppler-utils` (`pdfinfo`, `pdftotext`)
   for the render check. All are present in Claude Code cloud sessions.

## 2. Files

| File | Purpose |
|---|---|
| `daily_helpers.py` | Document setup (Calibri 10pt), `heading`, `bullets`, `table`, `numbered`, table headers |
| `clean_overrides.py` | `project()` – renders one project page; drops empty sections and TBC-only milestones; page break per project |
| `body_YYMMDD.py` / `body_11DD.py` | The day's content: title, date line and one `project({...})` call per project |
| `clar_1014.py` | Builds the Clarification Requests docx from a flag TSV |
| `flag.tsv` | Latest overdue list (tab-separated): `flag, key, status, assignee, due(YYYY-MM-DD), parent, est, spent, summary` |

### `project({...})` keys
`name`, `break` (True for every project after the first), `highlights` (list),
`risks` (rows: Risk, Impact, Mitigation, Owner, ETA), `deps` (rows: Dependency, Status, Impact,
Owner, Expected Date), `milestones` (tuples `("Key milestone:", text)`), `resources` (rows:
Resource, Utilisation, Performance, Action), `mgmt` (list), `focus` (list, numbered automatically).

## 3. Build commands

```bash
cd reports/tools
D=2026-11-16            # report date
B=body_1116.py          # the day's body file
cat daily_helpers.py clean_overrides.py $B > /tmp/build.py && echo 'doc.save(OUT)' >> /tmp/build.py
python3 /tmp/build.py ../Daily_Sprint_Report_$D.docx
python3 clar_1014.py flag.tsv ../Clarification_Requests_$D.docx "16 Nov 2026"

# Render check: report should be 8 pages, each page starting with a project name
soffice --headless --convert-to pdf --outdir /tmp/pdf ../Daily_Sprint_Report_$D.docx
pdfinfo /tmp/pdf/Daily_Sprint_Report_$D.pdf | grep Pages
for p in $(seq 1 9); do pdftotext -f $p -l $p /tmp/pdf/Daily_Sprint_Report_$D.pdf - | head -1; done
```
If a project spills onto an extra page, shorten that project's highlights/risks text and rebuild.

## 4. Scheduled task prompt (paste as-is)

Schedule daily at about **13:09 UTC (18:39 IST)**.

> Scheduled run: generate today's Daily Sprint Status Report as a Word document, matching the cleaned 7 Oct 2026 report (reports/Daily_Sprint_Report_2026-10-07.docx), then prepare the per-assignee clarification emails. Use the scripts and runbook in reports/tools/ (README.md) and start from the most recent body_*.py and flag.tsv.
>
> Scope: Jira site uvation-devops (cloudId 09e6aef8-d8d5-492a-9b43-17decb19460a); projects MT (Web Marketplace), MR (Web Marketing), USP, ATLAS (Uvation Atlas), ID (Web Identity), PULSE (Uvation Pulse), UC (Uvation Conversational AI) and AFVU (AI Factory Visualizations – USP). Only tickets in the CURRENT sprint (per board: the sprint whose dates cover today, active or future, else the latest active one; ignore stale old sprints such as "MAR Sprint 1/2" and "USP_Sprint_02 | 2025_07_20"; beware sprint names reused by old closed sprints – match on sprint id/state) and in the "Retrospective" sprint (sprint = "Retrospective"), plus subtasks whose parent is in that set. Do not scan the rest of the projects.
>
> Steps:
> 1. Pull current-sprint and Retrospective tickets (fields incl. customfield_10020, status, assignee, duedate, resolutiondate, parent, timeoriginalestimate, timespent). Pull today's activity (updated/created/resolutiondate >= startOfDay()) for the eight projects and keep only in-scope keys/parents.
> 2. Highlights cover TODAY only; sprint status line, risks and resources are a snapshot as of today.
> 3. Per project, same structure: Key Highlights, Risks table (Risk/Impact/Mitigation/Owner/ETA), Dependencies table, Upcoming Milestones, Resource Utilisation & Performance table, Management Attention / Decisions Required, Next Day Focus (numbered 1..n, restarting per project). No Performance Review. Project order: MT, MR, USP, ID, ATLAS, PULSE, UC, AFVU.
> 4. NO NOISE: title "Daily Sprint Status Report" with one line "Date: <date> | Current sprint & Retrospective"; no explanatory notes or scope paragraphs; leave out projects with no sprint/Retrospective tickets; drop milestone lines that are only TBC; omit a section when it has nothing real; no "None today" lines; no resource rows without an action; never invent dates or utilisation %.
> 5. Save as reports/Daily_Sprint_Report_<YYYY-MM-DD>.docx (python-docx, same layout), check it renders, send it to me with SendUserFile.
> 6. Clarification emails: list every in-scope ticket (incl. subtasks) that is not Done and whose due date is before today (or whose original estimate is exceeded, if estimate fields exist). Group by assignee: one email per assignee, subject "Clarification needed – <n> ticket(s) past due date", body asking for reason for delay (blocker, dependency, scope change or estimate), revised completion date and help needed, with a table Ticket / Summary / Due date / Current status, signed "Thanks, Shashi". Unassigned tickets go in my summary, not an email.
>    - If an Outlook / Microsoft 365 mail tool is available in this session AND the assignee's email address is known, send the email from my Outlook to that assignee. Do not cc anyone.
>    - Otherwise do not send anything: save all emails as reports/Clarification_Requests_<YYYY-MM-DD>.docx (one page per assignee, same layout as Clarification_Requests_2026-10-13.docx), send it to me with SendUserFile, and say which emails could not be sent and why.
> 7. Give a 3–5 line summary. Commit and push the new files to branch claude/sleepy-ramanujan-njq2mz.

## 5. Rules applied so far (keep these consistent)

**Current sprints (as of 16 Nov 2026)** – "Nov 2nd Sprint", 16–29/30 Nov:

| Project | Board | Current sprint id | Retrospective id | Notes |
|---|---|---|---|---|
| MT | 15 | 5418 (active) | 2655 | Ignore MAR Sprint 1/2 (ids 1, 22) |
| MR | 4 | 5419 (active) | 3490 | |
| USP | 183 | 5352 (future, 16–30 Nov) | – | Nov 1st Sprint 5351 still open: include its non-done items. Ignore USP_Sprint_02 (id 185) |
| ID | 10 | 5421 (active) | 2689 | |
| ATLAS | 650 | 5424 (active) | 5429 | |
| UC | 581 | 5423 (active) | 5413 | |
| AFVU | 653 | 5422 (future, 16–29 Nov) | 5409 ("Retro Spective") | Nov 1st Sprint 5403 still open: include its non-done items |
| PULSE | – | none in November | – | October sprint 5336 still open, all Done |

Re-check sprint ids at each sprint change (every ~2 weeks): query
`project = X AND (sprint in openSprints() OR sprint in futureSprints())` with field `customfield_10020`.

**Today's activity window:** changes since 19:00 (Jira site time, +05:45) of the previous report day.

**Overdue (clarification) list:**
- `duedate < today AND statusCategory != Done AND status != "Deployed In Prod"`.
- Include subtasks whose parent is in scope. JQL `sprint in (...)` does not reliably return subtasks,
  so query them with `parent in (<in-scope parent keys>)`.
- To avoid double-listing, skip a subtask when its parent is itself already on the overdue list.
- Estimate/time-spent fields are no longer returned by the Jira connector, so only due dates are checked.

**Report conventions:**
- ETA column = next working day.
- Mention unassigned in-scope tickets in the summary, not in emails.
- Keep each project to one page (8 pages total).
