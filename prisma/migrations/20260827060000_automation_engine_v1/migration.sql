-- Bridata Automation Engine V1
-- Versioned WHEN / IF / THEN definitions, idempotent runs, step history and human approvals.

CREATE TABLE "automation_definitions_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID,
  "project_object_id" UUID,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  "active_version" INTEGER,
  "max_runs_per_hour" INTEGER NOT NULL DEFAULT 100,
  "max_depth" INTEGER NOT NULL DEFAULT 5,
  "created_by_user_id" UUID NOT NULL,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_definitions_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_definitions_v1_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  CONSTRAINT "automation_definitions_v1_limits_check" CHECK ("max_runs_per_hour" BETWEEN 1 AND 10000 AND "max_depth" BETWEEN 1 AND 10),
  CONSTRAINT "automation_definitions_v1_project_scope_check" CHECK ("project_object_id" IS NULL OR "workspace_id" IS NOT NULL),
  CONSTRAINT "automation_definitions_v1_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "automation_definitions_v1_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "automation_definitions_v1_project_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE,
  CONSTRAINT "automation_definitions_v1_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id"),
  CONSTRAINT "automation_definitions_v1_updated_by_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "automation_definitions_v1_tenant_id_id_key" ON "automation_definitions_v1"("tenant_id","id");
CREATE INDEX "automation_definitions_v1_tenant_status_idx" ON "automation_definitions_v1"("tenant_id","status");
CREATE INDEX "automation_definitions_v1_workspace_idx" ON "automation_definitions_v1"("tenant_id","workspace_id");
CREATE INDEX "automation_definitions_v1_project_idx" ON "automation_definitions_v1"("tenant_id","project_object_id");

CREATE TABLE "automation_versions_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "definition_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "trigger_event_type" VARCHAR(150) NOT NULL,
  "condition_dsl" JSONB,
  "actions" JSONB NOT NULL,
  "change_note" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_versions_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_versions_v1_version_check" CHECK ("version" > 0),
  CONSTRAINT "automation_versions_v1_actions_array_check" CHECK (jsonb_typeof("actions") = 'array'),
  CONSTRAINT "automation_versions_v1_definition_fkey" FOREIGN KEY ("tenant_id","definition_id") REFERENCES "automation_definitions_v1"("tenant_id","id") ON DELETE CASCADE,
  CONSTRAINT "automation_versions_v1_created_by_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "automation_versions_v1_tenant_id_id_key" ON "automation_versions_v1"("tenant_id","id");
CREATE UNIQUE INDEX "automation_versions_v1_definition_version_key" ON "automation_versions_v1"("definition_id","version");
CREATE INDEX "automation_versions_v1_trigger_idx" ON "automation_versions_v1"("tenant_id","trigger_event_type");

