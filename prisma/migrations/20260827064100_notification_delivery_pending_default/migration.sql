-- Align Prisma default after the enum value was committed by the prior migration.
ALTER TABLE notification_deliveries_v1
  ALTER COLUMN status SET DEFAULT 'PENDING'::"NotificationDeliveryStatusV1";
