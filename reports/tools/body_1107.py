TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 7 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "No Marketplace ticket updated today. HGX B300 search fix (MT-1784) still in Code Review, now past due (6 Nov).",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 10 tickets – 1 Done, 1 Ready for Prod, 1 Dev, 1 Code Review, 4 In Progress, 2 To Do. Retrospective: MT-1615 Ready for Prod (due 31 Oct).",
    ],
    "risks": [
        ["HGX B300 search fix (MT-1784) past due in Code Review; FAQ 404 (MT-1780) not started", "Search broken on Dev; missing prod pages", "Close MT-1784; start MT-1780", "Naveen Jangid", "9 Nov"],
        ["Go-live on 15 Nov; Magento Part-2 (MT-1753) and V1.4 design (MT-1747) due 16 Nov", "Go-live scope at risk", "Confirm go-live scope", "Naman Bapna / Naveen Jangid", "9 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MT-1780 and Go-Live checklist (MT-1770) – 13 Nov 2026; go-live – 15 Nov 2026"),
    ],
    "resources": [
        ["Naman Bapna", "MT-1753, MT-1770 in progress; MT-1615, MT-1778 Ready for Prod", "2 items awaiting release", "Release MT-1615, MT-1778"],
        ["Naveen Jangid", "MT-1784 Code Review; MT-1747 in progress; MT-1780 To Do", "MT-1784 past due", "Close MT-1784"],
        ["Nagamuni Valluri", "MT-1787 To Do (new)", "Undated bug", "Date MT-1787"],
    ],
    "mgmt": [
        "Confirm the 15 Nov go-live scope given MT-1747 and MT-1753 are dated 16 Nov.",
    ],
    "focus": [
        "Close HGX B300 search fix (MT-1784).",
        "Release MT-1615 and MT-1778.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "No Marketing ticket updated today. Kimi page (MR-1470) still in progress, now past due (6 Nov); MR-1411 still has no assignee.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 8 tickets – 1 Done, 4 In Progress, 1 Dev, 2 To Do.",
    ],
    "risks": [
        ["5 tickets past due: Retrospective MR-1362, 1379, 1073, 1454 (30 Oct) and Kimi page MR-1470 (6 Nov)", "Work still open", "Release or re-date", "Kunal Jangid / Vishnu kumar yadav", "9 Nov"],
        ["MR-1411 (V1.2 design) in progress with no assignee; same work also tracked in MR-1379", "No owner; duplicate tracking", "Assign or merge into MR-1379", "Kunal Jangid", "9 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MR-1277, MR-1411, MR-1460, MR-1467, MR-1476 – 13 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1470, MR-1379 in progress; MR-1362 Code Review; MR-1467 in Dev; MR-1476 To Do", "Over-allocated; 3 past due", "Close MR-1362"],
        ["Vishnu kumar yadav", "MR-1474 closed; MR-1073, MR-1454 Ready for Prod; MR-1460 in progress", "2 past due awaiting release", "Release MR-1073, MR-1454"],
    ],
    "mgmt": [
        "Assign an owner to MR-1411 or merge it into MR-1379.",
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
        "Lifecycle notifications (USP-3783) and Support Hub v2 (USP-4252) updated; no status changes today.",
        "Sprint status (Nov 1st Sprint, 1–15 Nov): 23 tickets – 5 Done, 5 Deployed in Dev, 6 In Progress, 7 To Do.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do, dated 15 Nov", "Document flows fail for customers until then", "Fix early in sprint", "Cășvan Marcel", "9 Nov"],
        ["Proposal wording (USP-4433) past due (6 Nov), still Deployed in Dev", "Wording change not live", "Release", "Livian Stefan Stan", "9 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "All open sprint items – 15 Nov 2026"),
    ],
    "resources": [
        ["Cășvan Marcel", "USP-3783 in progress; USP-4231 (S1), 3784, 4073 To Do", "S1 not started", "Start USP-4231"],
        ["Silviu Oltean", "USP-4228, 4252 in progress; USP-4302, 4331 open", "On track", "Progress USP-4302"],
        ["Livian Stefan Stan", "USP-4401, 4433 in Dev; USP-4295, 4329, 4435 in progress", "USP-4433 past due", "Release USP-4433"],
    ],
    "mgmt": [],
    "focus": [
        "Start S1 Document API fix (USP-4231).",
        "Release Proposal wording (USP-4433).",
    ],
})

