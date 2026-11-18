TBC = "TBC"
title_p = doc.add_paragraph(); _r = title_p.add_run("Daily Sprint Status Report"); _r.bold = True; _r.font.size = Pt(16)
doc.add_paragraph().add_run("Date: 18 Nov 2026  |  Current sprint & Retrospective").italic = True

project({
    "name": "1. Web Marketplace (MT)",
    "highlights": [
        "No Marketplace status change today. Sales Dashboard subtasks MT-1823 and MT-1824 (Naveen Jangid) passed their 16–17 Nov dates.",
        "Nov 2nd Sprint (16–29 Nov): 4 stories, all in progress. Retrospective: go-live checklist (MT-1770), FAQ 404 (MT-1780) and V1.4 design (MT-1747, due 16 Nov) still open.",
    ],
    "risks": [
        ["Production FAQ 404 (MT-1780) still not started; go-live checklist (MT-1770) open", "Customers hit missing pages", "Fix MT-1780; close MT-1770", "Naveen Jangid / Naman Bapna", "19 Nov"],
        ["V1.4 design (MT-1747) past due 16 Nov with 12 subtasks open", "Redesign slipping", "Re-plan into sprint", "Naveen Jangid", "19 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Sales Dashboard (MT-1822) – 27 Nov 2026; Store Credit/RMA and AI Agent connector – 30 Nov 2026"),
    ],
    "resources": [
        ["Naveen Jangid", "MT-1747, 1822, 1823 in progress; MT-1780, 1824 To Do", "4 past due", "Fix MT-1780"],
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
        "About page fixes (MR-1477) closed; Kimi page (MR-1470), chatbot card fix (MR-1467) and Contact page (MR-1484) moved to Ready for Prod. Production issues (MR-1547) in progress.",
        "New: continuous design implementation from Figma/business feedback (MR-1556, Kunal Jangid, due 30 Nov). Klaviyo hardening subtasks MR-1489, 1490 in Dev, due 17 Nov.",
    ],
    "risks": [
        ["Kimi page, chatbot card and Contact fixes Ready for Prod but past due; async ticket fallback (MR-1476) still in UAT", "Remaining redesign items not live", "Release; close UAT", "Kunal Jangid / Kannan Elangovan", "19 Nov"],
        ["Production issues (MR-1547) have no due date", "Live-site defects untracked by date", "Set a due date", "Vishnu kumar yadav", "19 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "Nov 2nd Sprint stories (MR-1488, 1498, 1504, 1510) – 30 Nov 2026"),
    ],
    "resources": [
        ["Kunal Jangid", "MR-1477 closed; MR-1467, 1470, 1484 Ready for Prod; MR-1476 UAT; MR-1498, 1556 in progress", "5 past due", "Release batch"],
        ["Vishnu kumar yadav", "MR-1488 (1489, 1490 in Dev); MR-1547 in progress", "2 past due", "Close MR-1489, 1490"],
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
        "Closed: BAU (USP-4435), Contract Proposal signing front end (USP-4451) and coming-soon catalogue state (USP-4466). Comm Hub tenant switch (USP-4470) past due 17 Nov.",
        "Nov 1st Sprint still open (2 items); Nov 2nd Sprint (16–30 Nov) still not started in Jira.",
    ],
    "risks": [
        ["S1 Document API 502 (USP-4231) still To Do in the unstarted Nov 2nd Sprint", "Document flows fail in production", "Start sprint; fix first", "Cășvan Marcel", "19 Nov"],
        ["Hub notifications (USP-4302), Book a Meeting (USP-4438) and tenant switch (USP-4470) past due", "Carry-over", "Close or move", "Silviu Oltean / Anshul Bhargava", "19 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "First 45 days ends today, 18 Nov 2026; Nov 2nd Sprint – 30 Nov 2026"),
    ],
    "resources": [
        ["Livian Stefan Stan", "USP-4435, 4451, 4466 closed; USP-4464, 4465, 4467 next", "No past-due items", "Start Nov 2nd items"],
        ["Silviu Oltean", "USP-4302, 4470 in progress", "2 past due", "Close USP-4470"],
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
        "New: SendGrid onboarding template ID and password reset link (ID-784, Yash Janeshwar) in Dev. ID-781, 782, 783 in progress; ID-779, 780 To Do.",
    ],
    "risks": [],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ID-779 to ID-784 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saravana Kumar", "ID-781, 782, 783 in progress; ID-779, 780 To Do", "Carries 5 of 6 sprint items", "Sequence ID-780"],
        ["Yash Janeshwar", "ID-784 in Dev; AFVU-497, 498 To Do", "Split across ID and AFVU", "Close ID-784"],
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
        "Playwright UI testing (ATLAS-297, Nagamuni Valluri) started. ATLAS-354, 360 To Do; Retrospective ATLAS-304 To Do.",
    ],
    "risks": [
        ["Pilot enablement (ATLAS-354) not started; CRM Kanban epic (ATLAS-304) past due 13 Nov", "Pilot slipping", "Start ATLAS-354; re-date ATLAS-304", "Saurabh Jain", "19 Nov"],
    ],
    "deps": [],
    "milestones": [
        ("Key milestone:", "ATLAS-297, 354, 360 – 30 Nov 2026"),
    ],
    "resources": [
        ["Saurabh Jain", "ATLAS-354 To Do; ATLAS-304, MR-1459 past due", "2 past due", "Start ATLAS-354"],
        ["Nagamuni Valluri", "ATLAS-297 in progress; ATLAS-360 To Do", "On track", "Start ATLAS-360"],
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
        ["No Pulse sprint planned for November", "Pulse work not scheduled", "Plan next sprint", "Naveen Jangid", "19 Nov"],
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
        "Lead capture CTA (UC-57), SLA fallback (UC-69) and Connect with Agent fix (UC-421) moved to Ready for Prod (Nareddy Shiva Prasad Reddy). Comm Hub UI subtasks UC-424, 425 passed 17 Nov.",
        "Nov 2nd Sprint (16–29 Nov): UC-59, 170, 423 in progress; UC-70, 174, 428 To Do.",
    ],
    "risks": [
        ["6 items Ready for Prod and not released (UC-413, 414, 418 since 2–4 Nov; UC-57, 69, 421)", "Fixes not live", "Release", "Ankit Saxena", "19 Nov"],
        ["9 Retrospective stories/subtasks in UAT past due; handoff routing (UC-68) not started", "UAT backlog", "Close UAT; re-plan UC-68", "Ankit Saxena / Shivam Dhoundiyal", "19 Nov"],
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
        "Closed: S3 Summary step page-not-found (AFVU-360, Anshul Bhargava) and Download Proposal PDF fix (AFVU-479, Aman prakash).",
        "New: production DB set-up with migrations and seed data (AFVU-495, due 23 Nov, unassigned); Book a Meeting notification bugs AFVU-497, 498 (Yash Janeshwar).",
    ],
    "risks": [
        ["GPUaaS hardening (AFVU-214) and 4 GPUaaS stories (AFVU-259–262) past due; DSX POD real price (AFVU-352) open", "GPUaaS release not ready", "Finish before switch-on (AFVU-480)", "Anshul Bhargava", "19 Nov"],
        ["Production DB set-up (AFVU-495) and AFVU-489 unassigned", "Release prep and bug unowned", "Assign both", "Anshul Bhargava", "19 Nov"],
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
