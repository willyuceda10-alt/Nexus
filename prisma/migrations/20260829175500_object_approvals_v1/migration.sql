-- Bridata Object Approval Core V1
-- Persistent business approvals attached directly to Nexus objects.

CREATE TABLE "object_approval_requests_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "approver_user_id" UUID NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "description" TEXT,
  "previous_object_status" VARCHAR(100) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "decision_by_user_id" UUID,
  "decision_comment" TEXT,
  "decided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "object_approval_requests_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "object_approval_requests_v1_status_check" CHECK ("status" IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  CONSTRAINT "object_approval_requests_v1_decision_check" CHECK (
    ("status" = 'PENDING' AND "decision_by_user_id" IS NULL AND "decided_at" IS NULL)
    OR
    ("status" IN ('APPROVED','REJECTED','CANCELLED') AND "decision_by_user_id" IS NOT NULL AND "decided_at" IS NOT NULL)
  ),
  CONSTRAINT "object_approval_requests_v1_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "object_approval_requests_v1_object_fkey" FOREIGN KEY ("object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE,
  CONSTRAINT "object_approval_requests_v1_requested_by_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "object_approval_requests_v1_approver_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "object_approval_requests_v1_decision_by_fkey" FOREIGN KEY ("decision_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "object_approval_requests_v1_pending_object_key"
  ON "object_approval_requests_v1"("object_id")
  WHERE "status" = 'PENDING';
CREATE INDEX "object_approval_requests_v1_object_idx"
  ON "object_approval_requests_v1"("tenant_id","object_id","created_at" DESC);
CREATE INDEX "object_approval_requests_v1_approver_idx"
  ON "object_approval_requests_v1"("tenant_id","approver_user_id","status","created_at" DESC);

CREATE OR REPLACE FUNCTION bridata_validate_object_approval_scope_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  object_tenant uuid;
BEGIN
  SELECT tenant_id INTO object_tenant
  FROM nexus_objects
  WHERE id = NEW.object_id AND deleted_at IS NULL;

  IF object_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'object_approval_object_tenant_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = NEW.tenant_id
      AND tm.user_id = NEW.requested_by_user_id
      AND tm.status = 'ACTIVE'
      AND u.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'object_approval_requester_not_active_tenant_member' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = NEW.tenant_id
      AND tm.user_id = NEW.approver_user_id
      AND tm.status = 'ACTIVE'
      AND u.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'object_approval_approver_not_active_tenant_member' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.decision_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = NEW.tenant_id
      AND tm.user_id = NEW.decision_by_user_id
      AND tm.status = 'ACTIVE'
      AND u.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'object_approval_decider_not_active_tenant_member' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER object_approval_requests_v1_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, object_id, requested_by_user_id, approver_user_id, decision_by_user_id
ON object_approval_requests_v1
FOR EACH ROW EXECUTE FUNCTION bridata_validate_object_approval_scope_v1();

ALTER TABLE object_approval_requests_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE object_approval_requests_v1 FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON object_approval_requests_v1
  USING (tenant_id = nexus_current_tenant_id())
  WITH CHECK (tenant_id = nexus_current_tenant_id());
