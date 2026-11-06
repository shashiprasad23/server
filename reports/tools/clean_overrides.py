# --- noise filters ---
def _is_tbc(v):
    v = v.strip()
    return v == "TBC" or v.endswith("– TBC") or v.endswith(" TBC")
def project(p):
    p = dict(p)
    p["milestones"] = [m for m in p.get("milestones", []) if not _is_tbc(m[1] if isinstance(m, tuple) else m)]
    p["mgmt"] = [m for m in p.get("mgmt", []) if m.strip().lower() not in ("none today.", "none")]
    p["deps"] = [d for d in p.get("deps", []) if not (d[1].lower().startswith("pending") and d[0].lower().startswith("next sprint"))]
    t = doc.add_paragraph()
    if p.get("break"):
        t.paragraph_format.page_break_before = True
    r = t.add_run(p["name"]); r.bold = True; r.font.size = Pt(14); r.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
    if p.get("highlights"):
        heading("Key Highlights"); bullets(p["highlights"])
    if p.get("risks"):
        heading("Risks"); table(RISK_H, p["risks"])
    if p["deps"]:
        heading("Dependencies"); table(DEP_H, p["deps"])
    if p["milestones"]:
        heading("Upcoming Milestones"); bullets(p["milestones"])
    if p.get("resources"):
        heading("Resource Utilisation & Performance"); table(RES_H, p["resources"])
    if p["mgmt"]:
        heading("Management Attention / Decisions Required"); bullets(p["mgmt"])
    if p.get("focus"):
        heading("Next Day Focus"); numbered(p["focus"])
