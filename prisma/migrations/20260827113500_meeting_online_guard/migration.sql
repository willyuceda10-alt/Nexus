-- A Microsoft 365 event that has been converted to an online meeting cannot be
-- silently downgraded by Bridata after Graph synchronization.

CREATE OR REPLACE FUNCTION bridata_guard_synced_online_meeting_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.graph_event_id IS NOT NULL
     AND OLD.is_online = true
     AND NEW.is_online = false THEN
    RAISE EXCEPTION 'A synchronized Teams meeting cannot be converted back to an offline meeting.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_collaboration_v1_online_guard ON meeting_collaboration_v1;
CREATE TRIGGER meeting_collaboration_v1_online_guard
BEFORE UPDATE ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_guard_synced_online_meeting_v1();
