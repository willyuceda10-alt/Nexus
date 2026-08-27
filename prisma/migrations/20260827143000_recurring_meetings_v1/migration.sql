-- Bridata Recurring Meetings V1

DO $$ BEGIN
  CREATE TYPE "MeetingRecurrencePatternTypeV1" AS ENUM ('DAILY', 'WEEKLY', 'ABSOLUTE_MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "MeetingRecurrenceRangeTypeV1" AS ENUM ('NUMBERED', 'END_DATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "meeting_recurrence_series_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "meeting_collaboration_id" uuid NOT NULL UNIQUE REFERENCES "meeting_collaboration_v1"("id") ON DELETE CASCADE,
  "master_meeting_object_id" uuid NOT NULL UNIQUE REFERENCES "nexus_objects"("id") ON DELETE CASCADE,
  "pattern_type" "MeetingRecurrencePatternTypeV1" NOT NULL,
  "interval" integer NOT NULL,
  "days_of_week" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "day_of_month" integer,
  "range_type" "MeetingRecurrenceRangeTypeV1" NOT NULL,
  "range_start_date" date NOT NULL,
  "range_end_date" date,
  "number_of_occurrences" integer,
  "timezone" varchar(100) NOT NULL DEFAULT 'America/Lima',
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_recurrence_series_interval_check" CHECK ("interval" BETWEEN 1 AND 99),
  CONSTRAINT "meeting_recurrence_series_day_check" CHECK ("day_of_month" IS NULL OR "day_of_month" BETWEEN 1 AND 31),
  CONSTRAINT "meeting_recurrence_series_count_check" CHECK ("number_of_occurrences" IS NULL OR "number_of_occurrences" BETWEEN 2 AND 120),
  CONSTRAINT "meeting_recurrence_series_timezone_check" CHECK ("timezone" = 'America/Lima')
);
CREATE INDEX IF NOT EXISTS "meeting_recurrence_series_workspace_idx"
  ON "meeting_recurrence_series_v1"("tenant_id", "workspace_id", "range_start_date");

CREATE TABLE IF NOT EXISTS "meeting_recurrence_occurrences_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "series_id" uuid NOT NULL REFERENCES "meeting_recurrence_series_v1"("id") ON DELETE CASCADE,
  "sequence" integer NOT NULL,
  "occurrence_date" date NOT NULL,
  "original_start_at" timestamptz(6) NOT NULL,
  "start_at" timestamptz(6) NOT NULL,
  "end_at" timestamptz(6) NOT NULL,
  "lifecycle_status" "MeetingLifecycleStatusV2" NOT NULL DEFAULT 'SCHEDULED',
  "is_exception" boolean NOT NULL DEFAULT false,
  "graph_event_id" varchar(1024),
  "cancellation_comment" text,
  "cancelled_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_recurrence_occurrence_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "meeting_recurrence_occurrence_time_check" CHECK ("end_at" > "start_at"),
  CONSTRAINT "meeting_recurrence_occurrence_series_sequence_key" UNIQUE ("series_id", "sequence"),
  CONSTRAINT "meeting_recurrence_occurrence_series_date_key" UNIQUE ("series_id", "occurrence_date")
);
CREATE INDEX IF NOT EXISTS "meeting_recurrence_occurrences_schedule_idx"
  ON "meeting_recurrence_occurrences_v1"("tenant_id", "start_at", "lifecycle_status");

CREATE TABLE IF NOT EXISTS "meeting_occurrence_resource_bookings_v1" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "occurrence_id" uuid NOT NULL REFERENCES "meeting_recurrence_occurrences_v1"("id") ON DELETE CASCADE,
  "meeting_resource_id" uuid NOT NULL REFERENCES "meeting_resources_v1"("id") ON DELETE RESTRICT,
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_occurrence_resource_booking_key" UNIQUE ("occurrence_id", "meeting_resource_id")
);
CREATE INDEX IF NOT EXISTS "meeting_occurrence_resource_booking_resource_idx"
  ON "meeting_occurrence_resource_bookings_v1"("tenant_id", "meeting_resource_id");

