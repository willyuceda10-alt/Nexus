CREATE UNIQUE INDEX "inbox_items_v1_source_user_key"
  ON "inbox_items_v1"("tenant_id", "user_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL;

CREATE UNIQUE INDEX "notification_deliveries_v1_inbox_channel_key"
  ON "notification_deliveries_v1"("inbox_item_id", "channel")
  WHERE "inbox_item_id" IS NOT NULL;
