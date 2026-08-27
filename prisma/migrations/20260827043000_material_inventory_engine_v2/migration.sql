-- Bridata Material / Inventory Engine V2
-- Typed operational foundation for materials, requirements, reservations,
-- procurement, receipts and immutable inventory movements.
-- Existing MATERIAL NexusObjects remain the collaboration identity during migration.

CREATE TABLE "unit_of_measures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "decimal_places" INTEGER NOT NULL DEFAULT 2,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unit_of_measures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "unit_of_measures_decimal_places_check" CHECK ("decimal_places" BETWEEN 0 AND 6)
);

CREATE TABLE "material_masters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "material_object_id" UUID NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "base_uom_id" UUID NOT NULL,
  "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_masters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_masters_unit_cost_check" CHECK ("unit_cost" >= 0)
);

CREATE TABLE "warehouses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "tax_id" VARCHAR(50),
  "email" VARCHAR(255),
  "phone" VARCHAR(80),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "material_requirements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_object_id" UUID NOT NULL,
  "work_item_object_id" UUID,
  "material_id" UUID NOT NULL,
  "preferred_warehouse_id" UUID,
  "required_qty" DECIMAL(18,4) NOT NULL,
  "required_date" DATE NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'OPEN',
  "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_requirements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_requirements_qty_check" CHECK ("required_qty" > 0),
  CONSTRAINT "material_requirements_status_check" CHECK ("status" IN ('OPEN','PARTIALLY_ALLOCATED','ALLOCATED','FULFILLED','CANCELLED')),
  CONSTRAINT "material_requirements_priority_check" CHECK ("priority" IN ('LOW','MEDIUM','HIGH','CRITICAL'))
);

CREATE TABLE "stock_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_reservations_qty_check" CHECK ("quantity" > 0),
  CONSTRAINT "stock_reservations_status_check" CHECK ("status" IN ('OPEN','RELEASED','CONSUMED','CANCELLED'))
);

CREATE TABLE "purchase_requisitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_object_id" UUID,
  "number" VARCHAR(80) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "required_date" DATE,
  "requested_by_user_id" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_requisitions_status_check" CHECK ("status" IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED','CANCELLED'))
);

CREATE TABLE "purchase_requisition_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "requisition_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "requirement_id" UUID,
  "uom_id" UUID NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "estimated_unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_requisition_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_requisition_lines_qty_check" CHECK ("quantity" > 0),
  CONSTRAINT "purchase_requisition_lines_cost_check" CHECK ("estimated_unit_cost" >= 0)
);

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_object_id" UUID,
  "supplier_id" UUID NOT NULL,
  "number" VARCHAR(80) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "order_date" DATE NOT NULL DEFAULT CURRENT_DATE,
  "expected_date" DATE,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_status_check" CHECK ("status" IN ('DRAFT','APPROVED','ORDERED','PARTIAL','RECEIVED','CANCELLED'))
);

CREATE TABLE "purchase_order_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "requirement_id" UUID,
  "uom_id" UUID NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "expected_date" DATE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_lines_qty_check" CHECK ("quantity" > 0),
  CONSTRAINT "purchase_order_lines_received_check" CHECK ("received_qty" >= 0 AND "received_qty" <= "quantity"),
  CONSTRAINT "purchase_order_lines_cost_check" CHECK ("unit_cost" >= 0)
);

CREATE TABLE "goods_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "purchase_order_id" UUID,
  "number" VARCHAR(80) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'POSTED',
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_by_user_id" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipts_status_check" CHECK ("status" IN ('POSTED','VOID'))
);

CREATE TABLE "goods_receipt_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "goods_receipt_id" UUID NOT NULL,
  "purchase_order_line_id" UUID,
  "material_id" UUID NOT NULL,
  "requirement_id" UUID,
  "uom_id" UUID NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_lines_qty_check" CHECK ("quantity" > 0),
  CONSTRAINT "goods_receipt_lines_cost_check" CHECK ("unit_cost" >= 0)
);

CREATE TABLE "inventory_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "requirement_id" UUID,
  "work_item_object_id" UUID,
  "movement_type" VARCHAR(30) NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unit_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reference_type" VARCHAR(50),
  "reference_id" UUID,
  "created_by_user_id" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_qty_check" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_movements_cost_check" CHECK ("unit_cost" >= 0),
  CONSTRAINT "inventory_movements_type_check" CHECK ("movement_type" IN ('RECEIPT','ISSUE','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT'))
);

