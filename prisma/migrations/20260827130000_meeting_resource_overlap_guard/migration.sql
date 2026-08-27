-- Bridata Meeting Scheduling V2 · prevent concurrent/overlapping resource reservations.
-- The guard is database-level so every current/future booking path is protected.

CREATE OR REPLACE FUNCTION bridata_guard_meeting_resource_overlap_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_start timestamptz;
  new_end timestamptz;
BEGIN
  -- Serialize bookings for one tenant/resource for the duration of the transaction.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'meeting-resource:' || NEW.tenant_id::text || ':' || NEW.meeting_resource_id::text,
      0
    )
  );

  SELECT start_at, end_at
    INTO new_start, new_end
    FROM meeting_collaboration_v1
   WHERE id = NEW.meeting_collaboration_id
     AND tenant_id = NEW.tenant_id;

  IF new_start IS NULL OR new_end IS NULL THEN
    RAISE EXCEPTION 'Meeting collaboration is missing for resource booking.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM meeting_resource_bookings_v1 existing
      JOIN meeting_collaboration_v1 collaboration
        ON collaboration.id = existing.meeting_collaboration_id
       AND collaboration.tenant_id = existing.tenant_id
     WHERE existing.tenant_id = NEW.tenant_id
       AND existing.meeting_resource_id = NEW.meeting_resource_id
       AND existing.meeting_collaboration_id <> NEW.meeting_collaboration_id
       AND collaboration.start_at < new_end
       AND collaboration.end_at > new_start
  ) THEN
    RAISE EXCEPTION 'Meeting resource already has an overlapping reservation.' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_resource_booking_overlap_guard_v2 ON meeting_resource_bookings_v1;
CREATE TRIGGER meeting_resource_booking_overlap_guard_v2
BEFORE INSERT OR UPDATE OF meeting_collaboration_id, meeting_resource_id
ON meeting_resource_bookings_v1
FOR EACH ROW EXECUTE FUNCTION bridata_guard_meeting_resource_overlap_v2();
