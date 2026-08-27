-- Bridata Project - Cost Engine V2
-- Project controlling: budget, commitment, actual and forecast.
-- This migration is additive and does not backfill legacy project metadata.

CREATE TABLE "project_cost_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "contingency_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_cost_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_cost_profiles_contingency_check" CHECK ("contingency_amount" >= 0)
);

CREATE TABLE "cost_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "category" VARCHAR(30) NOT NULL DEFAULT 'OTHER',
  "parent_cost_code_id" UUID,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cost_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cost_codes_category_check" CHECK ("category" IN ('MATERIAL','LABOR','EQUIPMENT','SERVICE','SUBCONTRACT','OTHER')),
  CONSTRAINT "cost_codes_parent_self_check" CHECK ("parent_cost_code_id" IS NULL OR "parent_cost_code_id" <> "id")
);

CREATE TABLE "project_budget_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "work_item_object_id" UUID,
  "cost_code_id" UUID NOT NULL,
  "material_id" UUID,
  "description" VARCHAR(500) NOT NULL,
  "planned_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "approved_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "forecast_remaining_uncommitted" DECIMAL(18,4),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_budget_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_budget_lines_amount_check" CHECK (
    "planned_amount" >= 0 AND "approved_amount" >= 0
    AND ("forecast_remaining_uncommitted" IS NULL OR "forecast_remaining_uncommitted" >= 0)
  )
);

CREATE TABLE "project_commitments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "work_item_object_id" UUID,
  "cost_code_id" UUID,
  "supplier_id" UUID,
  "description" VARCHAR(500) NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "released_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  "source_type" VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  "source_reference" VARCHAR(255),
  "committed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_commitments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_commitments_amount_check" CHECK ("amount" >= 0 AND "released_amount" >= 0 AND "released_amount" <= "amount"),
  CONSTRAINT "project_commitments_status_check" CHECK ("status" IN ('OPEN','CLOSED','CANCELLED'))
);

CREATE TABLE "project_actual_costs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "work_item_object_id" UUID,
  "cost_code_id" UUID,
  "material_id" UUID,
  "description" VARCHAR(500) NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "source_type" VARCHAR(40) NOT NULL DEFAULT 'MANUAL',
  "source_id" UUID,
  "external_reference" VARCHAR(255),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_actual_costs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_actual_costs_amount_check" CHECK ("amount" >= 0)
);

CREATE TABLE "project_cost_baselines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(255),
  "currency" VARCHAR(3) NOT NULL,
  "contingency_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "captured_by_user_id" UUID,
  "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_cost_baselines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_cost_baselines_version_check" CHECK ("version" > 0),
  CONSTRAINT "project_cost_baselines_contingency_check" CHECK ("contingency_amount" >= 0)
);

CREATE TABLE "project_cost_baseline_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "baseline_id" UUID NOT NULL,
  "budget_line_id" UUID NOT NULL,
  "work_item_object_id" UUID,
  "cost_code_id" UUID NOT NULL,
  "material_id" UUID,
  "description" VARCHAR(500) NOT NULL,
  "planned_amount" DECIMAL(18,4) NOT NULL,
  "approved_amount" DECIMAL(18,4) NOT NULL,
  "forecast_remaining_uncommitted" DECIMAL(18,4),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_cost_baseline_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_cost_baseline_lines_amount_check" CHECK (
    "planned_amount" >= 0 AND "approved_amount" >= 0
    AND ("forecast_remaining_uncommitted" IS NULL OR "forecast_remaining_uncommitted" >= 0)
  )
);

CREATE UNIQUE INDEX "project_cost_profiles_project_object_id_key" ON "project_cost_profiles"("project_object_id");
CREATE INDEX "project_cost_profiles_workspace_idx" ON "project_cost_profiles"("tenant_id", "workspace_id");
CREATE UNIQUE INDEX "cost_codes_workspace_code_key" ON "cost_codes"("tenant_id", "workspace_id", "code");
CREATE INDEX "cost_codes_workspace_category_idx" ON "cost_codes"("tenant_id", "workspace_id", "category");
CREATE INDEX "project_budget_lines_project_cost_code_idx" ON "project_budget_lines"("tenant_id", "project_object_id", "cost_code_id");
CREATE INDEX "project_budget_lines_work_item_idx" ON "project_budget_lines"("tenant_id", "work_item_object_id");
CREATE INDEX "project_budget_lines_material_idx" ON "project_budget_lines"("tenant_id", "material_id");
CREATE INDEX "project_commitments_project_status_idx" ON "project_commitments"("tenant_id", "project_object_id", "status");
CREATE INDEX "project_commitments_cost_code_idx" ON "project_commitments"("tenant_id", "cost_code_id");
CREATE INDEX "project_actual_costs_project_date_idx" ON "project_actual_costs"("tenant_id", "project_object_id", "occurred_at");
CREATE INDEX "project_actual_costs_cost_code_idx" ON "project_actual_costs"("tenant_id", "cost_code_id");
CREATE INDEX "project_actual_costs_work_item_idx" ON "project_actual_costs"("tenant_id", "work_item_object_id");
CREATE UNIQUE INDEX "project_actual_costs_source_unique" ON "project_actual_costs"("tenant_id", "source_type", "source_id") WHERE "source_id" IS NOT NULL;
CREATE UNIQUE INDEX "project_cost_baselines_project_version_key" ON "project_cost_baselines"("project_object_id", "version");
CREATE INDEX "project_cost_baselines_project_date_idx" ON "project_cost_baselines"("tenant_id", "project_object_id", "captured_at");
CREATE UNIQUE INDEX "project_cost_baseline_lines_line_key" ON "project_cost_baseline_lines"("baseline_id", "budget_line_id");
CREATE INDEX "project_cost_baseline_lines_baseline_idx" ON "project_cost_baseline_lines"("tenant_id", "baseline_id");

