import { request } from './client';
import type { ApiSapInventoryV1G4, ListSapInventoryV1G4Params } from './sapInventoryV1G4Contracts';

export const sapInventoryV1G4Api = {
  list(params: ListSapInventoryV1G4Params, signal?: AbortSignal): Promise<ApiSapInventoryV1G4> {
    const query = new URLSearchParams({ workspaceId: params.workspaceId });
    if (params.materialId) query.set('materialId', params.materialId);
    if (params.warehouseId) query.set('warehouseId', params.warehouseId);
    if (params.sapMovementType) query.set('sapMovementType', params.sapMovementType);
    if (params.limit) query.set('limit', String(params.limit));
    return request<ApiSapInventoryV1G4>(`/api/v1/material-engine-v2/sap-inventory-v1g4?${query.toString()}`, { signal });
  },
};
