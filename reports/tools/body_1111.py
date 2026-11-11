TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 11 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "Closed: footer FAQ 404 (MT-1789) and Playwright home/CMS suite (MT-1636). Magento Part-2 module subtasks moved to Dev; new My account Comm Hub subtask (MT-1791) started.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 11 tickets – 3 Done, 1 Ready for Prod, 1 Dev, 1 Code Review, 4 In Progress, 1 To Do. Retrospective: MT-1615 Ready for Prod (due 31 Oct).",
    ],
    "risks": [
        ["MT-1784 and 7 V1.4/go-live subtasks past due; FAQ 404 (MT-1780) not started", "Go-live readiness at risk", "Close MT-1784; start MT-1780", "Naveen Jangid", "12 Nov"],
        ["Go-live on 15 Nov; Magento Part-2 (MT-1753) and V1.4 design (MT-1747) due 16 Nov", "Go-live scope at risk", "Confirm go-live scope", "Naman Bapna / Naveen Jangid", "12 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MT-1780 and Go-Live checklist (MT-1770) – 13 Nov 2026; go-live – 15 Nov 2026"),
    ],
    "resources": [
        ["Naman Bapna", "MT-1753, MT-1770 in progress; MT-1615, MT-1778 Ready for Prod", "2 items awaiting release", "Release MT-1615, MT-1778"],
        ["Naveen Jangid", "MT-1784 Code Review; MT-1765, 1788 Dev; MT-1790, 1791 in progress; MT-1776, 1780 To Do", "Over-allocated; 4 past due", "Close MT-1784"],
        ["Nagamuni Valluri", "MT-1763, 1764, 1769 in progress", "MT-1763, 1764 past due", "Close MT-1763"],
    ],
    "mgmt": [
        "Confirm 15 Nov go-live scope (MT-1747, 1753 dated 16 Nov).",
    ],
    "focus": [
        "Close MT-1784; release MT-1615 and MT-1778.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "V1.2 design (MR-1411) now assigned to Kunal Jangid; Retrospective MR-1379 re-dated to 13 Nov. Contact page (MR-1403) to Code Review.",
        "New: Contact page cross-device issues (MR-1484, Kunal Jangid, due 14 Nov); resources API (MR-1483) and Comm Hub login error (MR-1485) subtasks (Vishnu kumar yadav).",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 10 tickets – 1 Done, 5 In Progress, 1 Dev, 3 To Do.",
    ],
    "risks": [
        ["14 past due: MR-1362, 1073, 1454 (30 Oct), Kimi page MR-1470 and 10 V1.2 page subtasks (30 Oct–6 Nov)", "Design go-live slipping", "Release or re-date", "Kunal Jangid / Vishnu kumar yadav", "12 Nov"],
        ["V1.2 design tracked twice (MR-1379 and MR-1411, both Kunal Jangid, due 13 Nov)", "Duplicate tracking", "Merge or close one", "Kunal Jangid", "12 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MR-1277, 1379, 1411, 1460, 1467, 1476, 1477 – 13 Nov 2026; MR-1484 – 14 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1379, 1411, 1470, 1476 in progress; MR-1362 Code Review; MR-1467 Dev; MR-1477, 1484 To Do", "Over-allocated; 5 past due", "Close MR-1362"],
        ["Vishnu kumar yadav", "MR-1073, MR-1454 Ready for Prod; MR-1460 in progress; 8 V1.2 subtasks in Dev/Review", "10 past due", "Release MR-1073, MR-1454"],
    ],
    "mgmt": [
        "Decide whether MR-1379 or MR-1411 carries the V1.2 design work.",
    ],
    "focus": [
        "Release MR-1073 and MR-1454.",
        "Close Kimi page (MR-1470) and MR-1362.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "Deployed in Dev: auto-assign service requests (USP-4331) and payment modal messages (USP-4292). Hub notifications (USP-4302) started.",
        "Sprint status (Nov 1st Sprint, 1–15 Nov): 28 tickets – 6 Done, 13 Deployed in Dev, 5 In Progress, 4 To Do.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do, dated 15 Nov", "Document flows fail for customers until then", "Fix early in sprint", "Cășvan Marcel", "12 Nov"],
        ["13 items in Dev awaiting release with 4 days left; 3 Communication Hub subtasks (USP-4225, 4310, 4311) past due since Oct", "Release crunch before 15 Nov", "Plan release order", "Silviu Oltean / Livian Stefan Stan", "12 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "All open sprint items – 15 Nov 2026"),
    ],
    "resources": [
        ["Cășvan Marcel", "USP-3783 in progress; USP-4231 (S1), 3784, 4073 To Do", "S1 not started", "Start USP-4231"],
        ["Silviu Oltean", "USP-4252, 4305, 4331, 4428 in Dev; USP-4302 in progress", "3 past-due subtasks", "Re-date USP-4225, 4310, 4311"],
        ["Livian Stefan Stan", "USP-4292, 4401, 4433, 4450–4453, 4458 in Dev; USP-4295, 4329, 4435 in progress", "Heavy Dev queue", "Release USP-4433, 4450–4453"],
    ],
    "mgmt": [],
    "focus": [
        "Start S1 Document API fix (USP-4231).",
        "Release USP-4433 and the Contract Proposal set (USP-4450 to 4453).",
    ],
})

