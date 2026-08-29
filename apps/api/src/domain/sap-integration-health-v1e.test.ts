import { describe, expect, it } from 'vitest';
import {
  aggregateSapConnectionHealthV1e,
  DEFAULT_SAP_FRESHNESS_MINUTES_V1E,
  evaluateSapSourceHealthV1e,
  resolveSapFreshnessMinutesV1e,
} from './sap-integration-health-v1e.js';

const now = new Date('2026-08-30T04:00:00.000Z');

function base() {
  return {
    configured: true,
    isActive: true,
    freshnessMinutes: 60,
    lastSuccessAt: new Date('2026-08-30T03:30:00.000Z'),
    lastGeneratedAt: new Date('2026-08-30T03:20:00.000Z'),
    latestBatchStatus: 'SUCCEEDED',
    latestBatchReceivedAt: new Date('2026-08-30T03:30:00.000Z'),
    latestBatchSourceGeneratedAt: new Date('2026-08-30T03:20:00.000Z'),
    latestSuccessfulBatchStatus: 'SUCCEEDED',
    latestSuccessfulWarnings: 0,
    latestSuccessfulRejected: 0,
  };
}

describe('SAP integration health V1-E', () => {
  it('uses configured freshness minutes only inside governed bounds', () => {
    expect(resolveSapFreshnessMinutesV1e({ freshnessMinutes: 90 })).toBe(90);
    expect(resolveSapFreshnessMinutesV1e({ freshnessMinutes: 1 })).toBe(DEFAULT_SAP_FRESHNESS_MINUTES_V1E);
    expect(resolveSapFreshnessMinutesV1e({ freshnessMinutes: '90' })).toBe(DEFAULT_SAP_FRESHNESS_MINUTES_V1E);
  });

  it('marks recent successful SAP data fresh and calculates transport lag', () => {
    const result = evaluateSapSourceHealthV1e(base(), now);
    expect(result.freshnessState).toBe('FRESH');
    expect(result.qualityState).toBe('CLEAN');
    expect(result.dataAgeMinutes).toBe(40);
    expect(result.transportLagMinutes).toBe(10);
  });

  it('marks old generated data stale even when it was received recently', () => {
    const result = evaluateSapSourceHealthV1e({
      ...base(),
      lastGeneratedAt: new Date('2026-08-30T01:00:00.000Z'),
      latestBatchSourceGeneratedAt: new Date('2026-08-30T01:00:00.000Z'),
    }, now);
    expect(result.freshnessState).toBe('STALE');
    expect(result.dataAgeMinutes).toBe(180);
  });

  it('surfaces a newer failed batch instead of hiding it behind the last success', () => {
    const result = evaluateSapSourceHealthV1e({
      ...base(),
      latestBatchStatus: 'FAILED',
      latestBatchReceivedAt: new Date('2026-08-30T03:50:00.000Z'),
    }, now);
    expect(result.freshnessState).toBe('ERROR');
  });

  it('distinguishes processing, never configured and disabled sources', () => {
    expect(evaluateSapSourceHealthV1e({ ...base(), lastSuccessAt: null, lastGeneratedAt: null, latestBatchStatus: 'PROCESSING' }, now).freshnessState).toBe('PROCESSING');
    expect(evaluateSapSourceHealthV1e({ ...base(), configured: false, lastSuccessAt: null, lastGeneratedAt: null }, now).freshnessState).toBe('NEVER');
    expect(evaluateSapSourceHealthV1e({ ...base(), isActive: false }, now).freshnessState).toBe('DISABLED');
  });

  it('marks partial or rejected successful batches as quality rejected', () => {
    const result = evaluateSapSourceHealthV1e({
      ...base(),
      latestSuccessfulBatchStatus: 'PARTIAL',
      latestSuccessfulRejected: 2,
    }, now);
    expect(result.qualityState).toBe('REJECTED');
  });

  it('aggregates connection health conservatively', () => {
    expect(aggregateSapConnectionHealthV1e('ACTIVE', ['FRESH', 'FRESH'])).toBe('HEALTHY');
    expect(aggregateSapConnectionHealthV1e('ACTIVE', ['FRESH', 'STALE'])).toBe('DEGRADED');
    expect(aggregateSapConnectionHealthV1e('ACTIVE', ['FRESH', 'PROCESSING'])).toBe('PROCESSING');
    expect(aggregateSapConnectionHealthV1e('ACTIVE', ['FRESH', 'ERROR'])).toBe('ERROR');
    expect(aggregateSapConnectionHealthV1e('DISCONNECTED', ['ERROR'])).toBe('DISCONNECTED');
  });
});
