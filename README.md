# ATLAS-I: AI-native internal sales CRM

ATLAS-I runs Uvation's AI-server sales pipeline with AI agents doing the routine work and people approving anything binding. It is the internal first phase of Project ATLAS; the requirements, FRS, SRS, roadmap and sprint plan are in the [ATLAS-I requirements doc](https://claude.ai/code/artifact/b406178a-7da6-4004-a619-850d2cb3f701).

This repository holds the platform plus the end-to-end sales modules from the requirements doc: capture, CPQ for AI servers, supply and deal registration, export compliance, deal coaching, forecasting, renewals and Ask-the-CRM, all run by governed agents.

| Area | What is here | Requirements |
| --- | --- | --- |
| Data model | Accounts, contacts, leads, opportunities with AI-server fields, activities, tasks; tenant isolation by Postgres row-level security | FR-CORE-01..03 |
| Flexibility | Custom fields defined at runtime, configurable pipeline stages with named entry gates, JSON tenant settings for capture and routing rules | FR-CORE, FR-CH-04 |
| Channel pipeline | Signed webhooks for Uvation Marketplace, USP, Outlook, Teams and WhatsApp; normalise, privacy rules, identity match, map to records, one timeline | FR-CH-01..08, FR-CAP-01..04, 07..10, 12 |
| Governed agents | Agent identities and scopes, reversibility classes, confidence thresholds, approval queue, audit trail, rollback, kill switch, daily caps, AI usage metering | FR-AI-01..07, 09 |
| Built-in agents | Capture agent (fills deals from emails, chats, calls and transcripts with cited quotes); Inbound SDR agent (explainable scoring, routing, drafted first reply) | FR-CAP-07, FR-LEAD-02..05 |
| NetSuite boundary | No sales transactions stored (guardrail rejects or strips them), NetSuite reference fields editable only by Finance, manual close flow, adapter interface for the later integration | FR-NS-01..06 |
| Compliance gate | Only Trade Compliance can clear a deal; Closed won needs clearance plus a NetSuite sales order or Marketplace order reference | FR-CMP-04, FR-PIPE-01 |
| CPQ | Illustrative AI-server catalogue and price-list import; configurator that builds a valid BOM (servers, InfiniBand/Ethernet fabric, optics, storage, racks, PDUs, NVIDIA AI Enterprise, services, support) from GPUs, cooling and kW per rack; versioned quotes with freight, margin and an approval matrix; printable proposal without cost or margin; publish to Marketplace, USP or email | FR-CPQ-01..10 |
| Supply and deal registration | Stock net of other deals' holds with alternatives, time-boxed holds, OEM deal registrations, supply vs weighted demand by GPU and quarter | FR-SUP-01..05 |
| Site readiness and delivery | Power, cooling and access checks with a hosting offer when the site cannot take the configuration, presales tasks, mutual action plan | FR-DC-01..04 |
| Export compliance | Automatic restricted-party screening (fuzzy name match), embargo and licence-review destinations, classification on quote lines, red-flag scan of customer messages, end-user statements, Trade Compliance decision | FR-CMP-01..06 |
| Deal coach agent | Explainable risk score, win probability and next best actions per deal; account health from tickets, RMAs and engagement | FR-PIPE-03/05, FR-CS-03 |
| Quote and renewal agents | Draft the BOM, quote and OEM registration when a deal reaches solution design; open renewals 120 days before support or licences end; flag ageing GPUs for refresh | FR-CPQ, FR-CS-01..04 |
| Forecast and insights | AI forecast with a range against the rep call, by rep, GPU and channel; deal inspection; revenue-leak finder; weekly summary; dashboard KPIs | FR-FCST-01..06, FR-AN |
| Ask ATLAS | Plain-English questions become a pipeline filter (Claude structured output, rules offline), with cited deals | FR-AI-10 |
| Web app | Magic UI bento dashboard, pipeline board, deal drawer (brief, requirement sheet with evidence, configure and quote, compliance, site and plan, history), accounts, quotes, supply, compliance queue, forecast, renewals, approvals, tasks, agents, channel simulator, settings; light and dark themes | |

Not built yet (later sprints, per the sprint plan): the live Microsoft Graph connector process, Entra ID SSO, live OEM and distributor feeds, a licensed restricted-party list service, and the NetSuite adapter. Catalogue prices, restricted parties and compliance rules in the seed are illustrative: Procurement and Trade Compliance must load and confirm the real ones.

## Architecture

