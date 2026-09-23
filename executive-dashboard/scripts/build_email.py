#!/usr/bin/env python3
"""Write the status-report email for a stored report.

  python3 scripts/build_email.py [--date 2026-09-23] [--to s.prasad@uvation.com]

Reads reports/<date>/dashboard-data.json and writes, next to it:
  email.html   HTML body (inline styles, safe for Outlook and Gmail)
  email.txt    plain-text body
  email.eml    a ready-to-send message (open it in Outlook or Apple Mail and press Send)
"""
import argparse
import datetime as dt
import html
import json
import pathlib
from email.message import EmailMessage
from email.utils import formatdate

ROOT = pathlib.Path(__file__).resolve().parent.parent
REVIEW_URL = "https://claude.ai/artifact/R9gQ2oHPXkQaj2ZgrXCEAe"
DAILY_URL = "https://claude.ai/artifact/K7m76XrnRRHWkGYqHtDySN"

INK, MUTED, RULE, SOFT = "#16212C", "#5E6B78", "#DCE2E8", "#F4F6F8"
RAG = {"red": ("#B02B23", "#FBE4E2", "Red"), "amber": ("#8A5A00", "#FBEFD9", "Amber"), "green": ("#2C7A4D", "#E3F2E9", "Green"), "grey": ("#5E6B78", "#ECEFF2", "Not reviewed")}


def e(s):
    return html.escape(str(s if s is not None else ""))


def pill(rag, text=None):
    fg, bg, label = RAG.get(rag, RAG["grey"])
    return f'<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:{bg};color:{fg};font-size:12px;font-weight:600;white-space:nowrap">{e(text or label)}</span>'


def table(head, rows, widths=None):
    th = "".join(f'<th align="left" style="padding:8px 10px;border-bottom:1px solid {RULE};background:{SOFT};font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:{MUTED};font-weight:600">{e(h)}</th>' for h in head)
    body = "".join("<tr>" + "".join(f'<td valign="top" style="padding:8px 10px;border-bottom:1px solid {RULE};font-size:13px;color:{INK}">{c}</td>' for c in r) + "</tr>" for r in rows)
    return f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid {RULE};margin:8px 0 18px">{"<tr>"+th+"</tr>"}{body}</table>'


def h2(t):
    return f'<h2 style="font-size:18px;margin:26px 0 6px;color:{INK};border-top:2px solid {INK};padding-top:10px">{e(t)}</h2>'


def p(t, muted=False):
    return f'<p style="margin:6px 0 10px;font-size:14px;line-height:1.55;color:{MUTED if muted else INK}">{t}</p>'


def ul(items):
    return "<ul style=\"margin:4px 0 14px;padding-left:20px\">" + "".join(f'<li style="font-size:14px;line-height:1.5;margin:3px 0;color:{INK}">{i}</li>' for i in items) + "</ul>"


