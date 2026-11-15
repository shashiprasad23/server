TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 15 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "No Marketplace ticket updated today (go-live day).",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 12 tickets – 6 Done, 3 In Progress, 1 Dev, 1 Code Review, 1 To Do.",
    ],
    "risks": [
        ["Go-live checklist (MT-1770), footer CMS (MT-1771) and FAQ 404 (MT-1780) past due 13 Nov; go-live 15 Nov", "Go-live readiness at risk", "Record go/no-go outcome", "Naman Bapna / Naveen Jangid", "16 Nov"],
        ["12 V1.4 design subtasks past due (4–13 Nov), most in Dev; MT-1784 in Code Review since 6 Nov", "V1.4 not ready for go-live", "Prioritise go-live scope", "Naveen Jangid / Nagamuni Valluri", "16 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Go-live – today, 15 Nov 2026; V1.4 design (MT-1747) – 16 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1784 Code Review; 7 V1.4 subtasks open; MT-1780 To Do", "Over-allocated; 9 past due", "Close MT-1784, MT-1780"],
        ["Nagamuni Valluri", "MT-1763, 1764, 1768, 1769 in Dev", "4 past due", "Move to testing"],
        ["Naman Bapna", "MT-1778, 1841 closed; MT-1770 in progress", "Go-live checklist past due", "Close MT-1770"],
    ],
    "mgmt": [
        "Confirm today's go-live outcome; MT-1770, 1771, 1780 still open in Jira.",
    ],
    "focus": [
        "Close MT-1770, MT-1780 and MT-1784 before go-live.",
    ],
})

project({
    "name": "2. Web Marketing (MR)",
    "break": True,
    "highlights": [
        "No Marketing ticket updated today. Contact page fixes (MR-1484) and PR review (MR-1459, Saurabh Jain) passed their 14 Nov due date.",
    ],
    "risks": [
        ["V1.2 design (MR-1379, 1411) and v1.3 Kimi page (MR-1470) past due; 18 page/Kimi subtasks open", "Marketing redesign launch slipping", "Re-plan into next sprint", "Kunal Jangid", "16 Nov"],
        ["9 items Ready for Prod awaiting release (MR-1073, 1454 since 30 Oct)", "Done work not live", "Schedule release", "Vishnu kumar yadav", "16 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sprint end – today, 15 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1379, 1411, 1470, 1476, 1477 in progress; MR-1362 + 14 page subtasks in Code Review", "Over-allocated; 8 past due", "Clear Code Review queue"],
        ["Vishnu kumar yadav", "9 items Ready for Prod; MR-1460, MT-1771, 1792 open", "8 past due, mostly awaiting release", "Release batch"],
    ],
    "mgmt": [
        "Decide the carry-over of V1.2/Kimi work and close the duplicate MR-1379 or MR-1411.",
    ],
    "focus": [
        "Release Ready for Prod batch (MR-1073, 1454, 1409, 1410, 1468, 1469, 1475, 1483, 1530, 1531).",
        "Clear Code Review queue for V1.2 pages.",
    ],
})

project({
    "name": "3. Web USP – Uvation Services Platform (USP)",
    "break": True,
    "highlights": [
        "Tested in UAT, ready for production: engineer-initiated chat (USP-4305), service requests follow the customer team (USP-4428) and the seat-claim security fix (USP-4369). Subscription lifecycle epics USP-3482 and USP-4374 closed.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do, due today", "Document flows fail for customers", "Fix or re-plan explicitly", "Cășvan Marcel", "16 Nov"],
        ["Comm Hub subtasks USP-4310, 4311 past due since 11 Oct", "Stale plan", "Re-date or close", "Silviu Oltean", "16 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sprint end and UAT sign-off – 15 Nov 2026"),
    ],
    "resources": [
        ["Livian Stefan Stan", "9 items in UAT/Staging; USP-4295, 4329, 4435 in progress; USP-4466 Dev", "Strong throughput", "Support UAT"],
        ["Silviu Oltean", "USP-4252, 4305, 4331, 4428, 4441 in UAT/Staging; USP-4302 in progress", "3 past-due subtasks", "Re-date USP-4310, 4311"],
        ["Cășvan Marcel", "USP-4369 in UAT/Staging; USP-3783 in progress; USP-4231 (S1) To Do", "S1 not started", "Start USP-4231"],
    ],
    "mgmt": [
        "Confirm whether S1 USP-4231 carries into the next sprint.",
    ],
    "focus": [
        "Release the 3 UAT-tested items; finish UAT on the remaining 11.",
        "Start S1 fix USP-4231.",
    ],
})

