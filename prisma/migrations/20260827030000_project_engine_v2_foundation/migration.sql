-- Bridata Project - Project Engine V2 relational foundation
-- Additive migration: V1 NexusObject scheduling remains supported during transition.

CREATE TYPE "SchedulingModeV2" AS ENUM ('AUTO', 'MANUAL');
CREATE TYPE "ScheduleConstraintTypeV2" AS ENUM (
  'AS_SOON_AS_POSSIBLE',
  'AS_LATE_AS_POSSIBLE',
  'MUST_START_ON',
  'MUST_FINISH_ON',
  'START_NO_EARLIER_THAN',
  'START_NO_LATER_THAN',
  'FINISH_NO_EARLIER_THAN',
  'FINISH_NO_LATER_THAN'
);
CREATE TYPE "ScheduleProgressMethodV2" AS ENUM ('DURATION', 'PHYSICAL');
CREATE TYPE "ScheduleDependencyTypeV2" AS ENUM ('FS', 'SS', 'FF', 'SF');

CREATE TABLE "work_calendars" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
  "working_weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
  "minutes_per_day" INTEGER NOT NULL DEFAULT 480,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "work_calendars_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_calendars_minutes_per_day_check" CHECK ("minutes_per_day" > 0)
);

CREATE TABLE "work_calendar_exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "calendar_id" UUID NOT NULL,
  "exception_date" DATE NOT NULL,
  "name" VARCHAR(255),
  "is_working" BOOLEAN NOT NULL DEFAULT false,
  "working_minutes" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_calendar_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_calendar_exceptions_working_minutes_check"
    CHECK ("working_minutes" IS NULL OR "working_minutes" >= 0)
);

CREATE TABLE "project_schedule_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "calendar_id" UUID,
  "scheduling_mode" "SchedulingModeV2" NOT NULL DEFAULT 'AUTO',
  "progress_method" "ScheduleProgressMethodV2" NOT NULL DEFAULT 'DURATION',
  "timezone" VARCHAR(100) NOT NULL DEFAULT 'UTC',
  "minutes_per_day" INTEGER NOT NULL DEFAULT 480,
  "minutes_per_week" INTEGER NOT NULL DEFAULT 2400,
  "status_date" TIMESTAMPTZ(6),
  "planned_start" TIMESTAMPTZ(6),
  "target_finish" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "project_schedule_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_schedule_profiles_minutes_per_day_check" CHECK ("minutes_per_day" > 0),
  CONSTRAINT "project_schedule_profiles_minutes_per_week_check" CHECK ("minutes_per_week" >= "minutes_per_day")
);

CREATE TABLE "work_item_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "parent_work_item_id" UUID,
  "wbs_code" VARCHAR(100),
  "outline_level" INTEGER NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "scheduling_mode" "SchedulingModeV2" NOT NULL DEFAULT 'AUTO',
  "duration_minutes" INTEGER NOT NULL DEFAULT 0,
  "remaining_duration_minutes" INTEGER NOT NULL DEFAULT 0,
  "constraint_type" "ScheduleConstraintTypeV2" NOT NULL DEFAULT 'AS_SOON_AS_POSSIBLE',
  "constraint_date" TIMESTAMPTZ(6),
  "actual_start" TIMESTAMPTZ(6),
  "actual_finish" TIMESTAMPTZ(6),
  "physical_percent_complete" DECIMAL(5,2),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "work_item_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_item_schedules_outline_level_check" CHECK ("outline_level" >= 0),
  CONSTRAINT "work_item_schedules_sort_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "work_item_schedules_duration_check" CHECK ("duration_minutes" >= 0),
  CONSTRAINT "work_item_schedules_remaining_duration_check"
    CHECK ("remaining_duration_minutes" >= 0 AND "remaining_duration_minutes" <= "duration_minutes"),
  CONSTRAINT "work_item_schedules_physical_progress_check"
    CHECK ("physical_percent_complete" IS NULL OR ("physical_percent_complete" >= 0 AND "physical_percent_complete" <= 100)),
  CONSTRAINT "work_item_schedules_actual_dates_check"
    CHECK ("actual_finish" IS NULL OR "actual_start" IS NULL OR "actual_finish" >= "actual_start"),
  CONSTRAINT "work_item_schedules_constraint_date_check"
    CHECK (
      "constraint_type" IN ('AS_SOON_AS_POSSIBLE', 'AS_LATE_AS_POSSIBLE')
      OR "constraint_date" IS NOT NULL
    )
);

