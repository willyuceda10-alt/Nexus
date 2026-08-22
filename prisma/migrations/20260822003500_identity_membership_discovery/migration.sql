-- BRIDATA PROJECT - RLS-SAFE MEMBERSHIP DISCOVERY
--
-- TenantMembership remains FORCE RLS protected. Before a tenant has been selected,
-- the API may set app.current_user_id from an already authenticated identity and
-- read only that user's own active membership rows. Writes remain governed by the
-- existing tenant_isolation policy.

CREATE OR REPLACE FUNCTION bridata_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

DROP POLICY IF EXISTS membership_self_discovery ON tenant_memberships;
CREATE POLICY membership_self_discovery ON tenant_memberships
  FOR SELECT
  USING (user_id = bridata_current_user_id());