project({
    "name": "4. Web Identity (ID)",
    "break": True,
    "highlights": [
        "No Identity ticket updated today.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 7 tickets – 1 Done, 1 UAT Testing, 2 Dev Testing, 2 In Progress, 1 To Do. Retrospective: ID-736 Ready for Prod (due 30 Oct).",
    ],
    "risks": [
        ["S2/P1 bearer token stays valid after logout (ID-774) still in progress", "API access after logout until fixed", "Complete and release", "Saravana Kumar", "9 Nov"],
        ["ID-736 Ready for Prod since 30 Oct (due date)", "Not released", "Release", "Yash Janeshwar", "9 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-727 – 13 Nov 2026; ID-773 to ID-777 – 15 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-774, ID-777 in progress; ID-775 Dev Testing; ID-776 To Do", "S2/P1 under way", "Close ID-774"],
        ["Yash Janeshwar", "ID-727 UAT; ID-773 Dev Testing; ID-736 Ready for Prod", "1 past due awaiting release", "Release ID-736"],
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
        "No Atlas ticket updated today.",
        "Sprint status (November 1st Sprint 1, 2–14 Nov): 5 tickets – 1 Done, 2 In Progress, 2 To Do.",
    ],
    "risks": [
        ["Playwright UI testing (ATLAS-297) and CRM Kanban boards (ATLAS-304) not started", "Atlas testing and CRM work slip", "Confirm start dates", "Nagamuni Valluri / Saurabh Jain", "9 Nov"],
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
        ["No next Pulse sprint planned", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "9 Nov"],
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
        "No Conversation AI ticket updated today. CSM Teams admin dashboard APIs (UC-408) now past due (6 Nov), in progress.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 11 tickets – 4 Ready for Prod, 1 Dev Testing, 4 In Progress, 2 To Do. Retrospective: UC-19 UAT, UC-60 UAT Testing.",
    ],
    "risks": [
        ["3 Ready for Prod chatbot fixes past due (UC-413, 414, 418, due 2–4 Nov); UC-408 past due (6 Nov)", "Fixes and dashboard APIs not live", "Release; re-date UC-408", "Ankit Saxena", "9 Nov"],
        ["Retrospective UC-19 and UC-60 in UAT, past due (30 Oct)", "October work still open", "Complete UAT", "Ankit Saxena / Nareddy Shiva Prasad Reddy", "9 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "UC-23 – 11 Nov 2026; UC-57, 68, 69 – 13 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-413, 414, 418 Ready for Prod; UC-23, 408 in progress; UC-19 UAT", "5 past due", "Release fixes"],
        ["Nareddy Shiva Prasad Reddy", "UC-419 Ready for Prod; UC-57 in progress; UC-69 Dev Testing; UC-60 UAT Testing", "1 past due", "Close UC-60"],
    ],
    "mgmt": [
        "Approve a production release for UC-413, 414, 418 and 419.",
    ],
    "focus": [
        "Release UC-413, UC-414, UC-418, UC-419.",
        "Close or re-date UC-408.",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "Closed today: component registry (AFVU-127, Aman prakash); CRM and Portal v3 merge to demo/main (AFVU-342, 343) and meeting guest/agenda editing (AFVU-375, 376), Anshul Bhargava.",
    ],
    "risks": [
        ["11 Retrospective tickets past due (30–31 Oct): Anshul Bhargava 8, r.jaiswal 2, Aman prakash 1", "October release not closed", "Re-date and finish", "Anshul Bhargava", "9 Nov"],
    ],
    "deps": [
        ["DSX POD price and NVIDIA render approval (AFVU-353)", "To Do", "DSX POD go-live (AFVU-352)", "Anshul Bhargava", TBC],
        ["IT – Graph app and working hours (AFVU-366)", "To Do", "Book a Meeting release (AFVU-361)", "Anshul Bhargava / IT", TBC],
    ],
    "milestones": [
        ("Key milestone:", "November 1st Sprint subtasks – 15–16 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-342, 343, 375, 376 closed; 8 past-due Retrospective tickets", "Release work open", "Close AFVU-132"],
        ["r.jaiswal", "AFVU-138, 147 (past due) in progress", "QA load", "Close AFVU-138, 147"],
        ["Aman prakash", "AFVU-127 closed; AFVU-131 (past due), 333, 346 in progress", "1 past due", "Close AFVU-131"],
    ],
    "mgmt": [
        "Confirm the October integration release (AFVU-132) date.",
    ],
    "focus": [
        "Close release and rollback (AFVU-132, 165–167).",
        "Close AFVU-346 and AFVU-437.",
    ],
})
