TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 12 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "Magento 2.4.9 upgrade closed: Part-1 (MT-1615, Retrospective) and Part-2 (MT-1753) Done with all module subtasks and FE/BE regression testing (Naman Bapna, shubham kuchwar, Parth).",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 11 tickets – 4 Done, 1 Ready for Prod, 1 Dev, 1 Code Review, 3 In Progress, 1 To Do. Retrospective clear.",
    ],
    "risks": [
        ["MT-1784 and 8 V1.4/go-live subtasks past due; FAQ 404 (MT-1780) not started", "Go-live readiness at risk", "Close MT-1784; start MT-1780", "Naveen Jangid", "13 Nov"],
        ["Go-live on 15 Nov; V1.4 design (MT-1747) due 16 Nov with 8 subtasks past due", "Go-live scope at risk", "Confirm go-live scope", "Naveen Jangid", "13 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MT-1780 and Go-Live checklist (MT-1770) – 13 Nov 2026; go-live – 15 Nov 2026"),
    ],
    "resources": [
        ["Naman Bapna", "MT-1615, 1753 closed; MT-1770 in progress; MT-1778 Ready for Prod", "Magento upgrade done", "Release MT-1778"],
        ["Naveen Jangid", "MT-1784 Code Review; MT-1762, 1765, 1788 Dev; MT-1790, 1791 in progress; MT-1776, 1780 To Do", "Over-allocated; 5 past due", "Close MT-1784"],
        ["Nagamuni Valluri", "MT-1763, 1764, 1769 in progress", "MT-1763, 1764 past due", "Close MT-1763"],
    ],
    "mgmt": [
        "Confirm 15 Nov go-live scope (MT-1747 dated 16 Nov).",
    ],
    "focus": [
        "Close MT-1784; release MT-1778.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "V1.2 page subtasks moved to Code Review/Dev Testing; Kimi page (MR-1470) in Dev Testing; About and Contact fixes (MR-1477, 1484) started. New design-validation tracker MR-1516 (13 issues).",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 11 tickets – 1 Done, 7 In Progress, 1 Dev Testing, 1 Dev, 1 To Do.",
    ],
    "risks": [
        ["15 past due: MR-1362, 1073, 1454 (30 Oct), Kimi page MR-1470 and 11 V1.2/Kimi subtasks (30 Oct–7 Nov)", "Design go-live slipping", "Release or re-date", "Kunal Jangid / Vishnu kumar yadav", "13 Nov"],
        ["V1.2 design tracked twice (MR-1379 and MR-1411, both Kunal Jangid, due 13 Nov)", "Duplicate tracking", "Merge or close one", "Kunal Jangid", "13 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MR-1277, 1379, 1411, 1460, 1467, 1476, 1477 – 13 Nov 2026; MR-1484 – 14 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1379, 1411, 1476, 1477, 1484, 1516 in progress; MR-1362 + 6 page subtasks in Code Review", "Over-allocated; 7 past due", "Close MR-1362"],
        ["Vishnu kumar yadav", "MR-1073, MR-1454 Ready for Prod; MR-1460 in progress; MR-1409, 1410, 1468, 1469 open", "6 past due", "Release MR-1073, MR-1454"],
    ],
    "mgmt": [
        "Decide whether MR-1379 or MR-1411 carries the V1.2 design work.",
    ],
    "focus": [
        "Release MR-1073, MR-1454; close MR-1470 testing and MR-1362.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "ACS chat events webhook (USP-4441) added to the sprint and started; Comm Hub notification subtasks re-planned (email USP-4225 re-dated 15 Nov, bell USP-4460 new).",
        "Sprint status (Nov 1st Sprint, 1–15 Nov): 29 tickets – 6 Done, 13 Deployed in Dev, 6 In Progress, 4 To Do.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do, dated 15 Nov", "Document flows fail for customers until then", "Fix early in sprint", "Cășvan Marcel", "13 Nov"],
        ["13 items in Dev awaiting release with 3 days left; Comm Hub subtasks USP-4310, 4311 past due since 11 Oct", "Release crunch before 15 Nov", "Plan release order", "Silviu Oltean / Livian Stefan Stan", "13 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "All open sprint items – 15 Nov 2026"),
    ],
    "resources": [
        ["Cășvan Marcel", "USP-3783 in progress; USP-4231 (S1), 3784, 4073 To Do", "S1 not started", "Start USP-4231"],
        ["Silviu Oltean", "USP-4252, 4305, 4331, 4428 in Dev; USP-4302, 4441 in progress", "3 past-due subtasks", "Re-date USP-4310, 4311"],
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
        "Closed: S2/P1 bearer token valid after logout (ID-774) and Entra ID SSO for split CSM portal (ID-776), Saravana Kumar. Safari autocomplete fix (ID-775) Ready for Prod.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 7 tickets – 4 Done, 1 Ready for Prod, 1 Dev Testing, 1 In Progress. Retrospective: ID-736 Ready for Prod (due 30 Oct).",
    ],
    "risks": [
        ["ID-736 Ready for Prod since 30 Oct (due date)", "Not released", "Release", "Yash Janeshwar", "13 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-773 to ID-777 – 15 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-774, 776 closed; ID-775 Ready for Prod; ID-777 in progress", "On track", "Release ID-775"],
        ["Yash Janeshwar", "ID-773 Dev Testing; ID-736 Ready for Prod", "1 past due awaiting release", "Release ID-736"],
    ],
    "mgmt": [],
    "focus": [
        "Release ID-775; close B2C/CRM validation (ID-777).",
        "Release ID-736.",
    ],
})

