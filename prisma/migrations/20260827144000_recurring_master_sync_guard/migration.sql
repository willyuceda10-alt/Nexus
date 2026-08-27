-- Bridata Recurring Meetings V1
-- Prevent occurrence-level M365 divergence while the Outlook series master is still pending/failed without a graph event id.

CREATE OR REPLACE FUNCTION bridata_guard_recurring_occurrence_master_sync_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  collaboration_sync_status "MeetingM365SyncStatusV1";
  collaboration_graph_event_id varchar(1024);
BEGIN
  SELECT c.sync_status, c.graph_event_id
    INTO collaboration_sync_status, collaboration_graph_event_id
    FROM meeting_recurrence_series_v1 s
    JOIN meeting_collaboration_v1 c
      ON c.id = s.meeting_collaboration_id
     AND c.tenant_id = s.tenant_id
   WHERE s.id = NEW.series_id
     AND s.tenant_id = NEW.tenant_id;

  IF collaboration_sync_status IS NULL THEN
    RAISE EXCEPTION 'Recurring series collaboration is missing.' USING ERRCODE = 'P0001';
  END IF;

  -- LOCAL_ONLY series can have local exceptions. If the series has entered the M365
  -- sync lifecycle, the Outlook series master must exist before an individual
  -- occurrence can become an exception or cancellation.
  IF collaboration_sync_status <> 'LOCAL_ONLY'::"MeetingM365SyncStatusV1"
     AND collaboration_graph_event_id IS NULL
     AND (
       NEW.start_at IS DISTINCT FROM OLD.start_at
       OR NEW.end_at IS DISTINCT FROM OLD.end_at
       OR NEW.occurrence_date IS DISTINCT FROM OLD.occurrence_date
       OR NEW.is_exception IS DISTINCT FROM OLD.is_exception
       OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
       OR NEW.cancellation_comment IS DISTINCT FROM OLD.cancellation_comment
     ) THEN
    RAISE EXCEPTION 'Recurring series master must be synchronized before occurrence-level exceptions or cancellations.' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_recurrence_occurrence_master_sync_guard_v1
  ON meeting_recurrence_occurrences_v1;
CREATE TRIGGER meeting_recurrence_occurrence_master_sync_guard_v1
BEFORE UPDATE OF start_at, end_at, occurrence_date, is_exception, lifecycle_status, cancellation_comment
ON meeting_recurrence_occurrences_v1
FOR EACH ROW EXECUTE FUNCTION bridata_guard_recurring_occurrence_master_sync_v1();
