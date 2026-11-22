TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 22 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "No Marketplace ticket changed status today. Post-deployment production issues (MT-1852, Naveen Jangid) To Do, due 23 Nov.",
        "Nov 2nd Sprint (16–29 Nov): 4 stories, all in progress. Retrospective: go-live checklist (MT-1770), FAQ 404 (MT-1780) and V1.4 design (MT-1747, due 16 Nov) still open.",
    ],
    "risks": [
        ["Go-live checklist (MT-1770) still open 8 days after go-live", "Go-live not formally closed", "Close or re-date MT-1770", "Naman Bapna", "23 Nov"],
        ["V1.4 design (MT-1747) past due 16 Nov with 12 subtasks open", "Redesign slipping", "Re-plan into sprint", "Naveen Jangid", "23 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sales Dashboard (MT-1822) – 27 Nov 2026; Store Credit/RMA and AI Agent connector – 30 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1747, 1823, 1825, 1843 in progress; MT-1844 Dev; MT-1824 To Do; MT-1852 next", "Over-allocated; 6 past due", "Prioritise MT-1852"],
        ["Naman Bapna", "MT-1770 open; MT-1793 in progress", "Go-live checklist past due", "Close MT-1770"],
    ],
    "mgmt": [
        "Confirm the Marketplace go-live outcome and close or re-date MT-1770.",
    ],
    "focus": [
        "Close go-live checklist (MT-1770).",
        "Re-plan V1.4 (MT-1747) into the Nov 2nd Sprint.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "No Marketing ticket changed status today. Content updates MR-1561–1563 (Kannan Elangovan) still in Dev Testing; CMS API hardening subtasks MR-1489–1493 still past due.",
    ],
    "risks": [
        ["Kimi page, chatbot card and Contact fixes Ready for Prod but past due; async ticket fallback (MR-1476) still in UAT", "Remaining redesign items not live", "Release; close UAT", "Kunal Jangid / Kannan Elangovan", "23 Nov"],
        ["Production issues (MR-1547) have no due date", "Live-site defects untracked by date", "Set a due date", "Vishnu kumar yadav", "23 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories (MR-1488, 1498, 1504, 1510) – 30 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1477 closed; MR-1467, 1470, 1484 Ready for Prod; MR-1476 UAT; MR-1498, 1556 in progress", "5 past due", "Release batch"],
        ["Vishnu kumar yadav", "MR-1489–1491 Dev; MR-1492, 1493 To Do; MR-1560 Code Review", "6 past due", "Re-date MR-1488 subtasks"],
        ["Kannan Elangovan", "MR-1561, 1562, 1563 Dev Testing", "3 past due", "Close Dev Testing"],
    ],
    "mgmt": [],
    "focus": [
        "Release MR-1467, 1470, 1484; close MR-1476 UAT.",
        "Close Dev Testing on MR-1561–1563.",
        "Date and fix production issues MR-1547.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "No USP ticket changed status today. Nov 2nd Sprint still not started; S1 Document API 502 (USP-4231) To Do.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do in the unstarted Nov 2nd Sprint", "Document flows fail in production", "Start sprint; fix first", "Cășvan Marcel", "23 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint incl. carry-overs – 30 Nov 2026"),
    ],
    "resources": [
        ["Livian Stefan Stan", "Go-live items Done; USP-4464 in progress; USP-4467 next", "No past-due items", "Progress USP-4464"],
        ["Silviu Oltean", "USP-4302, 4441 in Dev; USP-4331 in progress; USP-4457 To Do (15 Nov)", "1 past due", "Re-date USP-4457"],
        ["Cășvan Marcel", "USP-4231 (S1), 3784, 4073 To Do", "S1 not started", "Start USP-4231"],
    ],
    "mgmt": [
        "Start the USP Nov 2nd Sprint and close the Nov 1st Sprint in Jira.",
    ],
    "focus": [
        "Start S1 fix USP-4231.",
        "Run the post-go-live regression pass (USP-4353).",
    ],
})

