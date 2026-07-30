-- =============================================================================
-- NEXUS OS ENTERPRISE POSTGRESQL 16 MIGRATION
-- RLS (Row Level Security), Multi-Tenant Isolation, UUID v7 & GIN Indexing
-- =============================================================================

-- Enable pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. ROW LEVEL SECURITY (RLS) POLICIES FOR TENANT ISOLATION
-- -----------------------------------------------------------------------------

-- Enable RLS on core multi-tenant tables
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "object_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nexus_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

-- Create RLS Isolation Policy for nexus_objects
CREATE POLICY tenant_isolation_nexus_objects ON "nexus_objects"
    AS RESTRICTIVE
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Create RLS Isolation Policy for object_definitions
CREATE POLICY tenant_isolation_object_definitions ON "object_definitions"
    AS RESTRICTIVE
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Create RLS Isolation Policy for workspaces
CREATE POLICY tenant_isolation_workspaces ON "workspaces"
    AS RESTRICTIVE
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Create RLS Isolation Policy for domain_events
CREATE POLICY tenant_isolation_domain_events ON "domain_events"
    AS RESTRICTIVE
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Create RLS Isolation Policy for audit_logs
CREATE POLICY tenant_isolation_audit_logs ON "audit_logs"
    AS RESTRICTIVE
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- 2. HIGH PERFORMANCE GIN INDEXES FOR JSONB & FULL TEXT SEARCH
-- -----------------------------------------------------------------------------

-- GIN index on nexus_objects.metadata for fast arbitrary JSON queries
CREATE INDEX IF NOT EXISTS idx_nexus_objects_metadata_gin 
ON "nexus_objects" USING GIN (metadata);

-- GIN index on object_definitions.schema for dynamic schema queries
CREATE INDEX IF NOT EXISTS idx_object_definitions_schema_gin 
ON "object_definitions" USING GIN (schema);

-- GIN index on domain_events.payload
CREATE INDEX IF NOT EXISTS idx_domain_events_payload_gin 
ON "domain_events" USING GIN (payload);

-- Full text search index on title and description
CREATE INDEX IF NOT EXISTS idx_nexus_objects_fts 
ON "nexus_objects" USING GIN (to_tsvector('spanish', coalesce(title, '') || ' ' || coalesce(description, '')));
