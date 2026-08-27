import { config } from './config.js';
import { prisma } from './db.js';
import { MicrosoftGraphNotificationClient } from './microsoft-graph-notification-client.js';
import { processNotificationDeliveryEventV1 } from './notification-delivery-runner.js';
import { AzureServiceBusNotificationReceiver } from './service-bus-notification-receiver.js';

if (!config.NOTIFICATION_WORKER_ENABLED) {
  throw new Error('Notification worker cannot start unless NOTIFICATION_WORKER_ENABLED=true.');
}

const receiver = new AzureServiceBusNotificationReceiver();
const graph = new MicrosoftGraphNotificationClient();
let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalStop(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ component: 'notification-worker', event: 'shutdown-requested', signal }));
}

process.on('SIGTERM', () => signalStop('SIGTERM'));
process.on('SIGINT', () => signalStop('SIGINT'));

async function main(): Promise<void> {
  console.info(JSON.stringify({
    component: 'notification-worker',
    event: 'started',
    topic: config.SERVICE_BUS_TOPIC,
    subscription: config.SERVICE_BUS_NOTIFICATION_SUBSCRIPTION,
    graphDeliveryEnabled: config.M365_GRAPH_DELIVERY_ENABLED,
  }));

  while (!stopping) {
    try {
      const locked = await receiver.receive();
      if (!locked) {
        await sleep(config.NOTIFICATION_LOOP_DELAY_MS);
        continue;
      }

      try {
        const result = await processNotificationDeliveryEventV1(locked.envelope, graph);
        if (result.retryableFailure) {
          await receiver.abandon(locked);
          console.warn(JSON.stringify({
            component: 'notification-worker',
            event: 'message-abandoned',
            eventId: locked.envelope.eventId,
            eventType: locked.envelope.eventType,
            deliveryCount: locked.deliveryCount,
            result,
          }));
        } else {
          await receiver.complete(locked);
          console.info(JSON.stringify({
            component: 'notification-worker',
            event: 'message-completed',
            eventId: locked.envelope.eventId,
            eventType: locked.envelope.eventType,
            deliveryCount: locked.deliveryCount,
            result,
          }));
        }
      } catch (error) {
        try {
          await receiver.abandon(locked);
        } catch (abandonError) {
          console.error(JSON.stringify({
            component: 'notification-worker',
            event: 'message-abandon-failed',
            eventId: locked.envelope.eventId,
            error: abandonError instanceof Error ? abandonError.message : String(abandonError),
          }));
        }
        console.error(JSON.stringify({
          component: 'notification-worker',
          event: 'message-processing-failed',
          eventId: locked.envelope.eventId,
          eventType: locked.envelope.eventType,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        component: 'notification-worker',
        event: 'receive-loop-failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      await sleep(Math.max(1000, config.NOTIFICATION_LOOP_DELAY_MS));
    }
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ component: 'notification-worker', event: 'fatal', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    receiver.close();
    graph.close();
    await prisma.$disconnect();
    console.info(JSON.stringify({ component: 'notification-worker', event: 'stopped' }));
  });
