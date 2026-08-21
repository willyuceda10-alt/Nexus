-- NEXUS OS - TENANT ROW LEVEL SECURITY
-- Applied after the Prisma baseline migration.
-- Application transactions set app.current_tenant_id using set_config(..., true).
-- The runtime database role MUST NOT be SUPERUSER or have BYPASSRLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION nexus_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = nexus_current_tenant_id())
  WITH CHECK (id = nexus_current_tenant_id());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant_memberships',
    'workspaces',
    'workspace_members',
    'object_definitions',
    'nexus_objects',
    'object_field_values',
    'object_relations',
    'workflow_definitions',
    'object_history',
    'object_comments',
    'object_attachments',
    'integration_connections',
    'domain_events',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_nexus_objects_metadata_gin
  ON nexus_objects USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_object_definitions_schema_gin
  ON object_definitions USING GIN (schema);

CREATE INDEX IF NOT EXISTS idx_domain_events_payload_gin
  ON domain_events USING GIN (payload);

CREATE INDEX IF NOT EXISTS idx_nexus_objects_fts
  ON nexus_objects USING GIN (
    to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(description, ''))
  );
