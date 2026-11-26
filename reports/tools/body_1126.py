TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 26 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "Closed: go-live checklist (MT-1770, Naman Bapna) and AI Agent connector (MT-1834, Parth); products and contents (MT-1775) In Prod. Sales Dashboard: MT-1827, 1829 to Dev, module audit MT-1830 started; DEV corrections MT-1846, 1848 started (Naveen Jangid).",
    ],
    "risks": [
        ["Sales Dashboard subtasks MT-1823–1825, MT-1843, 1844 and production issues MT-1852 past due", "Dashboard (MT-1822) slipping", "Re-date subtasks", "Naveen Jangid", "27 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sales Dashboard tests and Dev sign-off (MT-1829) – 27 Nov 2026; Store Credit/RMA – 30 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1846, 1848 started; MT-1852; MT-1823–1825, 1843, 1844 open", "6 past due", "Close MT-1852"],
        ["Naman Bapna", "MT-1770 closed; MT-1826–1829 Dev; MT-1830 in progress", "No past-due items", "Close MT-1829 by 27 Nov"],
        ["Kannan Elangovan", "MT-1851 in progress (no due date)", "Also carries MR items", "Date MT-1851"],
    ],
    "mgmt": [
    ],
    "focus": [
        "Close MT-1852; re-date MT-1823–1825.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "Klaviyo hardening MR-1494 (re-dated 26 Nov), MR-1495 and MR-1496 moved to Dev (Vishnu kumar yadav). MR-1492, 1493, security regression/UAT sign-off (MR-1497, To Do) and Partners page (MR-1570) passed their 25 Nov due date.",
    ],
    "risks": [
        ["Chatbot card fix (MR-1467) Ready for Prod and async ticket fallback (MR-1476) in UAT, both past due", "Fixes not live", "Release; close UAT", "Kunal Jangid", "27 Nov"],
        ["CMS hardening MR-1489–1493, 1497 and content MR-1560–1563, 1569, 1570 past due", "Security fixes and pages delayed", "Re-date or close", "Vishnu kumar yadav", "27 Nov"],
        ["Production issues (MR-1547) have no due date", "Live-site defects untracked by date", "Set a due date", "Vishnu kumar yadav", "27 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "MR-1494–1496 – 26 Nov 2026 (today); Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1467 Ready for Prod; MR-1476 UAT; MR-1362 Code Review; MR-1510, 1564, 1565, 1571 active", "3 past due", "Release MR-1467"],
        ["Vishnu kumar yadav", "MR-1489–1496 Dev; MR-1497 To Do; MR-1569; MR-1560–1563, 1570 Code Review", "12 past due", "Re-date MR-1489–1497"],
    ],
    "mgmt": [],
    "focus": [
        "Release MR-1467; close MR-1476 UAT.",
        "Close Code Review on MR-1560–1563, 1570.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "No USP ticket changed status today. Nov 2nd Sprint still not started; server sync USP-4512 (Shivam Dhoundiyal) past due since 24 Nov.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do in the unstarted Nov 2nd Sprint", "Document flows fail in production", "Start sprint; fix first", "Cășvan Marcel", "27 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Regression pass (USP-4353) and Nov 2nd Sprint incl. carry-overs – 30 Nov 2026"),
    ],
    "resources": [
        ["Silviu Oltean", "USP-4483 in progress; USP-4302, 4441 in Dev", "No past-due items", "Close USP-4302, 4441"],
        ["Livian Stefan Stan", "USP-4464 in progress; USP-4467 next", "No past-due items", "Progress USP-4464"],
        ["Cășvan Marcel", "USP-4471, 4472 Tested in Dev; USP-3985, 4299 in progress; USP-4231 (S1) To Do", "S1 not started", "Start USP-4231"],
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
        "No Identity ticket changed status today. ID-784 Ready for Prod; ID-781, 782 Dev Testing; ID-780, 783, 786 in progress.",
    ],
    "risks": [],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-779 to ID-786 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-780, 783, 786 in progress; ID-779 To Do", "No past-due items", "Progress ID-780"],
        ["Yash Janeshwar", "ID-784 Ready for Prod; AFVU-497, 498, 505 in progress", "Split across ID and AFVU", "Release ID-784"],
    ],
    "mgmt": [],
    "focus": [
        "Release ID-784; close Dev Testing on ID-781, 782; progress ID-780.",
    ],
})

