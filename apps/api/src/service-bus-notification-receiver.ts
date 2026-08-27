import { config } from './config.js';
import { AzureManagedIdentityTokenProvider } from './azure-managed-identity.js';
import type { AutomationEventEnvelopeV1 } from './domain/automation-engine-v1.js';

export interface LockedNotificationMessageV1 {
  envelope: AutomationEventEnvelopeV1;
  lockUrl: string;
  deliveryCount: number;
  messageId: string | null;
}

type BrokerProperties = {
  DeliveryCount?: number;
  MessageId?: string;
};

export class AzureServiceBusNotificationReceiver {
  private readonly tokenProvider = new AzureManagedIdentityTokenProvider('https://servicebus.azure.net/');
  private readonly namespaceHost: string;
  private readonly receiveUrl: string;

  constructor() {
    if (!config.SERVICE_BUS_NAMESPACE) throw new Error('SERVICE_BUS_NAMESPACE is required for notification receiver.');
    this.namespaceHost = config.SERVICE_BUS_NAMESPACE.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.receiveUrl = `https://${this.namespaceHost}/${encodeURIComponent(config.SERVICE_BUS_TOPIC)}`
      + `/subscriptions/${encodeURIComponent(config.SERVICE_BUS_NOTIFICATION_SUBSCRIPTION)}/messages/head`;
  }

  private async authorizedFetch(url: string, init: RequestInit, forceRefresh = false): Promise<Response> {
    const token = await this.tokenProvider.token(forceRefresh);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    let response = await fetch(url, { ...init, headers });
    if (response.status === 401 && !forceRefresh) {
      this.tokenProvider.reset();
      response = await this.authorizedFetch(url, init, true);
    }
    return response;
  }

  private safeLockUrl(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== this.namespaceHost.toLowerCase()) {
      throw new Error('Service Bus returned a notification lock URL outside the configured namespace.');
    }
    return url.toString();
  }

  async receive(): Promise<LockedNotificationMessageV1 | null> {
    const url = `${this.receiveUrl}?timeout=${config.NOTIFICATION_RECEIVE_TIMEOUT_SECONDS}`;
    const response = await this.authorizedFetch(url, {
      method: 'POST',
      headers: { 'Content-Length': '0' },
      signal: AbortSignal.timeout((config.NOTIFICATION_RECEIVE_TIMEOUT_SECONDS + 10) * 1000),
    });
    if (response.status === 204) return null;
    if (response.status !== 201) {
      const body = (await response.text()).slice(0, 2000);
      throw new Error(`Service Bus notification receive failed (${response.status} ${response.statusText}): ${body}`);
    }

    const location = response.headers.get('location');
    if (!location) throw new Error('Service Bus notification peek-lock response did not include Location.');
    const brokerRaw = response.headers.get('brokerproperties');
    let broker: BrokerProperties = {};
    if (brokerRaw) {
      try { broker = JSON.parse(brokerRaw) as BrokerProperties; } catch { broker = {}; }
    }
    const body = await response.text();
    const envelope = JSON.parse(body) as AutomationEventEnvelopeV1;
    return {
      envelope,
      lockUrl: this.safeLockUrl(location),
      deliveryCount: Number.isFinite(Number(broker.DeliveryCount)) ? Number(broker.DeliveryCount) : 1,
      messageId: typeof broker.MessageId === 'string' ? broker.MessageId : null,
    };
  }

  async complete(message: LockedNotificationMessageV1): Promise<void> {
    const response = await this.authorizedFetch(this.safeLockUrl(message.lockUrl), {
      method: 'DELETE',
      headers: { 'Content-Length': '0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200 && response.status !== 404) {
      throw new Error(`Service Bus notification complete failed (${response.status} ${response.statusText}).`);
    }
  }

  async abandon(message: LockedNotificationMessageV1): Promise<void> {
    const response = await this.authorizedFetch(this.safeLockUrl(message.lockUrl), {
      method: 'PUT',
      headers: { 'Content-Length': '0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200 && response.status !== 404) {
      throw new Error(`Service Bus notification abandon failed (${response.status} ${response.statusText}).`);
    }
  }

  close(): void {
    this.tokenProvider.reset();
  }
}
