-- Row-level security: the app role only ever sees rows of the tenant set in app.tenant_id
-- (set per transaction by DbService.tx). Background workers may read the outbox, outbound queue
-- and approvals across tenants with app.worker = 'on', then switch to a tenant context per item.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','field_definitions','pipeline_stages','settings','accounts','contacts','leads',
    'opportunities','channel_events','activities','tasks','field_provenance','agent_settings',
    'agent_actions','approvals','outbound_messages','llm_usage','outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['outbox','outbound_messages','approvals'] LOOP
    EXECUTE format(
      'CREATE POLICY worker_scan ON %I USING (current_setting(''app.worker'', true) = ''on'')', t);
  END LOOP;
END $$;
