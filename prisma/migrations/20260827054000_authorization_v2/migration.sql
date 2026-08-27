-- Bridata Authorization / Permissions V2

CREATE TABLE "authorization_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "scope_type" VARCHAR(20) NOT NULL,
  "scope_id" UUID NOT NULL,
  "subject_type" VARCHAR(30) NOT NULL,
  "subject_key" VARCHAR(100) NOT NULL,
  "permission_key" VARCHAR(150) NOT NULL,
  "effect" VARCHAR(10) NOT NULL,
  "created_by_user_id" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "authorization_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "authorization_policies_scope_type_check" CHECK ("scope_type" IN ('TENANT','WORKSPACE','PROJECT')),
  CONSTRAINT "authorization_policies_subject_type_check" CHECK ("subject_type" IN ('USER','TENANT_ROLE','WORKSPACE_ROLE')),
  CONSTRAINT "authorization_policies_effect_check" CHECK ("effect" IN ('ALLOW','DENY')),
  CONSTRAINT "authorization_policies_permission_key_check" CHECK (length(trim("permission_key")) > 0),
  CONSTRAINT "authorization_policies_subject_key_check" CHECK (length(trim("subject_key")) > 0)
);

CREATE UNIQUE INDEX "authorization_policies_subject_permission_key"
  ON "authorization_policies"("tenant_id", "scope_type", "scope_id", "subject_type", "subject_key", "permission_key");
CREATE INDEX "authorization_policies_scope_permission_idx"
  ON "authorization_policies"("tenant_id", "scope_type", "scope_id", "permission_key");
CREATE INDEX "authorization_policies_subject_idx"
  ON "authorization_policies"("tenant_id", "subject_type", "subject_key");

ALTER TABLE "authorization_policies"
  ADD CONSTRAINT "authorization_policies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "authorization_policies"
  ADD CONSTRAINT "authorization_policies_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense-in-depth: ensure every policy scope really belongs to its tenant.
CREATE OR REPLACE FUNCTION bridata_validate_authorization_policy_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  scoped_tenant uuid;
BEGIN
  IF NEW.scope_type = 'TENANT' THEN
    IF NEW.scope_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'authorization_tenant_scope_mismatch' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.scope_type = 'WORKSPACE' THEN
    SELECT tenant_id INTO scoped_tenant FROM workspaces WHERE id = NEW.scope_id;
    IF scoped_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'authorization_workspace_scope_mismatch' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.scope_type = 'PROJECT' THEN
    SELECT tenant_id INTO scoped_tenant
    FROM nexus_objects
    WHERE id = NEW.scope_id AND object_type_key = 'PROJECT' AND deleted_at IS NULL;
    IF scoped_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'authorization_project_scope_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER authorization_policy_scope_guard
BEFORE INSERT OR UPDATE ON authorization_policies
FOR EACH ROW EXECUTE FUNCTION bridata_validate_authorization_policy_scope();

ALTER TABLE "authorization_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "authorization_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "authorization_policies";
CREATE POLICY tenant_isolation ON "authorization_policies"
  USING (tenant_id = nexus_current_tenant_id())
  WITH CHECK (tenant_id = nexus_current_tenant_id());
