-- Material / Inventory Engine V2 concurrency guard.
-- Availability is revalidated inside PostgreSQL after taking a transaction-level
-- advisory lock for tenant + warehouse + material. This closes the race where
-- two API transactions read the same free stock before either writes.

CREATE OR REPLACE FUNCTION bridata_inventory_lock_key(
  p_tenant UUID,
  p_warehouse UUID,
  p_material UUID
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_tenant::text || ':' || p_warehouse::text || ':' || p_material::text,
      0
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION bridata_guard_stock_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_on_hand NUMERIC(18,4);
  v_reserved NUMERIC(18,4);
  v_available NUMERIC(18,4);
BEGIN
  PERFORM bridata_inventory_lock_key(NEW.tenant_id, NEW.warehouse_id, NEW.material_id);

  SELECT COALESCE(SUM(
    CASE WHEN movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN')
         THEN quantity ELSE -quantity END
  ), 0)
  INTO v_on_hand
  FROM inventory_movements
  WHERE tenant_id = NEW.tenant_id
    AND warehouse_id = NEW.warehouse_id
    AND material_id = NEW.material_id;

  SELECT COALESCE(SUM(quantity), 0)
  INTO v_reserved
  FROM stock_reservations
  WHERE tenant_id = NEW.tenant_id
    AND warehouse_id = NEW.warehouse_id
    AND material_id = NEW.material_id
    AND status = 'OPEN';

  v_available := GREATEST(0, v_on_hand - v_reserved);
  IF NEW.status = 'OPEN' AND NEW.quantity > v_available THEN
    RAISE EXCEPTION 'insufficient_available_stock: requested %, available %', NEW.quantity, v_available
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_stock_reservation ON stock_reservations;
CREATE TRIGGER trg_guard_stock_reservation
BEFORE INSERT ON stock_reservations
FOR EACH ROW EXECUTE FUNCTION bridata_guard_stock_reservation();

CREATE OR REPLACE FUNCTION bridata_guard_outbound_inventory_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_on_hand NUMERIC(18,4);
  v_competing_reserved NUMERIC(18,4);
  v_issuable NUMERIC(18,4);
BEGIN
  IF NEW.movement_type NOT IN ('ISSUE','TRANSFER_OUT','ADJUSTMENT_OUT') THEN
    RETURN NEW;
  END IF;

  PERFORM bridata_inventory_lock_key(NEW.tenant_id, NEW.warehouse_id, NEW.material_id);

  SELECT COALESCE(SUM(
    CASE WHEN movement_type IN ('RECEIPT','TRANSFER_IN','ADJUSTMENT_IN')
         THEN quantity ELSE -quantity END
  ), 0)
  INTO v_on_hand
  FROM inventory_movements
  WHERE tenant_id = NEW.tenant_id
    AND warehouse_id = NEW.warehouse_id
    AND material_id = NEW.material_id;

  IF NEW.requirement_id IS NULL THEN
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_competing_reserved
    FROM stock_reservations
    WHERE tenant_id = NEW.tenant_id
      AND warehouse_id = NEW.warehouse_id
      AND material_id = NEW.material_id
      AND status = 'OPEN';
  ELSE
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_competing_reserved
    FROM stock_reservations
    WHERE tenant_id = NEW.tenant_id
      AND warehouse_id = NEW.warehouse_id
      AND material_id = NEW.material_id
      AND status = 'OPEN'
      AND requirement_id <> NEW.requirement_id;
  END IF;

  v_issuable := GREATEST(0, v_on_hand - v_competing_reserved);
  IF NEW.quantity > v_issuable THEN
    RAISE EXCEPTION 'insufficient_stock_for_issue: requested %, issuable %', NEW.quantity, v_issuable
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_outbound_inventory_movement ON inventory_movements;
CREATE TRIGGER trg_guard_outbound_inventory_movement
BEFORE INSERT ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION bridata_guard_outbound_inventory_movement();
