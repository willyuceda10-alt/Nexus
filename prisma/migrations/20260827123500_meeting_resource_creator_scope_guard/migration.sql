-- Strengthen Meeting Resources V1 creator scope at the database boundary.

CREATE OR REPLACE FUNCTION bridata_validate_meeting_resource_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workspaces w
    WHERE w.id = NEW.workspace_id AND w.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Meeting resource workspace scope is inconsistent.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    JOIN tenant_memberships tm ON tm.user_id = wm.user_id AND tm.tenant_id = NEW.tenant_id
    WHERE wm.tenant_id = NEW.tenant_id
      AND wm.workspace_id = NEW.workspace_id
      AND wm.user_id = NEW.created_by
      AND u.is_active = true
      AND tm.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'Meeting resource creator must be an active member of the resource workspace.' USING ERRCODE = 'P0001';
  END IF;

  NEW.email := lower(trim(NEW.email));
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
