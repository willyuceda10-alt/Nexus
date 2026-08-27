-- Bridata Transactional Outbox dispatcher control plane.
-- This table intentionally stores only tenant ids and scan timestamps. It has no
-- business payload and is not tenant-RLS protected; workers use it only to discover
-- which tenant context to enter next via withTenant().

CREATE TABLE "outbox_tenant_partitions" (
  "tenant_id" UUID NOT NULL,
  "next_scan_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_event_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_scanned_at" TIMESTAMPTZ(6),
  CONSTRAINT "outbox_tenant_partitions_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "outbox_tenant_partitions"
  ADD CONSTRAINT "outbox_tenant_partitions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "outbox_tenant_partitions_next_scan_idx"
  ON "outbox_tenant_partitions"("next_scan_at", "tenant_id");

CREATE OR REPLACE FUNCTION bridata_signal_outbox_tenant_partition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO outbox_tenant_partitions (tenant_id, next_scan_at, last_event_at)
  VALUES (NEW.tenant_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  ON CONFLICT (tenant_id)
  DO UPDATE SET next_scan_at = LEAST(outbox_tenant_partitions.next_scan_at, CURRENT_TIMESTAMP),
                last_event_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS domain_events_signal_outbox_partition ON domain_events;
CREATE TRIGGER domain_events_signal_outbox_partition
AFTER INSERT ON domain_events
FOR EACH ROW EXECUTE FUNCTION bridata_signal_outbox_tenant_partition();

-- Seed the registry for tenants that already have pending/processing events.
INSERT INTO outbox_tenant_partitions (tenant_id, next_scan_at, last_event_at)
SELECT tenant_id, CURRENT_TIMESTAMP, MAX(created_at)
FROM domain_events
WHERE status IN ('PENDING', 'PROCESSING')
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE
SET next_scan_at = CURRENT_TIMESTAMP,
    last_event_at = GREATEST(outbox_tenant_partitions.last_event_at, EXCLUDED.last_event_at);