CREATE TABLE "schedule_dependencies_v2" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "predecessor_object_id" UUID NOT NULL,
  "successor_object_id" UUID NOT NULL,
  "dependency_type" "ScheduleDependencyTypeV2" NOT NULL DEFAULT 'FS',
  "lag_minutes" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "legacy_relation_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "schedule_dependencies_v2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_dependencies_v2_self_check" CHECK ("predecessor_object_id" <> "successor_object_id")
);

CREATE TABLE "project_baselines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "name" VARCHAR(255),
  "captured_by_user_id" UUID,
  "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_baselines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_baselines_version_check" CHECK ("version" > 0)
);

CREATE TABLE "project_baseline_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "baseline_id" UUID NOT NULL,
  "work_item_object_id" UUID NOT NULL,
  "wbs_code" VARCHAR(100),
  "planned_start" TIMESTAMPTZ(6),
  "planned_finish" TIMESTAMPTZ(6),
  "duration_minutes" INTEGER NOT NULL DEFAULT 0,
  "remaining_duration_minutes" INTEGER NOT NULL DEFAULT 0,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "physical_percent_complete" DECIMAL(5,2),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_baseline_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_baseline_items_duration_check" CHECK ("duration_minutes" >= 0),
  CONSTRAINT "project_baseline_items_remaining_check"
    CHECK ("remaining_duration_minutes" >= 0 AND "remaining_duration_minutes" <= "duration_minutes"),
  CONSTRAINT "project_baseline_items_progress_check" CHECK ("progress" >= 0 AND "progress" <= 100),
  CONSTRAINT "project_baseline_items_physical_progress_check"
    CHECK ("physical_percent_complete" IS NULL OR ("physical_percent_complete" >= 0 AND "physical_percent_complete" <= 100))
);

CREATE UNIQUE INDEX "work_calendars_tenant_id_workspace_id_name_key"
  ON "work_calendars"("tenant_id", "workspace_id", "name");
CREATE INDEX "work_calendars_tenant_id_workspace_id_idx"
  ON "work_calendars"("tenant_id", "workspace_id");
CREATE UNIQUE INDEX "work_calendar_exceptions_calendar_id_exception_date_key"
  ON "work_calendar_exceptions"("calendar_id", "exception_date");
CREATE INDEX "work_calendar_exceptions_tenant_id_exception_date_idx"
  ON "work_calendar_exceptions"("tenant_id", "exception_date");
CREATE UNIQUE INDEX "project_schedule_profiles_project_object_id_key"
  ON "project_schedule_profiles"("project_object_id");
CREATE INDEX "project_schedule_profiles_tenant_id_project_object_id_idx"
  ON "project_schedule_profiles"("tenant_id", "project_object_id");
CREATE UNIQUE INDEX "work_item_schedules_object_id_key"
  ON "work_item_schedules"("object_id");
CREATE INDEX "work_item_schedules_tenant_id_project_object_id_sort_order_idx"
  ON "work_item_schedules"("tenant_id", "project_object_id", "sort_order");
CREATE INDEX "work_item_schedules_tenant_id_parent_work_item_id_idx"
  ON "work_item_schedules"("tenant_id", "parent_work_item_id");
CREATE UNIQUE INDEX "schedule_dependencies_v2_project_edge_key"
  ON "schedule_dependencies_v2"("project_object_id", "predecessor_object_id", "successor_object_id");
CREATE UNIQUE INDEX "schedule_dependencies_v2_legacy_relation_id_key"
  ON "schedule_dependencies_v2"("legacy_relation_id") WHERE "legacy_relation_id" IS NOT NULL;
CREATE INDEX "schedule_dependencies_v2_tenant_id_project_object_id_idx"
  ON "schedule_dependencies_v2"("tenant_id", "project_object_id");
CREATE UNIQUE INDEX "project_baselines_project_object_id_version_key"
  ON "project_baselines"("project_object_id", "version");
CREATE INDEX "project_baselines_tenant_id_project_object_id_captured_at_idx"
  ON "project_baselines"("tenant_id", "project_object_id", "captured_at");
CREATE UNIQUE INDEX "project_baseline_items_baseline_id_work_item_object_id_key"
  ON "project_baseline_items"("baseline_id", "work_item_object_id");
CREATE INDEX "project_baseline_items_tenant_id_baseline_id_idx"
  ON "project_baseline_items"("tenant_id", "baseline_id");

