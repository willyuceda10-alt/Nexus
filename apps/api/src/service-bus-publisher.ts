import { createHash } from 'node:crypto';
import { config } from './config.js';
import {
  outboxMessageId,
  toServiceBusEnvelopeV2,
  type OutboxEventV2,
} from './domain/outbox-dispatch-v2.js';
import type { DomainEventPublisherV2 } from './outbox-dispatcher.js';

type ManagedIdentityTokenResponse = {
  access_token?: string;
  expires_on?: string | number;
  expires_in?: string | number;
};

function brokerMessageId(event: OutboxEventV2): string {
  const logicalId = outboxMessageId(event);
  if (logicalId.length <= 128) return logicalId;
  return `sha256:${createHash('sha256').update(logicalId).digest('hex')}`;
}

function parseExpiryMs(payload: ManagedIdentityTokenResponse): number {
  const numeric = Number(payload.expires_on);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = typeof payload.expires_on === 'string' ? Date.parse(payload.expires_on) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  const expiresIn = Number(payload.expires_in);
  return Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 5 * 60 * 1000);
}

export class AzureServiceBusDomainPublisher implements DomainEventPublisherV2 {
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;
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

  private async managedIdentityToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() + 120_000 < this.accessTokenExpiresAtMs) {
      return this.accessToken;
    }

    const endpoint = process.env.IDENTITY_ENDPOINT;
    const identityHeader = process.env.IDENTITY_HEADER;
    if (!endpoint || !identityHeader) {
      throw new Error('Container Apps managed identity endpoint is not available. IDENTITY_ENDPOINT and IDENTITY_HEADER are required.');
    }

    const tokenUrl = new URL(endpoint);
    tokenUrl.searchParams.set('resource', 'https://servicebus.azure.net/');
    tokenUrl.searchParams.set('api-version', '2019-08-01');
    if (config.AZURE_CLIENT_ID) tokenUrl.searchParams.set('client_id', config.AZURE_CLIENT_ID);

    const response = await fetch(tokenUrl, {
      method: 'GET',
      headers: { 'X-IDENTITY-HEADER': identityHeader },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Managed identity token request failed (${response.status} ${response.statusText}).`);
    }

    const payload = await response.json() as ManagedIdentityTokenResponse;
    if (!payload.access_token) throw new Error('Managed identity token response did not include access_token.');
    this.accessToken = payload.access_token;
    this.accessTokenExpiresAtMs = parseExpiryMs(payload);
    return payload.access_token;
  }

  private async send(event: OutboxEventV2, forceTokenRefresh = false): Promise<Response> {
    const token = await this.managedIdentityToken(forceTokenRefresh);
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
      this.accessToken = null;
      this.accessTokenExpiresAtMs = 0;
      response = await this.send(event, true);
    }
    if (response.status !== 201) {
      const body = (await response.text()).slice(0, 2000);
      throw new Error(`Service Bus send failed (${response.status} ${response.statusText}): ${body}`);
    }
  }

  async close(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
  }
}
