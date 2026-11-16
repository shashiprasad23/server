TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 16 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "Nov 1st Sprint closed; Nov 2nd Sprint (16–29 Nov) started with 4 stories: in-house Store Credit/RMA (MT-1795, shubham kuchwar) and AI Agent connector (MT-1834, Parth) in progress; Sales Dashboard (MT-1822) and General (MT-1793) To Do.",
        "Go-live items MT-1770, 1771, 1780, 1784 and V1.4 design (MT-1747, due today) moved to the Retrospective sprint, still open.",
    ],
    "risks": [
        ["Go-live checklist (MT-1770) and production FAQ 404 (MT-1780) still open after the 15 Nov go-live date", "Go-live not formally closed; FAQ pages broken", "Confirm go-live status; fix MT-1780", "Naman Bapna / Naveen Jangid", "17 Nov"],
        ["V1.4 design (MT-1747) due today with 12 subtasks past due, mostly in Dev", "Redesign slipping", "Re-plan V1.4", "Naveen Jangid / Nagamuni Valluri", "17 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sales Dashboard (MT-1822) – 27 Nov 2026; Store Credit/RMA and AI Agent connector – 30 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1747 + 9 V1.4 subtasks; MT-1780, 1784 open; MT-1822 next", "Over-allocated; 9 past due", "Re-plan V1.4"],
        ["Nagamuni Valluri", "MT-1763, 1764, 1768, 1769 in Dev", "4 past due", "Move to testing"],
        ["shubham kuchwar / Parth", "MT-1795, MT-1834 in progress", "New sprint work started", "Continue"],
    ],
    "mgmt": [
        "Confirm whether the 15 Nov Marketplace go-live happened and close or re-date MT-1770.",
    ],
    "focus": [
        "Fix MT-1780, close MT-1784 and re-plan V1.4.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "V1.2 redesign moved to UAT Testing (MR-1379, 1460, 1470, 1476, 1477, 1484, 1516, 1532); MR-1411 Ready for Prod. New: home and Project Genesis design updates (MR-1546, Vishnu kumar yadav, due 17 Nov).",
        "Nov 2nd Sprint (16–29 Nov) started: CMS API hardening (MR-1488), JS reduction (MR-1498), image/LCP (MR-1504) and Sonar (MR-1510), all To Do.",
    ],
    "risks": [
        ["14 Retrospective items past due; 7 Ready for Prod awaiting release (MR-1073, 1454 since 30 Oct)", "Done work not live", "Schedule release after UAT", "Vishnu kumar yadav / Kunal Jangid", "17 Nov"],
        ["CMS API data-leak hardening (MR-1488) not started", "Public data exposure continues", "Start early in sprint", "Vishnu kumar yadav", "17 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MR-1546 – 17 Nov 2026; Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "V1.2/Kimi in UAT; MR-1362 Code Review; MR-1498, 1504, 1510 To Do", "6 past due", "Close UAT; start MR-1498"],
        ["Vishnu kumar yadav", "4 items Ready for Prod; MR-1546 in progress; MR-1488 To Do", "7 past due", "Release; start MR-1488"],
        ["Kannan Elangovan", "MR-1467, 1484 UAT Testing; MT-1632 in progress", "3 past due", "Close UAT"],
    ],
    "mgmt": [
        "Approve the V1.2 marketing release once UAT completes.",
    ],
    "focus": [
        "Complete UAT on V1.2 and release the Ready for Prod batch.",
        "Start CMS API hardening (MR-1488).",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "Go-live: 16 items deployed to production, incl. Support Hub v2 (USP-4252), lifecycle notifications (USP-3783), Contract Proposal and feature flags (USP-4450–4453), seat-claim security fix (USP-4369) and coming-soon catalogue state (USP-4466).",
        "Nov 1st Sprint still open with 5 items; Nov 2nd Sprint (16–30 Nov, go-live wrap-up incl. regression pass) planned with 19 tickets, not yet started. New: invoices design and data change (USP-4467).",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) moved to Nov 2nd Sprint, still To Do (now due 30 Nov)", "Document flows fail for customers in production", "Fix first in new sprint", "Cășvan Marcel", "17 Nov"],
        ["5 Nov 1st Sprint items past due (Comm Hub re-skin, hub notifications, Support Hub mobile, BAU, Book a Meeting)", "Carry-over", "Close sprint and move", "Silviu Oltean / Livian Stefan Stan", "17 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "First 45 days ends 18 Nov 2026; Nov 2nd Sprint – 30 Nov 2026"),
    ],
    "resources": [
        ["Livian Stefan Stan", "11 items to production; USP-4295, 4329, 4435 open; USP-4464, 4465, 4467 next", "Strong delivery; 3 past due", "Close carry-over"],
        ["Silviu Oltean", "USP-4252, 4305, 4331, 4428, 4441 in production; USP-4302 open", "2 past due", "Close USP-4302"],
        ["Cășvan Marcel", "USP-3783, 4369 in production; USP-4231 (S1), 3784, 4073 To Do", "S1 not started", "Start USP-4231"],
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
        "Nov 2nd Sprint (16–29 Nov) started: B2C field validation clean-up (ID-781) and S3 state dropdown error (ID-782) in progress; refresh token revocation (ID-779) and B2C/Rafay SSO production deployment (ID-780) To Do – all Saravana Kumar.",
    ],
    "risks": [
        ["ID-736 (since 30 Oct) and ID-773 Ready for Prod, in Retrospective", "Not released", "Release both", "Yash Janeshwar", "17 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-779 to ID-782 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-781, 782 in progress; ID-779, 780 To Do", "Sole owner of sprint", "Sequence ID-780"],
        ["Yash Janeshwar", "ID-736, ID-773 Ready for Prod", "2 past due awaiting release", "Release"],
    ],
    "mgmt": [],
    "focus": [
        "Release ID-736 and ID-773.",
    ],
})

