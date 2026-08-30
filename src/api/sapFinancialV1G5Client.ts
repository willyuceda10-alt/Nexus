import { request } from './client';
import type { SapFinancialViewV1G5 } from './sapFinancialV1G5Contracts';

export function getSapFinancialViewV1G5(
  projectId: string,
  signal?: AbortSignal,
): Promise<SapFinancialViewV1G5> {
  const query = new URLSearchParams({ projectId });
  return request<SapFinancialViewV1G5>(
    `/api/v1/cost-engine-v2/sap-financial-v1g5?${query.toString()}`,
    { signal },
  );
}
