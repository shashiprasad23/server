# Unified Enterprise Project Management Platform

One work record for delivery and service work, universal ticket-level time capture, resource capacity kept
separate from actuals, and AI meeting notes that only become work after a person approves them.

Built from the *PRD / FSD / Architecture v1.0* and the *UX Blueprint* (screens 01–08).

| Layer | Choice |
|---|---|
| Backend | Python 3.12+ · FastAPI · SQLAlchemy 2 · Alembic — modular monolith (`backend/app/modules/*`) |
| Database | PostgreSQL 16 (append-only audit enforced by trigger) |
| Background | In-process or standalone worker: transactional outbox, AI processing, SLA sweeps, Teams delivery |
| Frontend | React 18 · TypeScript · Vite · TanStack Query, styled from the blueprint (IBM Plex) |
| Identity | Microsoft Entra ID / OIDC bearer tokens in production; persona sign-in for local development |
| AI | Pluggable provider: local heuristic extractor (default, offline) or Ollama; output grounded and schema-validated |

## Run it locally

Prerequisites: Python 3.12+, Node 20+, PostgreSQL 16.

```bash
# 1. database
createuser -s upm --pwprompt        # password: upm (or set UPM_DATABASE_URL)
createdb -O upm upm

# 2. backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m app.seed --reset           # migrate + load the demo organization
uvicorn app.main:app --port 8000     # API docs at http://localhost:8000/api/docs

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                          # http://localhost:5173 (proxies /api to :8000)
```

Or with Docker: `docker compose up --build`, then `docker compose run --rm seed` for demo data, and open
http://localhost:8000 (the image serves the built web app and the API together).

## Demo personas

Sign in on the login screen by choosing a persona. Each has different scoped roles:

| Persona | Role | Try |
|---|---|---|
| S. Prasad | Contributor (Web Portal, Checkout v2), service agent (Application Support) | My work, Log Work on any ticket, submit the week, request an amendment |
| R. Iyer | Web Portal project manager, time approver, AI reviewer | Approvals queue, board and sprints, meeting review and approval |
| K. Osei | Checkout v2 project manager | Separate approver: sees only Checkout time |
| L. Fernandes | Application Support service owner and approver | Service queue, change approval, SLA timeline |
| N. Kapoor | Resource manager | Capacity planner, allocations, leave |
| E. Grant | Executive viewer | Aggregate reports without ticket-level detail |
| Platform Admin | Platform administrator | Roles, feature flags, calendars, integrations health, audit log |

## End-to-end workflow

1. **Plan**: a project manager creates work items (epic → story → sub-task hierarchy enforced), plans a sprint and starts
   it. Starting the sprint checks required estimates and locks the original estimate as the baseline.
2. **Deliver**: the board runs workflow transitions with validators (estimate before active work, approved change and
   rollback plan before closing a change, post-incident review for Sev 1/2).
3. **Log Work**: the same panel on every ticket type captures date, duration, activity, description and remaining-estimate
   handling. Each submission carries an idempotency key, so retries never duplicate it, and logging never changes status.
4. **Timesheet**: the week view groups time by project and ticket, flags missing time against the work calendar, and
   submits one timesheet that each project's approver decides separately. Rejections need a reason. Approved entries
   change only via an amendment, which keeps the original. Locked periods need an audited, privileged reopen.
5. **Resources**: net capacity = calendar − leave − holidays − reserved time. Allocations (hours or %, tentative or
   confirmed) and actuals are stored and shown as separate measures. Conflicts cover over-allocation, leave and holiday
   clashes, and skills gaps.
6. **Meetings**: import a Teams transcript (Graph), upload a VTT/TXT/audio file, or paste text. AI produces a summary,
   decisions, risks, open questions and proposed actions, each citing transcript evidence. Owners and dates stay
   *Unassigned / Not stated* unless the transcript says them. A reviewer edits, approves or rejects each one. Approval
   creates or updates a ticket exactly once, linked to the meeting segment.
7. **Service**: published catalog offerings with dynamic forms raise requests, incidents and changes. SLA timers pause
   only in configured statuses, and every start, pause, resume, breach and escalation is audited.
