TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 19 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "Closed: production FAQ 404 (MT-1780, Naveen Jangid). RMA allowed-status fix (MT-1844) in Dev, past due 18 Nov.",
        "Nov 2nd Sprint (16–29 Nov): 4 stories, all in progress. Retrospective: go-live checklist (MT-1770), FAQ 404 (MT-1780) and V1.4 design (MT-1747, due 16 Nov) still open.",
    ],
    "risks": [
        ["Go-live checklist (MT-1770) still open 6 days after go-live", "Go-live not formally closed", "Close or re-date MT-1770", "Naman Bapna", "20 Nov"],
        ["V1.4 design (MT-1747) past due 16 Nov with 12 subtasks open", "Redesign slipping", "Re-plan into sprint", "Naveen Jangid", "20 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sales Dashboard (MT-1822) – 27 Nov 2026; Store Credit/RMA and AI Agent connector – 30 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1780 closed; MT-1747, 1822, 1823 in progress; MT-1844 Dev; MT-1824 To Do", "4 past due", "Close MT-1823, 1844"],
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
        "New: Kemi page responsive UI issues (MR-1565, Kunal Jangid, due 30 Nov). Design validation trackers MR-1516, 1532 in progress.",
        "CMS API hardening: Klaviyo routes and lead-rights subtasks MR-1489, 1490, 1491 in Dev, past due 17–18 Nov (Vishnu kumar yadav).",
    ],
    "risks": [
        ["Kimi page, chatbot card and Contact fixes Ready for Prod but past due; async ticket fallback (MR-1476) still in UAT", "Remaining redesign items not live", "Release; close UAT", "Kunal Jangid / Kannan Elangovan", "20 Nov"],
        ["Production issues (MR-1547) have no due date", "Live-site defects untracked by date", "Set a due date", "Vishnu kumar yadav", "20 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories (MR-1488, 1498, 1504, 1510) – 30 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1477 closed; MR-1467, 1470, 1484 Ready for Prod; MR-1476 UAT; MR-1498, 1556 in progress", "5 past due", "Release batch"],
        ["Vishnu kumar yadav", "MR-1488 (1489–1491 in Dev); MR-1516, 1547 in progress", "3 past due", "Close MR-1489–1491"],
        ["Kannan Elangovan", "MT-1632 in progress", "1 past due", "Close MT-1632"],
    ],
    "mgmt": [],
    "focus": [
        "Release MR-1467, 1470, 1484; close MR-1476 UAT.",
        "Date and fix production issues MR-1547.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "Go-live items closed out: 22 Nov 1st Sprint stories moved from production to Done (incl. Support Hub v2, Comm Hub re-skin, Contract Proposal, seat-claim fix). Support Hub Teams tenant switch (USP-4465) set to Won't Do.",
        "Carry-overs re-dated to 30 Nov: hub notifications (USP-4302), auto-assign (USP-4331), Book a Meeting (USP-4438), ACS webhook (USP-4441). Support widget change (USP-4464) started.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do in the unstarted Nov 2nd Sprint", "Document flows fail in production", "Start sprint; fix first", "Cășvan Marcel", "20 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint incl. carry-overs – 30 Nov 2026"),
    ],
    "resources": [
        ["Livian Stefan Stan", "Go-live items Done; USP-4464 in progress; USP-4467 next", "No past-due items", "Progress USP-4464"],
        ["Silviu Oltean", "USP-4302, 4331, 4441 in progress (due 30 Nov)", "No past-due items", "Close USP-4302"],
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
        "Pilot enablement (ATLAS-354, Saurabh Jain) started. ATLAS-297 in progress; ATLAS-360 To Do; Retrospective ATLAS-304 To Do.",
    ],
    "risks": [
        ["CRM Kanban epic (ATLAS-304) past due 13 Nov, not started", "Carry-over", "Start ATLAS-354; re-date ATLAS-304", "Saurabh Jain", "20 Nov"],
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
        ["No Pulse sprint planned for November", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "20 Nov"],
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
        "New: duplicate thank-you message after agent handoff consent (UC-434, Nareddy Shiva Prasad Reddy, in progress). No Retrospective item moved today.",
        "Nov 2nd Sprint (16–29 Nov): UC-59, 170, 423 in progress; UC-70, 174, 428 To Do.",
    ],
    "risks": [
        ["6 items Ready for Prod and not released (UC-413, 414, 418 since 2–4 Nov; UC-57, 69, 421)", "Fixes not live", "Release", "Ankit Saxena", "20 Nov"],
        ["9 Retrospective stories/subtasks in UAT past due; handoff routing (UC-68) not started", "UAT backlog", "Close UAT; re-plan UC-68", "Ankit Saxena / Shivam Dhoundiyal", "20 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-19, 23, 408 UAT; UC-68 To Do; 3 fixes Ready for Prod; UC-59 in progress", "7 past due", "Release fixes"],
        ["Shivam Dhoundiyal", "UC-261 and 6 dashboard subtasks in UAT; UC-423 (424, 425 in Dev)", "9 past due", "Close UAT"],
        ["Nareddy Shiva Prasad Reddy", "UC-57, 69, 421 Ready for Prod; UC-60 UAT Testing; UC-170 in progress", "3 past due", "Release"],
    ],
    "mgmt": [
        "Approve a production release for UC-413, 414, 418, 57, 69, 421.",
    ],
    "focus": [
        "Release Ready for Prod chatbot fixes.",
        "Close UAT on UC-23, 261, 408.",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "New S2: Join Meeting button missing in meeting update and booking emails (AFVU-505, Yash Janeshwar, due 30 Nov). No AFVU ticket closed today.",
        "Production DB set-up (AFVU-495, due 23 Nov) still unassigned.",
    ],
    "risks": [
        ["GPUaaS hardening (AFVU-214) and 4 GPUaaS stories (AFVU-259–262) past due; DSX POD real price (AFVU-352) open", "GPUaaS release not ready", "Finish before switch-on (AFVU-480)", "Anshul Bhargava", "20 Nov"],
        ["Production DB set-up (AFVU-495) and AFVU-489 unassigned", "Release prep and bug unowned", "Assign both", "Anshul Bhargava", "20 Nov"],
    ],
    "deps": [
        ["DSX POD real price (AFVU-352)", "Open", "DSX POD go-live", "Business", TBC],
    ],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint – 29 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-360 closed; AFVU-214, 259, 260, 262, 352 open; USP-4438", "Over-allocated; 6 past due", "Rebalance"],
        ["Aman prakash", "AFVU-490 in review; AFVU-261 in progress", "1 past due", "Close AFVU-261"],
    ],
    "mgmt": [
        "Assign AFVU-495 and AFVU-489; rebalance GPUaaS work off Anshul Bhargava.",
    ],
    "focus": [
        "Finish GPUaaS hardening (AFVU-214) and AFVU-259–262.",
    ],
})
