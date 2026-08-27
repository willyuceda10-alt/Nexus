import { config } from './config.js';
import { prisma } from './db.js';
import { processAutomationEventV1, resumeAutomationApprovalRunV1 } from './automation-runner-v1.js';
import { AzureServiceBusAutomationReceiver } from './service-bus-receiver.js';

if (!config.AUTOMATION_WORKER_ENABLED) {
  throw new Error('Automation worker cannot start unless AUTOMATION_WORKER_ENABLED=true.');
}

const receiver = new AzureServiceBusAutomationReceiver();
let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalStop(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ component: 'automation-worker', event: 'shutdown-requested', signal }));
}

process.on('SIGTERM', () => signalStop('SIGTERM'));
process.on('SIGINT', () => signalStop('SIGINT'));

async function main(): Promise<void> {
  console.info(JSON.stringify({
    component: 'automation-worker',
    event: 'started',
    topic: config.SERVICE_BUS_TOPIC,
    subscription: config.SERVICE_BUS_AUTOMATION_SUBSCRIPTION,
  }));

  while (!stopping) {
    try {
      const locked = await receiver.receive();
      if (!locked) {
        await sleep(config.AUTOMATION_LOOP_DELAY_MS);
        continue;
      }

      try {
        const resumed = await resumeAutomationApprovalRunV1(locked.envelope);
        const result = await processAutomationEventV1(locked.envelope);
        if (result.retryableFailure) {
          await receiver.abandon(locked);
          console.warn(JSON.stringify({
            component: 'automation-worker',
            event: 'message-abandoned',
            eventId: locked.envelope.eventId,
            eventType: locked.envelope.eventType,
            deliveryCount: locked.deliveryCount,
            resumedApproval: resumed,
            result,
          }));
        } else {
          await receiver.complete(locked);
          console.info(JSON.stringify({
            component: 'automation-worker',
            event: 'message-completed',
            eventId: locked.envelope.eventId,
            eventType: locked.envelope.eventType,
            deliveryCount: locked.deliveryCount,
            resumedApproval: resumed,
            result,
          }));
        }
      } catch (error) {
        try {
          await receiver.abandon(locked);
        } catch (abandonError) {
          console.error(JSON.stringify({
            component: 'automation-worker',
            event: 'message-abandon-failed',
            eventId: locked.envelope.eventId,
            error: abandonError instanceof Error ? abandonError.message : String(abandonError),
          }));
        }
        console.error(JSON.stringify({
          component: 'automation-worker',
          event: 'message-processing-failed',
          eventId: locked.envelope.eventId,
          eventType: locked.envelope.eventType,
          deliveryCount: locked.deliveryCount,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        component: 'automation-worker',
        event: 'receive-loop-failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      await sleep(Math.max(1000, config.AUTOMATION_LOOP_DELAY_MS));
    }
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ component: 'automation-worker', event: 'fatal', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    receiver.close();
    await prisma.$disconnect();
    console.info(JSON.stringify({ component: 'automation-worker', event: 'stopped' }));
  });
