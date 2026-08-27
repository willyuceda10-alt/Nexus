import { runtimeConfig } from '../config/runtime';
import type {
  ApiBaselineSummary,
  ApiDependency,
  ApiDependencyListResponse,
  ApiErrorPayload,
  ApiNexusObject,
  ApiObjectListResponse,
  ApiProjectForecast,
  ApiScheduleAnalysis,
  BootstrapResponse,
  CreateApiDependencyInput,
  CreateApiObjectInput,
  ListObjectsParams,
  SessionResponse,
  UpdateApiDependencyInput,
  UpdateApiObjectInput,
} from './contracts';
import type {
  ApiAutomationApprovalStatusV1,
  ApiAutomationApprovalV1,
  ApiAutomationDefinitionV1,
  ApiAutomationRunV1,
  ApiAutomationStatusV1,
  ApiAutomationVersionV1,
  CreateApiAutomationDefinitionV1Input,
  PublishApiAutomationVersionV1Input,
} from './automationV1Contracts';
import type {
  PublishInternalNotificationAutomationV2Input,
  PublishInternalNotificationAutomationV2Response,
} from './automationActionsV2Contracts';
import type {
  ApiCostBackfillV2Response,
  ApiCostCatalogV2,
  ApiProjectCostOverviewV2,
  CreateApiActualCostV2Input,
  CreateApiBudgetLineV2Input,
  CreateApiCommitmentV2Input,
  CreateApiCostCodeV2Input,
  UpdateApiBudgetLineV2Input,
  UpdateApiCostProfileV2Input,
} from './costEngineV2Contracts';
import type {
  ApiInboxItemV1,
  ApiInboxListV1,
  ListApiInboxV1Params,
} from './inboxV1Contracts';
import type {
  ApiMaterialMasterV2,
  ApiMaterialOverviewV2,
  ApiMaterialSetupV2,
  ApiSupplierV2,
  ApiWarehouseV2,
  CreateGoodsReceiptV2Input,
  CreateMaterialIssueV2Input,
  CreateMaterialRequirementV2Input,
  CreatePurchaseOrderV2Input,
  CreateReservationV2Input,
  MaterialEngineBackfillV2Response,
} from './materialInventoryV2Contracts';
import type {
  ApiProjectEngineV2BackfillResponse,
  ApiScheduleAnalysisV2,
  ApiWbsV2Response,
  ApiWorkItemScheduleV2,
  UpdateApiWbsV2Input,
  UpdateApiWbsV2Response,
  UpdateApiWorkItemScheduleV2Input,
} from './projectScheduleV2Contracts';
import type { ApiResourceCapacityResponse } from './resourceCapacityContracts';

export type AccessTokenProvider = () => Promise<string | null>;
export type TenantIdProvider = () => string | null;

let accessTokenProvider: AccessTokenProvider | null = null;
let tenantIdProvider: TenantIdProvider | null = null;

export function configureApiSession(options: {
  getAccessToken?: AccessTokenProvider | null;
  getTenantId?: TenantIdProvider | null;
}): void {
  accessTokenProvider = options.getAccessToken ?? null;
  tenantIdProvider = options.getTenantId ?? null;
}

