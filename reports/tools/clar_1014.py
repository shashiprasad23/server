import sys, csv, datetime
from collections import OrderedDict
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_BREAK
PROJ = {"MT": "Web Marketplace", "MR": "Web Marketing", "USP": "USP", "ID": "Web Identity", "ATLAS": "Atlas", "PULSE": "Pulse", "UC": "Conversation AI", "AFVU": "AI Factory Visualise"}
def d(s):
    return datetime.date.fromisoformat(s).strftime("%-d %b") if s else "—"
def h(sec):
    if sec == "": return ""
    v = int(sec) / 3600
    return f"{v:g}h" if v == int(v) else f"{v:.1f}h"
people = OrderedDict()
for row in csv.reader(open(sys.argv[1]), delimiter="\t"):
    flag, key, status, who, due, parent, est, spent, summ = row[:9]
    people.setdefault(who, []).append((flag, key, summ.strip(), d(due), status, f"{h(est)} / {h(spent)}" if "EST" in flag else "—"))
doc = Document(); s = doc.styles["Normal"]; s.font.name = "Calibri"; s.font.size = Pt(10)
t = doc.add_paragraph().add_run("Clarification Requests – Missed Timelines & Estimates"); t.bold = True; t.font.size = Pt(16)
doc.add_paragraph().add_run("Based on Daily Sprint Status Report – " + sys.argv[3] + "  |  One email per assignee").italic = True
def shade(c):
    sh = OxmlElement("w:shd"); sh.set(qn("w:val"), "clear"); sh.set(qn("w:color"), "auto"); sh.set(qn("w:fill"), "D9D9D9"); c._tc.get_or_add_tcPr().append(sh)
n = 0
for name in sorted(people, key=lambda n: -len(people[n])):
    tickets = people[name]
    if name == "Unassigned": continue
    n += 1
    projs = " / ".join(OrderedDict.fromkeys(PROJ[k[1].split("-")[0]] for k in tickets))
    due_n = sum("DUE" in k[0] for k in tickets); est_n = sum("EST" in k[0] for k in tickets)
    if est_n and due_n: subj = f"Clarification needed – {len(tickets)} ticket(s) past due date or over estimate"; what = "have passed their due date or logged more time than the original estimate"
    elif est_n: subj = f"Clarification needed – {len(tickets)} ticket(s) over estimate"; what = "have logged more time than the original estimate"
    else: subj = f"Clarification needed – {len(tickets)} ticket(s) past due date"; what = "have passed their due date"
    if n > 1:
        doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    r = doc.add_paragraph().add_run(f"To: {name}   ({projs})"); r.bold = True; r.font.size = Pt(12); r.font.color.rgb = RGBColor(0x1F,0x3A,0x5F)
    doc.add_paragraph().add_run(f"Subject: {subj}").bold = True
    doc.add_paragraph(f"Hi {name.split()[0]},")
    doc.add_paragraph(f"The following ticket(s) assigned to you in the current sprint {what} in Jira. Could you please reply with:")
    for b in ["the reason for the delay (blocker, dependency, scope change or estimate),", "the revised completion date, and", "any help you need to close it."]:
        doc.add_paragraph(b, style="List Bullet")
    tb = doc.add_table(rows=1, cols=5); tb.style = "Table Grid"
    for c, hd in zip(tb.rows[0].cells, ["Ticket", "Summary", "Due date", "Current status", "Estimate / Logged"]):
        rr = c.paragraphs[0].add_run(hd); rr.bold = True; rr.font.size = Pt(9); shade(c)
    for flag, key, summ, due, status, el in tickets:
        for c, v in zip(tb.add_row().cells, [key, summ, due, status, el]):
            c.paragraphs[0].add_run(v).font.size = Pt(9)
    doc.add_paragraph()
    doc.add_paragraph("Please also update the due date in Jira if it has changed.")
    doc.add_paragraph("Thanks,\nShashi")
doc.save(sys.argv[2])
print(n, "assignees")
