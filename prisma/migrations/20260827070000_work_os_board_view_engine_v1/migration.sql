-- Bridata Work OS · Board + View Engine V1

CREATE TYPE "WorkBoardColumnSourceV1" AS ENUM ('CORE', 'CUSTOM');
CREATE TYPE "WorkBoardColumnTypeV1" AS ENUM (
  'TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN',
  'STATUS', 'PRIORITY', 'PROGRESS', 'PERSON', 'TAGS', 'LINK', 'FILE', 'FORMULA'
);
CREATE TYPE "WorkViewTypeV1" AS ENUM ('TABLE', 'KANBAN', 'CALENDAR', 'GANTT', 'TIMELINE');

CREATE TABLE "work_boards_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "object_definition_id" uuid NOT NULL REFERENCES "object_definitions"("id"),
  "name" varchar(255) NOT NULL,
  "description" text,
  "icon" varchar(100),
  "is_archived" boolean NOT NULL DEFAULT false,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "work_board_groups_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL REFERENCES "work_boards_v1"("id") ON DELETE CASCADE,
  "key" varchar(100) NOT NULL,
  "name" varchar(255) NOT NULL,
  "color" varchar(30),
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_board_groups_v1_board_key_key" UNIQUE ("board_id", "key")
);

CREATE TABLE "work_board_columns_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL REFERENCES "work_boards_v1"("id") ON DELETE CASCADE,
  "key" varchar(100) NOT NULL,
  "label" varchar(255) NOT NULL,
  "source" "WorkBoardColumnSourceV1" NOT NULL,
  "data_type" "WorkBoardColumnTypeV1" NOT NULL,
  "field_key" varchar(100) NOT NULL,
  "width" smallint,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_visible" boolean NOT NULL DEFAULT true,
  "is_editable" boolean NOT NULL DEFAULT true,
  "config" jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_board_columns_v1_board_key_key" UNIQUE ("board_id", "key"),
  CONSTRAINT "work_board_columns_v1_width_check" CHECK ("width" IS NULL OR "width" BETWEEN 60 AND 600)
);

CREATE TABLE "work_views_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL REFERENCES "work_boards_v1"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "view_type" "WorkViewTypeV1" NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "work_board_item_placements_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL REFERENCES "work_boards_v1"("id") ON DELETE CASCADE,
  "object_id" uuid NOT NULL REFERENCES "nexus_objects"("id") ON DELETE CASCADE,
  "group_id" uuid REFERENCES "work_board_groups_v1"("id") ON DELETE SET NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_board_item_placements_v1_board_object_key" UNIQUE ("board_id", "object_id")
);

CREATE INDEX "work_boards_v1_tenant_workspace_archived_idx"
  ON "work_boards_v1"("tenant_id", "workspace_id", "is_archived");
CREATE INDEX "work_boards_v1_tenant_definition_idx"
  ON "work_boards_v1"("tenant_id", "object_definition_id");
CREATE INDEX "work_board_groups_v1_tenant_board_sort_idx"
  ON "work_board_groups_v1"("tenant_id", "board_id", "sort_order");
CREATE INDEX "work_board_columns_v1_tenant_board_sort_idx"
  ON "work_board_columns_v1"("tenant_id", "board_id", "sort_order");
CREATE INDEX "work_views_v1_tenant_board_sort_idx"
  ON "work_views_v1"("tenant_id", "board_id", "sort_order");
CREATE INDEX "work_board_item_placements_v1_tenant_board_group_sort_idx"
  ON "work_board_item_placements_v1"("tenant_id", "board_id", "group_id", "sort_order");
CREATE INDEX "work_board_item_placements_v1_tenant_object_idx"
  ON "work_board_item_placements_v1"("tenant_id", "object_id");
CREATE UNIQUE INDEX "work_views_v1_one_default_per_board_idx"
  ON "work_views_v1"("board_id") WHERE "is_default" = true;

-- Fail closed if a Board is wired to another tenant/workspace definition.
CREATE OR REPLACE FUNCTION bridata_validate_work_board_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_tenant uuid;
  definition_tenant uuid;
BEGIN
  SELECT tenant_id INTO workspace_tenant FROM workspaces WHERE id = NEW.workspace_id;
  SELECT tenant_id INTO definition_tenant FROM object_definitions WHERE id = NEW.object_definition_id;
  IF workspace_tenant IS DISTINCT FROM NEW.tenant_id OR definition_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Work Board tenant/workspace/object-definition scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_boards_v1_scope_guard
BEFORE INSERT OR UPDATE ON work_boards_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_work_board_v1();

CREATE OR REPLACE FUNCTION bridata_validate_board_child_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  board_tenant uuid;
BEGIN
  SELECT tenant_id INTO board_tenant FROM work_boards_v1 WHERE id = NEW.board_id;
  IF board_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Board child tenant scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_board_groups_v1_scope_guard
BEFORE INSERT OR UPDATE ON work_board_groups_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_board_child_v1();
CREATE TRIGGER work_board_columns_v1_scope_guard
BEFORE INSERT OR UPDATE ON work_board_columns_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_board_child_v1();
CREATE TRIGGER work_views_v1_scope_guard
BEFORE INSERT OR UPDATE ON work_views_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_board_child_v1();

CREATE OR REPLACE FUNCTION bridata_validate_board_placement_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  board_tenant uuid;
  board_workspace uuid;
  board_definition uuid;
  object_tenant uuid;
  object_workspace uuid;
  object_definition uuid;
  group_board uuid;
BEGIN
  SELECT tenant_id, workspace_id, object_definition_id
    INTO board_tenant, board_workspace, board_definition
    FROM work_boards_v1 WHERE id = NEW.board_id;
  SELECT tenant_id, workspace_id, object_definition_id
    INTO object_tenant, object_workspace, object_definition
    FROM nexus_objects WHERE id = NEW.object_id AND deleted_at IS NULL;

  IF board_tenant IS DISTINCT FROM NEW.tenant_id
     OR object_tenant IS DISTINCT FROM NEW.tenant_id
     OR object_workspace IS DISTINCT FROM board_workspace
     OR object_definition IS DISTINCT FROM board_definition THEN
    RAISE EXCEPTION 'Board item must belong to the same tenant, workspace and object definition as its board.' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.group_id IS NOT NULL THEN
    SELECT board_id INTO group_board FROM work_board_groups_v1 WHERE id = NEW.group_id;
    IF group_board IS DISTINCT FROM NEW.board_id THEN
      RAISE EXCEPTION 'Board item group must belong to the same board.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_board_item_placements_v1_scope_guard
BEFORE INSERT OR UPDATE ON work_board_item_placements_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_board_placement_v1();

-- Tenant RLS is enabled immediately so additive deployment never opens these tables.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'work_boards_v1',
    'work_board_groups_v1',
    'work_board_columns_v1',
    'work_views_v1',
    'work_board_item_placements_v1'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())', table_name);
  END LOOP;
END $$;