def build(date, to):
    d = json.loads((ROOT / "reports" / date / "dashboard-data.json").read_text())
    hist = json.loads((ROOT / "reports" / "history.json").read_text())
    prev = [h for h in hist if h["date"] < date]
    prev = prev[-1] if prev else None
    k, per, rs = d["kpis"], d["period"], d["registerSummary"]
    items = [r for r in d["register"] if r["kind"] != "Epic"]
    red = [r for r in items if r["rag"] == "red"]
    close = [r for r in items if r["verdict"].startswith("Close")]
    reass = [r for r in items if r["verdict"].startswith("Re-assess")]
    mp, mk, un, q = d["marketplace"], d["marketingTesting"], d["utilisationNotes"], d["quality"]
    total_products = sum(b["products"] for b in mp["brands"])
    nice_date = dt.date.fromisoformat(date).strftime("%d %b %Y").lstrip("0")
    scope_names = ", ".join(c["name"] for c in d["scorecards"])

    def delta(key, cur):
        if not prev or key not in prev:
            return ""
        dv = cur - prev[key]
        return f' <span style="color:{MUTED};font-size:12px">({"+" if dv >= 0 else ""}{round(dv, 1)} vs {prev["date"]})</span>'

    H = []
    H.append(f'<div style="font-family:Segoe UI,Arial,sans-serif;max-width:860px;margin:0 auto;color:{INK}">')
    H.append(f'<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:{MUTED};margin:0">Status report · {e(nice_date)}</p>')
    H.append(f'<h1 style="font-size:26px;margin:4px 0 8px">Web programmes: risks, issues, progress and utilisation</h1>')
    H.append(p(f"Scope: {e(scope_names)}. Web-Marketplace includes the Product Catalog board. Figures come from Jira and Tempo, pulled on {e(nice_date)}. Throughput counts use the last 30 days, and hours use the window {e(per['short'])} ({per['workingDays']} working days)."))
    H.append(table(["Live page", "Link", "What it shows"], [
        ["Portfolio Status Review", f'<a href="{REVIEW_URL}" style="color:#1D5C84">{REVIEW_URL}</a>', "Risk review, issues log, programme scorecards, Marketplace pipeline, Marketing testing and utilisation"],
        ["Daily Delivery Pulse", f'<a href="{DAILY_URL}" style="color:#1D5C84">{DAILY_URL}</a>', "Day-by-day flow, effort, people heatmaps, day explorer, milestone tracks and risk age"],
    ]))

    H.append(h2("Headline figures"))
    H.append(table(["Measure", "Value"], [
        ["Issues moved in the last 30 days", f"{k['issuesUpdated30']:,}" + delta("issuesMoved30", k["issuesUpdated30"])],
        ["Issues closed in the last 30 days", f"{k['done30']:,}" + delta("closed30", k["done30"])],
        [f"Issues closed {per['short']}", f"{k['doneInPeriod']:,}" + delta("closedWindow", k["doneInPeriod"])],
        ["Open issues (all time, in scope)", f"{k['openAllTime']:,}"],
        ["Open issues past their due date", f"{k['overdueOpen']}" + delta("pastDue", k["overdueOpen"])],
        [f"Tempo hours logged {per['short']}", f"{round(k['hoursInPeriod']):,} h" + delta("hours", k["hoursInPeriod"])],
        ["AI-server listings live to buyers", f"0 of {total_products} (all moved to production, all disabled pending approval)"],
        ["Risk-register items rated red", f"{len(red)} of {rs['items']}"],
    ]))

    H.append(h2("Decisions needed"))
    dec = []
    for i in d["issues"]:
        if i["rag"] == "red":
            dec.append(f"<b>{e(i['title'])}.</b> {e(i['preventive'].split('. ')[0].rstrip('.'))}.")
    for r in red:
        dec.append(f"<b>{e(r['key'])} {e(r['summary'])}.</b> {e(r['action'])}")
    for r in d["newRisks"]:
        if r["rag"] == "red":
            dec.append(f"<b>{e(r['title'])}.</b> {e(r['mitigation'])} Suggested owner: {e(r.get('suggestedOwner'))}.")
    H.append(ul(dec))

    # 1. Risks
    H.append(h2("1. Risks: impact, mitigation, owner and status"))
    H.append(p(f"The Jira register holds {rs['risks']} risks and {rs['dependencies']} dependencies for the in-scope projects. It was created on 7 Jul. {rs['stale30']} items have not been updated in over 30 days, and {rs['unassigned']} have no Jira assignee. The Services Platform set is the only one actively owned."))
    H.append(table(["Item", "Likelihood · Impact", "Owner", "Last update", "Verdict", "Why, and next action"], [
        [f"<b>{e(r['key'])}</b> {e(r['kind'])}<br>{e(r['summary'])}<br><span style=\"color:{MUTED}\">{e(r['projectName'])}</span>",
         f"{e(r['likelihood'])} · {e(r['impact'])}",
         f"{e(r['ownerTeam'])}<br><span style=\"color:{MUTED}\">Jira: {e(r['assignee'] or 'unassigned')}{(' · suggested ' + e(r['suggestedOwner'])) if r.get('suggestedOwner') and not r['assignee'] else ''}</span>",
         f"{r['daysSinceUpdate']} days<br><span style=\"color:{MUTED}\">{e(r['jiraStatus'])}</span>",
         pill(r["rag"], r["verdict"]),
         f"{e(r['why'])}<br><b>Next:</b> {e(r['action'])}"] for r in items]))
    rr = d["reportedRisksNotInJira"][0]
    H.append(p(f"<b>Status-report risk not in Jira: “{e(rr['title'])}”.</b> Verdict: {e(rr['verdict'])}."))
    H.append(ul([e(x) for x in rr["evidence"]] + [f"<b>Replace it with:</b> {e(rr['replaceWith'])}", f"<b>Action:</b> {e(rr['action'])}"]))
    H.append(p("<b>New risks found in Jira evidence</b> (not yet in the register):"))
    H.append(table(["Risk", "Likelihood · Impact", "Detail", "Mitigation", "Owner"], [
        [f"<b>{e(r['title'])}</b><br><span style=\"color:{MUTED}\">{e(r['project'])}</span>", pill(r["rag"], f"{r['likelihood']} · {r['impact']}"), e(r["detail"]), e(r["mitigation"]), e(r.get("suggestedOwner"))] for r in d["newRisks"]]))

    # 2. Issues
    H.append(h2("2. Issues and preventive actions"))
    H.append(table(["Issue", "Status", "Impact", "Root cause", "Action taken", "Preventive measure"], [
        [f"<b>{e(i['title'])}</b><br><span style=\"color:{MUTED}\">{e(i['project'])} · surfaced {e(i['surfaced'])}{(' · ' + ', '.join(e(x) for x in i['keys'])) if i['keys'] else ''}</span>",
         pill(i["rag"], i["status"]), e(i["impact"]), e(i["rootCause"]), e(i["actionTaken"]), e(i["preventive"])] for i in d["issues"]]))

    # 3. Progress
    H.append(h2("3. Project-wise accomplishments"))
    H.append(table(["Programme", "Moved 30 d", "Closed 30 d", f"Closed {per['short']}", "Past due", "Blocked", "Open bugs", "Stories delivered / in flight / planned"], [
        [f"<b>{e(c['name'])}</b><br><span style=\"color:{MUTED}\">{' + '.join(c['projects'])}</span>", c["updated30"], c["done30"], c["doneInPeriod"], c["overdueCount"], len(c["blocked"]),
         f"{c['openBugs']}" + (f"<br><span style=\"color:{MUTED}\">{', '.join(f'{a} {b}' for a, b in c['bugSeverity'].items())}</span>" if c["openBugs"] else ""),
         f"{c['stories']['delivered']} / {c['stories']['inflight']} / {c['stories']['planned']}"] for c in d["scorecards"]]))
    for c in d["scorecards"]:
        H.append(f'<h3 style="font-size:15px;margin:16px 0 4px">{e(c["name"])}</h3>')
        H.append(p(e(c["headline"])))
        rows = []
        if c["delivered"]:
            rows.append(["Delivered (30 d)", "<br>".join(f"<b>{e(i['key'])}</b> {e(i['summary'])} <span style=\"color:{MUTED}\">· {e(i['assignee'] or 'Unassigned')}, closed {e(i['resolved'])}</span>" for i in c["delivered"][:6])])
        if c["inflight"]:
            rows.append(["In flight", "<br>".join(f"<b>{e(i['key'])}</b> {e(i['summary'])} <span style=\"color:{MUTED}\">· {e(i['status'])}, {e(i['assignee'] or 'Unassigned')}{', due ' + e(i['due']) if i['due'] else ', no due date'}</span>" for i in c["inflight"][:6])])
        if c["overdue"]:
            rows.append([f"Past due ({c['overdueCount']})", "<br>".join(f"<b>{e(i['key'])}</b> {e(i['summary'])} <span style=\"color:{MUTED}\">· due {e(i['due'])}, {e(i['status'])}</span>" for i in c["overdue"][:6])])
        if c["blocked"]:
            rows.append(["Blocked", "<br>".join(f"<b>{e(i['key'])}</b> {e(i['summary'])} <span style=\"color:{MUTED}\">· {e(i['status'])}</span>" for i in c["blocked"])])
        if c["rollups"]:
            rows.append(["Largest parents", "<br>".join(f"<b>{e(r['key'])}</b> {e(r['summary'])} <span style=\"color:{MUTED}\">· {r['done']} of {r['total']} child tasks done</span>" for r in c["rollups"][:4])])
        H.append(table(["", "Detail"], rows))

    H.append(f'<h3 style="font-size:15px;margin:16px 0 4px">Web-Marketplace: AI-server catalogue, research to production</h3>')
    H.append(p(e(mp["summary"]) + f" Expected completion: {e(mp['expectedCompletion'])}."))
    H.append(table(["Brand", "Listings", "Research", "Created on UAT", "Moved to production", "Live"], [
        [f"<b>{e(b['brand'])}</b><br><span style=\"color:{MUTED}\">{e(' · '.join(b['items']))}</span>", f"{b['products']}" + (f"<br><span style=\"color:{MUTED}\">{e(b['note'])}</span>" if b.get("note") else ""),
         e(b["research"]), e(b["uat"]), e(b["prod"]), pill("red", b["live"])] for b in mp["brands"]] +
        [[f"<b>Total</b>", f"<b>{total_products}</b>", f"{len(mp['brands'])} of {len(mp['brands'])} brands", f"{total_products} of {total_products}", f"{total_products} of {total_products}", f"0 of {total_products}"]]))
    H.append(p("<b>Still pending:</b>"))
    H.append(ul([e(x) for x in mp["pending"]]))
    H.append(table(["Workstream", "State", "Open"], [[f"{e(w['name'])}<br><span style=\"color:{MUTED}\">{e(w['key'])}</span>", e(w["state"]), e(w["open"])] for w in mp["otherWorkstreams"]]))

    fd = mk["figmaDefects"]
    H.append(f'<h3 style="font-size:15px;margin:16px 0 4px">Web-Marketing: testing done against total scope</h3>')
    H.append(p(e(mk["summary"])))
    H.append(table(["Measure", "Done", "Scope", "Note"], [
        ["URLs under automated smoke test", f"{mk['automatedUrls']:,}", f"{mk['scopeUrlsExpected']:,}+", e(mk["scopeNote"]) + ". Capped by the sitemap bug (MR-1199)."],
        ["Automated checks passing", f"{mk['automatedPassed']:,}", f"{mk['automatedChecks']:,}", f"{mk['browserDeviceProjects']} browser and device profiles (MR-1165)"],
        ["Figma defects fixed", fd["done"], fd["raised"], f"{fd['inProgress']} in progress, {fd['todo']} to do, about {fd['pagesCovered']} pages ({fd['key']})"],
        ["Site verification checks closed", mk["siteVerification"]["done"], mk["siteVerification"]["subtasks"], mk["siteVerification"]["key"]],
        ["Pages tested by hand across browsers", f"about {mk['manualCrossBrowserPages']}", "", e(mk["manualNote"])],
    ]))
    H.append(p("<b>Validated:</b>"))
    H.append(ul([e(x) for x in mk["validated"]]))
    H.append(p("<b>Still pending:</b>"))
    H.append(ul([e(x) for x in mk["pending"]]))
    H.append(p(f"<b>Remaining effort:</b> {e(mk['remainingEffort'])} <b>Target date:</b> {e(mk['targetDate'])}"))
    H.append(p(e(mk["anmolNote"]), muted=True))

    # 4. Utilisation
    cap = k["capacityPerPerson"]
    H.append(h2("4. Resource utilisation"))
    H.append(p(f"Capacity is {cap} hours per full-time person for the window: {per['workingDays']} working days at 8 hours. The SOP sets a utilisation target of 80–90%, with 60 of every 80 hours on development. Contract status is not in Jira, so every row uses the full-time figure."))
    H.append(p(f"<b>Read this before the table.</b> {e(un['attributionWarning'])} {e(un['overheadGap'])}"))
    flag = {"attribution": "A day over 10 h (other people's hours or bulk logging)", "low": "Below 60% of capacity", "nolog": "No Tempo hours"}
    H.append(table(["Person", "Hours", "% of capacity", "Days logged", "Peak day", "Closed", "Open", "Past due", "Flag"], [
        [f"{e(x['name'])}<br><span style=\"color:{MUTED}\">{e(' · '.join(f'{a} {b}h' for a, b in x['projects'].items()))}</span>", x["hours"], f"{x['pctCapacity']}%", x["daysLogged"], x["maxDay"], x["doneInPeriod"], x["open"], x["overdue"], "<br>".join(flag[f] for f in x["flags"])]
        for x in d["people"] if x["hours"] > 0]))
    nolog = [x for x in d["people"] if "nolog" in x["flags"]]
    if nolog:
        H.append(p("<b>People with tickets in the window but no Tempo hours on them:</b> " + ", ".join(f"{e(x['name'])} ({x['doneInPeriod']} closed)" for x in sorted(nolog, key=lambda x: -x["doneInPeriod"]))))
    for dd in un["deepDives"]:
        H.append(f'<h3 style="font-size:15px;margin:16px 0 4px">{e(dd["person"])}</h3>')
        H.append(ul([f"<b>Finding.</b> {e(dd['finding'])}", f"<b>Context.</b> {e(dd['context'])}", f"<b>Open question.</b> {e(dd['question'])}", f"<b>To verify.</b> {e(dd['verify'])}"]))
    H.append(p("<b>Time-logging quality:</b>"))
    H.append(ul([
        f"{round(100 * q['genericDescriptions'] / max(1, q['worklogsInPeriod']))}% of {q['worklogsInPeriod']} worklogs in the window say only “time-tracking”. The SOP makes a description mandatory.",
        f"{round(100 * q['ticketsWithTimeNoEstimate'] / max(1, q['ticketsWithTime']))}% of {q['ticketsWithTime']} tickets with logged time have no Original Estimate, so planned versus actual cannot be measured.",
        f"{len(q['overheadTicketsTruncated'])} shared overhead tickets hide recent meeting and leave time from Jira.",
    ]))

    H.append(h2("Data notes"))
    H.append(ul([
        f"Source: Jira Cloud {e(d['meta']['site'])}, boards {e(', '.join(d['scope']['projects']))}. {k['issuesUpdated30']:,} issues updated in 30 days were pulled, against Jira's own count of {e(d['meta']['counts'].get('expectedIssues'))}.",
        "Verdicts, root causes and suggested owners are the reviewer's reading of the tickets cited. Confirm them with each owner.",
        f"This report is stored in the repository shashiprasad23/server, branch claude/executive-dashboard-jira-review-gclk36, folder executive-dashboard/reports/{e(date)}/.",
        "A new report is generated every weekday at 7:00 PM Nepal time.",
    ]))
    H.append("</div>")
    html_body = "".join(H)

    # plain text
    T = [f"STATUS REPORT · {nice_date}", "Web programmes: risks, issues, progress and utilisation", "",
         f"Scope: {scope_names} (Web-Marketplace includes the Product Catalog board).",
         f"Window for hours: {per['short']} ({per['workingDays']} working days). Throughput: last 30 days.", "",
         f"Portfolio Status Review: {REVIEW_URL}", f"Daily Delivery Pulse:   {DAILY_URL}", "",
         "HEADLINE FIGURES",
         f"- Issues moved, 30 days: {k['issuesUpdated30']:,}", f"- Issues closed, 30 days: {k['done30']:,}",
         f"- Issues closed {per['short']}: {k['doneInPeriod']:,}", f"- Open issues (all time): {k['openAllTime']:,}",
         f"- Open and past due: {k['overdueOpen']}", f"- Tempo hours {per['short']}: {round(k['hoursInPeriod']):,}",
         f"- AI-server listings live: 0 of {total_products}", f"- Red register items: {len(red)} of {rs['items']}", "", "DECISIONS NEEDED"]
    T += [f"- {html.unescape(x.replace('<b>', '').replace('</b>', ''))}" for x in dec]
    T += ["", "1. RISKS", f"{rs['risks']} risks and {rs['dependencies']} dependencies; {rs['stale30']} not updated in 30+ days; {rs['unassigned']} unassigned."]
    T += [f"- {r['key']} {r['summary']} [{r['likelihood']}/{r['impact']}, {r['ownerTeam']}, Jira: {r['assignee'] or 'unassigned'}, {r['daysSinceUpdate']} d] -> {r['verdict']}. {r['why']} Next: {r['action']}" for r in items]
    T += [f"- Not in Jira: {rr['title']} -> {rr['verdict']}. Replace with: {rr['replaceWith']}"]
    T += [f"- New: {r['title']} ({r['likelihood']}/{r['impact']}). {r['detail']} Mitigation: {r['mitigation']}" for r in d["newRisks"]]
    T += ["", "2. ISSUES AND PREVENTIVE ACTIONS"]
    for i in d["issues"]:
        T += [f"- {i['title']} [{i['status']}] ({i['project']}, surfaced {i['surfaced']})", f"  Impact: {i['impact']}", f"  Root cause: {i['rootCause']}", f"  Action: {i['actionTaken']}", f"  Prevention: {i['preventive']}"]
    T += ["", "3. PROJECT PROGRESS"]
    for c in d["scorecards"]:
        T += [f"- {c['name']}: {c['updated30']} moved, {c['done30']} closed (30 d), {c['overdueCount']} past due, {len(c['blocked'])} blocked, {c['openBugs']} open bugs. {c['headline']}"]
    T += [f"- Marketplace pipeline: " + "; ".join(f"{b['brand']} {b['products']} ({b['prod']}, {b['live']})" for b in mp["brands"]), f"  Expected completion: {mp['expectedCompletion']}"]
    T += [f"- Marketing testing: {mk['automatedUrls']} of {mk['scopeUrlsExpected']}+ URLs automated; {mk['automatedPassed']}/{mk['automatedChecks']} checks pass; Figma defects {fd['done']} fixed of {fd['raised']}. Remaining effort: {mk['remainingEffort']} Target date: {mk['targetDate']}"]
    T += ["", "4. RESOURCE UTILISATION", f"Capacity {cap} h per person for the window. {un['attributionWarning']}"]
    T += [f"- {x['name']}: {x['hours']} h ({x['pctCapacity']}%), {x['daysLogged']} days, peak {x['maxDay']} h{(' — ' + ', '.join(flag[f] for f in x['flags'])) if x['flags'] else ''}" for x in d["people"] if x["hours"] > 0]
    T += [f"- {dd['person']}: {dd['finding']} {dd['context']} To verify: {dd['verify']}" for dd in un["deepDives"]]
    T += ["", f"Stored in shashiprasad23/server, branch claude/executive-dashboard-jira-review-gclk36, executive-dashboard/reports/{date}/."]
    text_body = "\n".join(T)

    out = ROOT / "reports" / date
    (out / "email.html").write_text(f"<!doctype html><html><head><meta charset=\"utf-8\"><title>Status report {e(nice_date)}</title></head><body style=\"margin:0;padding:20px;background:#fff\">{html_body}</body></html>", encoding="utf-8")
    (out / "email.txt").write_text(text_body, encoding="utf-8")
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = f"Status report {nice_date}: Marketplace, Marketing, Services Platform, Conversational AI"
    msg["Date"] = formatdate(localtime=True)
    msg["X-Unsent"] = "1"  # Outlook opens it as a draft ready to send
    msg.set_content(text_body)
    msg.add_alternative(f"<!doctype html><html><body>{html_body}</body></html>", subtype="html")
    (out / "email.eml").write_bytes(bytes(msg))
    print(f"wrote {out}/email.html, email.txt, email.eml ({len(text_body):,} characters of text)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None)
    ap.add_argument("--to", default="s.prasad@uvation.com")
    a = ap.parse_args()
    date = a.date or json.loads((ROOT / "data" / "snapshot" / "meta.json").read_text())["snapshotDate"]
    build(date, a.to)


if __name__ == "__main__":
    main()