8. **Report**: estimate vs actual (hierarchy, each entry counted once), timesheet compliance, project health, service
   performance, AI actions and quality. Each report shows its policy, time zone and refresh time, and exports to CSV
   (exports are audited).

`e2e/workflow.cjs` drives this whole flow through the browser across five personas
(`node e2e/workflow.cjs`, with the API on :8000 freshly seeded and the web app on :5173).

## Architecture notes

```
backend/app
├── core/            errors, auth (dev + OIDC/JWKS), access rules, audit + outbox, idempotency, storage
├── modules/
│   ├── identity/    users, org, project memberships (roles are per project)
│   ├── work/        projects, work items, hierarchy, workflow + validators, links, comments, history
│   ├── time/        time entries, timesheet periods, approvals, amendments, locks   (FSD C4)
│   ├── agile/       sprints, scope-change audit, board, burndown                    (C5)
│   ├── resources/   calendars, leave, profiles, allocations, capacity + conflicts   (C6)
│   ├── service_desk/ catalog, SLA policies and timers, escalation                   (C7)
│   ├── meetings/    transcript parsing, AI providers + grounding, review, Graph adapter (C8, C9)
│   ├── reporting/   read models + CSV export                                         (C10)
│   ├── search/ notifications/ admin/ integrations/                                  (C9, C11, C12)
├── worker.py        outbox dispatch with retry/dead-letter, AI jobs, SLA sweep, Teams delivery
└── seed.py          demo organization mirroring the blueprint scenario
```

- **Consistency**: business changes, their audit event and their outbox event are written in one transaction (D6).
- **Idempotency**: Log Work requires `Idempotency-Key`. Ticket creation, service requests, meeting import and AI
  decisions accept it, and replays return the original response. Time entries also have a DB uniqueness backstop.
- **Concurrency**: work items and time entries use optimistic versioning (`version` / `If-Match`). A stale write
  gets `409 version_conflict`.
- **Authorization**: enforced server-side on every API and background path. Unauthorized records return 404 so IDs
  aren't disclosed. Search and meeting links never widen access.
- **Errors**: always `{code, message, correlationId, errors}`, and every response echoes `X-Correlation-ID`.

## Configuration

See `backend/.env.example`. Key switches:

- `UPM_AUTH_MODE=oidc` with `UPM_OIDC_ISSUER/AUDIENCE/JWKS_URL`: required when `UPM_ENVIRONMENT=production`
  (the app refuses to start with dev sign-in or default secrets in production).
- `UPM_AI_PROVIDER=ollama` with `UPM_OLLAMA_URL/MODEL`: use a local LLM. The default `heuristic` provider runs
  offline and labels itself as such in the model metadata.
- `UPM_GRAPH_*`: enable Teams transcript import. Without them, Teams import answers `503 teams_not_configured` and
  file upload remains available.
- Audio upload transcribes with `faster-whisper` if it's installed on the worker (licence review pending, so it's
  not a default dependency).

## Tests

```bash
cd backend && pytest -q        # 72 tests: unit + integration on a real PostgreSQL
cd frontend && npm run build   # typecheck + production build
```

The integration suite covers every FSD F4 mandatory scenario:
- time logged on all nine ticket types
- hierarchy totals counting each entry once
- idempotent retries
- date-window and locked-period rejection
- edits vs amendments
- approvals that update reports exactly once and are audited
- capacity recalculation after over-allocation, leave and calendar changes
- permission-limited meeting import and search
- no fabricated owners or dates
- no duplicate tickets on approval replay
- AI timeout / malformed output recovery with alerting
- meeting notes unreachable through linked tickets

It also covers SLA pause/resume/breach, the append-only audit trigger, outbox dead-lettering and replay, webhook
signatures and dedupe, CSV formula neutralisation, and a concurrency regression test.

## Not yet built (planned)

- **Live Teams integration**: the Graph transcript adapter is written but untested without a tenant.
- **Azure DevOps sync**: field ownership needs agreeing before bidirectional sync (FSD G3). Webhook intake and the
  mapping tables are in place.
- **Semantic search**: Qdrant isn't used. Search is permission-filtered PostgreSQL matching, as the FSD recommends
  for MVP.
- **Live meeting features and configurable portfolio dashboards**: P2 in the PRD.
