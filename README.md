# ATLAS-I: AI-native internal sales CRM

ATLAS-I runs Uvation's AI-server sales pipeline with AI agents doing the routine work and people approving anything binding. It is the internal first phase of Project ATLAS; the requirements, FRS, SRS, roadmap and sprint plan are in the [ATLAS-I requirements doc](https://claude.ai/code/artifact/b406178a-7da6-4004-a619-850d2cb3f701).

This repository holds the **foundation release**: the platform every later sprint builds on, plus the first two governed agents.

| Area | What is here | Requirements |
| --- | --- | --- |
| Data model | Accounts, contacts, leads, opportunities with AI-server fields, activities, tasks; tenant isolation by Postgres row-level security | FR-CORE-01..03 |
| Flexibility | Custom fields defined at runtime, configurable pipeline stages with named entry gates, JSON tenant settings for capture and routing rules | FR-CORE, FR-CH-04 |
| Channel pipeline | Signed webhooks for Uvation Marketplace, USP, Outlook, Teams and WhatsApp; normalise, privacy rules, identity match, map to records, one timeline | FR-CH-01..08, FR-CAP-01..04, 07..10, 12 |
| Governed agents | Agent identities and scopes, reversibility classes, confidence thresholds, approval queue, audit trail, rollback, kill switch, daily caps, AI usage metering | FR-AI-01..07, 09 |
| Built-in agents | Capture agent (fills deals from emails, chats, calls and transcripts with cited quotes); Inbound SDR agent (explainable scoring, routing, drafted first reply) | FR-CAP-07, FR-LEAD-02..05 |
| NetSuite boundary | No sales transactions stored (guardrail rejects or strips them), NetSuite reference fields editable only by Finance, manual close flow, adapter interface for the later integration | FR-NS-01..06 |
| Compliance gate | Only Trade Compliance can clear a deal; Closed won needs clearance plus a NetSuite sales order or Marketplace order reference | FR-CMP-04, FR-PIPE-01 |
| Web app | Pipeline board, opportunity drawer with field sources and quotes, accounts with timeline, approvals, agents and audit trail, channel simulator | |

Not built yet (later sprints, per the sprint plan): configurator, supply and deal registration, quoting and proposals, forecasting, renewals, restricted-party screening service, the live Microsoft Graph connector process, Entra ID SSO, and the NetSuite adapter.

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
                  agents (capture, inbound SDR) ──► policy engine
                                    │            execute │ queue │ block
                                    ▼                    ▼
                         audit trail + rollback     approval queue
                                    │
                     outbound queue (undo window) ──► Outlook (Graph)
```

- `apps/api`: NestJS + PostgreSQL 16 (plain SQL migrations, `pg`), zod validation, Anthropic SDK behind an LLM gateway.
- `apps/web`: React + Vite.
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

Sign in with one of the seeded users (development sign-in), open **Channel simulator** and send a Marketplace RFQ, an Outlook email and a Teams transcript. Then watch the pipeline, the approvals queue and the agents' audit trail.

Or with Docker: `docker compose up --build`, then open http://localhost:8080. The compose file and Dockerfiles are written but have not yet been built in CI.

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

## Extending it

- **Custom field**: `POST /v1/metadata/fields` (admin). Transaction-like keys are refused.
- **Stage or gate**: edit `pipeline_stages`; gate rules are named in `apps/api/src/records/stage-rules.ts`.
- **Agent**: add a definition (scope, templates, threshold, reviewer) to `agents/agent-definitions.ts`, subscribe to an event, and call `AgentRuntime.propose()`. The runtime handles policy, audit, approvals and rollback.
- **Channel**: add a source to `ingestion/normalized-event.ts`, a schema and mapping in `normalizers.ts`, and a secret in config.
- **NetSuite**: implement `FinanceSystemAdapter` (`adapters/finance-system.adapter.ts`) and bind it in `app.module.ts`; the close flow switches to automatic.

## Tests

```bash
createdb -U postgres -O atlas atlas_test
npm test
```

Unit tests cover the policy engine, the transaction guardrail, capture rules, extraction and scoring. End-to-end tests run the real app against Postgres: ingestion and identity, idempotency, privacy skips and redaction, agent scoring with citations, approval and sending, rollback with conflict detection, human corrections never overwritten, the kill switch, custom fields, field-level security, optimistic locking, the compliance and NetSuite close gate, Marketplace order stripping, tenant isolation, and validation.
