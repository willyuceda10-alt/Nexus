-- Cost Engine V2 / Procurement integrity guard
-- Defense in depth for project, workspace, currency and linked procurement dimensions.

CREATE OR REPLACE FUNCTION bridata_validate_project_cost_profile_currency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  invalid_count integer;
BEGIN
  IF NEW.currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'project_cost_currency_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO invalid_count
  FROM (
    SELECT currency FROM project_commitments
      WHERE tenant_id = NEW.tenant_id AND project_object_id = NEW.project_object_id
    UNION ALL
    SELECT currency FROM project_actual_costs
      WHERE tenant_id = NEW.tenant_id AND project_object_id = NEW.project_object_id
  ) currencies
  WHERE currency <> NEW.currency;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'project_cost_currency_locked' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_cost_profile_currency_guard ON project_cost_profiles;
CREATE TRIGGER project_cost_profile_currency_guard
BEFORE INSERT OR UPDATE OF currency ON project_cost_profiles
FOR EACH ROW EXECUTE FUNCTION bridata_validate_project_cost_profile_currency();

CREATE OR REPLACE FUNCTION bridata_validate_cost_transaction_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  profile_currency varchar(3);
  project_workspace uuid;
  linked_project uuid;
  linked_workspace uuid;
  dimension_tenant uuid;
  material_uuid uuid;
  supplier_uuid uuid;
BEGIN
  SELECT workspace_id INTO project_workspace
  FROM nexus_objects
  WHERE id = NEW.project_object_id
    AND tenant_id = NEW.tenant_id
    AND object_type_key = 'PROJECT'
    AND deleted_at IS NULL;
  IF project_workspace IS NULL OR project_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'cost_project_workspace_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.work_item_object_id IS NOT NULL THEN
    SELECT workspace_id,
           NULLIF(metadata->>'projectId','')::uuid
      INTO linked_workspace, linked_project
    FROM nexus_objects
    WHERE id = NEW.work_item_object_id
      AND tenant_id = NEW.tenant_id
      AND object_type_key IN ('TASK','DELIVERABLE','MILESTONE')
      AND deleted_at IS NULL;
    IF linked_workspace IS NULL OR linked_workspace <> NEW.workspace_id OR linked_project IS DISTINCT FROM NEW.project_object_id THEN
      RAISE EXCEPTION 'cost_work_item_project_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.cost_code_id IS NOT NULL THEN
    SELECT tenant_id, workspace_id INTO dimension_tenant, linked_workspace
    FROM cost_codes WHERE id = NEW.cost_code_id AND is_active = TRUE;
    IF dimension_tenant IS DISTINCT FROM NEW.tenant_id OR linked_workspace IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'cost_code_workspace_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'project_actual_costs' THEN
    material_uuid := NULLIF(to_jsonb(NEW)->>'material_id', '')::uuid;
    IF material_uuid IS NOT NULL THEN
      SELECT tenant_id, workspace_id INTO dimension_tenant, linked_workspace
      FROM material_masters WHERE id = material_uuid AND is_active = TRUE;
      IF dimension_tenant IS DISTINCT FROM NEW.tenant_id OR linked_workspace IS DISTINCT FROM NEW.workspace_id THEN
        RAISE EXCEPTION 'cost_material_workspace_mismatch' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'project_commitments' THEN
    supplier_uuid := NULLIF(to_jsonb(NEW)->>'supplier_id', '')::uuid;
    IF supplier_uuid IS NOT NULL THEN
      SELECT tenant_id INTO dimension_tenant FROM suppliers WHERE id = supplier_uuid AND is_active = TRUE;
      IF dimension_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'cost_supplier_tenant_mismatch' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  SELECT currency INTO profile_currency
  FROM project_cost_profiles
  WHERE tenant_id = NEW.tenant_id AND project_object_id = NEW.project_object_id;
  IF profile_currency IS NULL THEN
    RAISE EXCEPTION 'project_cost_profile_required' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.currency <> profile_currency THEN
    RAISE EXCEPTION 'cost_currency_mismatch' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_commitments_scope_guard ON project_commitments;
CREATE TRIGGER project_commitments_scope_guard
BEFORE INSERT OR UPDATE ON project_commitments
FOR EACH ROW EXECUTE FUNCTION bridata_validate_cost_transaction_scope();

DROP TRIGGER IF EXISTS project_actual_costs_scope_guard ON project_actual_costs;
CREATE TRIGGER project_actual_costs_scope_guard
BEFORE INSERT OR UPDATE ON project_actual_costs
FOR EACH ROW EXECUTE FUNCTION bridata_validate_cost_transaction_scope();

CREATE OR REPLACE FUNCTION bridata_validate_budget_line_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_workspace uuid;
  linked_workspace uuid;
  linked_project uuid;
  dimension_tenant uuid;
