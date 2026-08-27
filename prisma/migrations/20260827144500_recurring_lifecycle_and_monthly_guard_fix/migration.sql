-- Recurring Meetings V1 follow-up integrity fixes.

-- V1 deliberately supports absolute-monthly days 1..28 only until Outlook/Graph
-- smoke tests explicitly validate edge-day behavior for this application.
ALTER TABLE meeting_recurrence_series_v1
  DROP CONSTRAINT IF EXISTS meeting_recurrence_series_day_check;
ALTER TABLE meeting_recurrence_series_v1
  ADD CONSTRAINT meeting_recurrence_series_day_check
  CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28);

-- The propagation function was introduced by the previous migration. Attach it
-- explicitly so whole-series cancellation propagates to materialized occurrences.
DROP TRIGGER IF EXISTS meeting_recurrence_series_lifecycle_propagation_v1
  ON meeting_collaboration_v1;
CREATE TRIGGER meeting_recurrence_series_lifecycle_propagation_v1
AFTER UPDATE OF lifecycle_status, cancelled_at, cancellation_comment
ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_propagate_series_lifecycle_v1();