CREATE TABLE "automation_runs_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "definition_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "source_event_id" UUID NOT NULL,
  "source_event_type" VARCHAR(150) NOT NULL,
  "root_event_id" UUID NOT NULL,
  "depth" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "context_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_runs_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_runs_v1_status_check" CHECK ("status" IN ('RUNNING','SUCCEEDED','FAILED','WAITING_APPROVAL','SKIPPED','CANCELLED')),
  CONSTRAINT "automation_runs_v1_depth_check" CHECK ("depth" BETWEEN 0 AND 10),
  CONSTRAINT "automation_runs_v1_attempts_check" CHECK ("attempts" BETWEEN 1 AND 50),
  CONSTRAINT "automation_runs_v1_definition_fkey" FOREIGN KEY ("tenant_id","definition_id") REFERENCES "automation_definitions_v1"("tenant_id","id") ON DELETE CASCADE,
  CONSTRAINT "automation_runs_v1_version_fkey" FOREIGN KEY ("tenant_id","version_id") REFERENCES "automation_versions_v1"("tenant_id","id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "automation_runs_v1_tenant_id_id_key" ON "automation_runs_v1"("tenant_id","id");
CREATE UNIQUE INDEX "automation_runs_v1_definition_source_event_key" ON "automation_runs_v1"("definition_id","source_event_id");
CREATE INDEX "automation_runs_v1_status_idx" ON "automation_runs_v1"("tenant_id","status","created_at");
CREATE INDEX "automation_runs_v1_source_event_idx" ON "automation_runs_v1"("tenant_id","source_event_id");

CREATE TABLE "automation_step_runs_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "step_index" INTEGER NOT NULL,
  "action_type" VARCHAR(64) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "input_json" JSONB,
  "output_json" JSONB,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_step_runs_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_step_runs_v1_status_check" CHECK ("status" IN ('RUNNING','SUCCEEDED','FAILED','WAITING_APPROVAL','SKIPPED')),
  CONSTRAINT "automation_step_runs_v1_step_check" CHECK ("step_index" >= 0 AND "step_index" < 100),
  CONSTRAINT "automation_step_runs_v1_run_fkey" FOREIGN KEY ("tenant_id","run_id") REFERENCES "automation_runs_v1"("tenant_id","id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "automation_step_runs_v1_tenant_id_id_key" ON "automation_step_runs_v1"("tenant_id","id");
CREATE UNIQUE INDEX "automation_step_runs_v1_run_step_key" ON "automation_step_runs_v1"("run_id","step_index");
CREATE INDEX "automation_step_runs_v1_status_idx" ON "automation_step_runs_v1"("tenant_id","status");

CREATE TABLE "automation_approval_requests_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "step_index" INTEGER NOT NULL,
  "automation_definition_id" UUID NOT NULL,
  "approver_user_id" UUID,
  "title" VARCHAR(500) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "decision_by_user_id" UUID,
  "decision_comment" TEXT,
  "decided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "automation_approval_requests_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_approval_requests_v1_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  CONSTRAINT "automation_approval_requests_v1_run_fkey" FOREIGN KEY ("tenant_id","run_id") REFERENCES "automation_runs_v1"("tenant_id","id") ON DELETE CASCADE,
  CONSTRAINT "automation_approval_requests_v1_definition_fkey" FOREIGN KEY ("tenant_id","automation_definition_id") REFERENCES "automation_definitions_v1"("tenant_id","id") ON DELETE CASCADE,
  CONSTRAINT "automation_approval_requests_v1_approver_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id"),
  CONSTRAINT "automation_approval_requests_v1_decision_by_fkey" FOREIGN KEY ("decision_by_user_id") REFERENCES "users"("id")
);

CREATE UNIQUE INDEX "automation_approval_requests_v1_tenant_id_id_key" ON "automation_approval_requests_v1"("tenant_id","id");
CREATE UNIQUE INDEX "automation_approval_requests_v1_run_step_key" ON "automation_approval_requests_v1"("run_id","step_index");
CREATE INDEX "automation_approval_requests_v1_pending_idx" ON "automation_approval_requests_v1"("tenant_id","status","approver_user_id");

CREATE OR REPLACE FUNCTION bridata_validate_automation_definition_scope_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ws_tenant uuid;
  project_tenant uuid;
  project_workspace uuid;
  project_type varchar(100);
BEGIN
  IF NEW.workspace_id IS NOT NULL THEN
    SELECT tenant_id INTO ws_tenant FROM workspaces WHERE id = NEW.workspace_id;
    IF ws_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'automation_workspace_tenant_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.project_object_id IS NOT NULL THEN
    SELECT tenant_id, workspace_id, object_type_key
      INTO project_tenant, project_workspace, project_type
    FROM nexus_objects
    WHERE id = NEW.project_object_id AND deleted_at IS NULL;
    IF project_tenant IS DISTINCT FROM NEW.tenant_id OR project_type IS DISTINCT FROM 'PROJECT' THEN
      RAISE EXCEPTION 'automation_project_tenant_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF project_workspace IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'automation_project_workspace_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER automation_definitions_v1_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, workspace_id, project_object_id ON automation_definitions_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_automation_definition_scope_v1();

CREATE OR REPLACE FUNCTION bridata_validate_automation_approval_user_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.approver_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.approver_user_id AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'automation_approver_not_active_tenant_member' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER automation_approval_requests_v1_user_guard
BEFORE INSERT OR UPDATE OF approver_user_id ON automation_approval_requests_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_automation_approval_user_v1();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'automation_definitions_v1',
    'automation_versions_v1',
    'automation_runs_v1',
    'automation_step_runs_v1',
    'automation_approval_requests_v1'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;
