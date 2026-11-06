import sys
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
OUT = sys.argv[1]
doc = Document()
_s = doc.styles["Normal"]; _s.font.name = "Calibri"; _s.font.size = Pt(10)
RISK_H = ["Risk", "Impact", "Mitigation / Action", "Owner", "ETA"]
DEP_H = ["Dependency", "Status", "Impact", "Owner", "Expected Date"]
RES_H = ["Resource", "Utilisation", "Performance", "Action"]
def heading(text):
    r = doc.add_paragraph().add_run(text); r.bold = True; r.font.size = Pt(11)
def bullets(items):
    for it in items:
        p = doc.add_paragraph(style="List Bullet")
        if isinstance(it, tuple):
            p.add_run(it[0]).bold = True; p.add_run(" " + it[1])
        else:
            p.add_run(it)
def _shade(cell):
    sh = OxmlElement("w:shd"); sh.set(qn("w:val"), "clear"); sh.set(qn("w:color"), "auto"); sh.set(qn("w:fill"), "D9D9D9")
    cell._tc.get_or_add_tcPr().append(sh)
def table(headers, rows):
    t = doc.add_table(rows=1, cols=len(headers)); t.style = "Table Grid"
    for c, h in zip(t.rows[0].cells, headers):
        r = c.paragraphs[0].add_run(h); r.bold = True; r.font.size = Pt(9); _shade(c)
    for row in rows:
        cells = t.add_row().cells
        for c, v in zip(cells, row):
            c.paragraphs[0].add_run(str(v)).font.size = Pt(9)
    _sp = doc.add_paragraph(); _sp.paragraph_format.space_after = Pt(0); _sp.add_run().font.size = Pt(4)
def numbered(items):
    for i, it in enumerate(items, 1):
        p = doc.add_paragraph(f"{i}. {it}"); p.paragraph_format.left_indent = Inches(0.25)