CREATE OR REPLACE FUNCTION bridata_validate_recurrence_series_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE collab_tenant uuid; collab_workspace uuid; collab_object uuid;
BEGIN
  SELECT tenant_id, workspace_id, meeting_object_id INTO collab_tenant, collab_workspace, collab_object
  FROM meeting_collaboration_v1 WHERE id = NEW.meeting_collaboration_id;
  IF collab_tenant IS DISTINCT FROM NEW.tenant_id OR collab_workspace IS DISTINCT FROM NEW.workspace_id OR collab_object IS DISTINCT FROM NEW.master_meeting_object_id THEN
    RAISE EXCEPTION 'Recurring meeting series scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.pattern_type = 'WEEKLY' AND cardinality(NEW.days_of_week) = 0 THEN
    RAISE EXCEPTION 'Weekly recurrence requires days_of_week.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.pattern_type <> 'WEEKLY' AND cardinality(NEW.days_of_week) <> 0 THEN
    RAISE EXCEPTION 'days_of_week is only supported for weekly recurrence.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.pattern_type = 'ABSOLUTE_MONTHLY' AND NEW.day_of_month IS NULL THEN
    RAISE EXCEPTION 'Absolute monthly recurrence requires day_of_month.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.pattern_type <> 'ABSOLUTE_MONTHLY' AND NEW.day_of_month IS NOT NULL THEN
    RAISE EXCEPTION 'day_of_month is only supported for absolute monthly recurrence.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.range_type = 'NUMBERED' AND (NEW.number_of_occurrences IS NULL OR NEW.range_end_date IS NOT NULL) THEN
    RAISE EXCEPTION 'Numbered recurrence requires number_of_occurrences only.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.range_type = 'END_DATE' AND (NEW.range_end_date IS NULL OR NEW.number_of_occurrences IS NOT NULL OR NEW.range_end_date < NEW.range_start_date) THEN
    RAISE EXCEPTION 'End-date recurrence requires a valid range_end_date only.' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS meeting_recurrence_series_scope_guard ON meeting_recurrence_series_v1;
CREATE TRIGGER meeting_recurrence_series_scope_guard BEFORE INSERT OR UPDATE ON meeting_recurrence_series_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_recurrence_series_v1();

CREATE OR REPLACE FUNCTION bridata_validate_recurrence_occurrence_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE series_tenant uuid;
BEGIN
  SELECT tenant_id INTO series_tenant FROM meeting_recurrence_series_v1 WHERE id = NEW.series_id;
  IF series_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Recurring meeting occurrence scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  IF (NEW.start_at AT TIME ZONE 'America/Lima')::date IS DISTINCT FROM NEW.occurrence_date THEN
    RAISE EXCEPTION 'Occurrence date must match the effective start in America/Lima.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.lifecycle_status = 'CANCELLED' AND NEW.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'Cancelled recurrence occurrence must include cancelled_at.' USING ERRCODE = 'P0001';
  END IF;
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS meeting_recurrence_occurrence_scope_guard ON meeting_recurrence_occurrences_v1;
CREATE TRIGGER meeting_recurrence_occurrence_scope_guard BEFORE INSERT OR UPDATE ON meeting_recurrence_occurrences_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_recurrence_occurrence_v1();

