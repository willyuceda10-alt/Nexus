-- Notification Preferences + Microsoft 365 delivery foundation
-- Additive migration: Inbox remains the canonical user work projection.

ALTER TYPE "NotificationChannelV1" ADD VALUE IF NOT EXISTS 'OUTLOOK_EMAIL';
ALTER TYPE "NotificationChannelV1" ADD VALUE IF NOT EXISTS 'TEAMS_ACTIVITY';
ALTER TYPE "NotificationDeliveryStatusV1" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "NotificationDeliveryStatusV1" ADD VALUE IF NOT EXISTS 'SKIPPED';

CREATE TABLE IF NOT EXISTS notification_preferences_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  channel "NotificationChannelV1" NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  minimum_priority "InboxPriorityV1" NOT NULL DEFAULT 'MEDIUM',
  only_requires_action boolean NOT NULL DEFAULT false,
  quiet_hours_start varchar(5),
  quiet_hours_end varchar(5),
  timezone varchar(100) NOT NULL DEFAULT 'UTC',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notification_preferences_v1_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_v1_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT notification_preferences_v1_quiet_start_ck
    CHECK (quiet_hours_start IS NULL OR quiet_hours_start ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT notification_preferences_v1_quiet_end_ck
    CHECK (quiet_hours_end IS NULL OR quiet_hours_end ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT notification_preferences_v1_quiet_pair_ck
    CHECK ((quiet_hours_start IS NULL) = (quiet_hours_end IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_v1_user_channel
  ON notification_preferences_v1 (tenant_id, user_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_v1_user
  ON notification_preferences_v1 (tenant_id, user_id);

ALTER TABLE notification_deliveries_v1
  ADD COLUMN IF NOT EXISTS destination varchar(500),
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempted_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz(6),
  ADD COLUMN IF NOT EXISTS provider_message_id varchar(500),
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE notification_deliveries_v1
  DROP CONSTRAINT IF EXISTS notification_deliveries_v1_attempts_ck;
ALTER TABLE notification_deliveries_v1
  ADD CONSTRAINT notification_deliveries_v1_attempts_ck CHECK (attempts >= 0 AND attempts <= 100);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_v1_dispatch
  ON notification_deliveries_v1 (tenant_id, channel, status, next_attempt_at);

ALTER TABLE notification_preferences_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences_v1 FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_preferences_v1;
CREATE POLICY tenant_isolation ON notification_preferences_v1
  USING (tenant_id = nexus_current_tenant_id())
  WITH CHECK (tenant_id = nexus_current_tenant_id());
