-- ATLAS-I core schema.
-- Every tenant-owned table carries tenant_id and is protected by row-level security (see 002_rls.sql).
-- Sales transactions (orders, invoices, payments, settlements) are deliberately absent: they live in
-- Oracle NetSuite. ATLAS-I only keeps NetSuite reference IDs and status flags (FR-NS-01).

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  email       text NOT NULL,
  name        text NOT NULL,
  roles       text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

-- Metadata: custom fields per object (flexibility without schema changes).
CREATE TABLE field_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  object      text NOT NULL,
  key         text NOT NULL,
  label       text NOT NULL,
  type        text NOT NULL CHECK (type IN ('text','number','boolean','date','enum','json')),
  options     jsonb NOT NULL DEFAULT '[]',
  required    boolean NOT NULL DEFAULT false,
  restricted  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, object, key)
);

-- Metadata: configurable pipeline stages with named entry rules.
CREATE TABLE pipeline_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  key         text NOT NULL,
  label       text NOT NULL,
  position    int  NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false,
  is_won      boolean NOT NULL DEFAULT false,
  entry_rules text[] NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, key)
);

-- Metadata: tenant settings (routing, capture rules, thresholds) as JSON documents.
CREATE TABLE settings (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  key         text NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  name                  text NOT NULL,
  domain                text,
  industry              text,
  segment               text,
  hq_country            text,
  owner_id              uuid,
  channel_first_seen    text,
  netsuite_customer_id  text,
  credit_hold           boolean NOT NULL DEFAULT false,
  custom                jsonb NOT NULL DEFAULT '{}',
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX accounts_domain_uq ON accounts (tenant_id, lower(domain)) WHERE domain IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  account_id            uuid REFERENCES accounts(id),
  name                  text,
  email                 text,
  phone                 text,
  title                 text,
  committee_role        text,
  consent_status        text NOT NULL DEFAULT 'unknown',
  marketplace_user_id   text,
  usp_user_id           text,
  custom                jsonb NOT NULL DEFAULT '{}',
  version               int NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX contacts_email_uq ON contacts (tenant_id, lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  account_id      uuid REFERENCES accounts(id),
  contact_id      uuid REFERENCES contacts(id),
  opportunity_id  uuid,
  channel         text NOT NULL,
  source          text,
  status          text NOT NULL DEFAULT 'new',
  fit_score       int,
  intent_score    int,
  score_reasons   jsonb NOT NULL DEFAULT '[]',
  routed_to       uuid,
  summary         text,
  custom          jsonb NOT NULL DEFAULT '{}',
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE opportunities (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id),
  account_id                uuid REFERENCES accounts(id),
  primary_contact_id        uuid REFERENCES contacts(id),
  name                      text NOT NULL,
  type                      text NOT NULL DEFAULT 'hardware',
  channel                   text NOT NULL DEFAULT 'rep',
  stage_key                 text NOT NULL,
  owner_id                  uuid,
  workload                  text,
  gpu_model                 text,
  gpu_count                 int,
  node_count                int,
  oem                       text,
  expected_value            numeric(14,2),
  est_margin                numeric(14,2),
  recurring_value           numeric(14,2),
  currency                  text NOT NULL DEFAULT 'USD',
  quote_valid_until         date,
  expected_po_date          date,
  expected_ship_date        date,
  deployment_location       text,
  kw_per_rack               numeric(8,2),
  cooling                   text,
  end_user                  text,
  destination_country       text,
  compliance_status         text NOT NULL DEFAULT 'not_screened',
  order_reference           text,
  netsuite_sales_order_id   text,
  netsuite_status           text,
  probability               int,
  ai_probability            int,
  risk_score                int,
  closed_at                 timestamptz,
  lost_reason               text,
  custom                    jsonb NOT NULL DEFAULT '{}',
  version                   int NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);
CREATE INDEX opportunities_account_idx ON opportunities (tenant_id, account_id);

CREATE TABLE channel_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  source        text NOT NULL,
  type          text NOT NULL,
  external_id   text NOT NULL,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','skipped','failed')),
  skip_reason   text,
  error         text,
  attempts      int NOT NULL DEFAULT 0,
  linked        jsonb NOT NULL DEFAULT '{}',
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (tenant_id, source, external_id)
);

