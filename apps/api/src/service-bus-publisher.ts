import { createHash } from 'node:crypto';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { ServiceBusClient, type ServiceBusSender } from '@azure/service-bus';
import { config } from './config.js';
import {
  outboxMessageId,
  toServiceBusEnvelopeV2,
  type OutboxEventV2,
} from './domain/outbox-dispatch-v2.js';
import type { DomainEventPublisherV2 } from './outbox-dispatcher.js';

function brokerMessageId(event: OutboxEventV2): string {
  const logicalId = outboxMessageId(event);
  if (logicalId.length <= 128) return logicalId;
  return `sha256:${createHash('sha256').update(logicalId).digest('hex')}`;
}

export class AzureServiceBusDomainPublisher implements DomainEventPublisherV2 {
  private readonly client: ServiceBusClient;
  private readonly sender: ServiceBusSender;

  constructor() {
    if (!config.SERVICE_BUS_NAMESPACE) {
      throw new Error('SERVICE_BUS_NAMESPACE is required for the outbox publisher.');
    }
    const credential = config.AZURE_CLIENT_ID
      ? new ManagedIdentityCredential(config.AZURE_CLIENT_ID)
      : new DefaultAzureCredential();
    this.client = new ServiceBusClient(config.SERVICE_BUS_NAMESPACE, credential);
    this.sender = this.client.createSender(config.SERVICE_BUS_TOPIC);
  }

  async publish(event: OutboxEventV2): Promise<void> {
    const envelope = toServiceBusEnvelopeV2(event);
    await this.sender.sendMessages({
      body: envelope,
      messageId: brokerMessageId(event),
      subject: event.eventType,
      contentType: 'application/json',
      correlationId: event.aggregateId,
      applicationProperties: {
        schemaVersion: 1,
        tenantId: event.tenantId,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        publishAttempt: event.attempts,
      },
    });
  }

  async close(): Promise<void> {
    await this.sender.close();
    await this.client.close();
  }
}