CREATE OR REPLACE FUNCTION bridata_guard_occurrence_resource_booking_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_start timestamptz; new_end timestamptz; occurrence_tenant uuid; occurrence_workspace uuid; resource_tenant uuid; resource_workspace uuid; resource_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('meeting-resource:' || NEW.tenant_id::text || ':' || NEW.meeting_resource_id::text, 0));
  SELECT o.start_at, o.end_at, o.tenant_id, s.workspace_id
    INTO new_start, new_end, occurrence_tenant, occurrence_workspace
  FROM meeting_recurrence_occurrences_v1 o JOIN meeting_recurrence_series_v1 s ON s.id = o.series_id
  WHERE o.id = NEW.occurrence_id;
  SELECT tenant_id, workspace_id, is_active INTO resource_tenant, resource_workspace, resource_active FROM meeting_resources_v1 WHERE id = NEW.meeting_resource_id;
  IF occurrence_tenant IS DISTINCT FROM NEW.tenant_id OR resource_tenant IS DISTINCT FROM NEW.tenant_id OR occurrence_workspace IS DISTINCT FROM resource_workspace THEN
    RAISE EXCEPTION 'Recurring occurrence resource scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;
  IF resource_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Inactive meeting resources cannot be newly booked.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM meeting_resource_bookings_v1 b
    JOIN meeting_collaboration_v1 c ON c.id = b.meeting_collaboration_id AND c.tenant_id = b.tenant_id
    WHERE b.tenant_id = NEW.tenant_id AND b.meeting_resource_id = NEW.meeting_resource_id
      AND c.lifecycle_status = 'SCHEDULED' AND c.start_at < new_end AND c.end_at > new_start
  ) THEN RAISE EXCEPTION 'Meeting resource already has an overlapping single-meeting reservation.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (
    SELECT 1 FROM meeting_occurrence_resource_bookings_v1 b
    JOIN meeting_recurrence_occurrences_v1 o ON o.id = b.occurrence_id AND o.tenant_id = b.tenant_id
    WHERE b.tenant_id = NEW.tenant_id AND b.meeting_resource_id = NEW.meeting_resource_id
      AND b.occurrence_id <> NEW.occurrence_id AND o.lifecycle_status = 'SCHEDULED'
      AND o.start_at < new_end AND o.end_at > new_start
  ) THEN RAISE EXCEPTION 'Meeting resource already has an overlapping recurring reservation.' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS meeting_occurrence_resource_overlap_guard_v1 ON meeting_occurrence_resource_bookings_v1;
CREATE TRIGGER meeting_occurrence_resource_overlap_guard_v1 BEFORE INSERT OR UPDATE OF occurrence_id, meeting_resource_id
ON meeting_occurrence_resource_bookings_v1 FOR EACH ROW EXECUTE FUNCTION bridata_guard_occurrence_resource_booking_v1();

-- Extend the existing single-meeting booking guard so a one-off meeting cannot collide with a recurring occurrence.
CREATE OR REPLACE FUNCTION bridata_guard_meeting_resource_overlap_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_start timestamptz; new_end timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('meeting-resource:' || NEW.tenant_id::text || ':' || NEW.meeting_resource_id::text, 0));
  SELECT start_at, end_at INTO new_start, new_end FROM meeting_collaboration_v1
  WHERE id = NEW.meeting_collaboration_id AND tenant_id = NEW.tenant_id;
  IF new_start IS NULL OR new_end IS NULL THEN RAISE EXCEPTION 'Meeting collaboration is missing for resource booking.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (
    SELECT 1 FROM meeting_resource_bookings_v1 existing
    JOIN meeting_collaboration_v1 c ON c.id = existing.meeting_collaboration_id AND c.tenant_id = existing.tenant_id
    WHERE existing.tenant_id = NEW.tenant_id AND existing.meeting_resource_id = NEW.meeting_resource_id
      AND existing.meeting_collaboration_id <> NEW.meeting_collaboration_id AND c.lifecycle_status = 'SCHEDULED'
      AND c.start_at < new_end AND c.end_at > new_start
  ) THEN RAISE EXCEPTION 'Meeting resource already has an overlapping reservation.' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (
    SELECT 1 FROM meeting_occurrence_resource_bookings_v1 rb
    JOIN meeting_recurrence_occurrences_v1 o ON o.id = rb.occurrence_id AND o.tenant_id = rb.tenant_id
    WHERE rb.tenant_id = NEW.tenant_id AND rb.meeting_resource_id = NEW.meeting_resource_id
      AND o.lifecycle_status = 'SCHEDULED' AND o.start_at < new_end AND o.end_at > new_start
  ) THEN RAISE EXCEPTION 'Meeting resource overlaps a recurring occurrence.' USING ERRCODE = 'P0001'; END IF;
  RETURN NEW;