project({
    "name": "5. Uvation Atlas (ATLAS)",
    "break": True,
    "highlights": [
        "Closed (Saurabh Jain): hybrid RAG with pgvector and Neo4j (ATLAS-350), CRM roles/lead ownership schema (ATLAS-306) and Admin board (ATLAS-312) with migration subtasks. Playwright testing (ATLAS-297) re-dated to 30 Nov.",
        "Sprint status (November 1st Sprint 1, 2–14 Nov): 7 tickets – 4 Done, 1 In Progress, 2 To Do.",
    ],
    "risks": [
        ["CRM Kanban epic (ATLAS-304) To Do; ATLAS-297 now dated 30 Nov, after sprint end", "Atlas testing and CRM work slip", "Confirm start dates", "Nagamuni Valluri / Saurabh Jain", "13 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-304, 314 – 13 Nov 2026; ATLAS-297 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-306, 312, 350 closed; ATLAS-314 in progress; ATLAS-304 To Do", "Strong delivery", "Close ATLAS-314"],
        ["Nagamuni Valluri", "ATLAS-297 To Do (30 Nov)", "Moved out of sprint window", "Move to next sprint"],
    ],
    "mgmt": [],
    "focus": [
        "Close ATLAS-314; start ATLAS-304.",
    ],
})

project({
    "name": "6. Uvation Pulse (PULSE)",
    "break": True,
    "highlights": [
        "No November Pulse sprint in Jira. October 2nd Sprint (still open): 3 tickets – 3 Done.",
    ],
    "risks": [
        ["No next Pulse sprint planned", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "13 Nov"],
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
        "Teams support desk/analytics UI (UC-261) started; SLA availability subtasks (UC-150, 151) in Dev Testing. RFQ in-chat (UC-23) missed its 11 Nov date, still In Dev.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 13 tickets – 4 Ready for Prod, 2 In Dev, 4 Dev Testing, 2 In Progress, 1 To Do. Retrospective: UC-19 UAT, UC-60 UAT Testing.",
    ],
    "risks": [
        ["UC-23 and 3 Ready for Prod fixes (UC-413, 414, 418) past due; 11 dashboard/handoff subtasks past due", "Fixes not live; subtask dates stale", "Release; re-date subtasks", "Ankit Saxena", "13 Nov"],
        ["Retrospective UC-19 and UC-60 in UAT, past due (30 Oct)", "October work still open", "Complete UAT", "Ankit Saxena / Nareddy Shiva Prasad Reddy", "13 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "UC-57, 68, 69, 408 – 13 Nov 2026; UC-261 – 16 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-413, 414, 418 Ready for Prod; UC-23 In Dev; UC-408 in progress; UC-19 UAT", "11 past due incl. subtasks", "Release fixes"],
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
        "Closed: S2 bugs AFVU-465, 474, 475; UAT sign-off AFVU-131; Book a Meeting and AI Factory verification (AFVU-385, 406, 461).",
    ],
    "risks": [
        ["S1 AFVU-476: first payment approvable before provisioning is published", "Billing before service is ready", "Fix first", "Anshul Bhargava", "13 Nov"],
        ["10 Retrospective tickets past due (30–31 Oct): Anshul Bhargava 8, r.jaiswal 2", "October release not closed", "Re-date and finish", "Anshul Bhargava", "13 Nov"],
    ],
    "deps": [
        ["DSX POD price and NVIDIA render approval (AFVU-353)", "To Do", "DSX POD go-live (AFVU-352)", "Anshul Bhargava", TBC],
        ["IT – Graph app, working hours (AFVU-366)", "To Do", "Book a Meeting release", "IT", TBC],
    ],
    "milestones": [
        ("Key milestone:", "November 1st Sprint subtasks – 15–16 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-465, 474, 475 closed; S1 AFVU-476 open; 8 past-due Retrospective tickets", "Over-allocated", "Fix AFVU-476"],
        ["r.jaiswal", "AFVU-138, 147 past due; AFVU-369 in progress", "QA load", "Close or re-date"],
    ],
    "mgmt": [
        "Confirm the October release (AFVU-132) date.",
    ],
    "focus": [
        "Fix S1 AFVU-476; close release and rollback (AFVU-132, 165–167).",
    ],
})
