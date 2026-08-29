-- Bridata SAP Reconciliation V1-C
-- Preserve the semantic distinction between a single scored proposal and a genuinely ambiguous match.

ALTER TABLE "integration_reconciliation_links"
  DROP CONSTRAINT IF EXISTS "integration_reconciliation_status_check";

ALTER TABLE "integration_reconciliation_links"
  ADD CONSTRAINT "integration_reconciliation_status_check"
  CHECK ("status" IN ('MATCHED','PROPOSED','AMBIGUOUS','MANUAL_CONFIRMED','REJECTED'));