END; $$;

-- When an occurrence is moved, re-check all resources assigned to that occurrence.
CREATE OR REPLACE FUNCTION bridata_guard_recurring_occurrence_reschedule_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource_row record;
BEGIN
  IF NEW.lifecycle_status <> 'SCHEDULED' OR (NEW.start_at = OLD.start_at AND NEW.end_at = OLD.end_at) THEN RETURN NEW; END IF;
  FOR resource_row IN SELECT meeting_resource_id FROM meeting_occurrence_resource_bookings_v1 WHERE occurrence_id = NEW.id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('meeting-resource:' || NEW.tenant_id::text || ':' || resource_row.meeting_resource_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM meeting_resource_bookings_v1 b JOIN meeting_collaboration_v1 c ON c.id=b.meeting_collaboration_id AND c.tenant_id=b.tenant_id
      WHERE b.tenant_id=NEW.tenant_id AND b.meeting_resource_id=resource_row.meeting_resource_id AND c.lifecycle_status='SCHEDULED'
        AND c.start_at < NEW.end_at AND c.end_at > NEW.start_at
    ) OR EXISTS (
      SELECT 1 FROM meeting_occurrence_resource_bookings_v1 b JOIN meeting_recurrence_occurrences_v1 o ON o.id=b.occurrence_id AND o.tenant_id=b.tenant_id
      WHERE b.tenant_id=NEW.tenant_id AND b.meeting_resource_id=resource_row.meeting_resource_id AND b.occurrence_id<>NEW.id
        AND o.lifecycle_status='SCHEDULED' AND o.start_at < NEW.end_at AND o.end_at > NEW.start_at
    ) THEN RAISE EXCEPTION 'Recurring occurrence reschedule overlaps another resource reservation.' USING ERRCODE='P0001'; END IF;
  END LOOP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS meeting_recurrence_occurrence_reschedule_guard ON meeting_recurrence_occurrences_v1;
CREATE TRIGGER meeting_recurrence_occurrence_reschedule_guard BEFORE UPDATE OF start_at, end_at ON meeting_recurrence_occurrences_v1
FOR EACH ROW EXECUTE FUNCTION bridata_guard_recurring_occurrence_reschedule_v1();

-- Cancelling a master series via the existing lifecycle flow also frees all occurrence reservations logically.
CREATE OR REPLACE FUNCTION bridata_propagate_series_lifecycle_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status AND NEW.lifecycle_status IN ('CANCEL_PENDING', 'CANCELLED') THEN
    UPDATE meeting_recurrence_occurrences_v1 o
       SET lifecycle_status = NEW.lifecycle_status,
           cancelled_at = CASE WHEN NEW.lifecycle_status='CANCELLED' THEN COALESCE(NEW.cancelled_at, CURRENT_TIMESTAMP) ELSE o.cancelled_at END,
           cancellation_comment = COALESCE(NEW.cancellation_comment, o.cancellation_comment),
           updated_at = CURRENT_TIMESTAMP
      FROM meeting_recurrence_series_v1 s
     WHERE s.meeting_collaboration_id = NEW.id AND o.series_id = s.id AND o.lifecycle_status = 'SCHEDULED';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS meeting_collaboration_series_lifecycle_guard_v1 ON meeting_collaboration_v1;
CREATE TRIGGER meeting_collaboration_series_lifecycle_guard_v1 AFTER UPDATE OF lifecycle_status ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_propagate_series_lifecycle_v1();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['meeting_recurrence_series_v1','meeting_recurrence_occurrences_v1','meeting_occurrence_resource_bookings_v1'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    BEGIN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())', table_name);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
