TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 17 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "Closed: HGX B300 search fix (MT-1784, Naveen Jangid) and footer CMS API (MT-1771, Vishnu kumar yadav). Sales Dashboard (MT-1822, Naveen Jangid) and General support (MT-1793, Naman Bapna) started.",
        "Nov 2nd Sprint (16–29 Nov): 4 stories, all in progress. Retrospective: go-live checklist (MT-1770), FAQ 404 (MT-1780) and V1.4 design (MT-1747, due 16 Nov) still open.",
    ],
    "risks": [
        ["Production FAQ 404 (MT-1780) still not started; go-live checklist (MT-1770) open", "Customers hit missing pages", "Fix MT-1780; close MT-1770", "Naveen Jangid / Naman Bapna", "18 Nov"],
        ["V1.4 design (MT-1747) past due 16 Nov with 12 subtasks open", "Redesign slipping", "Re-plan into sprint", "Naveen Jangid", "18 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sales Dashboard (MT-1822) – 27 Nov 2026; Store Credit/RMA and AI Agent connector – 30 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1784 closed; MT-1747, 1822 in progress; MT-1780 To Do", "3 past due", "Fix MT-1780"],
        ["Naman Bapna", "MT-1770 open; MT-1793 in progress", "Go-live checklist past due", "Close MT-1770"],
    ],
    "mgmt": [
        "Confirm the Marketplace go-live outcome and close or re-date MT-1770.",
    ],
    "focus": [
        "Fix FAQ 404 (MT-1780); close MT-1770.",
        "Re-plan V1.4 (MT-1747) into the Nov 2nd Sprint.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "V1.2 redesign closed: MR-1379, 1411 and design validation (MR-1460) Done; released MR-1073, 1454, 1530, 1531; home and Project Genesis updates (MR-1546) Done.",
        "New: production UI and functional issues (MR-1547, Vishnu kumar yadav). Sprint work started: CMS API hardening (MR-1488) and JS reduction (MR-1498).",
    ],
    "risks": [
        ["Kimi page (MR-1470), async ticket fallback (MR-1476), About (MR-1477) and Contact (MR-1484) fixes still in UAT, past due", "Remaining redesign items not live", "Finish UAT", "Kunal Jangid / Kannan Elangovan", "18 Nov"],
        ["New production issues after release (MR-1547)", "Live-site defects", "Triage and date", "Vishnu kumar yadav", "18 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories (MR-1488, 1498, 1504, 1510) – 30 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1379, 1411 closed; MR-1470, 1476, 1477 UAT; MR-1498 started", "4 past due", "Close UAT items"],
        ["Vishnu kumar yadav", "6 items closed; MR-1488 started; MR-1547 To Do", "No past-due items", "Triage MR-1547"],
        ["Kannan Elangovan", "MR-1467, 1484 UAT; MT-1632 in progress", "3 past due", "Close UAT"],
    ],
    "mgmt": [],
    "focus": [
        "Close UAT on MR-1470, 1476, 1477, 1484.",
        "Triage production issues MR-1547.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "Comm Hub re-skin (USP-4295) and Support Hub mobile (USP-4329) deployed to production; payment modal, max deposit and Proposal wording items closed. New: switch Communication Hub tenant (USP-4470, Silviu Oltean, due today).",
        "Nov 1st Sprint still open (3 items); Nov 2nd Sprint (16–30 Nov) not yet started in Jira.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do in the unstarted Nov 2nd Sprint", "Document flows fail in production", "Start sprint; fix first", "Cășvan Marcel", "18 Nov"],
        ["Hub notifications (USP-4302), BAU (USP-4435) and Book a Meeting (USP-4438) past due 15 Nov", "Carry-over", "Close or move", "Silviu Oltean / Livian Stefan Stan / Anshul Bhargava", "18 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "First 45 days ends 18 Nov 2026; Nov 2nd Sprint – 30 Nov 2026"),
    ],
    "resources": [
        ["Livian Stefan Stan", "USP-4295, 4329 in production; USP-4435 open", "1 past due", "Start Nov 2nd items"],
        ["Silviu Oltean", "USP-4470 in progress; USP-4302 open", "1 past due", "Close USP-4302"],
        ["Cășvan Marcel", "USP-4231 (S1), 3784, 4073 To Do", "S1 not started", "Start USP-4231"],
    ],
    "mgmt": [
        "Start the USP Nov 2nd Sprint and close the Nov 1st Sprint in Jira.",
    ],
    "focus": [
        "Start S1 fix USP-4231.",
        "Switch Communication Hub tenant (USP-4470).",
    ],
})

project({
    "name": "4. Web Identity (ID)",
    "break": True,
    "highlights": [
        "Released: identity remediation (ID-736) and deactivation email styling (ID-773) – Retrospective now clear (Yash Janeshwar).",
        "New and started: check Azure B2C emails contain no Rewards references (ID-783, Saravana Kumar). ID-781, 782 in progress; ID-779, 780 To Do.",
    ],
    "risks": [],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-779 to ID-783 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-781, 782, 783 in progress; ID-779, 780 To Do", "Sole owner of sprint", "Sequence ID-780"],
    ],
    "mgmt": [],
    "focus": [
        "Progress ID-781 and ID-782; start ID-780 production deployment plan.",
    ],
})

