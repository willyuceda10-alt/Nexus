-- Recurring Meetings V1 follow-up integrity fixes.

-- V1 deliberately supports absolute-monthly days 1..28 only until Outlook/Graph
-- smoke tests explicitly validate edge-day behavior for this application.
ALTER TABLE meeting_recurrence_series_v1
  DROP CONSTRAINT IF EXISTS meeting_recurrence_series_day_check;
ALTER TABLE meeting_recurrence_series_v1
  ADD CONSTRAINT meeting_recurrence_series_day_check
  CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28);

-- The initial recurring migration already attached this function to a lifecycle
-- trigger. Normalize the trigger definition after the follow-up function replacement
-- and guarantee that exactly one propagation trigger remains.
DROP TRIGGER IF EXISTS meeting_recurrence_series_lifecycle_propagation_v1
  ON meeting_collaboration_v1;
DROP TRIGGER IF EXISTS meeting_collaboration_series_lifecycle_guard_v1
  ON meeting_collaboration_v1;
CREATE TRIGGER meeting_collaboration_series_lifecycle_guard_v1
AFTER UPDATE OF lifecycle_status, cancelled_at, cancellation_comment
ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_propagate_series_lifecycle_v1();
