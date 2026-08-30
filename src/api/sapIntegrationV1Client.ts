import { request } from './client';
import type { ApiSapIntegrationCenterV1G1 } from './sapIntegrationV1Contracts';

export const sapIntegrationV1Api = {
  center(signal?: AbortSignal): Promise<ApiSapIntegrationCenterV1G1> {
    return request<ApiSapIntegrationCenterV1G1>('/api/v1/integrations/sap/center-v1g1', { signal });
  },
};
