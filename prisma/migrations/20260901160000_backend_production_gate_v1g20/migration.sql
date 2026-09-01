-- G20 Backend Production Gate
--
-- outbox_tenant_partitions is intentionally NOT protected by
-- tenant RLS. It belongs to the platform dispatcher control plane
-- and contains only tenant identifiers and scheduling timestamps.
--
-- Workers read this table only to discover which tenant context
-- must be entered next. Business payload remains in domain_events,
-- which continues to use FORCE ROW LEVEL SECURITY.

COMMENT ON TABLE outbox_tenant_partitions IS
'Bridata platform control-plane partition registry. Intentionally not tenant-RLS protected. Contains no tenant business payload; workers use it only to select the next tenant context before entering withTenant().';
