-- INVENTORY CONCURRENCY GUARD - SUPPORTING INDEXES
--
-- The BEFORE INSERT triggers added in 20260827043500_material_inventory_concurrency_guard
-- re-validate available stock by aggregating over inventory_movements and
-- stock_reservations filtered by (tenant_id, warehouse_id, material_id) — without
-- workspace_id.
--
-- The existing index inventory_movements_balance_idx leads with
-- (tenant_id, workspace_id, ...), so the only usable prefix for those trigger
-- queries is tenant_id alone: every ISSUE / TRANSFER_OUT / ADJUSTMENT_OUT insert
-- degraded into a scan of the tenant's entire movement history, while holding
-- pg_advisory_xact_lock on the (tenant, warehouse, material) triple. A 500-line
-- goods receipt fired 500 such scans inside one interactive transaction.
--
-- stock_reservations had no supporting index at all for its trigger's filter.
-- These indexes match the trigger predicates exactly and are additive only.

CREATE INDEX IF NOT EXISTS inventory_movements_guard_idx
  ON inventory_movements (tenant_id, warehouse_id, material_id);

CREATE INDEX IF NOT EXISTS stock_reservations_guard_open_idx
  ON stock_reservations (tenant_id, warehouse_id, material_id)
  WHERE status = 'OPEN';
