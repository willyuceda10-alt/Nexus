-- A locally cancelled meeting must stop exposing live join/outlook links immediately.

CREATE OR REPLACE FUNCTION bridata_clear_meeting_links_on_cancel_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lifecycle_status IN ('CANCEL_PENDING'::"MeetingLifecycleStatusV2", 'CANCELLED'::"MeetingLifecycleStatusV2") THEN
    NEW.join_url := NULL;
    NEW.web_link := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_collaboration_v1_cancel_link_guard ON meeting_collaboration_v1;
CREATE TRIGGER meeting_collaboration_v1_cancel_link_guard
BEFORE INSERT OR UPDATE OF lifecycle_status ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_clear_meeting_links_on_cancel_v2();
