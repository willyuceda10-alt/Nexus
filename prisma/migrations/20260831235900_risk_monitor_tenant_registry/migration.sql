-- Bridata Project Risk Monitor V1G9
--
-- G9 needs to discover tenant ids before entering each tenant through withTenant().
-- Business tables remain protected by FORCE RLS.
-- outbox_tenant_partitions is the existing non-RLS worker control plane and stores
-- tenant ids only, never business payload.

INSERT INTO outbox_tenant_partitions (
  tenant_id,
  next_scan_at,
  last_event_at
)
SELECT
  id,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM tenants
ON CONFLICT (tenant_id)
DO NOTHING;

CREATE OR REPLACE FUNCTION bridata_register_worker_tenant_partition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO outbox_tenant_partitions (
    tenant_id,
    next_scan_at,
    last_event_at
  )
  VALUES (
    NEW.id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (tenant_id)
  DO NOTHING;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tenants_register_worker_partition
ON tenants;

CREATE TRIGGER tenants_register_worker_partition
AFTER INSERT ON tenants
FOR EACH ROW
EXECUTE FUNCTION bridata_register_worker_tenant_partition();