project({
    "name": "4. Web Identity (ID)",
    "break": True,
    "highlights": [
        "No Identity ticket updated today.",
        "Sprint status (Nov 1st Sprint, 2–15 Nov): 7 tickets – 6 Done, 1 Ready for Prod. Retrospective: ID-736 Ready for Prod (due 30 Oct).",
    ],
    "risks": [
        ["ID-736 Ready for Prod since 30 Oct; ID-773 also awaiting release", "Not released", "Release both", "Yash Janeshwar", "16 Nov"],
    ],
    "deps": [],
    "milestones": [],
    "resources": [
        ["Saravana Kumar", "ID-777 closed; sprint work complete", "On track", "Plan next sprint (ID-779–782)"],
        ["Yash Janeshwar", "ID-736, ID-773 Ready for Prod", "1 past due awaiting release", "Release ID-736, 773"],
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
        "No Atlas ticket updated today. Sprint ended 14 Nov: 7 tickets – 5 Done, 2 To Do; not yet closed in Jira.",
    ],
    "risks": [
        ["CRM Kanban epic (ATLAS-304) not started, due 13 Nov; sprint ends today", "Carry-over", "Move to next sprint", "Saurabh Jain", "16 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-297 – 30 Nov 2026; pilot enablement (ATLAS-354) – 30 Nov 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-304 To Do; MR-1459 PR review past due", "5 of 7 sprint items done", "Re-plan ATLAS-304"],
        ["Nagamuni Valluri", "ATLAS-297 To Do (30 Nov)", "Moved out of sprint window", "Move to next sprint"],
    ],
    "mgmt": [
        "Close the Atlas sprint and plan the next one (ATLAS-297, 304, 354).",
    ],
    "focus": [
        "Close the sprint; carry ATLAS-304 and ATLAS-297.",
    ],
})

project({
    "name": "6. Uvation Pulse (PULSE)",
    "break": True,
    "highlights": [
        "No November Pulse sprint in Jira. October 2nd Sprint (still open): 3 tickets – 3 Done.",
    ],
    "risks": [
        ["No next Pulse sprint planned", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "16 Nov"],
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
        "No Conversation AI ticket updated today; RFQ (UC-23), CSM dashboard (UC-402), lead capture (UC-57) and SLA fallback (UC-69) remain in UAT.",
    ],
    "risks": [
        ["4 Ready for Prod chatbot fixes (UC-413, 414, 418 past due; UC-420) not released", "Fixes not live", "Release", "Ankit Saxena", "16 Nov"],
        ["UC-23, 57, 68, 69, 408 past due (11–13 Nov); handoff routing (UC-68) not started", "Sprint goals slipping", "Finish UAT; re-plan UC-68", "Ankit Saxena / Nareddy Shiva Prasad Reddy", "16 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sprint end – today, 15 Nov 2026; Teams support desk UI (UC-261) – 16 Nov 2026"),
    ],
    "resources": [
        ["Ankit Saxena", "UC-19, 23 UAT; UC-408 in progress; UC-68 To Do; 3 fixes Ready for Prod", "7 past due", "Release fixes; re-plan UC-68"],
        ["Nareddy Shiva Prasad Reddy", "UC-57, 60, 69, 421 UAT Testing; UC-420 Ready for Prod", "3 past due, all in UAT", "Close UAT"],
        ["Shivam Dhoundiyal", "UC-402 and 6 dashboard subtasks in UAT; UC-340 in progress", "7 past due", "Close UAT; re-date"],
    ],
    "mgmt": [
        "Approve a production release for UC-413, 414, 418, 419, 420.",
    ],
    "focus": [
        "Release Ready for Prod chatbot fixes.",
        "Close UAT on UC-23, 57, 69, 402.",
    ],
})

project({
    "name": "8. AI Factory Visualise – USP (AFVU)",
    "break": True,
    "highlights": [
        "GPUaaS access and single sign-on (AFVU-211) closed with B2C/Rafay policy (AFVU-228); GPU console sign-in history on the Activity tab built (AFVU-312, 334), QA (AFVU-313) pending. GPUaaS end-to-end test and release rehearsal (AFVU-224, 225) in progress.",
    ],
    "risks": [
        ["GPUaaS hardening and release (AFVU-214) past due since 30 Oct; E2E test and rehearsal under way", "GPUaaS not release-ready", "Re-date and finish", "Anshul Bhargava", "16 Nov"],
        ["Several stories closed with work left (e.g. DSX real price, Book a Meeting IT setup and release)", "Remaining work not tracked", "Raise follow-up tickets", "Anshul Bhargava", "16 Nov"],
    ],
    "deps": [
        ["DSX POD real price; IT Graph app setup (AFVU-366)", "Open", "DSX POD and Book a Meeting release", "Business / IT", TBC],
    ],
    "milestones": [
        ("Key milestone:", "November 1st Sprint subtasks – 15–16 Nov 2026"),
    ],
    "resources": [
        ["Anshul Bhargava", "AFVU-211 closed; AFVU-214 (224, 225), 262 in progress; USP-4438 Code Review", "Last Retrospective item open", "Finish AFVU-214"],
        ["r.jaiswal", "AFVU-476 in progress; AFVU-386, 414, 417 closed", "QA load", "Confirm AFVU-476"],
    ],
    "mgmt": [
        "Confirm AFVU-476 by-design decision.",
    ],
    "focus": [
        "Finish GPUaaS hardening (AFVU-214); confirm AFVU-476.",
    ],
})
