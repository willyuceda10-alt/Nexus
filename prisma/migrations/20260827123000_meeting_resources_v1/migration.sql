-- Bridata Meeting Resources V1

CREATE TABLE IF NOT EXISTS "meeting_resources_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "resource_type" varchar(20) NOT NULL,
  "name" varchar(255) NOT NULL,
  "email" varchar(320) NOT NULL,
  "location" varchar(500),
  "capacity" integer,
  "features" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_resources_v1_type_check" CHECK ("resource_type" IN ('ROOM', 'EQUIPMENT')),
  CONSTRAINT "meeting_resources_v1_capacity_check" CHECK ("capacity" IS NULL OR ("capacity" >= 1 AND "capacity" <= 10000)),
  CONSTRAINT "meeting_resources_v1_features_check" CHECK (jsonb_typeof("features") = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS "meeting_resources_v1_tenant_email_key"
  ON "meeting_resources_v1" ("tenant_id", lower("email"));
CREATE INDEX IF NOT EXISTS "meeting_resources_v1_workspace_active_idx"
  ON "meeting_resources_v1" ("tenant_id", "workspace_id", "is_active", "resource_type", "name");

CREATE TABLE IF NOT EXISTS "meeting_resource_bookings_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "meeting_collaboration_id" uuid NOT NULL REFERENCES "meeting_collaboration_v1"("id") ON DELETE CASCADE,
  "meeting_resource_id" uuid NOT NULL REFERENCES "meeting_resources_v1"("id") ON DELETE RESTRICT,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_resource_bookings_v1_unique" UNIQUE ("meeting_collaboration_id", "meeting_resource_id")
);

CREATE INDEX IF NOT EXISTS "meeting_resource_bookings_v1_tenant_meeting_idx"
  ON "meeting_resource_bookings_v1" ("tenant_id", "meeting_collaboration_id");
CREATE INDEX IF NOT EXISTS "meeting_resource_bookings_v1_tenant_resource_idx"
  ON "meeting_resource_bookings_v1" ("tenant_id", "meeting_resource_id");

CREATE OR REPLACE FUNCTION bridata_validate_meeting_resource_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.id = NEW.workspace_id AND w.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Meeting resource workspace scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = NEW.created_by AND u.is_active = true
  ) THEN
    RAISE EXCEPTION 'Meeting resource creator must be an active user.' USING ERRCODE = 'P0001';
  END IF;
  NEW.email := lower(trim(NEW.email));
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_resources_v1_scope_guard ON meeting_resources_v1;
CREATE TRIGGER meeting_resources_v1_scope_guard
BEFORE INSERT OR UPDATE ON meeting_resources_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_meeting_resource_v1();

CREATE OR REPLACE FUNCTION bridata_validate_meeting_resource_booking_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  meeting_tenant uuid;
  meeting_workspace uuid;
  resource_tenant uuid;
  resource_workspace uuid;
  resource_active boolean;
BEGIN
  SELECT tenant_id, workspace_id INTO meeting_tenant, meeting_workspace
  FROM meeting_collaboration_v1 WHERE id = NEW.meeting_collaboration_id;

  SELECT tenant_id, workspace_id, is_active
    INTO resource_tenant, resource_workspace, resource_active
  FROM meeting_resources_v1 WHERE id = NEW.meeting_resource_id;

  IF meeting_tenant IS DISTINCT FROM NEW.tenant_id
     OR resource_tenant IS DISTINCT FROM NEW.tenant_id
     OR meeting_workspace IS DISTINCT FROM resource_workspace THEN
    RAISE EXCEPTION 'Meeting resource booking scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  IF resource_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Inactive meeting resources cannot be newly booked.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_resource_bookings_v1_scope_guard ON meeting_resource_bookings_v1;
CREATE TRIGGER meeting_resource_bookings_v1_scope_guard
BEFORE INSERT OR UPDATE ON meeting_resource_bookings_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_meeting_resource_booking_v1();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['meeting_resources_v1', 'meeting_resource_bookings_v1']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    BEGIN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())', table_name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
