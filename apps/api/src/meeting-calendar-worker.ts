import { config } from './config.js';
import { prisma } from './db.js';
import { processMeetingCalendarCancelEventV2 } from './meeting-calendar-cancel-runner.js';
import { processMeetingCalendarSyncEventV1 } from './meeting-calendar-sync-runner.js';
import { MicrosoftGraphCalendarClient } from './microsoft-graph-calendar-client.js';
import { AzureServiceBusMeetingReceiver } from './service-bus-meeting-receiver.js';

if (!config.MEETING_CALENDAR_WORKER_ENABLED) {
  throw new Error('Meeting calendar worker cannot start unless MEETING_CALENDAR_WORKER_ENABLED=true.');
}

const receiver = new AzureServiceBusMeetingReceiver();
const graph = new MicrosoftGraphCalendarClient();
let stopping = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalStop(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.info(JSON.stringify({ component: 'meeting-calendar-worker', event: 'shutdown-requested', signal }));
}

process.on('SIGTERM', () => signalStop('SIGTERM'));
process.on('SIGINT', () => signalStop('SIGINT'));

async function main(): Promise<void> {
  console.info(JSON.stringify({
    component: 'meeting-calendar-worker',
    event: 'started',
    topic: config.SERVICE_BUS_TOPIC,
    subscription: config.SERVICE_BUS_MEETING_SUBSCRIPTION,
    graphCalendarSyncEnabled: config.M365_CALENDAR_SYNC_ENABLED,
  }));

  while (!stopping) {
    try {
      const locked = await receiver.receive();
      if (!locked) {
        await sleep(config.MEETING_CALENDAR_LOOP_DELAY_MS);
        continue;
      }
      try {
        const cancelResult = await processMeetingCalendarCancelEventV2(locked.envelope, graph, locked.deliveryCount);
        const result = cancelResult.handled
          ? cancelResult
          : await processMeetingCalendarSyncEventV1(locked.envelope, graph, locked.deliveryCount);
        if (result.retryableFailure) {
          await receiver.abandon(locked);
          console.warn(JSON.stringify({ component: 'meeting-calendar-worker', event: 'message-abandoned', eventId: locked.envelope.eventId, result }));
        } else {
          await receiver.complete(locked);
          console.info(JSON.stringify({ component: 'meeting-calendar-worker', event: 'message-completed', eventId: locked.envelope.eventId, result }));
        }
      } catch (error) {
        try { await receiver.abandon(locked); } catch { /* lock may already be gone */ }
        console.error(JSON.stringify({
          component: 'meeting-calendar-worker', event: 'message-processing-failed', eventId: locked.envelope.eventId,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    } catch (error) {
      console.error(JSON.stringify({ component: 'meeting-calendar-worker', event: 'receive-loop-failed', error: error instanceof Error ? error.message : String(error) }));
      await sleep(Math.max(1000, config.MEETING_CALENDAR_LOOP_DELAY_MS));
    }
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ component: 'meeting-calendar-worker', event: 'fatal', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    receiver.close();
    graph.close();
    await prisma.$disconnect();
    console.info(JSON.stringify({ component: 'meeting-calendar-worker', event: 'stopped' }));
  });
