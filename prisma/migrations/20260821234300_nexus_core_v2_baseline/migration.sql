-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PROVISIONING', 'DELETED');

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('ENTRA_ID', 'LOCAL', 'GOOGLE', 'GITHUB');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('OWNER', 'TENANT_ADMIN', 'MEMBER', 'GUEST');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('MICROSOFT_365', 'SAP', 'GITHUB', 'SLACK', 'GOOGLE_WORKSPACE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEGRADED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "plan" "PlanType" NOT NULL DEFAULT 'ENTERPRISE',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "issuer" VARCHAR(500) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "provider_tenant_id" VARCHAR(255),
    "email_snapshot" VARCHAR(255),
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(100),
    "schema" JSONB NOT NULL,
    "permissions" JSONB,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "object_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nexus_objects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "object_definition_id" UUID NOT NULL,
    "object_type_key" VARCHAR(100) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(100) NOT NULL DEFAULT 'DRAFT',
    "priority" VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "owner_id" UUID NOT NULL,
    "assignee_id" UUID,
    "start_date" TIMESTAMPTZ(6),
    "due_date" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "nexus_objects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_field_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "field_key" VARCHAR(100) NOT NULL,
    "value_text" TEXT,
    "value_number" DECIMAL(18,4),
    "value_date" TIMESTAMPTZ(6),
    "value_boolean" BOOLEAN,
    "value_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "object_field_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_relations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "source_object_id" UUID NOT NULL,
    "target_object_id" UUID NOT NULL,
    "relation_type" VARCHAR(100) NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "object_relations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "object_definition_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "states" JSONB NOT NULL,
    "transitions" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "user_id" UUID,
    "field_key" VARCHAR(100) NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "object_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "object_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "object_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "checksum_sha256" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "object_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "display_name" VARCHAR(255),
    "external_tenant_id" VARCHAR(255),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credential_reference" TEXT,
    "config" JSONB,
    "last_sync_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "domain_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(150) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resource_id" UUID,
    "details" JSONB,
    "correlation_id" VARCHAR(128),
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "user_identities_user_id_idx" ON "user_identities"("user_id");
CREATE INDEX "user_identities_provider_tenant_id_idx" ON "user_identities"("provider_tenant_id");
CREATE UNIQUE INDEX "user_identities_provider_issuer_subject_key" ON "user_identities"("provider", "issuer", "subject");
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");
CREATE INDEX "workspaces_tenant_id_idx" ON "workspaces"("tenant_id");
CREATE UNIQUE INDEX "workspaces_tenant_id_code_key" ON "workspaces"("tenant_id", "code");
CREATE INDEX "workspace_members_tenant_id_user_id_idx" ON "workspace_members"("tenant_id", "user_id");
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");
CREATE INDEX "object_definitions_tenant_id_idx" ON "object_definitions"("tenant_id");
CREATE UNIQUE INDEX "object_definitions_tenant_id_key_key" ON "object_definitions"("tenant_id", "key");
CREATE INDEX "nexus_objects_tenant_id_workspace_id_idx" ON "nexus_objects"("tenant_id", "workspace_id");
CREATE INDEX "nexus_objects_tenant_id_object_type_key_idx" ON "nexus_objects"("tenant_id", "object_type_key");
CREATE INDEX "nexus_objects_tenant_id_status_idx" ON "nexus_objects"("tenant_id", "status");
CREATE INDEX "nexus_objects_tenant_id_owner_id_idx" ON "nexus_objects"("tenant_id", "owner_id");
CREATE INDEX "nexus_objects_tenant_id_assignee_id_idx" ON "nexus_objects"("tenant_id", "assignee_id");
CREATE INDEX "nexus_objects_tenant_id_updated_at_idx" ON "nexus_objects"("tenant_id", "updated_at");
CREATE INDEX "object_field_values_tenant_id_field_key_value_number_idx" ON "object_field_values"("tenant_id", "field_key", "value_number");
CREATE INDEX "object_field_values_tenant_id_field_key_value_date_idx" ON "object_field_values"("tenant_id", "field_key", "value_date");
CREATE UNIQUE INDEX "object_field_values_object_id_field_key_key" ON "object_field_values"("object_id", "field_key");
CREATE INDEX "object_relations_tenant_id_source_object_id_idx" ON "object_relations"("tenant_id", "source_object_id");
CREATE INDEX "object_relations_tenant_id_target_object_id_idx" ON "object_relations"("tenant_id", "target_object_id");
CREATE UNIQUE INDEX "object_relations_source_object_id_target_object_id_relation_key" ON "object_relations"("source_object_id", "target_object_id", "relation_type");
CREATE INDEX "workflow_definitions_tenant_id_object_definition_id_idx" ON "workflow_definitions"("tenant_id", "object_definition_id");
CREATE INDEX "object_history_tenant_id_object_id_created_at_idx" ON "object_history"("tenant_id", "object_id", "created_at");
CREATE INDEX "object_comments_tenant_id_object_id_created_at_idx" ON "object_comments"("tenant_id", "object_id", "created_at");
CREATE INDEX "object_attachments_tenant_id_object_id_idx" ON "object_attachments"("tenant_id", "object_id");
CREATE INDEX "integration_connections_tenant_id_provider_status_idx" ON "integration_connections"("tenant_id", "provider", "status");
CREATE UNIQUE INDEX "domain_events_idempotency_key_key" ON "domain_events"("idempotency_key");
CREATE INDEX "domain_events_tenant_id_status_available_at_idx" ON "domain_events"("tenant_id", "status", "available_at");
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_resource_resource_id_idx" ON "audit_logs"("tenant_id", "resource", "resource_id");

ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_definitions" ADD CONSTRAINT "object_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nexus_objects" ADD CONSTRAINT "nexus_objects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nexus_objects" ADD CONSTRAINT "nexus_objects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nexus_objects" ADD CONSTRAINT "nexus_objects_object_definition_id_fkey" FOREIGN KEY ("object_definition_id") REFERENCES "object_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nexus_objects" ADD CONSTRAINT "nexus_objects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nexus_objects" ADD CONSTRAINT "nexus_objects_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "object_field_values" ADD CONSTRAINT "object_field_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_field_values" ADD CONSTRAINT "object_field_values_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_relations" ADD CONSTRAINT "object_relations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_relations" ADD CONSTRAINT "object_relations_source_object_id_fkey" FOREIGN KEY ("source_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_relations" ADD CONSTRAINT "object_relations_target_object_id_fkey" FOREIGN KEY ("target_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_object_definition_id_fkey" FOREIGN KEY ("object_definition_id") REFERENCES "object_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_history" ADD CONSTRAINT "object_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_history" ADD CONSTRAINT "object_history_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_comments" ADD CONSTRAINT "object_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_comments" ADD CONSTRAINT "object_comments_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_attachments" ADD CONSTRAINT "object_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_attachments" ADD CONSTRAINT "object_attachments_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