CREATE TABLE activities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  account_id        uuid REFERENCES accounts(id),
  contact_id        uuid REFERENCES contacts(id),
  opportunity_id    uuid REFERENCES opportunities(id),
  type              text NOT NULL,
  source            text NOT NULL,
  direction         text,
  subject           text,
  body              text,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  participants      jsonb NOT NULL DEFAULT '[]',
  thread_id         text,
  channel_event_id  uuid REFERENCES channel_events(id),
  extracted         jsonb NOT NULL DEFAULT '{}',
  custom            jsonb NOT NULL DEFAULT '{}',
  version           int NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX activities_account_idx ON activities (tenant_id, account_id, occurred_at DESC);

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  title         text NOT NULL,
  object        text,
  record_id     uuid,
  assignee_id   uuid,
  assignee_role text,
  due_at        timestamptz,
  status        text NOT NULL DEFAULT 'open',
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Every field write, with its source; powers citations, "never re-infer a correction" and rollback.
CREATE TABLE field_provenance (
  id               bigserial PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  object           text NOT NULL,
  record_id        uuid NOT NULL,
  field            text NOT NULL,
  old_value        jsonb,
  new_value        jsonb,
  source           text NOT NULL CHECK (source IN ('user','agent','integration','system')),
  actor_id         text,
  agent_action_id  uuid,
  confidence       numeric(4,3),
  evidence         jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_provenance_record_idx ON field_provenance (tenant_id, object, record_id, field, created_at DESC);

CREATE TABLE agent_settings (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  agent_id    text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  killed      boolean NOT NULL DEFAULT false,
  overrides   jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE TABLE agent_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  agent_id        text NOT NULL,
  run_id          uuid NOT NULL,
  action_type     text NOT NULL,
  reversibility   text NOT NULL CHECK (reversibility IN ('reversible','compensable','binding','irreversible')),
  target_object   text,
  target_id       uuid,
  payload         jsonb NOT NULL,
  confidence      numeric(4,3),
  evidence        jsonb NOT NULL DEFAULT '[]',
  prompt_version  text,
  model           text,
  decision        text NOT NULL CHECK (decision IN ('executed','queued','blocked','rejected','expired','rolled_back','failed')),
  reason          text,
  writes          jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  executed_at     timestamptz,
  rolled_back_at  timestamptz
);
CREATE INDEX agent_actions_agent_idx ON agent_actions (tenant_id, agent_id, created_at DESC);

CREATE TABLE approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  agent_action_id  uuid NOT NULL REFERENCES agent_actions(id),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  assignee_role    text NOT NULL,
  assignee_id      uuid,
  summary          text NOT NULL,
  expires_at       timestamptz NOT NULL,
  decided_by       uuid,
  decided_at       timestamptz,
  decision_note    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Outbound messages are held for an undo window so a compensable send can still be recalled (FR-AI-06).
CREATE TABLE outbound_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  channel          text NOT NULL,
  from_mailbox     text,
  to_address       text NOT NULL,
  subject          text,
  body             text NOT NULL,
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','recalled','failed')),
  send_after       timestamptz NOT NULL,
  agent_action_id  uuid REFERENCES agent_actions(id),
  related_object   text,
  related_id       uuid,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE llm_usage (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  agent_id       text,
  purpose        text NOT NULL,
  model          text NOT NULL,
  input_tokens   int NOT NULL DEFAULT 0,
  output_tokens  int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox: events written in the same transaction as the change, dispatched afterwards.
CREATE TABLE outbox (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  type           text NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  dispatched_at  timestamptz,
  attempts       int NOT NULL DEFAULT 0,
  last_error     text
);
CREATE INDEX outbox_pending_idx ON outbox (id) WHERE dispatched_at IS NULL;