```
Marketplace / USP / Outlook / Teams / WhatsApp
        │  signed webhooks (X-Atlas-Signature: sha256=HMAC(body))
        ▼
  ingestion ──► normalise ──► capture rules ──► identity match ──► map to records
                                                                     │
                     records engine (validation, field security, ◄───┘
                     transaction guardrail, stage gates, provenance)
                                    │ transactional outbox
                                    ▼
  agents (capture, SDR, quote, deal coach, renewal) ──► policy engine
                                    │            execute │ queue │ block
                                    ▼                    ▼
                         audit trail + rollback     approval queue
                                    │
                     outbound queue (undo window) ──► Outlook (Graph)
```

- `apps/api`: NestJS + PostgreSQL 16 (plain SQL migrations, `pg`), zod validation, Anthropic SDK behind an LLM gateway.
- `apps/web`: React + Vite, Tailwind CSS v4, and [Magic UI](https://magicui.design) components (MIT, vendored in `src/components/magicui`): bento grid, number ticker, border beam, magic card, animated list, marquee, shimmer button.
- People, agents and integrations all write through the same records engine, so every change gets the same checks and a provenance row (`field_provenance`: old value, new value, source, actor, agent action, confidence, evidence).

## Run it locally

Requirements: Node 20+, PostgreSQL 16.

```bash
# one-off: roles and database (owner role for migrations, non-superuser runtime role so RLS applies)
psql -U postgres -c "CREATE ROLE atlas LOGIN SUPERUSER PASSWORD 'atlas';"
psql -U postgres -c "CREATE ROLE atlas_app LOGIN PASSWORD 'atlas_app' NOSUPERUSER NOBYPASSRLS;"
createdb -U postgres -O atlas atlas_dev

npm install
cp apps/api/.env.example apps/api/.env
npm run migrate && npm run seed
npm run dev:api        # http://localhost:3000, OpenAPI at /docs
npm run dev:web        # http://localhost:5173
```

Sign in as **VP Sales** (development sign-in) and press **Load demo pipeline** on Home or in the Channel simulator: it creates deals across every stage, quotes, a compliance hit, a won deal with installed base near renewal, and a rep forecast call. Then open a deal from the pipeline, or send a Marketplace RFQ, an Outlook email or a Teams transcript from the simulator and watch the agents react. Switch persona (Deal Desk, Trade Compliance, Finance Ops) to see approvals, clearance and the NetSuite close from their side.

Or with Docker: `docker compose up --build`, then open http://localhost:8080. The stack has been built and run end to end with Docker 29 (Postgres 16, API, nginx-served web app).

### Using Claude for extraction

`LLM_PROVIDER=heuristic` (default) runs offline rules so everything works without a key. Set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` to use Claude (`LLM_MODEL`, default `claude-opus-5-5`). The gateway uses structured outputs, prompt caching, the server-side refusal fallback, and records token usage per agent in `llm_usage`. If the model is unavailable it falls back to the rules at low confidence, so actions built on it go to a person.

### Sending email for real

By default outbound mail is recorded, not sent. Set `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` and `GRAPH_DEFAULT_MAILBOX` to send through Microsoft Graph from the rep's mailbox. Messages wait `OUTBOUND_UNDO_WINDOW_SECONDS` before delivery so a rollback can still recall them.

### Deployment notes

- Run background workers (`WORKERS_ENABLED=true`) on one instance; the outbox dispatcher does not yet claim rows across instances. A Kafka or Event Hubs relay replaces it when the API scales out.
- In production `JWT_SECRET` must be set and `AUTH_DEV_TOKENS` must be off; the API refuses to start otherwise. Entra ID SSO replaces dev sign-in in the SSO sprint.

## Channel event contracts

`POST /v1/channel-events/{marketplace|usp|outlook|teams|whatsapp}`, signed with the per-source secret (`CHANNEL_SECRET_*`). Events are idempotent on their id; failed events are listed at `GET /v1/channel-events/failed` and replayed with `POST /v1/channel-events/{id}/replay`. Schemas are in `apps/api/src/ingestion/normalizers/normalizers.ts`; examples are in `apps/web/src/pages/Simulator.tsx`.

| Source | Types |
| --- | --- |
| Marketplace | `signup`, `rfq`, `custom_configuration`, `cart_abandoned`, `order_placed`, `web_chat`, `product_view` |
| USP | `signup`, `service_request`, `ticket`, `rma`, `contract_expiring`, `web_chat` |
| Outlook | `message` (user and shared mailboxes), `event` (calendar), as posted by the Graph connector |
| Teams | `chat_message`, `meeting_transcript`, `call_record` |
| WhatsApp | inbound message |

Privacy rules (`capture.rules` setting): internal-only threads, items marked private, excluded mailboxes (HR, legal, finance) and deny-listed domains are skipped, and card numbers in captured text are redacted. Order and payment details in portal payloads are stripped before storage.

## Main API

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /v1/records/{object}`, `GET/PATCH /v1/records/{object}/{id}` | CRUD for `accounts`, `contacts`, `leads`, `opportunities`, `activities`; `If-Match: <version>` for optimistic locking |
| `GET /v1/records/{object}/{id}/history` | Field history with sources, confidence and evidence |
| `GET /v1/timeline/accounts/{id}` | One timeline across channels and agent actions |
| `GET/POST /v1/metadata/fields`, `GET /v1/metadata/stages`, `GET/PUT /v1/metadata/settings/{key}` | Custom fields, stages, tenant settings |
| `GET /v1/approvals`, `POST /v1/approvals/{id}/approve or reject` | Approval queue (approve can carry an edited payload) |
| `GET /v1/agents`, `GET /v1/agents/actions`, `POST /v1/agents/actions/{id}/rollback`, `POST /v1/agents/{id}/kill or resume`, `PUT /v1/agents/{id}/overrides`, `GET /v1/agents/usage` | Agent governance |
| `POST /v1/opportunities/{id}/close-request`, `POST /v1/opportunities/{id}/close-confirm` | NetSuite-ready close flow (Finance confirms with the sales order ID) |
| `GET /v1/catalog`, `POST /v1/catalog/import` | Catalogue with free and held stock (cost visible to restricted roles only); price-list import |
| `POST /v1/opportunities/{id}/configure`, `GET /v1/opportunities/{id}/readiness`, `POST .../readiness/tasks` | BOM from the requirement sheet with supply per line; datacentre readiness |
| `GET /v1/supply/holds`, `POST /v1/opportunities/{id}/holds`, `DELETE /v1/supply/holds/{id}` | Stock holds |
| `GET /v1/deal-registrations`, `POST /v1/opportunities/{id}/deal-registrations`, `POST /v1/deal-registrations/{id}/submit or approve or reject` | OEM deal registration |
| `GET /v1/quotes`, `POST /v1/opportunities/{id}/quotes`, `GET /v1/quotes/{id}`, `POST /v1/quotes/{id}/submit, approve, reject, publish, accept, revalidate`, `GET /v1/quotes/{id}/proposal` | Quotes, approvals and the printable proposal |
| `GET/POST /v1/opportunities/{id}/milestones`, `POST .../milestones/default`, `PATCH /v1/milestones/{id}` | Mutual action plan |
| `GET /v1/compliance/queue`, `GET /v1/compliance/opportunities/{id}`, `POST .../screen`, `POST .../eus/request or receive`, `POST .../decision` | Export compliance |
| `GET /v1/insights/dashboard, forecast, supply-demand, leaks, inspection, weekly-summary`, `POST /v1/insights/forecast/calls` | Dashboard, forecast and inspection |
| `POST /v1/ask`, `GET /v1/opportunities/{id}/insights`, `GET /v1/opportunities/{id}/brief`, `GET /v1/accounts/{id}/committee` | Ask ATLAS, deal score and brief, buying committee |
| `GET /v1/installed-base`, `POST /v1/agents/renewal_agent/run`, `POST /v1/agents/deal_coach/run`, `GET /v1/timeline/tasks`, `POST /v1/tasks/{id}/complete` | Renewals, agent runs, tasks |
| `POST /v1/dev/demo-data` | Development only: load the demo pipeline |

## Extending it

- **Custom field**: `POST /v1/metadata/fields` (admin). Transaction-like keys are refused.
- **Stage or gate**: edit `pipeline_stages`; gate rules are named in `apps/api/src/records/stage-rules.ts`.
- **Agent**: add a definition (allowed actions, writable fields, templates, threshold, reviewer) to `agents/agent-definitions.ts`, subscribe to an event, and call `AgentRuntime.propose()`. The runtime handles policy, audit, approvals and rollback.
- **Channel**: add a source to `ingestion/normalized-event.ts`, a schema and mapping in `normalizers.ts`, and a secret in config.
- **NetSuite**: implement `FinanceSystemAdapter` (`adapters/finance-system.adapter.ts`) and bind it in `app.module.ts`; the close flow switches to automatic.

## Tests

```bash
createdb -U postgres -O atlas atlas_test
npm test
```

Unit tests cover the policy engine, the transaction guardrail, capture rules, extraction, lead and deal scoring, the configurator, restricted-party matching and the question parser. End-to-end tests run the real app against Postgres: ingestion and identity, idempotency, privacy skips and redaction, agent scoring with citations, approval and sending, rollback with conflict detection, human corrections never overwritten, the kill switch, custom fields, field-level security, optimistic locking, the compliance and NetSuite close gate, Marketplace order stripping, tenant isolation, and validation; plus quotes and the approval matrix, holds, deal registration, the quote agent and its rollback, screening and red flags, demo data, the deal coach, forecast, Ask, leaks, renewals and installed base on win.
