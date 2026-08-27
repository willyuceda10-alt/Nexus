-- Recurring Meetings V1 follow-up: optimistic concurrency and master lifecycle propagation.

ALTER TABLE "meeting_recurrence_occurrences_v1"
  ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE "meeting_recurrence_occurrences_v1"
    ADD CONSTRAINT "meeting_recurrence_occurrence_version_check" CHECK ("version" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION bridata_propagate_series_lifecycle_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
     AND NEW.lifecycle_status IN ('CANCEL_PENDING', 'CANCELLED') THEN
    UPDATE meeting_recurrence_occurrences_v1 o
       SET lifecycle_status = NEW.lifecycle_status,
           version = o.version + 1,
           cancelled_at = CASE
             WHEN NEW.lifecycle_status = 'CANCELLED' THEN COALESCE(NEW.cancelled_at, CURRENT_TIMESTAMP)
             ELSE o.cancelled_at
           END,
           cancellation_comment = COALESCE(NEW.cancellation_comment, o.cancellation_comment),
           updated_at = CURRENT_TIMESTAMP
      FROM meeting_recurrence_series_v1 s
     WHERE s.meeting_collaboration_id = NEW.id
       AND o.series_id = s.id
       AND o.lifecycle_status <> 'CANCELLED';
  END IF;
  RETURN NEW;
END; $$;