project({
    "name": "5. Uvation Atlas (ATLAS)",
    "break": True,
    "highlights": [
        "Nov 1st Sprint closed; ATLAS-304 moved to Retrospective. Nov 2nd Sprint (16–29 Nov) started: Playwright testing (ATLAS-297), pilot enablement (ATLAS-354) and lead pass/reassignment flow (ATLAS-360), all To Do.",
    ],
    "risks": [
        ["CRM Kanban epic (ATLAS-304) past due 13 Nov, not started", "Carry-over", "Re-date or move to sprint", "Saurabh Jain", "17 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-297, 354, 360 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-354 To Do; ATLAS-304, MR-1459 past due", "2 past due", "Start ATLAS-354"],
        ["Nagamuni Valluri", "ATLAS-297, 360 To Do; 4 MT subtasks", "Split across MT and Atlas", "Start ATLAS-360"],
    ],
    "mgmt": [],
    "focus": [
        "Start pilot enablement (ATLAS-354).",
    ],
})

project({
    "name": "6. Uvation Pulse (PULSE)",
    "break": True,
    "highlights": [
        "No November Pulse sprint in Jira. October 2nd Sprint (still open): 3 tickets – 3 Done.",
    ],
    "risks": [
        ["No Pulse sprint planned for November", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "17 Nov"],
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
        "Nov 1st Sprint closed; open items moved to Retrospective. Teams support desk UI (UC-261) and CSM Teams admin APIs (UC-408) moved to UAT.",
        "Nov 2nd Sprint (16–29 Nov) started: identity/authorization gateway (UC-170) and Marketplace Communication Hub (UC-423) in progress; RFQ intent prompt (UC-59), agent Teams handoff (UC-70), compliance gate (UC-174) and RFQ screens (UC-428) To Do.",
    ],
    "risks": [
        ["3 chatbot fixes Ready for Prod since 2–4 Nov (UC-413, 414, 418)", "Fixes not live", "Release", "Ankit Saxena", "17 Nov"],
        ["Retrospective carries 8 past-due stories in UAT and 6 dashboard subtasks", "UAT backlog", "Close UAT", "Ankit Saxena / Shivam Dhoundiyal", "17 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-19, 23, 408 UAT; UC-68 To Do; 3 fixes Ready for Prod; UC-59, 70 next", "7 past due", "Release fixes"],
        ["Shivam Dhoundiyal", "UC-261, 402 and subtasks in UAT; UC-423 in progress", "7 past due", "Close UAT"],
        ["Nareddy Shiva Prasad Reddy", "UC-57, 60, 69 UAT Testing; UC-170 in progress", "3 past due", "Close UAT"],
    ],
    "mgmt": [
        "Approve a production release for UC-413, 414, 418, 419, 420.",
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
        "Configurator fixes AFVU-431 and 434 closed (Anshul Bhargava). Nov 2nd Sprint (16–29 Nov) planned with 14 items, mostly 3D hall/Architect accuracy bugs; new: Send proposal/Provisioning ready hidden until reload (AFVU-490).",
        "New AFVU-489 (Architect in-rack cooling locks the wizard) has no assignee.",
    ],
    "risks": [
        ["GPUaaS hardening (AFVU-214) past due since 30 Oct; S3 AFVU-360 since 2 Nov", "GPUaaS release not ready", "Finish E2E test and rehearsal", "Anshul Bhargava", "17 Nov"],
        ["Nov 2nd Sprint: 12 of 14 items on Anshul Bhargava; AFVU-489 unassigned", "Single-person bottleneck", "Rebalance", "Anshul Bhargava", "17 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint – 29 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-214, 262, 360 in progress; 11 Nov 2nd Sprint items To Do; USP-4438", "Over-allocated", "Rebalance sprint"],
        ["r.jaiswal", "AFVU-476 in progress (past due); AFVU-313 QA", "1 past due", "Confirm AFVU-476"],
    ],
    "mgmt": [
        "Assign AFVU-489 and rebalance the AFVU Nov 2nd Sprint.",
    ],
    "focus": [
        "Finish AFVU-214; assign AFVU-489.",
    ],
})
