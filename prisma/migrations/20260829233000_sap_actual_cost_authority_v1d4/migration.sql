-- Bridata Project - SAP Actual Cost Authority V1-D4
-- Manual/accrual actuals remain non-negative; SAP imports may carry signed reversals/credits.

ALTER TABLE "project_actual_costs"
  DROP CONSTRAINT IF EXISTS "project_actual_costs_amount_check";

ALTER TABLE "project_actual_costs"
  ADD CONSTRAINT "project_actual_costs_amount_check"
  CHECK (
    "amount" >= 0
    OR "source_type" = 'SAP_IMPORT'
  );
