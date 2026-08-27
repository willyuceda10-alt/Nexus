-- Bridata Work OS · Board Configuration & Option Engine V1

ALTER TYPE "WorkBoardColumnTypeV1" ADD VALUE IF NOT EXISTS 'RELATION';

CREATE TABLE "work_board_option_sets_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "board_id" uuid NOT NULL REFERENCES "work_boards_v1"("id") ON DELETE CASCADE,
  "column_id" uuid NOT NULL REFERENCES "work_board_columns_v1"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "allow_multiple" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_board_option_sets_v1_column_key" UNIQUE ("column_id")
);

CREATE TABLE "work_board_options_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "option_set_id" uuid NOT NULL REFERENCES "work_board_option_sets_v1"("id") ON DELETE CASCADE,
  "key" varchar(100) NOT NULL,
  "label" varchar(255) NOT NULL,
  "color" varchar(30),
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_board_options_v1_set_key_key" UNIQUE ("option_set_id", "key")
);

CREATE INDEX "work_board_option_sets_v1_tenant_board_idx"
  ON "work_board_option_sets_v1"("tenant_id", "board_id");
CREATE INDEX "work_board_options_v1_tenant_set_sort_idx"
  ON "work_board_options_v1"("tenant_id", "option_set_id", "sort_order");

CREATE OR REPLACE FUNCTION bridata_validate_board_option_set_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  board_tenant uuid;
  column_tenant uuid;
  column_board uuid;
  column_type "WorkBoardColumnTypeV1";
BEGIN
  SELECT tenant_id INTO board_tenant FROM work_boards_v1 WHERE id = NEW.board_id;
  SELECT tenant_id, board_id, data_type
    INTO column_tenant, column_board, column_type
    FROM work_board_columns_v1 WHERE id = NEW.column_id;

  IF board_tenant IS DISTINCT FROM NEW.tenant_id
     OR column_tenant IS DISTINCT FROM NEW.tenant_id
     OR column_board IS DISTINCT FROM NEW.board_id THEN
    RAISE EXCEPTION 'Board option set scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;

  IF column_type NOT IN ('STATUS'::"WorkBoardColumnTypeV1", 'PRIORITY'::"WorkBoardColumnTypeV1", 'TAGS'::"WorkBoardColumnTypeV1") THEN
    RAISE EXCEPTION 'Option sets can only be attached to STATUS, PRIORITY or TAGS columns.' USING ERRCODE = 'P0001';
  END IF;

  IF column_type = 'TAGS'::"WorkBoardColumnTypeV1" AND NEW.allow_multiple = false THEN
    NEW.allow_multiple := true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_board_option_sets_v1_scope_guard
BEFORE INSERT OR UPDATE ON work_board_option_sets_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_board_option_set_v1();

CREATE OR REPLACE FUNCTION bridata_validate_board_option_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  set_tenant uuid;
BEGIN
  SELECT tenant_id INTO set_tenant FROM work_board_option_sets_v1 WHERE id = NEW.option_set_id;
  IF set_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Board option tenant scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER work_board_options_v1_scope_guard
BEFORE INSERT OR UPDATE ON work_board_options_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_board_option_v1();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'work_board_option_sets_v1',
    'work_board_options_v1'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())', table_name);
  END LOOP;
END $$;