BEGIN
  SELECT workspace_id INTO project_workspace
  FROM nexus_objects
  WHERE id = NEW.project_object_id AND tenant_id = NEW.tenant_id
    AND object_type_key = 'PROJECT' AND deleted_at IS NULL;
  IF project_workspace IS NULL OR project_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'budget_project_workspace_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT tenant_id, workspace_id INTO dimension_tenant, linked_workspace
  FROM cost_codes WHERE id = NEW.cost_code_id AND is_active = TRUE;
  IF dimension_tenant IS DISTINCT FROM NEW.tenant_id OR linked_workspace IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'budget_cost_code_workspace_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.work_item_object_id IS NOT NULL THEN
    SELECT workspace_id, NULLIF(metadata->>'projectId','')::uuid
      INTO linked_workspace, linked_project
    FROM nexus_objects
    WHERE id = NEW.work_item_object_id AND tenant_id = NEW.tenant_id
      AND object_type_key IN ('TASK','DELIVERABLE','MILESTONE') AND deleted_at IS NULL;
    IF linked_workspace IS NULL OR linked_workspace <> NEW.workspace_id OR linked_project IS DISTINCT FROM NEW.project_object_id THEN
      RAISE EXCEPTION 'budget_work_item_project_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.material_id IS NOT NULL THEN
    SELECT tenant_id, workspace_id INTO dimension_tenant, linked_workspace
    FROM material_masters WHERE id = NEW.material_id AND is_active = TRUE;
    IF dimension_tenant IS DISTINCT FROM NEW.tenant_id OR linked_workspace IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'budget_material_workspace_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS project_budget_lines_scope_guard ON project_budget_lines;
CREATE TRIGGER project_budget_lines_scope_guard
BEFORE INSERT OR UPDATE ON project_budget_lines
FOR EACH ROW EXECUTE FUNCTION bridata_validate_budget_line_scope();

CREATE OR REPLACE FUNCTION bridata_validate_purchase_order_line_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  po_tenant uuid;
  po_workspace uuid;
  po_project uuid;
  req_tenant uuid;
  req_workspace uuid;
  req_project uuid;
  req_material uuid;
BEGIN
  SELECT tenant_id, workspace_id, project_object_id
    INTO po_tenant, po_workspace, po_project
  FROM purchase_orders WHERE id = NEW.purchase_order_id;
  IF po_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'purchase_order_line_tenant_mismatch' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.requirement_id IS NOT NULL THEN
    SELECT tenant_id, workspace_id, project_object_id, material_id
      INTO req_tenant, req_workspace, req_project, req_material
    FROM material_requirements WHERE id = NEW.requirement_id;
    IF req_tenant IS DISTINCT FROM NEW.tenant_id OR req_workspace IS DISTINCT FROM po_workspace THEN
      RAISE EXCEPTION 'purchase_order_requirement_workspace_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF req_material IS DISTINCT FROM NEW.material_id THEN
      RAISE EXCEPTION 'purchase_order_requirement_material_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF po_project IS NOT NULL AND req_project IS DISTINCT FROM po_project THEN
      RAISE EXCEPTION 'purchase_order_requirement_project_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS purchase_order_line_scope_guard ON purchase_order_lines;
CREATE TRIGGER purchase_order_line_scope_guard
BEFORE INSERT OR UPDATE ON purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION bridata_validate_purchase_order_line_scope();

CREATE OR REPLACE FUNCTION bridata_validate_goods_receipt_line_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  receipt_po uuid;
  line_po uuid;
  line_material uuid;
  line_requirement uuid;
BEGIN
  IF NEW.purchase_order_line_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT gr.purchase_order_id INTO receipt_po FROM goods_receipts gr WHERE gr.id = NEW.goods_receipt_id;
  SELECT purchase_order_id, material_id, requirement_id
    INTO line_po, line_material, line_requirement
  FROM purchase_order_lines WHERE id = NEW.purchase_order_line_id AND tenant_id = NEW.tenant_id;
  IF line_po IS NULL THEN
    RAISE EXCEPTION 'goods_receipt_po_line_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF receipt_po IS NOT NULL AND receipt_po IS DISTINCT FROM line_po THEN
    RAISE EXCEPTION 'goods_receipt_purchase_order_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.material_id IS DISTINCT FROM line_material THEN
    RAISE EXCEPTION 'goods_receipt_material_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.requirement_id IS NOT NULL AND NEW.requirement_id IS DISTINCT FROM line_requirement THEN
    RAISE EXCEPTION 'goods_receipt_requirement_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS goods_receipt_line_scope_guard ON goods_receipt_lines;
CREATE TRIGGER goods_receipt_line_scope_guard
BEFORE INSERT OR UPDATE ON goods_receipt_lines
FOR EACH ROW EXECUTE FUNCTION bridata_validate_goods_receipt_line_scope();