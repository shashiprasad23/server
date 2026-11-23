TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 23 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "V1.4 design (MT-1747) and 10 of its stories (MT-1762–1791) moved to In Prod.",
        "Closed: Comm Hub (MT-1777), sitemap (MT-1845), PDP hero attribute (MT-1853), prod RFQ-to-Quote check (MT-1854). Started: MT-1826, 1828 (Naman Bapna); MT-1852 (due today).",
    ],
    "risks": [
        ["Go-live checklist (MT-1770) still open 8 days after go-live", "Go-live not formally closed", "Close or re-date MT-1770", "Naman Bapna", "24 Nov"],
        ["Sales Dashboard subtasks MT-1823–1825 and MT-1843, 1844 past due", "Dashboard (MT-1822) slipping", "Re-date subtasks", "Naveen Jangid", "24 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sales Dashboard (MT-1822) – 27 Nov 2026; Store Credit/RMA and AI Agent connector – 30 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1747 + 7 stories In Prod; MT-1852; MT-1823–1825, 1843, 1844 open", "5 past due", "Close MT-1852"],
        ["Naman Bapna", "MT-1845, 1853 closed; MT-1826, 1828 in progress; MT-1770 open", "1 past due", "Close MT-1770"],
        ["Kannan Elangovan", "MT-1854 closed; MT-1851 in progress (no due date)", "Also carries MR items", "Date MT-1851"],
    ],
    "mgmt": [
        "Confirm the Marketplace go-live outcome and close or re-date MT-1770.",
    ],
    "focus": [
        "Close MT-1852 and MT-1770; re-date MT-1823–1825.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "Closed: Kimi page (MR-1470) and Contact page fixes (MR-1484) – Kunal Jangid; PR review (MR-1459) – Saurabh Jain. Design validation (MR-1516) moved to In Prod1.",
        "MR-1492, 1493 started and re-dated to 25 Nov (Vishnu kumar yadav). New: design-doc bug fixes (MR-1564), Kemi responsive fixes (MR-1565), Partners page content (MR-1570, due 25 Nov).",
    ],
    "risks": [
        ["Chatbot card fix (MR-1467) Ready for Prod and async ticket fallback (MR-1476) in UAT, both past due", "Fixes not live", "Release; close UAT", "Kunal Jangid", "24 Nov"],
        ["CMS hardening MR-1489–1491 and content MR-1561–1563 past due", "Security fixes and pages delayed", "Re-date or close", "Vishnu kumar yadav / Kannan Elangovan", "24 Nov"],
        ["Production issues (MR-1547) have no due date", "Live-site defects untracked by date", "Set a due date", "Vishnu kumar yadav", "24 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MR-1492, 1493, 1570 – 25 Nov 2026; Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1470, 1484 closed; MR-1467 Ready for Prod; MR-1476 UAT; MR-1362 Code Review; MR-1510, 1564, 1565 active", "3 past due", "Release MR-1467"],
        ["Vishnu kumar yadav", "MR-1489–1493 Dev; MR-1560 Code Review; MR-1547; MT-1792 Dev", "5 past due", "Re-date MR-1489–1491"],
        ["Kannan Elangovan", "MR-1557, 1561–1563, 1570 Dev Testing", "3 past due", "Close Dev Testing"],
    ],
    "mgmt": [],
    "focus": [
        "Release MR-1467; close MR-1476 UAT.",
        "Close Dev Testing on MR-1561–1563.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "Closed: auto-assign new service requests (USP-4331) and CRM support roster (USP-4457) – Silviu Oltean. New: server upload in sync with Marketplace prod (USP-4512, Shivam Dhoundiyal, due 24 Nov).",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do in the unstarted Nov 2nd Sprint", "Document flows fail in production", "Start sprint; fix first", "Cășvan Marcel", "24 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "USP-4512 – 24 Nov 2026; Nov 2nd Sprint incl. carry-overs – 30 Nov 2026"),
    ],
    "resources": [
        ["Silviu Oltean", "USP-4331, 4457 closed; USP-4302, 4441 in Dev", "No past-due items", "Close USP-4302, 4441"],
        ["Livian Stefan Stan", "USP-4464 in progress; USP-4467 next", "No past-due items", "Progress USP-4464"],
        ["Cășvan Marcel", "USP-4231 (S1), 3784, 4073 To Do", "S1 not started", "Start USP-4231"],
    ],
    "mgmt": [
        "Start the USP Nov 2nd Sprint and close the Nov 1st Sprint in Jira.",
    ],
    "focus": [
        "Start S1 fix USP-4231.",
        "Complete server sync USP-4512.",
    ],
})

