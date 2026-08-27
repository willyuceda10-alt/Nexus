-- Meeting Collaboration V1 - attendee scope hardening
-- Internal attendees must remain active members of the same workspace.

CREATE UNIQUE INDEX IF NOT EXISTS ux_meeting_attendee_email_ci_v1
  ON meeting_collaboration_attendees_v1 (meeting_collaboration_id, lower(email));

CREATE OR REPLACE FUNCTION bridata_validate_meeting_attendee_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  meeting_tenant uuid;
  meeting_workspace uuid;
BEGIN
  SELECT tenant_id, workspace_id
    INTO meeting_tenant, meeting_workspace
    FROM meeting_collaboration_v1
   WHERE id = NEW.meeting_collaboration_id;

  IF meeting_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Meeting attendee tenant scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM workspace_members wm
      JOIN tenant_memberships tm
        ON tm.tenant_id = wm.tenant_id
       AND tm.user_id = wm.user_id
      JOIN users u
        ON u.id = wm.user_id
     WHERE wm.tenant_id = NEW.tenant_id
       AND wm.workspace_id = meeting_workspace
       AND wm.user_id = NEW.user_id
       AND tm.status = 'ACTIVE'
       AND u.is_active = true
  ) THEN
    RAISE EXCEPTION 'Internal meeting attendee is not an active member of the meeting workspace.' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_collaboration_attendees_v1_scope_guard
  ON meeting_collaboration_attendees_v1;
CREATE TRIGGER meeting_collaboration_attendees_v1_scope_guard
BEFORE INSERT OR UPDATE ON meeting_collaboration_attendees_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_meeting_attendee_v1();
