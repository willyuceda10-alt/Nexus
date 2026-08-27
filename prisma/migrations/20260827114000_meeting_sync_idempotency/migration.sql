-- Meeting Calendar V1 - completed DomainEvent idempotency
-- Prevents an already-completed Service Bus delivery from touching Graph twice
-- if the broker redelivers after an uncertain complete/ack outcome.

ALTER TABLE meeting_collaboration_v1
  ADD COLUMN IF NOT EXISTS last_synced_event_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_meeting_collaboration_last_synced_event_v1
  ON meeting_collaboration_v1 (tenant_id, last_synced_event_id)
  WHERE last_synced_event_id IS NOT NULL;

COMMENT ON COLUMN meeting_collaboration_v1.last_synced_event_id IS
  'DomainEvent id of the most recently completed Microsoft 365 calendar synchronization.';
