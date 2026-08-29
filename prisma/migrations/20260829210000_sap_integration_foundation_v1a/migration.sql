-- Bridata SAP Integration Foundation V1-A
-- Source-agnostic import staging, idempotency, reconciliation and service-principal foundation.
-- Excel filenames are evidence only; business meaning is represented by integration_sources.source_key.

CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_id_tenant_key"
  ON "integration_connections"("id", "tenant_id");

CREATE TABLE "integration_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "integration_connection_id" UUID NOT NULL,
  "source_key" VARCHAR(100) NOT NULL,
  "display_name" VARCHAR(255) NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "parser_version" VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "watermark" JSONB,
  "config" JSONB,
  "last_success_at" TIMESTAMPTZ(6),
  "last_generated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_sources_schema_version_check" CHECK ("schema_version" > 0),
  CONSTRAINT "integration_sources_source_key_check" CHECK ("source_key" ~ '^[A-Z0-9][A-Z0-9_]{2,99}$')
);

CREATE TABLE "integration_import_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "integration_source_id" UUID NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(150) NOT NULL,
  "file_size" BIGINT NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "storage_key" TEXT NOT NULL,
  "source_generated_at" TIMESTAMPTZ(6),
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processing_started_at" TIMESTAMPTZ(6),
  "processing_finished_at" TIMESTAMPTZ(6),
  "status" VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  "schema_version" INTEGER NOT NULL,
  "parser_version" VARCHAR(50) NOT NULL,
  "total_records" INTEGER NOT NULL DEFAULT 0,
  "accepted_records" INTEGER NOT NULL DEFAULT 0,
  "inserted_records" INTEGER NOT NULL DEFAULT 0,
  "updated_records" INTEGER NOT NULL DEFAULT 0,
  "unchanged_records" INTEGER NOT NULL DEFAULT 0,
  "warning_records" INTEGER NOT NULL DEFAULT 0,
  "rejected_records" INTEGER NOT NULL DEFAULT 0,
  "error_summary" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_import_batches_status_check" CHECK ("status" IN ('RECEIVED','PROCESSING','SUCCEEDED','PARTIAL','FAILED')),
  CONSTRAINT "integration_import_batches_file_size_check" CHECK ("file_size" > 0),
  CONSTRAINT "integration_import_batches_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "integration_import_batches_schema_version_check" CHECK ("schema_version" > 0),
  CONSTRAINT "integration_import_batches_counts_check" CHECK (
    "total_records" >= 0 AND "accepted_records" >= 0 AND "inserted_records" >= 0
    AND "updated_records" >= 0 AND "unchanged_records" >= 0
    AND "warning_records" >= 0 AND "rejected_records" >= 0
  )
);

CREATE TABLE "integration_import_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "row_number" INTEGER NOT NULL,
  "external_key" VARCHAR(255),
  "record_hash" VARCHAR(64) NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "normalized_payload" JSONB,
  "validation_status" VARCHAR(20) NOT NULL DEFAULT 'VALID',
  "processing_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_import_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_import_records_row_check" CHECK ("row_number" > 0),
  CONSTRAINT "integration_import_records_hash_check" CHECK ("record_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "integration_import_records_validation_check" CHECK ("validation_status" IN ('VALID','WARNING','INVALID')),
  CONSTRAINT "integration_import_records_processing_check" CHECK ("processing_status" IN ('PENDING','READY','APPLIED','IGNORED','FAILED'))
);

CREATE TABLE "integration_import_issues" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "record_id" UUID,
  "severity" VARCHAR(20) NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "field_key" VARCHAR(150),
  "message" TEXT NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_import_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_import_issues_severity_check" CHECK ("severity" IN ('INFO','WARNING','ERROR'))
);

CREATE TABLE "integration_entity_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "integration_connection_id" UUID NOT NULL,
  "source_record_id" UUID,
  "external_entity_type" VARCHAR(100) NOT NULL,
  "external_key" VARCHAR(255) NOT NULL,
  "canonical_entity_type" VARCHAR(100) NOT NULL,
  "canonical_entity_id" UUID NOT NULL,
  "metadata" JSONB,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_entity_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_reconciliation_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "integration_connection_id" UUID NOT NULL,
  "left_record_id" UUID NOT NULL,
  "right_record_id" UUID NOT NULL,
  "relationship_type" VARCHAR(100) NOT NULL,
  "match_method" VARCHAR(100) NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
  "status" VARCHAR(30) NOT NULL DEFAULT 'MATCHED',
  "evidence" JSONB,
  "confirmed_by_user_id" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_reconciliation_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_reconciliation_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "integration_reconciliation_status_check" CHECK ("status" IN ('MATCHED','AMBIGUOUS','MANUAL_CONFIRMED','REJECTED')),
  CONSTRAINT "integration_reconciliation_distinct_records_check" CHECK ("left_record_id" <> "right_record_id")
);

CREATE TABLE "integration_service_principals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "integration_connection_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "display_name" VARCHAR(255) NOT NULL,
  "allowed_source_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  "last_used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_service_principals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_service_principals_status_check" CHECK ("status" IN ('ACTIVE','SUSPENDED'))
);

CREATE UNIQUE INDEX "integration_sources_tenant_connection_source_key"
  ON "integration_sources"("tenant_id","integration_connection_id","source_key");
CREATE UNIQUE INDEX "integration_sources_id_tenant_key"
  ON "integration_sources"("id","tenant_id");
CREATE INDEX "integration_sources_connection_idx"
  ON "integration_sources"("tenant_id","integration_connection_id","is_active");

CREATE UNIQUE INDEX "integration_import_batches_source_checksum_key"
  ON "integration_import_batches"("tenant_id","integration_source_id","checksum_sha256");