project({
    "name": "4. Web Identity (ID)",
    "break": True,
    "highlights": [
        "Safari autocomplete fix (ID-775) moved to UAT Testing; S2/P1 token fix (ID-774) and B2C/CRM validation (ID-777) updated.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 7 tickets – 2 Done, 1 UAT Testing, 1 Dev Testing, 2 In Progress, 1 To Do. Retrospective: ID-736 Ready for Prod (due 30 Oct).",
    ],
    "risks": [
        ["S2/P1 bearer token stays valid after logout (ID-774) still in progress", "API access after logout until fixed", "Complete and release", "Saravana Kumar", "12 Nov"],
        ["ID-736 Ready for Prod since 30 Oct (due date)", "Not released", "Release", "Yash Janeshwar", "12 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-773 to ID-777 – 15 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-774, ID-777 in progress; ID-775 Dev Testing; ID-776 To Do", "S2/P1 under way", "Close ID-774"],
        ["Yash Janeshwar", "ID-773 Dev Testing; ID-736 Ready for Prod", "1 past due awaiting release", "Release ID-736"],
    ],
    "mgmt": [],
    "focus": [
        "Close S2/P1 fix ID-774.",
        "Release ID-736.",
    ],
})

project({
    "name": "5. Uvation Atlas (ATLAS)",
    "break": True,
    "highlights": [
        "Role and reassignment race testing (ATLAS-342, subtask of the CRM roles work) started (Saurabh Jain).",
        "Sprint status (November 1st Sprint 1, 2–14 Nov): 5 tickets – 1 Done, 2 In Progress, 2 To Do.",
    ],
    "risks": [
        ["Playwright UI testing (ATLAS-297) and CRM Kanban boards (ATLAS-304) not started", "Atlas testing and CRM work slip", "Confirm start dates", "Nagamuni Valluri / Saurabh Jain", "12 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-304, 314, 350 – 13 Nov 2026; ATLAS-297 – 14 Nov 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-314, 350 in progress; ATLAS-304 To Do", "3 items due 13 Nov", "Sequence ATLAS-304"],
        ["Nagamuni Valluri", "ATLAS-297 To Do; MT-1787 To Do", "Not started", "Start ATLAS-297"],
    ],
    "mgmt": [],
    "focus": [
        "Start ATLAS-297 and ATLAS-304.",
    ],
})

project({
    "name": "6. Uvation Pulse (PULSE)",
    "break": True,
    "highlights": [
        "No November Pulse sprint in Jira. October 2nd Sprint (still open): 3 tickets – 3 Done.",
    ],
    "risks": [
        ["No next Pulse sprint planned", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "12 Nov"],
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
        "Moved to Dev Testing: lead capture CTA (UC-57) with its subtasks and chatbot fixes UC-420, UC-421. CSM dashboard (UC-402) in Dev. RFQ in-chat (UC-23) due today, still In Dev.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 13 tickets – 4 Ready for Prod, 2 In Dev, 4 Dev Testing, 1 In Progress, 2 To Do. Retrospective: UC-19 UAT, UC-60 UAT Testing.",
    ],
    "risks": [
        ["3 Ready for Prod chatbot fixes past due (UC-413, 414, 418); 11 dashboard/RFQ subtasks past due (UC-45, 140, 403–405, 407, 409–412, 422)", "Fixes not live; subtask dates stale", "Release; re-date subtasks", "Ankit Saxena", "12 Nov"],
        ["Retrospective UC-19 and UC-60 in UAT, past due (30 Oct)", "October work still open", "Complete UAT", "Ankit Saxena / Nareddy Shiva Prasad Reddy", "12 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "UC-23 – 11 Nov 2026; UC-57, 68, 69, 408 – 13 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-413, 414, 418 Ready for Prod; UC-23 In Dev; UC-408 in progress; UC-19 UAT", "10 past due incl. subtasks", "Release fixes"],
        ["Nareddy Shiva Prasad Reddy", "UC-419 Ready for Prod; UC-57, 420, 421 Dev Testing; UC-60 UAT Testing", "1 past due", "Close UC-60"],
    ],
    "mgmt": [
        "Approve a production release for UC-413, 414, 418 and 419.",
    ],
    "focus": [
        "Release UC-413, UC-414, UC-418, UC-419.",
        "Re-date the past-due dashboard subtasks (Shivam Dhoundiyal, Ankit Saxena).",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "Closed: GPUaaS on Portal (AFVU-206), configurator fixes AFVU-393, 413, 419, and AFVU-314, 368. New: S1 AFVU-476 and S2 AFVU-474, 475 (Anshul Bhargava, due 15 Nov).",
    ],
    "risks": [
        ["S1: CRM admin can approve first payment before provisioning is published (AFVU-476)", "Billing before service is ready", "Fix first", "Anshul Bhargava", "12 Nov"],
        ["11 Retrospective tickets past due (30–31 Oct): Anshul Bhargava 8, r.jaiswal 2, Aman prakash 1", "October release not closed", "Re-date and finish", "Anshul Bhargava", "12 Nov"],
    ],
    "deps": [
        ["DSX POD price and NVIDIA render approval (AFVU-353)", "To Do", "DSX POD go-live (AFVU-352)", "Anshul Bhargava", TBC],
        ["IT – Graph app and working hours (AFVU-366)", "To Do", "Book a Meeting release (AFVU-361)", "Anshul Bhargava / IT", TBC],
    ],
    "milestones": [
        ("Key milestone:", "November 1st Sprint subtasks – 15–16 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "8 past-due Retrospective tickets; new S1/S2 bugs AFVU-474–476", "Over-allocated", "Fix AFVU-476"],
        ["r.jaiswal / Aman prakash", "AFVU-138, 147 / AFVU-131 past due", "QA and sign-off open", "Close or re-date"],
    ],
    "mgmt": [
        "Confirm the October release (AFVU-132) date.",
    ],
    "focus": [
        "Fix S1 AFVU-476; close release and rollback (AFVU-132, 165–167).",
    ],
})
