import { describe, expect, it } from 'vitest';
import { outboxMessageId, outboxRetryDelaySeconds, toServiceBusEnvelopeV2 } from './outbox-dispatch-v2.js';

describe('outbox dispatch v2', () => {
  it('uses exponential retry delays capped at fifteen minutes', () => {
    expect(outboxRetryDelaySeconds(1)).toBe(5);
    expect(outboxRetryDelaySeconds(2)).toBe(10);
    expect(outboxRetryDelaySeconds(5)).toBe(80);
    expect(outboxRetryDelaySeconds(20)).toBe(900);
  });

  it('prefers an idempotency key as the Service Bus message id', () => {
    expect(outboxMessageId({ id: 'event-1', idempotencyKey: 'cost:abc:1' })).toBe('cost:abc:1');
    expect(outboxMessageId({ id: 'event-1', idempotencyKey: null })).toBe('event-1');
  });

  it('creates a stable versioned envelope', () => {
    const result = toServiceBusEnvelopeV2({
      id: 'event-1',
      tenantId: 'tenant-1',
      aggregateId: 'aggregate-1',
      eventType: 'bridata.test.created',
      payload: { ok: true },
      attempts: 1,
      idempotencyKey: null,
      createdAt: new Date('2026-08-26T20:00:00.000Z'),
    });
    expect(result).toEqual({
      schemaVersion: 1,
      eventId: 'event-1',
      tenantId: 'tenant-1',
      aggregateId: 'aggregate-1',
      eventType: 'bridata.test.created',
      occurredAt: '2026-08-26T20:00:00.000Z',
      payload: { ok: true },
    });
  });
});