project({
    "name": "5. Uvation Atlas (ATLAS)",
    "break": True,
    "highlights": [
        "No Atlas ticket updated today. Nov 2nd Sprint (16–29 Nov): ATLAS-297, 354, 360 To Do; Retrospective: ATLAS-304 To Do.",
    ],
    "risks": [
        ["No Nov 2nd Sprint item started; CRM Kanban epic (ATLAS-304) past due 13 Nov", "Atlas sprint idle", "Start ATLAS-354; re-date ATLAS-304", "Saurabh Jain", "18 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-297, 354, 360 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-354 To Do; ATLAS-304, MR-1459 past due", "2 past due", "Start ATLAS-354"],
        ["Nagamuni Valluri", "ATLAS-297, 360 To Do", "Not started", "Start ATLAS-360"],
    ],
    "mgmt": [],
    "focus": [
        "Start pilot enablement (ATLAS-354) and lead pass flow (ATLAS-360).",
    ],
})

project({
    "name": "6. Uvation Pulse (PULSE)",
    "break": True,
    "highlights": [
        "No November Pulse sprint in Jira. October 2nd Sprint (still open): 3 tickets – 3 Done.",
    ],
    "risks": [
        ["No Pulse sprint planned for November", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "18 Nov"],
    ],
    "deps": [],
    "milestones": [],
    "resources": [
        ["Naveen Jangid", "No open Pulse tickets", "No sprint", "Plan next sprint"],
    ],
    "mgmt": [
        "Decide the next Pulse sprint and close the October sprint.",
    ],
    "focus": [
        "Plan the next Pulse sprint.",
    ],
})

project({
    "name": "7. Uvation Conversation AI (UC)",
    "break": True,
    "highlights": [
        "Marketplace RFQ-intent prompt (UC-59, Ankit Saxena) started. No Retrospective item moved today.",
        "Nov 2nd Sprint (16–29 Nov): UC-59, 170, 423 in progress; UC-70, 174, 428 To Do.",
    ],
    "risks": [
        ["3 chatbot fixes Ready for Prod since 2–4 Nov (UC-413, 414, 418)", "Fixes not live", "Release", "Ankit Saxena", "18 Nov"],
        ["9 Retrospective stories/subtasks in UAT past due; handoff routing (UC-68) not started", "UAT backlog", "Close UAT; re-plan UC-68", "Ankit Saxena / Shivam Dhoundiyal", "18 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-19, 23, 408 UAT; UC-68 To Do; 3 fixes Ready for Prod; UC-59 in progress", "7 past due", "Release fixes"],
        ["Shivam Dhoundiyal", "UC-261 and 6 dashboard subtasks in UAT; UC-423 in progress", "7 past due", "Close UAT"],
        ["Nareddy Shiva Prasad Reddy", "UC-57, 60, 69 UAT Testing; UC-170 in progress", "3 past due", "Close UAT"],
    ],
    "mgmt": [
        "Approve a production release for UC-413, 414, 418.",
    ],
    "focus": [
        "Release Ready for Prod chatbot fixes.",
        "Close UAT on UC-23, 57, 69, 261, 408.",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "Nov 1st Sprint closed and Nov 2nd Sprint (17–29 Nov) started: GPUaaS switch-on and first E2E order, subscription flow fixes, 3D hall accuracy and Architect fixes. Send proposal/Provisioning ready fix (AFVU-490) in review (Aman prakash).",
        "Closed: AFVU-476 confirmed by design (r.jaiswal). GPUaaS billing, alerts, sign-in activity and teardown (AFVU-259–262) carried to Retrospective, past due 16 Nov.",
    ],
    "risks": [
        ["GPUaaS hardening (AFVU-214) and 4 GPUaaS stories (AFVU-259–262) past due; DSX POD real price (AFVU-352) open", "GPUaaS release not ready", "Finish before switch-on (AFVU-480)", "Anshul Bhargava", "18 Nov"],
        ["AFVU-489 (Architect in-rack cooling lock) still unassigned", "Bug unowned", "Assign", "Anshul Bhargava", "18 Nov"],
    ],
    "deps": [
        ["DSX POD real price (AFVU-352)", "Open", "DSX POD go-live", "Business", TBC],
    ],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint – 29 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-214, 259, 260, 262, 352, 360 open; Nov 2nd Sprint items; USP-4438", "Over-allocated; 7 past due", "Rebalance"],
        ["Aman prakash", "AFVU-490 in review; AFVU-261 in progress", "1 past due", "Close AFVU-261"],
    ],
    "mgmt": [
        "Assign AFVU-489 and rebalance GPUaaS work off Anshul Bhargava.",
    ],
    "focus": [
        "Finish GPUaaS hardening (AFVU-214) and AFVU-259–262.",
    ],
})