project({
    "name": "4. Web Identity (ID)",
    "break": True,
    "highlights": [
        "Closed: limit Graph app to roster staff mailboxes in non-prod (ID-785). New: meeting recap permissions and lobby bypass (ID-786) in progress – Saravana Kumar.",
    ],
    "risks": [],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-779 to ID-786 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-785 closed; ID-781, 782, 783, 786 in progress; ID-779, 780 To Do", "Carries 6 of 7 open items", "Sequence ID-780"],
        ["Yash Janeshwar", "ID-784 in Dev; AFVU-497, 498, 505 To Do", "Split across ID and AFVU", "Close ID-784"],
    ],
    "mgmt": [],
    "focus": [
        "Progress ID-781, 782 and ID-786; start ID-780 production deployment plan.",
    ],
})

project({
    "name": "5. Uvation Atlas (ATLAS)",
    "break": True,
    "highlights": [
        "CRM Kanban epic (ATLAS-304) started and re-dated to 31 Dec (Saurabh Jain). Playwright/analytics work (ATLAS-297) to In Review; lead pass flow (ATLAS-360) started – Nagamuni Valluri.",
    ],
    "risks": [
        ["ATLAS-304 now due 31 Dec, beyond the sprint end (30 Nov)", "Epic spans next sprint", "Split into sprint-sized stories", "Saurabh Jain", "30 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-297, 354, 360 – 30 Nov 2026; CRM Kanban epic (ATLAS-304) – 31 Dec 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-304, 354 in progress; MR-1459 closed", "No past-due items", "Progress ATLAS-354"],
        ["Nagamuni Valluri", "ATLAS-297 In Review; ATLAS-360 in progress; MT-1764, 1768, 1769 In Prod", "On track", "Close ATLAS-297 review"],
    ],
    "mgmt": [
        "Confirm the ATLAS-304 re-date to 31 Dec.",
    ],
    "focus": [
        "Close ATLAS-297 review; progress lead pass flow ATLAS-360.",
    ],
})

project({
    "name": "6. Uvation Pulse (PULSE)",
    "break": True,
    "highlights": [
        "No November Pulse sprint in Jira. October 2nd Sprint (still open): 3 tickets – 3 Done.",
    ],
    "risks": [
        ["No Pulse sprint planned for November", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "24 Nov"],
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
        "Closed: chatbot fixes UC-413, 414, 418, 419, 420, 421 and stories UC-19, 23, 57, 60, 69, 408 (with UC-37, 38, 80, 81) – Ankit Saxena / Nareddy Shiva Prasad Reddy.",
        "Nov 2nd Sprint: UC-59 to UAT; UC-70, 174 started; UC-170 In Dev.",
    ],
    "risks": [
        ["8 subtasks of closed stories UC-23, 408 still in UAT and past due", "Jira status inconsistent", "Close or re-date subtasks", "Ankit Saxena", "24 Nov"],
        ["UC-261 Ready for Prod; 10 dashboard/Comm Hub subtasks in UAT/QA past due; UC-68 not started", "UAT backlog", "Release; close UAT; re-plan UC-68", "Shivam Dhoundiyal / Ankit Saxena", "24 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "8 items closed; UC-59 UAT; UC-70 in progress; UC-68 To Do; 8 UAT subtasks", "9 past due", "Close UC-23, 408 subtasks"],
        ["Shivam Dhoundiyal", "UC-261 Ready for Prod; 10 subtasks UAT/QA; USP-4512 new", "11 past due", "Close UAT"],
        ["Nareddy Shiva Prasad Reddy", "UC-57, 60, 69, 419–421 closed; UC-170 In Dev; UC-174 in progress", "No past-due items", "Progress UC-170"],
    ],
    "mgmt": [
        "Approve a production release for UC-261.",
    ],
    "focus": [
        "Close UAT subtasks under UC-23 and UC-408.",
        "Release UC-261; close dashboard and Comm Hub UAT.",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "Interactive View racks fix (AFVU-477) closed again – Anshul Bhargava. Production DB set-up (AFVU-495) due today, still unassigned and To Do.",
    ],
    "risks": [
        ["GPUaaS AFVU-214, 259–262 and DSX POD price (AFVU-352) past due", "GPUaaS release not ready", "Finish before switch-on (AFVU-480)", "Anshul Bhargava", "24 Nov"],
        ["AFVU-495 (due today) and AFVU-489 unassigned", "Release prep and bug unowned", "Assign both", "Anshul Bhargava", "24 Nov"],
    ],
    "deps": [
        ["DSX POD real price (AFVU-352)", "Open", "DSX POD go-live", "Business", TBC],
    ],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint – 29 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-214, 259, 260, 262, 352 open; USP-4438", "5 past due", "Finish GPUaaS items"],
        ["Aman prakash", "AFVU-490 in review; AFVU-261 in progress", "1 past due", "Close AFVU-261"],
    ],
    "mgmt": [
        "Assign AFVU-495 and AFVU-489; rebalance GPUaaS work off Anshul Bhargava.",
    ],
    "focus": [
        "Assign and start production DB set-up (AFVU-495).",
        "Finish GPUaaS hardening (AFVU-214) and AFVU-259–262.",
    ],
})
