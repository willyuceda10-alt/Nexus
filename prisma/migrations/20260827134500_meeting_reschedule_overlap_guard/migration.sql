-- Prevent a time update from moving an already-booked meeting on top of another booking.

CREATE OR REPLACE FUNCTION bridata_guard_meeting_reschedule_resources_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resource_row record;
  conflict_exists boolean;
BEGIN
  IF NEW.start_at IS NOT DISTINCT FROM OLD.start_at AND NEW.end_at IS NOT DISTINCT FROM OLD.end_at THEN
    RETURN NEW;
  END IF;
  IF NEW.lifecycle_status <> 'SCHEDULED'::"MeetingLifecycleStatusV2" THEN
    RETURN NEW;
  END IF;

  FOR resource_row IN
    SELECT meeting_resource_id
    FROM meeting_resource_bookings_v1
    WHERE tenant_id = NEW.tenant_id AND meeting_collaboration_id = NEW.id
    ORDER BY meeting_resource_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || resource_row.meeting_resource_id::text, 0));
    SELECT EXISTS (
      SELECT 1
      FROM meeting_resource_bookings_v1 b
      JOIN meeting_collaboration_v1 c ON c.id = b.meeting_collaboration_id
      WHERE b.tenant_id = NEW.tenant_id
        AND b.meeting_resource_id = resource_row.meeting_resource_id
        AND b.meeting_collaboration_id <> NEW.id
        AND c.lifecycle_status = 'SCHEDULED'::"MeetingLifecycleStatusV2"
        AND c.start_at < NEW.end_at
        AND c.end_at > NEW.start_at
    ) INTO conflict_exists;
    IF conflict_exists THEN
      RAISE EXCEPTION 'Meeting resource is already booked for the requested rescheduled time.' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_collaboration_v1_reschedule_resource_guard ON meeting_collaboration_v1;
CREATE TRIGGER meeting_collaboration_v1_reschedule_resource_guard
BEFORE UPDATE OF start_at, end_at ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_guard_meeting_reschedule_resources_v2();
