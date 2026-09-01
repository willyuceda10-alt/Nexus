-- G14 - Configurable Project Risk Notification Preferences
-- Additive and tenant isolated.
-- Existing Inbox + M365 notification preferences remain canonical.

CREATE TABLE IF NOT EXISTS project_risk_notification_preferences_v1g14 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,

  enabled boolean NOT NULL DEFAULT true,

  minimum_risk_level varchar(20)
    NOT NULL DEFAULT 'HIGH',

  high_cooldown_hours integer
    NOT NULL DEFAULT 24,

  critical_cooldown_hours integer
    NOT NULL DEFAULT 6,

  notify_on_escalation boolean
    NOT NULL DEFAULT true,

  notify_on_driver_change boolean
    NOT NULL DEFAULT true,

  notify_on_reentry boolean
    NOT NULL DEFAULT true,

  notify_on_cooldown_reminder boolean
    NOT NULL DEFAULT true,

  created_at timestamptz(6)
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at timestamptz(6)
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT project_risk_notification_preferences_v1g14_tenant_fk
    FOREIGN KEY (tenant_id)
    REFERENCES tenants(id)
    ON DELETE CASCADE,

  CONSTRAINT project_risk_notification_preferences_v1g14_user_fk
    FOREIGN KEY (user_id)
    REFERENCES users(id)
    ON DELETE CASCADE,

  CONSTRAINT project_risk_notification_preferences_v1g14_level_ck
    CHECK (
      minimum_risk_level IN (
        'HIGH',
        'CRITICAL'
      )
    ),

  CONSTRAINT project_risk_notification_preferences_v1g14_high_cooldown_ck
    CHECK (
      high_cooldown_hours
      BETWEEN 1 AND 168
    ),

  CONSTRAINT project_risk_notification_preferences_v1g14_critical_cooldown_ck
    CHECK (
      critical_cooldown_hours
      BETWEEN 1 AND 168
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_project_risk_notification_preferences_v1g14_user
ON project_risk_notification_preferences_v1g14
  (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS
  idx_project_risk_notification_preferences_v1g14_user
ON project_risk_notification_preferences_v1g14
  (tenant_id, user_id);

ALTER TABLE
  project_risk_notification_preferences_v1g14
ENABLE ROW LEVEL SECURITY;

ALTER TABLE
  project_risk_notification_preferences_v1g14
FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS
  tenant_isolation
ON project_risk_notification_preferences_v1g14;

CREATE POLICY tenant_isolation
ON project_risk_notification_preferences_v1g14
USING (
  tenant_id =
    nexus_current_tenant_id()
)
WITH CHECK (
  tenant_id =
    nexus_current_tenant_id()
);