ALTER TABLE "work_calendars"
  ADD CONSTRAINT "work_calendars_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_calendars"
  ADD CONSTRAINT "work_calendars_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_calendar_exceptions"
  ADD CONSTRAINT "work_calendar_exceptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_calendar_exceptions"
  ADD CONSTRAINT "work_calendar_exceptions_calendar_id_fkey"
  FOREIGN KEY ("calendar_id") REFERENCES "work_calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_schedule_profiles"
  ADD CONSTRAINT "project_schedule_profiles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_schedule_profiles"
  ADD CONSTRAINT "project_schedule_profiles_project_object_id_fkey"
  FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_schedule_profiles"
  ADD CONSTRAINT "project_schedule_profiles_calendar_id_fkey"
  FOREIGN KEY ("calendar_id") REFERENCES "work_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_item_schedules"
  ADD CONSTRAINT "work_item_schedules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_item_schedules"
  ADD CONSTRAINT "work_item_schedules_project_object_id_fkey"
  FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_item_schedules"
  ADD CONSTRAINT "work_item_schedules_object_id_fkey"
  FOREIGN KEY ("object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_item_schedules"
  ADD CONSTRAINT "work_item_schedules_parent_work_item_id_fkey"
  FOREIGN KEY ("parent_work_item_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "schedule_dependencies_v2"
  ADD CONSTRAINT "schedule_dependencies_v2_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_dependencies_v2"
  ADD CONSTRAINT "schedule_dependencies_v2_project_object_id_fkey"
  FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_dependencies_v2"
  ADD CONSTRAINT "schedule_dependencies_v2_predecessor_object_id_fkey"
  FOREIGN KEY ("predecessor_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_dependencies_v2"
  ADD CONSTRAINT "schedule_dependencies_v2_successor_object_id_fkey"
  FOREIGN KEY ("successor_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "schedule_dependencies_v2"
  ADD CONSTRAINT "schedule_dependencies_v2_legacy_relation_id_fkey"
  FOREIGN KEY ("legacy_relation_id") REFERENCES "object_relations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_baselines"
  ADD CONSTRAINT "project_baselines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_baselines"
  ADD CONSTRAINT "project_baselines_project_object_id_fkey"
  FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_baselines"
  ADD CONSTRAINT "project_baselines_captured_by_user_id_fkey"
  FOREIGN KEY ("captured_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_baseline_items"
  ADD CONSTRAINT "project_baseline_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_baseline_items"
  ADD CONSTRAINT "project_baseline_items_baseline_id_fkey"
  FOREIGN KEY ("baseline_id") REFERENCES "project_baselines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_baseline_items"
  ADD CONSTRAINT "project_baseline_items_work_item_object_id_fkey"
  FOREIGN KEY ("work_item_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS is applied in the same migration so these new tenant-owned tables fail closed.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'work_calendars',
    'work_calendar_exceptions',
    'project_schedule_profiles',
    'work_item_schedules',
    'schedule_dependencies_v2',
    'project_baselines',
    'project_baseline_items'
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

-- Backfill typed V2 dependencies from the current ObjectRelation convention.
-- V1 storage convention: source_object_id=successor, target_object_id=predecessor.
INSERT INTO "schedule_dependencies_v2" (
  "tenant_id",
  "project_object_id",
  "predecessor_object_id",
  "successor_object_id",
  "dependency_type",
  "lag_minutes",
  "notes",
  "legacy_relation_id",
  "updated_at"
)
SELECT
  r."tenant_id",
  (successor."metadata"->>'projectId')::uuid,
  r."target_object_id",
  r."source_object_id",
  CASE
    WHEN r."metadata"->>'dependencyType' IN ('FS','SS','FF','SF')
      THEN (r."metadata"->>'dependencyType')::"ScheduleDependencyTypeV2"
    ELSE 'FS'::"ScheduleDependencyTypeV2"
  END,
  COALESCE((r."metadata"->>'lagDays')::integer, 0) * 480,
  r."notes",
  r."id",
  CURRENT_TIMESTAMP
FROM "object_relations" r
JOIN "nexus_objects" successor ON successor."id" = r."source_object_id"
JOIN "nexus_objects" predecessor ON predecessor."id" = r."target_object_id"
WHERE r."relation_type" = 'DEPENDS_ON'
  AND successor."metadata"->>'projectId' IS NOT NULL
  AND predecessor."metadata"->>'projectId' = successor."metadata"->>'projectId'
  AND (successor."metadata"->>'projectId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
ON CONFLICT DO NOTHING;
