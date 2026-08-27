import { createHash } from 'node:crypto';
import { config } from './config.js';
import { AzureManagedIdentityTokenProvider } from './azure-managed-identity.js';
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
  private readonly tokenProvider = new AzureManagedIdentityTokenProvider('https://servicebus.azure.net/');
  private readonly sendUrl: string;

  constructor() {
    if (!config.SERVICE_BUS_NAMESPACE) {
      throw new Error('SERVICE_BUS_NAMESPACE is required for the outbox publisher.');
    }
    const namespaceHost = config.SERVICE_BUS_NAMESPACE
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');
    this.sendUrl = `https://${namespaceHost}/${encodeURIComponent(config.SERVICE_BUS_TOPIC)}/messages`;
  }

  private async send(event: OutboxEventV2, forceTokenRefresh = false): Promise<Response> {
    const token = await this.tokenProvider.token(forceTokenRefresh);
    const envelope = toServiceBusEnvelopeV2(event);
    const brokerProperties = JSON.stringify({
      MessageId: brokerMessageId(event),
      CorrelationId: event.aggregateId,
      Label: event.eventType,
    });

    return fetch(this.sendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        BrokerProperties: brokerProperties,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(30_000),
    });
  }

  async publish(event: OutboxEventV2): Promise<void> {
    let response = await this.send(event);
    if (response.status === 401) {
      this.tokenProvider.reset();
      response = await this.send(event, true);
    }
    if (response.status !== 201) {
      const body = (await response.text()).slice(0, 2000);
      throw new Error(`Service Bus send failed (${response.status} ${response.statusText}): ${body}`);
    }
  }

  async close(): Promise<void> {
    this.tokenProvider.reset();
  }
}
