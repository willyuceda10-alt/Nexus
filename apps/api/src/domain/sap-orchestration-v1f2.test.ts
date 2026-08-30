import { describe, expect, it } from 'vitest';
import {
  SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2,
  SAP_ORCHESTRATION_STEPS_V1F2,
  mergeSapAutomationProfileV1f2,
  notReadySourcesV1f2,
  readSapAutomationProfileV1f2,
  servicePrincipalCoversProfileV1f2,
} from './sap-orchestration-v1f2.js';

describe('SAP orchestration V1-F2', () => {
  it('orders the four validated canonical engines deterministically', () => {
    expect(SAP_ORCHESTRATION_STEPS_V1F2).toEqual([
      'CANONICAL_PROCUREMENT_V1D1',
      'INVENTORY_V1D2',
      'FINANCIAL_GUARD_V1D3',
      'ACTUAL_COST_V1D4',
    ]);
  });

  it('requires the five semantic SAP sources for the full orchestration profile', () => {
    expect(SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2).toHaveLength(5);
    expect(new Set(SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2).size).toBe(5);
  });

  it('does not let a limited service principal trigger sources outside its allowlist', () => {
    expect(servicePrincipalCoversProfileV1f2(
      ['SAP_PROJECT_PROCUREMENT'],
      ['SAP_PROJECT_PROCUREMENT', 'SAP_OPEN_PURCHASE_ORDERS'],
    )).toBe(false);
    expect(servicePrincipalCoversProfileV1f2(
      SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2,
      SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2,
    )).toBe(true);
  });

  it('fails closed when any required source is stale, failed or missing', () => {
    const notReady = notReadySourcesV1f2(
      ['SAP_PROJECT_PROCUREMENT', 'SAP_OPEN_PURCHASE_ORDERS', 'SAP_MATERIAL_MOVEMENTS', 'SAP_PROJECT_ACTUAL_COSTS'],
      [
        { sourceKey: 'SAP_PROJECT_PROCUREMENT', latestStatus: 'FRESH' },
        { sourceKey: 'SAP_OPEN_PURCHASE_ORDERS', latestStatus: 'FAILED' },
        { sourceKey: 'SAP_MATERIAL_MOVEMENTS', latestStatus: 'STALE' },
      ],
    );
    expect(notReady).toEqual([
      { sourceKey: 'SAP_OPEN_PURCHASE_ORDERS', status: 'FAILED' },
      { sourceKey: 'SAP_MATERIAL_MOVEMENTS', status: 'STALE' },
      { sourceKey: 'SAP_PROJECT_ACTUAL_COSTS', status: 'NEVER' },
    ]);
  });

  it('accepts legacy succeeded/partial readiness as well as the explicit FRESH state', () => {
    expect(notReadySourcesV1f2(
      ['SAP_PROJECT_PROCUREMENT', 'SAP_OPEN_PURCHASE_ORDERS', 'SAP_MATERIAL_MOVEMENTS'],
      [
        { sourceKey: 'SAP_PROJECT_PROCUREMENT', latestStatus: 'FRESH' },
        { sourceKey: 'SAP_OPEN_PURCHASE_ORDERS', latestStatus: 'SUCCEEDED' },
        { sourceKey: 'SAP_MATERIAL_MOVEMENTS', latestStatus: 'PARTIAL' },
      ],
    )).toEqual([]);
  });

  it('preserves unrelated connection config while storing the automation profile', () => {
    const merged = mergeSapAutomationProfileV1f2(
      { existing: { keep: true } },
      {
        enabled: true,
        workspaceId: '00000000-0000-4000-8000-000000000003',
        ownerUserId: '00000000-0000-4000-8000-000000000001',
        requiredSourceKeys: [...SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2],
      },
    );
    expect((merged.existing as { keep: boolean }).keep).toBe(true);
    expect(readSapAutomationProfileV1f2(merged)).toMatchObject({ enabled: true });
  });
});
