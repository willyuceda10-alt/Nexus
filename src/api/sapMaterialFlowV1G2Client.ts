import { request } from './client';
import type { ApiSapMaterialFlowV1G2 } from './sapMaterialFlowV1G2Contracts';

export const sapMaterialFlowV1G2Api = {
  flow(workspaceId: string, projectId?: string | null, signal?: AbortSignal): Promise<ApiSapMaterialFlowV1G2> {
    const query = new URLSearchParams({ workspaceId });
    if (projectId) query.set('projectId', projectId);
    return request<ApiSapMaterialFlowV1G2>(`/api/v1/material-engine-v2/sap-flow-v1g2?${query.toString()}`, { signal });
  },
};
