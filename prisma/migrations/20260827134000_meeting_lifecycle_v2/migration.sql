-- Bridata Meeting Lifecycle V2

DO $$ BEGIN
  CREATE TYPE "MeetingLifecycleStatusV2" AS ENUM ('SCHEDULED', 'CANCEL_PENDING', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "meeting_collaboration_v1"
  ADD COLUMN IF NOT EXISTS "lifecycle_status" "MeetingLifecycleStatusV2" NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz(6),
  ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "cancellation_comment" text,
  ADD COLUMN IF NOT EXISTS "last_cancel_event_id" uuid;

CREATE INDEX IF NOT EXISTS "meeting_collaboration_v1_tenant_lifecycle_idx"
  ON "meeting_collaboration_v1"("tenant_id", "lifecycle_status", "start_at");

CREATE OR REPLACE FUNCTION bridata_validate_meeting_lifecycle_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lifecycle_status = 'CANCELLED'::"MeetingLifecycleStatusV2" AND NEW.cancelled_at IS NULL THEN
    RAISE EXCEPTION 'Cancelled meeting must include cancelled_at.' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.cancelled_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM users u
    JOIN tenant_memberships tm ON tm.user_id = u.id AND tm.tenant_id = NEW.tenant_id AND tm.status = 'ACTIVE'
    JOIN workspace_members wm ON wm.user_id = u.id AND wm.tenant_id = NEW.tenant_id AND wm.workspace_id = NEW.workspace_id
    WHERE u.id = NEW.cancelled_by AND u.is_active = true
  ) THEN
    RAISE EXCEPTION 'Meeting cancellation actor is not active in the workspace.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_collaboration_v1_lifecycle_guard ON meeting_collaboration_v1;
CREATE TRIGGER meeting_collaboration_v1_lifecycle_guard
BEFORE INSERT OR UPDATE OF lifecycle_status, cancelled_at, cancelled_by ON meeting_collaboration_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_meeting_lifecycle_v2();
