-- Unassigned human approvals are not broadcast to every tenant member.
-- When a REQUEST_APPROVAL action omits an explicit approver, route it to the
-- automation owner. Scope managers and tenant administrators may still decide it
-- through the API policy checks.

CREATE OR REPLACE FUNCTION bridata_default_automation_approver_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_user_id uuid;
BEGIN
  IF NEW.approver_user_id IS NULL THEN
    SELECT created_by_user_id INTO owner_user_id
    FROM automation_definitions_v1
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.automation_definition_id;

    IF owner_user_id IS NULL THEN
      RAISE EXCEPTION 'automation_owner_not_found' USING ERRCODE = 'P0001';
    END IF;
    NEW.approver_user_id := owner_user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS automation_approval_requests_v1_default_approver ON automation_approval_requests_v1;
CREATE TRIGGER automation_approval_requests_v1_default_approver
BEFORE INSERT ON automation_approval_requests_v1
FOR EACH ROW EXECUTE FUNCTION bridata_default_automation_approver_v1();
