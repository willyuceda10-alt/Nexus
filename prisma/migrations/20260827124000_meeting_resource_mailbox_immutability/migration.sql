-- A booked Exchange resource mailbox is part of the external calendar identity.
-- Prevent silent retargeting of existing bookings to another mailbox.

CREATE OR REPLACE FUNCTION bridata_guard_meeting_resource_mailbox_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(trim(NEW.email)) IS DISTINCT FROM lower(trim(OLD.email))
     AND EXISTS (
       SELECT 1 FROM meeting_resource_bookings_v1 b
       WHERE b.meeting_resource_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'A meeting resource mailbox cannot be changed after the resource has been booked. Deactivate it and create a new resource instead.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_resources_v1_mailbox_guard ON meeting_resources_v1;
CREATE TRIGGER meeting_resources_v1_mailbox_guard
BEFORE UPDATE OF email ON meeting_resources_v1
FOR EACH ROW EXECUTE FUNCTION bridata_guard_meeting_resource_mailbox_v1();
