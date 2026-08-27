import { config } from './config.js';
import { prisma } from './db.js';
import {
  dispatchTenantOutbox,
  listDueOutboxTenants,
} from './outbox-dispatcher.js';
import { AzureServiceBusDomainPublisher } from './service-bus-publisher.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!config.OUTBOX_WORKER_ENABLED) {
    throw new Error('Outbox worker refused to start because OUTBOX_WORKER_ENABLED is not true.');
  }

  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  const publisher = new AzureServiceBusDomainPublisher();
  console.info(JSON.stringify({
    message: 'Bridata outbox worker started',
    topic: config.SERVICE_BUS_TOPIC,
    batchSize: config.OUTBOX_BATCH_SIZE,
    maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
  }));

  try {
    while (!stopping) {
      let processedThisLoop = 0;
      try {
        const partitions = await listDueOutboxTenants(config.OUTBOX_TENANT_SCAN_LIMIT);
        for (const partition of partitions) {
          if (stopping) break;
          try {
            processedThisLoop += await dispatchTenantOutbox({
              partition,
              publisher,
              batchSize: config.OUTBOX_BATCH_SIZE,
              maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
              lockTimeoutSeconds: config.OUTBOX_LOCK_TIMEOUT_SECONDS,
              idleDelayMs: config.OUTBOX_IDLE_DELAY_MS,
              onError(event, error, terminal) {
                console.error(JSON.stringify({
                  message: terminal ? 'Outbox event reached terminal failure' : 'Outbox event publish failed; retry scheduled',
                  eventId: event.id,
                  tenantId: event.tenantId,
                  eventType: event.eventType,
                  attempts: event.attempts,
                  error: error instanceof Error ? error.message : String(error),
                }));
              },
            });
          } catch (error) {
            console.error(JSON.stringify({
              message: 'Outbox tenant dispatch failed',
              tenantId: partition.tenantId,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      } catch (error) {
        console.error(JSON.stringify({
          message: 'Outbox partition scan failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }

      if (!stopping && processedThisLoop === 0) {
        await sleep(config.OUTBOX_LOOP_DELAY_MS);
      }
    }
  } finally {
    await publisher.close().catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    message: 'Bridata outbox worker fatal error',
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  }));
  await prisma.$disconnect().catch(() => undefined);
  process.exitCode = 1;
});
