export interface OutboxEventV2 {
  id: string;
  tenantId: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface ServiceBusDomainEnvelopeV2 {
  schemaVersion: 1;
  eventId: string;
  tenantId: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  payload: unknown;
}

export function outboxRetryDelaySeconds(attempt: number): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(900, 5 * (2 ** (normalizedAttempt - 1)));
}

export function outboxMessageId(event: Pick<OutboxEventV2, 'id' | 'idempotencyKey'>): string {
  return event.idempotencyKey?.trim() || event.id;
}

export function toServiceBusEnvelopeV2(event: OutboxEventV2): ServiceBusDomainEnvelopeV2 {
  return {
    schemaVersion: 1,
    eventId: event.id,
    tenantId: event.tenantId,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    occurredAt: event.createdAt.toISOString(),
    payload: event.payload,
  };
}