CREATE UNIQUE INDEX "integration_import_batches_id_tenant_key"
  ON "integration_import_batches"("id","tenant_id");
CREATE INDEX "integration_import_batches_source_received_idx"
  ON "integration_import_batches"("tenant_id","integration_source_id","received_at" DESC);
CREATE INDEX "integration_import_batches_status_idx"
  ON "integration_import_batches"("tenant_id","status","received_at" DESC);

CREATE UNIQUE INDEX "integration_import_records_batch_row_key"
  ON "integration_import_records"("tenant_id","batch_id","row_number");
CREATE UNIQUE INDEX "integration_import_records_id_tenant_key"
  ON "integration_import_records"("id","tenant_id");
CREATE INDEX "integration_import_records_external_key_idx"
  ON "integration_import_records"("tenant_id","external_key");
CREATE INDEX "integration_import_records_record_hash_idx"
  ON "integration_import_records"("tenant_id","batch_id","record_hash");

CREATE INDEX "integration_import_issues_batch_idx"
  ON "integration_import_issues"("tenant_id","batch_id","severity");
CREATE INDEX "integration_import_issues_record_idx"
  ON "integration_import_issues"("tenant_id","record_id");

CREATE UNIQUE INDEX "integration_entity_links_external_key"
  ON "integration_entity_links"("tenant_id","integration_connection_id","external_entity_type","external_key");
CREATE INDEX "integration_entity_links_canonical_idx"
  ON "integration_entity_links"("tenant_id","canonical_entity_type","canonical_entity_id");

CREATE UNIQUE INDEX "integration_reconciliation_pair_key"
  ON "integration_reconciliation_links"("tenant_id","integration_connection_id","left_record_id","right_record_id","relationship_type");
CREATE INDEX "integration_reconciliation_left_idx"
  ON "integration_reconciliation_links"("tenant_id","left_record_id","relationship_type");
CREATE INDEX "integration_reconciliation_right_idx"
  ON "integration_reconciliation_links"("tenant_id","right_record_id","relationship_type");

CREATE UNIQUE INDEX "integration_service_principals_tenant_client_key"
  ON "integration_service_principals"("tenant_id","client_id");
CREATE INDEX "integration_service_principals_connection_idx"
  ON "integration_service_principals"("tenant_id","integration_connection_id","status");

ALTER TABLE "integration_sources"
  ADD CONSTRAINT "integration_sources_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_sources_connection_tenant_fkey"
  FOREIGN KEY ("integration_connection_id","tenant_id") REFERENCES "integration_connections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_import_batches"
  ADD CONSTRAINT "integration_import_batches_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_import_batches_source_tenant_fkey"
  FOREIGN KEY ("integration_source_id","tenant_id") REFERENCES "integration_sources"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_import_records"
  ADD CONSTRAINT "integration_import_records_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_import_records_batch_tenant_fkey"
  FOREIGN KEY ("batch_id","tenant_id") REFERENCES "integration_import_batches"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_import_issues"
  ADD CONSTRAINT "integration_import_issues_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_import_issues_batch_tenant_fkey"
  FOREIGN KEY ("batch_id","tenant_id") REFERENCES "integration_import_batches"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_import_issues_record_tenant_fkey"
  FOREIGN KEY ("record_id","tenant_id") REFERENCES "integration_import_records"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_entity_links"
  ADD CONSTRAINT "integration_entity_links_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_entity_links_connection_tenant_fkey"
  FOREIGN KEY ("integration_connection_id","tenant_id") REFERENCES "integration_connections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_entity_links_source_record_tenant_fkey"
  FOREIGN KEY ("source_record_id","tenant_id") REFERENCES "integration_import_records"("id","tenant_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_links"
  ADD CONSTRAINT "integration_reconciliation_links_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_reconciliation_connection_tenant_fkey"
  FOREIGN KEY ("integration_connection_id","tenant_id") REFERENCES "integration_connections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_reconciliation_left_record_tenant_fkey"
  FOREIGN KEY ("left_record_id","tenant_id") REFERENCES "integration_import_records"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_reconciliation_right_record_tenant_fkey"
  FOREIGN KEY ("right_record_id","tenant_id") REFERENCES "integration_import_records"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_reconciliation_confirmed_user_fkey"
  FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_service_principals"
  ADD CONSTRAINT "integration_service_principals_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "integration_service_principals_connection_tenant_fkey"
  FOREIGN KEY ("integration_connection_id","tenant_id") REFERENCES "integration_connections"("id","tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION bridata_guard_import_batch_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.integration_source_id IS DISTINCT FROM OLD.integration_source_id
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.file_size IS DISTINCT FROM OLD.file_size
     OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'integration_import_batch_identity_is_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER integration_import_batch_identity_guard
BEFORE UPDATE ON "integration_import_batches"
FOR EACH ROW EXECUTE FUNCTION bridata_guard_import_batch_identity();

CREATE OR REPLACE FUNCTION bridata_guard_import_record_raw_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.row_number IS DISTINCT FROM OLD.row_number
     OR NEW.record_hash IS DISTINCT FROM OLD.record_hash
     OR NEW.raw_payload IS DISTINCT FROM OLD.raw_payload THEN
    RAISE EXCEPTION 'integration_import_record_raw_identity_is_immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER integration_import_record_raw_identity_guard
BEFORE UPDATE ON "integration_import_records"
FOR EACH ROW EXECUTE FUNCTION bridata_guard_import_record_raw_identity();

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'integration_sources',
    'integration_import_batches',
    'integration_import_records',
    'integration_import_issues',
    'integration_entity_links',
    'integration_reconciliation_links',
    'integration_service_principals'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;
