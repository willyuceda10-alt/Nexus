-- Bridata Work OS · Calendar / Timeline + Teams Meeting Foundation V1

DO $$ BEGIN
  CREATE TYPE "MeetingM365SyncStatusV1" AS ENUM ('LOCAL_ONLY', 'PENDING', 'SYNCED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "meeting_collaboration_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "meeting_object_id" uuid NOT NULL REFERENCES "nexus_objects"("id") ON DELETE CASCADE,
  "project_id" uuid REFERENCES "nexus_objects"("id") ON DELETE SET NULL,
  "organizer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "organizer_graph_user" varchar(320) NOT NULL,
  "start_at" timestamptz(6) NOT NULL,
  "end_at" timestamptz(6) NOT NULL,
  "timezone" varchar(100) NOT NULL DEFAULT 'America/Lima',
  "location" varchar(500),
  "is_online" boolean NOT NULL DEFAULT true,
  "online_provider" varchar(50) NOT NULL DEFAULT 'TEAMS',
  "sync_status" "MeetingM365SyncStatusV1" NOT NULL DEFAULT 'LOCAL_ONLY',
  "graph_event_id" varchar(1024),
  "graph_change_key" varchar(1024),
  "join_url" text,
  "web_link" text,
  "last_sync_attempt_at" timestamptz(6),
  "last_synced_at" timestamptz(6),
  "sync_error" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_collaboration_v1_meeting_key" UNIQUE ("meeting_object_id"),
  CONSTRAINT "meeting_collaboration_v1_time_check" CHECK ("end_at" >= "start_at")
);

CREATE TABLE IF NOT EXISTS "meeting_collaboration_attendees_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "meeting_collaboration_id" uuid NOT NULL REFERENCES "meeting_collaboration_v1"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "email" varchar(320) NOT NULL,
  "display_name" varchar(255) NOT NULL,
  "attendee_type" varchar(20) NOT NULL DEFAULT 'REQUIRED',
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_collaboration_attendees_v1_type_check" CHECK ("attendee_type" IN ('REQUIRED', 'OPTIONAL')),
  CONSTRAINT "meeting_collaboration_attendees_v1_email_key" UNIQUE ("meeting_collaboration_id", "email")
);

CREATE INDEX IF NOT EXISTS "meeting_collaboration_v1_tenant_workspace_start_idx"
  ON "meeting_collaboration_v1"("tenant_id", "workspace_id", "start_at");
CREATE INDEX IF NOT EXISTS "meeting_collaboration_v1_tenant_sync_idx"
  ON "meeting_collaboration_v1"("tenant_id", "sync_status", "updated_at");
CREATE INDEX IF NOT EXISTS "meeting_collaboration_attendees_v1_tenant_meeting_idx"
  ON "meeting_collaboration_attendees_v1"("tenant_id", "meeting_collaboration_id");

CREATE OR REPLACE FUNCTION bridata_validate_meeting_collaboration_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  object_tenant uuid;
  object_workspace uuid;
  object_type text;
BEGIN
  SELECT tenant_id, workspace_id, object_type_key
    INTO object_tenant, object_workspace, object_type
    FROM nexus_objects WHERE id = NEW.meeting_object_id AND deleted_at IS NULL;
  IF object_tenant IS DISTINCT FROM NEW.tenant_id OR object_workspace IS DISTINCT FROM NEW.workspace_id OR object_type IS DISTINCT FROM 'MEETING' THEN
    RAISE EXCEPTION 'Meeting collaboration scope or object type is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM nexus_objects p
    WHERE p.id = NEW.project_id AND p.tenant_id = NEW.tenant_id AND p.workspace_id = NEW.workspace_id
      AND p.object_type_key = 'PROJECT' AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Meeting project scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_collaboration_v1_scope_guard ON meeting_collaboration_v1;
CREATE TRIGGER meeting_collaboration_v1_scope_guard
BEFORE INSERT OR UPDATE ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_meeting_collaboration_v1();

CREATE OR REPLACE FUNCTION bridata_validate_meeting_attendee_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  meeting_tenant uuid;
BEGIN
  SELECT tenant_id INTO meeting_tenant FROM meeting_collaboration_v1 WHERE id = NEW.meeting_collaboration_id;
  IF meeting_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Meeting attendee tenant scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_collaboration_attendees_v1_scope_guard ON meeting_collaboration_attendees_v1;
CREATE TRIGGER meeting_collaboration_attendees_v1_scope_guard
BEFORE INSERT OR UPDATE ON meeting_collaboration_attendees_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_meeting_attendee_v1();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['meeting_collaboration_v1', 'meeting_collaboration_attendees_v1']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    BEGIN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())', table_name);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;