project({
    "name": "5. Uvation Atlas (ATLAS)",
    "break": True,
    "highlights": [
        "No Atlas ticket changed status today. ATLAS-297 In Review; ATLAS-304, 354, 360 in progress.",
    ],
    "risks": [
        ["ATLAS-304 now due 31 Dec, beyond the sprint end (30 Nov)", "Epic spans next sprint", "Split into sprint-sized stories", "Saurabh Jain", "30 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-297, 354, 360 – 30 Nov 2026; CRM Kanban epic (ATLAS-304) – 31 Dec 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-304, 354 in progress", "No past-due items", "Progress ATLAS-354"],
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
        ["No Pulse sprint planned for November", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "27 Nov"],
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
        "No Conversation AI ticket changed status today. 18 Retrospective subtasks still in UAT past due (Ankit Saxena 8, Shivam Dhoundiyal 10).",
    ],
    "risks": [
        ["8 subtasks of closed stories UC-23, 408 still in UAT and past due", "Jira status inconsistent", "Close or re-date subtasks", "Ankit Saxena", "27 Nov"],
        ["10 dashboard/Comm Hub subtasks in UAT past due; UC-68 not started", "UAT backlog", "Close UAT; re-plan UC-68", "Shivam Dhoundiyal / Ankit Saxena", "27 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories – 30 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-59 UAT; UC-70 in progress; UC-68 To Do; 8 UAT subtasks", "9 past due", "Close UC-23, 408 subtasks"],
        ["Shivam Dhoundiyal", "UC-423 UAT; UC-428 in progress; 10 subtasks UAT; USP-4512", "11 past due", "Close UAT"],
        ["Nareddy Shiva Prasad Reddy", "UC-170 In Dev; UC-174 in progress", "No past-due items", "Progress UC-170"],
    ],
    "mgmt": [],
    "focus": [
        "Close UAT subtasks under UC-23 and UC-408.",
        "Close dashboard (UC-403–422) and Comm Hub (UC-424–427) UAT.",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "Meeting cancellation/reschedule emails (AFVU-498) and missing Join Meeting button (AFVU-505, S2) started – Yash Janeshwar. Production DB set-up (AFVU-495) still unassigned, past due since 23 Nov.",
    ],
    "risks": [
        ["GPUaaS AFVU-214, 259–262 and DSX POD price (AFVU-352) past due", "GPUaaS release not ready", "Finish before switch-on (AFVU-480)", "Anshul Bhargava", "27 Nov"],
        ["AFVU-495 (past due) and AFVU-489 unassigned", "Release prep and bug unowned", "Assign both", "Anshul Bhargava", "27 Nov"],
    ],
    "deps": [
        ["DSX POD real price (AFVU-352)", "Open", "DSX POD go-live", "Business", TBC],
    ],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint – 29 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-480 started; AFVU-214, 259, 260, 262, 352 open", "5 past due", "Finish GPUaaS items"],
        ["Aman prakash", "AFVU-490 closed; AFVU-261 in progress", "1 past due", "Close AFVU-261"],
    ],
    "mgmt": [
        "Assign AFVU-495 and AFVU-489; rebalance GPUaaS work off Anshul Bhargava.",
    ],
    "focus": [
        "Assign and start production DB set-up (AFVU-495).",
        "Finish GPUaaS hardening (AFVU-214) and AFVU-259–262.",
    ],
})
