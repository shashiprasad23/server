-- Months 3-6 modules: catalogue and CPQ, supply holds, deal registration, trade compliance,
-- forecast calls, installed base, mutual action plans. Quotes are pre-sale proposals; orders,
-- invoices and payments still live only in NetSuite (FR-NS-01).

ALTER TABLE accounts ADD COLUMN health_score int;
ALTER TABLE accounts ADD COLUMN health_reasons jsonb NOT NULL DEFAULT '[]';
ALTER TABLE opportunities ADD COLUMN risk_reasons jsonb NOT NULL DEFAULT '[]';
ALTER TABLE opportunities ADD COLUMN eus_status text NOT NULL DEFAULT 'not_requested';

CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  sku              text NOT NULL,
  name             text NOT NULL,
  category         text NOT NULL CHECK (category IN ('gpu_server','rack_system','networking','optics','storage','software','service','support','rack_infra')),
  oem              text,
  gpu_model        text,
  gpus_per_unit    int NOT NULL DEFAULT 0,
  power_kw         numeric(8,2) NOT NULL DEFAULT 0,
  rack_units       int NOT NULL DEFAULT 0,
  cooling          text NOT NULL DEFAULT 'air',
  unit             text NOT NULL DEFAULT 'each',
  list_price       numeric(14,2) NOT NULL,
  cost             numeric(14,2) NOT NULL,
  stock            int NOT NULL DEFAULT 0,
  lead_time_weeks  int NOT NULL DEFAULT 0,
  export_class     text NOT NULL DEFAULT 'EAR99',
  price_valid_until date,
  source           text NOT NULL DEFAULT 'price_list',
  attrs            jsonb NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE TABLE supply_holds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  product_id      uuid NOT NULL REFERENCES products(id),
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id),
  qty             int NOT NULL CHECK (qty > 0),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','expired','converted')),
  expires_at      timestamptz NOT NULL,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deal_registrations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  opportunity_id         uuid NOT NULL REFERENCES opportunities(id),
  oem                    text NOT NULL,
  status                 text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','expired','withdrawn')),
  portal_reference       text,
  protected_discount_pct numeric(5,2),
  expires_at             date,
  notes                  text,
  created_by             text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quotes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  opportunity_id   uuid NOT NULL REFERENCES opportunities(id),
  number           text NOT NULL,
  version          int NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','pending_approval','approved','sent','accepted','rejected','expired','superseded','withdrawn')),
  currency         text NOT NULL DEFAULT 'USD',
  valid_until      date NOT NULL,
  discount_pct     numeric(5,2) NOT NULL DEFAULT 0,
  freight          numeric(14,2) NOT NULL DEFAULT 0,
  rebate           numeric(14,2) NOT NULL DEFAULT 0,
  payment_terms    text NOT NULL DEFAULT 'Net 30',
  subtotal         numeric(14,2) NOT NULL DEFAULT 0,
  total            numeric(14,2) NOT NULL DEFAULT 0,
  cost_total       numeric(14,2) NOT NULL DEFAULT 0,
  margin           numeric(14,2) NOT NULL DEFAULT 0,
  margin_pct       numeric(6,2) NOT NULL DEFAULT 0,
  power_kw_total   numeric(10,2) NOT NULL DEFAULT 0,
  racks            int NOT NULL DEFAULT 0,
  cooling          text,
  config_warnings  jsonb NOT NULL DEFAULT '[]',
  approval_role    text,
  approval_reasons jsonb NOT NULL DEFAULT '[]',
  revalidation     jsonb NOT NULL DEFAULT '[]',
  notes            text,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  approved_by      text,
  approved_at      timestamptz,
  published_to     text,
  published_at     timestamptz,
  accepted_at      timestamptz,
  UNIQUE (tenant_id, number, version)
);
CREATE INDEX quotes_opp_idx ON quotes (tenant_id, opportunity_id, version DESC);

CREATE TABLE quote_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  quote_id         uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id       uuid REFERENCES products(id),
  position         int NOT NULL,
  sku              text NOT NULL,
  description      text NOT NULL,
  category         text NOT NULL,
  qty              int NOT NULL,
  unit_price       numeric(14,2) NOT NULL,
  unit_cost        numeric(14,2) NOT NULL,
  extended_price   numeric(14,2) NOT NULL,
  lead_time_weeks  int NOT NULL DEFAULT 0,
  supply_status    text NOT NULL DEFAULT 'unknown',
  export_class     text NOT NULL DEFAULT 'EAR99'
);

CREATE TABLE restricted_parties (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  name       text NOT NULL,
  country    text,
  list_name  text NOT NULL,
  aliases    text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE compliance_checks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  opportunity_id        uuid NOT NULL REFERENCES opportunities(id),
  kind                  text NOT NULL CHECK (kind IN ('screening','red_flag','decision')),
  result                text NOT NULL CHECK (result IN ('clear','potential_match','licence_required','blocked','red_flag','cleared','rejected')),
  parties               jsonb NOT NULL DEFAULT '[]',
  matches               jsonb NOT NULL DEFAULT '[]',
  classification        jsonb NOT NULL DEFAULT '[]',
  licence_determination text,
  notes                 text,
  decided_by            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE forecast_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL,
  period      text NOT NULL,
  amount      numeric(14,2) NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, period)
);

CREATE TABLE installed_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  account_id       uuid NOT NULL REFERENCES accounts(id),
  opportunity_id   uuid REFERENCES opportunities(id),
  product_id       uuid REFERENCES products(id),
  sku              text NOT NULL,
  description      text NOT NULL,
  category         text NOT NULL,
  gpu_model        text,
  qty              int NOT NULL,
  serials          text[] NOT NULL DEFAULT '{}',
  site             text,
  delivered_at     date NOT NULL,
  warranty_end     date,
  support_end      date,
  licence_end      date,
  renewal_opportunity_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunity_milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id),
  title           text NOT NULL,
  owner_side      text NOT NULL DEFAULT 'uvation' CHECK (owner_side IN ('uvation','customer')),
  due_date        date,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','at_risk')),
  position        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','supply_holds','deal_registrations','quotes','quote_lines','restricted_parties',
                           'compliance_checks','forecast_calls','installed_assets','opportunity_milestones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