project({
    "name": "4. Web Identity (ID)",
    "break": True,
    "highlights": [
        "No Identity ticket changed status today. ID-781, 782, 783 in progress; ID-784 in Dev; ID-779, 780 To Do.",
    ],
    "risks": [],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-779 to ID-784 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-781, 782, 783 in progress; ID-779, 780 To Do", "Carries 5 of 6 sprint items", "Sequence ID-780"],
        ["Yash Janeshwar", "ID-784 in Dev; AFVU-497, 498, 505 To Do", "Split across ID and AFVU", "Close ID-784"],
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
        "No Atlas ticket changed status today. ATLAS-297, 354 in progress; ATLAS-360 To Do; Retrospective ATLAS-304 To Do.",
    ],
    "risks": [
        ["CRM Kanban epic (ATLAS-304) past due 13 Nov, not started", "Carry-over", "Start ATLAS-354; re-date ATLAS-304", "Saurabh Jain", "23 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-297, 354, 360 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-354 in progress; ATLAS-304, MR-1459 past due", "2 past due", "Re-date ATLAS-304"],
        ["Nagamuni Valluri", "ATLAS-297 in progress; ATLAS-360 To Do", "On track", "Start ATLAS-360"],
    ],
    "mgmt": [],
    "focus": [
        "Start lead pass flow (ATLAS-360); re-date ATLAS-304.",
    ],
})

project({
    "name": "6. Uvation Pulse (PULSE)",
    "break": True,
    "highlights": [
        "No November Pulse sprint in Jira. October 2nd Sprint (still open): 3 tickets – 3 Done.",
    ],
    "risks": [
        ["No Pulse sprint planned for November", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "23 Nov"],
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
        "No Conversation AI ticket changed status today. Comm Hub subtasks UC-424–426 in UAT, QA (UC-427) in progress, all past due.",
        "Nov 2nd Sprint (16–29 Nov): UC-59, 170, 423 in progress; UC-70, 174, 428 To Do.",
    ],
    "risks": [
        ["8 items Ready for Prod and not released (UC-413, 414, 418 since 2–4 Nov; UC-57, 69, 421, 261, 402)", "Fixes not live", "Release", "Ankit Saxena", "23 Nov"],
        ["9 Retrospective stories/subtasks in UAT past due; handoff routing (UC-68) not started", "UAT backlog", "Close UAT; re-plan UC-68", "Ankit Saxena / Shivam Dhoundiyal", "23 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-19, 23, 408 UAT; UC-68 To Do; 3 fixes Ready for Prod; UC-59 in progress", "7 past due", "Release fixes"],
        ["Shivam Dhoundiyal", "UC-261, 402 Ready for Prod; 6 dashboard + 4 Comm Hub subtasks in UAT/QA", "11 past due", "Close UAT"],
        ["Nareddy Shiva Prasad Reddy", "UC-57, 69, 421 Ready for Prod; UC-60 UAT Testing; UC-170 in progress", "3 past due", "Release"],
    ],
    "mgmt": [
        "Approve a production release for UC-413, 414, 418, 57, 69, 421, 261, 402.",
    ],
    "focus": [
        "Release Ready for Prod chatbot fixes.",
        "Close UAT on UC-23, 408 and dashboard subtasks.",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "Closed: Architect defects AFVU-525 (S2, saved design overwrote customer choice), AFVU-526 (S2, dead end at Scale) and AFVU-527 (S3, DSX price message) – Anshul Bhargava.",
        "Production DB set-up (AFVU-495, due 23 Nov) still unassigned.",
    ],
    "risks": [
        ["GPUaaS AFVU-214, 259–262 and DSX POD price (AFVU-352) past due", "GPUaaS release not ready", "Finish before switch-on (AFVU-480)", "Anshul Bhargava", "23 Nov"],
        ["AFVU-495 and AFVU-489 unassigned", "Release prep and bug unowned", "Assign both", "Anshul Bhargava", "23 Nov"],
    ],
    "deps": [
        ["DSX POD real price (AFVU-352)", "Open", "DSX POD go-live", "Business", TBC],
    ],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint – 29 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-525–527 closed; AFVU-214, 259, 260, 262, 352 open; USP-4438", "5 past due", "Finish GPUaaS items"],
        ["Aman prakash", "AFVU-490 in review; AFVU-261 in progress", "1 past due", "Close AFVU-261"],
    ],
    "mgmt": [
        "Assign AFVU-495 and AFVU-489; rebalance GPUaaS work off Anshul Bhargava.",
    ],
    "focus": [
        "Finish GPUaaS hardening (AFVU-214) and AFVU-259–262.",
    ],
})