CREATE UNIQUE INDEX "unit_of_measures_tenant_code_key" ON "unit_of_measures"("tenant_id","code");
CREATE UNIQUE INDEX "material_masters_material_object_id_key" ON "material_masters"("material_object_id");
CREATE UNIQUE INDEX "material_masters_workspace_code_key" ON "material_masters"("tenant_id","workspace_id","code");
CREATE INDEX "material_masters_workspace_idx" ON "material_masters"("tenant_id","workspace_id");
CREATE UNIQUE INDEX "warehouses_workspace_code_key" ON "warehouses"("tenant_id","workspace_id","code");
CREATE INDEX "warehouses_workspace_idx" ON "warehouses"("tenant_id","workspace_id");
CREATE UNIQUE INDEX "suppliers_tenant_code_key" ON "suppliers"("tenant_id","code");
CREATE INDEX "material_requirements_project_date_idx" ON "material_requirements"("tenant_id","project_object_id","required_date");
CREATE INDEX "material_requirements_work_item_idx" ON "material_requirements"("tenant_id","work_item_object_id");
CREATE INDEX "material_requirements_material_idx" ON "material_requirements"("tenant_id","material_id");
CREATE INDEX "stock_reservations_requirement_idx" ON "stock_reservations"("tenant_id","requirement_id","status");
CREATE UNIQUE INDEX "purchase_requisitions_workspace_number_key" ON "purchase_requisitions"("tenant_id","workspace_id","number");
CREATE INDEX "purchase_requisition_lines_req_idx" ON "purchase_requisition_lines"("tenant_id","requisition_id");
CREATE UNIQUE INDEX "purchase_orders_workspace_number_key" ON "purchase_orders"("tenant_id","workspace_id","number");
CREATE INDEX "purchase_orders_project_status_idx" ON "purchase_orders"("tenant_id","project_object_id","status");
CREATE INDEX "purchase_order_lines_po_idx" ON "purchase_order_lines"("tenant_id","purchase_order_id");
CREATE INDEX "purchase_order_lines_requirement_idx" ON "purchase_order_lines"("tenant_id","requirement_id");
CREATE UNIQUE INDEX "goods_receipts_workspace_number_key" ON "goods_receipts"("tenant_id","workspace_id","number");
CREATE INDEX "goods_receipt_lines_receipt_idx" ON "goods_receipt_lines"("tenant_id","goods_receipt_id");
CREATE INDEX "inventory_movements_balance_idx" ON "inventory_movements"("tenant_id","workspace_id","warehouse_id","material_id","occurred_at");
CREATE INDEX "inventory_movements_requirement_idx" ON "inventory_movements"("tenant_id","requirement_id","occurred_at");

ALTER TABLE "unit_of_measures" ADD CONSTRAINT "unit_of_measures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_masters" ADD CONSTRAINT "material_masters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_masters" ADD CONSTRAINT "material_masters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_masters" ADD CONSTRAINT "material_masters_material_object_id_fkey" FOREIGN KEY ("material_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_masters" ADD CONSTRAINT "material_masters_base_uom_id_fkey" FOREIGN KEY ("base_uom_id") REFERENCES "unit_of_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_work_item_object_id_fkey" FOREIGN KEY ("work_item_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_requirements" ADD CONSTRAINT "material_requirements_preferred_warehouse_id_fkey" FOREIGN KEY ("preferred_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "material_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "material_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "unit_of_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_object_id_fkey" FOREIGN KEY ("project_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "material_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "unit_of_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "material_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "unit_of_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_masters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "material_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_work_item_object_id_fkey" FOREIGN KEY ("work_item_object_id") REFERENCES "nexus_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation: fail closed exactly like the existing Project Engine V2 tables.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'unit_of_measures',
    'material_masters',
    'warehouses',
    'suppliers',
    'material_requirements',
    'stock_reservations',
    'purchase_requisitions',
    'purchase_requisition_lines',
    'purchase_orders',
    'purchase_order_lines',
    'goods_receipts',
    'goods_receipt_lines',
    'inventory_movements'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nexus_current_tenant_id()) WITH CHECK (tenant_id = nexus_current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;