ALTER TABLE "project_cost_profiles" ADD CONSTRAINT "project_cost_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "project_cost_profiles" ADD CONSTRAINT "project_cost_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "project_cost_profiles" ADD CONSTRAINT "project_cost_profiles_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE;
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "cost_codes" ADD CONSTRAINT "cost_codes_parent_cost_code_id_fkey" FOREIGN KEY ("parent_cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL;
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE;
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_work_item_object_id_fkey" FOREIGN KEY ("work_item_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL;
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE RESTRICT;
ALTER TABLE "project_budget_lines" ADD CONSTRAINT "project_budget_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE SET NULL;
ALTER TABLE "project_commitments" ADD CONSTRAINT "project_commitments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "project_commitments" ADD CONSTRAINT "project_commitments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "project_commitments" ADD CONSTRAINT "project_commitments_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE;
ALTER TABLE "project_commitments" ADD CONSTRAINT "project_commitments_work_item_object_id_fkey" FOREIGN KEY ("work_item_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL;
ALTER TABLE "project_commitments" ADD CONSTRAINT "project_commitments_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL;
ALTER TABLE "project_commitments" ADD CONSTRAINT "project_commitments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL;
ALTER TABLE "project_actual_costs" ADD CONSTRAINT "project_actual_costs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "project_actual_costs" ADD CONSTRAINT "project_actual_costs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE;
ALTER TABLE "project_actual_costs" ADD CONSTRAINT "project_actual_costs_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE;
ALTER TABLE "project_actual_costs" ADD CONSTRAINT "project_actual_costs_work_item_object_id_fkey" FOREIGN KEY ("work_item_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL;
ALTER TABLE "project_actual_costs" ADD CONSTRAINT "project_actual_costs_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE SET NULL;
ALTER TABLE "project_actual_costs" ADD CONSTRAINT "project_actual_costs_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE SET NULL;
ALTER TABLE "project_actual_costs" ADD CONSTRAINT "project_actual_costs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "project_cost_baselines" ADD CONSTRAINT "project_cost_baselines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "project_cost_baselines" ADD CONSTRAINT "project_cost_baselines_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE;
ALTER TABLE "project_cost_baselines" ADD CONSTRAINT "project_cost_baselines_captured_by_user_id_fkey" FOREIGN KEY ("captured_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "project_cost_baseline_lines" ADD CONSTRAINT "project_cost_baseline_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "project_cost_baseline_lines" ADD CONSTRAINT "project_cost_baseline_lines_baseline_id_fkey" FOREIGN KEY ("baseline_id") REFERENCES "project_cost_baselines"("id") ON DELETE CASCADE;
ALTER TABLE "project_cost_baseline_lines" ADD CONSTRAINT "project_cost_baseline_lines_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "project_budget_lines"("id") ON DELETE RESTRICT;
ALTER TABLE "project_cost_baseline_lines" ADD CONSTRAINT "project_cost_baseline_lines_work_item_object_id_fkey" FOREIGN KEY ("work_item_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL;
ALTER TABLE "project_cost_baseline_lines" ADD CONSTRAINT "project_cost_baseline_lines_cost_code_id_fkey" FOREIGN KEY ("cost_code_id") REFERENCES "cost_codes"("id") ON DELETE RESTRICT;
ALTER TABLE "project_cost_baseline_lines" ADD CONSTRAINT "project_cost_baseline_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE SET NULL;

-- Tenant-owned tables fail closed immediately.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'project_cost_profiles', 'cost_codes', 'project_budget_lines',
    'project_commitments', 'project_actual_costs',
    'project_cost_baselines', 'project_cost_baseline_lines'
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