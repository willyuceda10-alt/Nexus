import { describe, expect, it } from 'vitest';
import {
  isAllowedSapInternalOrchestrationPathV1f2,
  matchesSapInternalOrchestrationSecretV1f2,
  sapInternalOrchestrationSecretV1f2,
} from './internal-sap-orchestration-auth-v1f2.js';

describe('internal SAP orchestration credential V1-F2', () => {
  it('accepts only the process-local secret', () => {
    expect(matchesSapInternalOrchestrationSecretV1f2(sapInternalOrchestrationSecretV1f2())).toBe(true);
    expect(matchesSapInternalOrchestrationSecretV1f2('not-the-secret')).toBe(false);
  });

  it('is limited to the four canonical SAP POST routes', () => {
    const id = '00000000-0000-4000-8000-000000000999';
    expect(isAllowedSapInternalOrchestrationPathV1f2('POST', `/api/v1/integrations/sap/connections/${id}/canonical-sync-v1d1`)).toBe(true);
    expect(isAllowedSapInternalOrchestrationPathV1f2('POST', `/api/v1/integrations/sap/connections/${id}/inventory-sync-v1d2`)).toBe(true);
    expect(isAllowedSapInternalOrchestrationPathV1f2('POST', `/api/v1/integrations/sap/connections/${id}/financial-guard-v1d3`)).toBe(true);
    expect(isAllowedSapInternalOrchestrationPathV1f2('POST', `/api/v1/integrations/sap/connections/${id}/actual-cost-sync-v1d4`)).toBe(true);
    expect(isAllowedSapInternalOrchestrationPathV1f2('GET', `/api/v1/integrations/sap/connections/${id}/canonical-sync-v1d1`)).toBe(false);
    expect(isAllowedSapInternalOrchestrationPathV1f2('POST', '/api/v1/me')).toBe(false);
    expect(isAllowedSapInternalOrchestrationPathV1f2('POST', '/api/v1/documents')).toBe(false);
  });
});
