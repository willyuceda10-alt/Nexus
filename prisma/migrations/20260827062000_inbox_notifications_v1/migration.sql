-- Bridata Inbox / Internal Notifications V1

CREATE TYPE "InboxPriorityV1" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "InboxStatusV1" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "NotificationChannelV1" AS ENUM ('INTERNAL');
CREATE TYPE "NotificationDeliveryStatusV1" AS ENUM ('DELIVERED', 'FAILED');

CREATE TABLE "inbox_items_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_id" UUID,
  "project_object_id" UUID,
  "source_type" VARCHAR(80) NOT NULL,
  "source_id" UUID,
  "title" VARCHAR(500) NOT NULL,
  "body" TEXT,
  "priority" "InboxPriorityV1" NOT NULL DEFAULT 'MEDIUM',
  "status" "InboxStatusV1" NOT NULL DEFAULT 'OPEN',
  "requires_action" BOOLEAN NOT NULL DEFAULT false,
  "unread" BOOLEAN NOT NULL DEFAULT true,
  "snoozed_until" TIMESTAMPTZ(6),
  "read_at" TIMESTAMPTZ(6),
  "resolved_at" TIMESTAMPTZ(6),
  "automation_run_id" UUID,
  "automation_step_run_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inbox_items_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inbox_items_v1_automation_step_key" UNIQUE ("automation_step_run_id")
);

CREATE TABLE "notification_deliveries_v1" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "inbox_item_id" UUID,
  "channel" "NotificationChannelV1" NOT NULL DEFAULT 'INTERNAL',
  "status" "NotificationDeliveryStatusV1" NOT NULL DEFAULT 'DELIVERED',
  "title" VARCHAR(500) NOT NULL,
  "body" TEXT,
  "automation_run_id" UUID,
  "automation_step_run_id" UUID,
  "delivered_at" TIMESTAMPTZ(6),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_deliveries_v1_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_deliveries_v1_automation_step_key" UNIQUE ("automation_step_run_id")
);

ALTER TABLE "inbox_items_v1"
  ADD CONSTRAINT "inbox_items_v1_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "inbox_items_v1_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "inbox_items_v1_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "inbox_items_v1_project_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries_v1"
  ADD CONSTRAINT "notification_deliveries_v1_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_deliveries_v1_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_deliveries_v1_inbox_fkey" FOREIGN KEY ("inbox_item_id") REFERENCES "inbox_items_v1"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "inbox_items_v1_user_status_idx"
  ON "inbox_items_v1"("tenant_id", "user_id", "status", "unread", "created_at" DESC);
CREATE INDEX "inbox_items_v1_scope_idx"
  ON "inbox_items_v1"("tenant_id", "workspace_id", "project_object_id");
CREATE INDEX "notification_deliveries_v1_user_idx"
  ON "notification_deliveries_v1"("tenant_id", "user_id", "created_at" DESC);

ALTER TABLE "inbox_items_v1" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_items_v1" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inbox_items_v1"
  USING (tenant_id = nexus_current_tenant_id())
  WITH CHECK (tenant_id = nexus_current_tenant_id());

ALTER TABLE "notification_deliveries_v1" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries_v1" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_deliveries_v1"
  USING (tenant_id = nexus_current_tenant_id())
  WITH CHECK (tenant_id = nexus_current_tenant_id());