export class BridataApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;
  readonly details?: unknown;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message || `Bridata Project API request failed (${status})`);
    this.name = 'BridataApiError';
    this.status = status;
    this.code = payload.error;
    this.correlationId = payload.correlationId;
    this.details = payload.details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = accessTokenProvider ? await accessTokenProvider() : null;
  const tenantId = tenantIdProvider?.() ?? null;
  const headers = new Headers(init.headers);

  headers.set('accept', 'application/json');
  headers.set('x-correlation-id', crypto.randomUUID());

  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (tenantId) headers.set('x-bridata-tenant-id', tenantId);

  const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    let payload: ApiErrorPayload = {};
    try {
      payload = (await response.json()) as ApiErrorPayload;
    } catch {
      payload = { message: response.statusText };
    }
    throw new BridataApiError(response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function objectListPath(params: ListObjectsParams = {}): string {
  const query = new URLSearchParams();
  if (params.workspaceId) query.set('workspaceId', params.workspaceId);
  if (params.type) query.set('type', params.type);
  if (params.status) query.set('status', params.status);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString();
  return suffix ? `/api/v1/objects?${suffix}` : '/api/v1/objects';
}

export const bridataApi = {
  session(signal?: AbortSignal): Promise<SessionResponse> {
    return request<SessionResponse>('/api/v1/session', { signal });
  },
  bootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
    return request<BootstrapResponse>('/api/v1/bootstrap', { signal });
  },
  listObjects(params: ListObjectsParams = {}, signal?: AbortSignal): Promise<ApiObjectListResponse> {
    return request<ApiObjectListResponse>(objectListPath(params), { signal });
  },
  createObject(input: CreateApiObjectInput): Promise<ApiNexusObject> {
    return request<ApiNexusObject>('/api/v1/objects', { method: 'POST', body: JSON.stringify(input) });
  },
  updateObject(id: string, input: UpdateApiObjectInput): Promise<ApiNexusObject> {
    return request<ApiNexusObject>(`/api/v1/objects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  deleteObject(id: string): Promise<void> {
    return request<void>(`/api/v1/objects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  listDependencies(workspaceId: string, signal?: AbortSignal): Promise<ApiDependencyListResponse> {
    const query = new URLSearchParams({ workspaceId });
    return request<ApiDependencyListResponse>(`/api/v1/dependencies?${query.toString()}`, { signal });
  },
  createDependency(input: CreateApiDependencyInput): Promise<ApiDependency> {
    return request<ApiDependency>('/api/v1/dependencies', { method: 'POST', body: JSON.stringify(input) });
  },
  updateDependency(id: string, input: UpdateApiDependencyInput): Promise<ApiDependency> {
    return request<ApiDependency>(`/api/v1/dependencies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  deleteDependency(id: string): Promise<void> {
    return request<void>(`/api/v1/dependencies/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  scheduleAnalysis(projectId: string, signal?: AbortSignal): Promise<ApiScheduleAnalysis> {
    const query = new URLSearchParams({ projectId });
    return request<ApiScheduleAnalysis>(`/api/v1/schedule-analysis?${query.toString()}`, { signal });
  },
  projectScheduleAnalysisV2(projectId: string, signal?: AbortSignal): Promise<ApiScheduleAnalysisV2> {
    return request<ApiScheduleAnalysisV2>(`/api/v1/projects/${encodeURIComponent(projectId)}/schedule-analysis-v2`, { signal });
  },
  projectWbsV2(projectId: string, signal?: AbortSignal): Promise<ApiWbsV2Response> {
    return request<ApiWbsV2Response>(`/api/v1/projects/${encodeURIComponent(projectId)}/wbs-v2`, { signal });
  },
  updateProjectWbsV2(projectId: string, input: UpdateApiWbsV2Input): Promise<UpdateApiWbsV2Response> {
    return request<UpdateApiWbsV2Response>(`/api/v1/projects/${encodeURIComponent(projectId)}/wbs-v2`, {
      method: 'PUT', body: JSON.stringify(input),
    });
  },
  updateWorkItemScheduleV2(objectId: string, input: UpdateApiWorkItemScheduleV2Input): Promise<ApiWorkItemScheduleV2> {
    return request<ApiWorkItemScheduleV2>(`/api/v1/work-items/${encodeURIComponent(objectId)}/schedule`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  },
  backfillProjectEngineV2(projectId: string, dryRun = true): Promise<ApiProjectEngineV2BackfillResponse> {
    return request<ApiProjectEngineV2BackfillResponse>('/api/v1/project-engine-v2/backfill', {
      method: 'POST', body: JSON.stringify({ projectId, dryRun }),
    });
  },
  materialSetupV2(workspaceId: string, signal?: AbortSignal): Promise<ApiMaterialSetupV2> {
    const query = new URLSearchParams({ workspaceId });
    return request<ApiMaterialSetupV2>(`/api/v1/material-engine-v2/setup?${query.toString()}`, { signal });
  },
  materialOverviewV2(workspaceId: string, projectId?: string | null, asOf?: string, signal?: AbortSignal): Promise<ApiMaterialOverviewV2> {
    const query = new URLSearchParams({ workspaceId });
    if (projectId) query.set('projectId', projectId);
    if (asOf) query.set('asOf', asOf);
    return request<ApiMaterialOverviewV2>(`/api/v1/material-engine-v2/overview?${query.toString()}`, { signal });
  },
  backfillMaterialEngineV2(workspaceId: string, dryRun = true): Promise<MaterialEngineBackfillV2Response> {
    return request<MaterialEngineBackfillV2Response>('/api/v1/material-engine-v2/backfill', {
      method: 'POST', body: JSON.stringify({ workspaceId, dryRun }),
    });
  },
  syncMaterialMasterV2(input: {
    materialObjectId: string;
    code: string;
    uomCode?: string;
    uomName?: string;
    decimalPlaces?: number;
    unitCost?: number;
    currency?: string;
  }): Promise<ApiMaterialMasterV2> {
    return request<ApiMaterialMasterV2>('/api/v1/material-engine-v2/materials/sync', {
      method: 'POST', body: JSON.stringify(input),
    });
  },
  createWarehouseV2(input: { workspaceId: string; code: string; name: string }): Promise<ApiWarehouseV2> {
    return request<ApiWarehouseV2>('/api/v1/material-engine-v2/warehouses', { method: 'POST', body: JSON.stringify(input) });
  },
  createSupplierV2(input: { code: string; name: string; taxId?: string | null; email?: string | null; phone?: string | null }): Promise<ApiSupplierV2> {
    return request<ApiSupplierV2>('/api/v1/material-engine-v2/suppliers', { method: 'POST', body: JSON.stringify(input) });
  },
  createMaterialRequirementV2(input: CreateMaterialRequirementV2Input): Promise<{ id: string; status: string }> {
    return request<{ id: string; status: string }>('/api/v1/material-engine-v2/requirements', { method: 'POST', body: JSON.stringify(input) });
  },
  createReservationV2(input: CreateReservationV2Input): Promise<{ id: string; availableAfter: number }> {
    return request<{ id: string; availableAfter: number }>('/api/v1/material-engine-v2/reservations', { method: 'POST', body: JSON.stringify(input) });
  },
  createPurchaseOrderV2(input: CreatePurchaseOrderV2Input): Promise<{ id: string; number: string; status: string; lineCount: number }> {
    return request<{ id: string; number: string; status: string; lineCount: number }>('/api/v1/material-engine-v2/purchase-orders', { method: 'POST', body: JSON.stringify(input) });
  },
  createGoodsReceiptV2(input: CreateGoodsReceiptV2Input): Promise<{ id: string; number: string; status: string; lineCount: number }> {
    return request<{ id: string; number: string; status: string; lineCount: number }>('/api/v1/material-engine-v2/goods-receipts', { method: 'POST', body: JSON.stringify(input) });
  },
  issueMaterialV2(input: CreateMaterialIssueV2Input): Promise<{ id: string; type: 'ISSUE'; quantity: number }> {
    return request<{ id: string; type: 'ISSUE'; quantity: number }>('/api/v1/material-engine-v2/issues', { method: 'POST', body: JSON.stringify(input) });
  },
  costCatalogV2(workspaceId: string, signal?: AbortSignal): Promise<ApiCostCatalogV2> {
    const query = new URLSearchParams({ workspaceId });
    return request<ApiCostCatalogV2>(`/api/v1/cost-engine-v2/catalog?${query.toString()}`, { signal });
  },
  projectCostOverviewV2(projectId: string, signal?: AbortSignal): Promise<ApiProjectCostOverviewV2> {
    return request<ApiProjectCostOverviewV2>(`/api/v1/projects/${encodeURIComponent(projectId)}/cost-overview-v2`, { signal });
  },
  createCostCodeV2(input: CreateApiCostCodeV2Input): Promise<{ id: string }> {
    return request<{ id: string }>('/api/v1/cost-engine-v2/cost-codes', { method: 'POST', body: JSON.stringify(input) });
  },
  updateProjectCostProfileV2(projectId: string, input: UpdateApiCostProfileV2Input): Promise<{ id: string }> {
    return request<{ id: string }>(`/api/v1/projects/${encodeURIComponent(projectId)}/cost-profile-v2`, { method: 'PUT', body: JSON.stringify(input) });
  },
  createBudgetLineV2(projectId: string, input: CreateApiBudgetLineV2Input): Promise<{ id: string }> {
    return request<{ id: string }>(`/api/v1/projects/${encodeURIComponent(projectId)}/budget-lines-v2`, { method: 'POST', body: JSON.stringify(input) });
  },
  updateBudgetLineV2(id: string, input: UpdateApiBudgetLineV2Input): Promise<{ id: string }> {
    return request<{ id: string }>(`/api/v1/cost-engine-v2/budget-lines/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  createCommitmentV2(projectId: string, input: CreateApiCommitmentV2Input): Promise<{ id: string }> {
    return request<{ id: string }>(`/api/v1/projects/${encodeURIComponent(projectId)}/commitments-v2`, { method: 'POST', body: JSON.stringify(input) });
  },
  updateCommitmentV2(id: string, input: { releasedAmount?: number; status?: 'OPEN' | 'CLOSED' | 'CANCELLED'; notes?: string | null }): Promise<{ id: string }> {
    return request<{ id: string }>(`/api/v1/cost-engine-v2/commitments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  createActualCostV2(projectId: string, input: CreateApiActualCostV2Input): Promise<{ id: string }> {
    return request<{ id: string }>(`/api/v1/projects/${encodeURIComponent(projectId)}/actual-costs-v2`, { method: 'POST', body: JSON.stringify(input) });
  },
  captureCostBaselineV2(projectId: string, name?: string | null): Promise<{ id: string; version: number; lineCount: number }> {
    return request<{ id: string; version: number; lineCount: number }>(`/api/v1/projects/${encodeURIComponent(projectId)}/cost-baseline-v2`, {
      method: 'POST', body: JSON.stringify({ name: name ?? null }),
    });
  },
  listCostBaselinesV2(projectId: string, signal?: AbortSignal): Promise<{ items: Array<Record<string, unknown>> }> {
    return request<{ items: Array<Record<string, unknown>> }>(`/api/v1/projects/${encodeURIComponent(projectId)}/cost-baselines-v2`, { signal });
  },
  backfillCostEngineV2(projectId: string, dryRun = true): Promise<ApiCostBackfillV2Response> {
    return request<ApiCostBackfillV2Response>('/api/v1/cost-engine-v2/backfill', { method: 'POST', body: JSON.stringify({ projectId, dryRun }) });
  },
  listAutomationsV1(params: { workspaceId?: string; projectId?: string; status?: ApiAutomationStatusV1 } = {}, signal?: AbortSignal): Promise<{ items: ApiAutomationDefinitionV1[] }> {
    const query = new URLSearchParams();
    if (params.workspaceId) query.set('workspaceId', params.workspaceId);
    if (params.projectId) query.set('projectId', params.projectId);
    if (params.status) query.set('status', params.status);
    const suffix = query.toString();
    return request<{ items: ApiAutomationDefinitionV1[] }>(`/api/v1/automations-v1${suffix ? `?${suffix}` : ''}`, { signal });
  },
  createAutomationV1(input: CreateApiAutomationDefinitionV1Input): Promise<ApiAutomationDefinitionV1> {
    return request<ApiAutomationDefinitionV1>('/api/v1/automations-v1', { method: 'POST', body: JSON.stringify(input) });
  },
  publishAutomationVersionV1(id: string, input: PublishApiAutomationVersionV1Input): Promise<ApiAutomationVersionV1> {
    return request<ApiAutomationVersionV1>(`/api/v1/automations-v1/${encodeURIComponent(id)}/versions`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },
  publishInternalNotificationAutomationV2(
    id: string,
    input: PublishInternalNotificationAutomationV2Input,
  ): Promise<PublishInternalNotificationAutomationV2Response> {
    return request<PublishInternalNotificationAutomationV2Response>(
      `/api/v1/automations-v1/${encodeURIComponent(id)}/internal-notification-version-v2`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
  setAutomationStatusV1(id: string, status: ApiAutomationStatusV1): Promise<ApiAutomationDefinitionV1> {
    return request<ApiAutomationDefinitionV1>(`/api/v1/automations-v1/${encodeURIComponent(id)}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  },
  automationRunsV1(id: string, limit = 50, signal?: AbortSignal): Promise<{ items: ApiAutomationRunV1[] }> {
    const query = new URLSearchParams({ limit: String(limit) });
    return request<{ items: ApiAutomationRunV1[] }>(`/api/v1/automations-v1/${encodeURIComponent(id)}/runs?${query.toString()}`, { signal });
  },
  automationApprovalsV1(status: ApiAutomationApprovalStatusV1 = 'PENDING', signal?: AbortSignal): Promise<{ items: ApiAutomationApprovalV1[] }> {
    const query = new URLSearchParams({ status });
    return request<{ items: ApiAutomationApprovalV1[] }>(`/api/v1/automation-approvals-v1?${query.toString()}`, { signal });
  },
  decideAutomationApprovalV1(id: string, decision: 'APPROVED' | 'REJECTED', comment?: string | null): Promise<{ id: string; status: string; decidedAt: string | null }> {
    return request<{ id: string; status: string; decidedAt: string | null }>(`/api/v1/automation-approvals-v1/${encodeURIComponent(id)}/decision`, {
      method: 'POST', body: JSON.stringify({ decision, comment: comment ?? null }),
    });
  },
  inboxV1(params: ListApiInboxV1Params = {}, signal?: AbortSignal): Promise<ApiInboxListV1> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.unread !== undefined) query.set('unread', String(params.unread));
    if (params.includeSnoozed !== undefined) query.set('includeSnoozed', String(params.includeSnoozed));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return request<ApiInboxListV1>(`/api/v1/inbox-v1${suffix ? `?${suffix}` : ''}`, { signal });
  },
  readInboxItemV1(id: string): Promise<ApiInboxItemV1> {
    return request<ApiInboxItemV1>(`/api/v1/inbox-v1/${encodeURIComponent(id)}/read`, { method: 'POST' });
  },
  resolveInboxItemV1(id: string): Promise<ApiInboxItemV1> {
    return request<ApiInboxItemV1>(`/api/v1/inbox-v1/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
  },
  dismissInboxItemV1(id: string): Promise<ApiInboxItemV1> {
    return request<ApiInboxItemV1>(`/api/v1/inbox-v1/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
  },
  snoozeInboxItemV1(id: string, until: string | null): Promise<ApiInboxItemV1> {
    return request<ApiInboxItemV1>(`/api/v1/inbox-v1/${encodeURIComponent(id)}/snooze`, {
      method: 'POST', body: JSON.stringify({ until }),
    });
  },
  projectForecast(projectId: string, asOf?: string, signal?: AbortSignal): Promise<ApiProjectForecast> {
    const query = new URLSearchParams({ projectId });
    if (asOf) query.set('asOf', asOf);
    return request<ApiProjectForecast>(`/api/v1/forecast?${query.toString()}`, { signal });
  },
  resourceCapacity(workspaceId: string, from?: string, to?: string, signal?: AbortSignal): Promise<ApiResourceCapacityResponse> {
    const query = new URLSearchParams({ workspaceId });
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return request<ApiResourceCapacityResponse>(`/api/v1/resource-capacity?${query.toString()}`, { signal });
  },
  saveProjectBaseline(projectId: string, overwrite = false): Promise<ApiBaselineSummary> {
    return request<ApiBaselineSummary>(`/api/v1/projects/${encodeURIComponent(projectId)}/baseline`, {
      method: 'POST', body: JSON.stringify({ overwrite }),
    });
  },
};
