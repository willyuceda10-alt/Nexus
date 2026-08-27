-- NEXUS OS - TENANT ROW LEVEL SECURITY
-- Apply after the Prisma baseline migration has created the tables.
-- The application must run transactions with:
--   SELECT set_config('app.current_tenant_id', '<tenant-uuid>', true);
-- The application database role MUST NOT be SUPERUSER or have BYPASSRLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION nexus_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

-- The tenant row itself is scoped by its own id.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = nexus_current_tenant_id())
  WITH CHECK (id = nexus_current_tenant_id());

-- Every table below owns a tenant_id column and is isolated directly.
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
    'audit_logs',
    'work_calendars',
    'work_calendar_exceptions',
    'project_schedule_profiles',
    'work_item_schedules',
    'schedule_dependencies_v2',
    'project_baselines',
    'project_baseline_items',
    'authorization_policies',
    'automation_definitions_v1',
    'automation_versions_v1',
    'automation_runs_v1',
    'automation_step_runs_v1',
    'automation_approval_requests_v1',
    'inbox_items_v1',
    'notification_deliveries_v1',
    'notification_preferences_v1',
    'work_boards_v1',
    'work_board_groups_v1',
    'work_board_columns_v1',
    'work_views_v1',
    'work_board_item_placements_v1',
    'work_board_option_sets_v1',
    'work_board_options_v1',
    'meeting_collaboration_v1',
    'meeting_collaboration_attendees_v1'
  ]
  LOOP
    -- This script is also used as a defensive re-application step. During
    -- staged rollouts a newly defined table may not exist yet, so skip it
    -- until its migration has been applied.
    IF to_regclass(table_name) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

-- JSON/search indexes that Prisma does not model directly.
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

-- Defensive check: fail closed when no tenant context exists.
-- RLS policies above naturally return zero rows when nexus_current_tenant_id() is NULL.
