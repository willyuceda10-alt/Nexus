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
  ApiNotificationCapabilitiesV1,
  ApiNotificationPreferencesV1,
  UpdateApiNotificationPreferencesV1Input,
} from './notificationPreferencesV1Contracts';
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
import type {
  ApiWorkBoardColumnSourceV1,
  ApiWorkBoardColumnTypeV1,
  ApiWorkBoardDataV1,
  ApiWorkBoardDetailV1,
  ApiWorkBoardSummaryV1,
  ApiWorkViewTypeV1,
} from './workOsBoardV1Contracts';

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

// Shared transport for specialized API modules. It preserves the same access-token,
// tenant, correlation-id and error semantics as the core Bridata client.
export const bridataApiRequest = request;

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
  scheduleAnalysis(projectId: string): Promise<ApiScheduleAnalysis> {
    return request<ApiScheduleAnalysis>(`/api/v1/projects/${encodeURIComponent(projectId)}/schedule-analysis`);
  },
  scheduleAnalysisV2(projectId: string): Promise<ApiScheduleAnalysisV2> {
    return request<ApiScheduleAnalysisV2>(`/api/v2/projects/${encodeURIComponent(projectId)}/schedule-analysis`);
  },
  listWbsV2(projectId: string): Promise<ApiWbsV2Response> {
    return request<ApiWbsV2Response>(`/api/v2/projects/${encodeURIComponent(projectId)}/wbs`);
  },
  updateWbsV2(projectId: string, itemId: string, input: UpdateApiWbsV2Input): Promise<UpdateApiWbsV2Response> {
    return request<UpdateApiWbsV2Response>(`/api/v2/projects/${encodeURIComponent(projectId)}/wbs/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  updateWorkItemScheduleV2(itemId: string, input: UpdateApiWorkItemScheduleV2Input): Promise<ApiWorkItemScheduleV2> {
    return request<ApiWorkItemScheduleV2>(`/api/v2/work-items/${encodeURIComponent(itemId)}/schedule`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  projectEngineBackfillV2(projectId: string): Promise<ApiProjectEngineV2BackfillResponse> {
    return request<ApiProjectEngineV2BackfillResponse>(`/api/v2/projects/${encodeURIComponent(projectId)}/backfill`, { method: 'POST' });
  },
  createBaseline(projectId: string, input: { name: string; notes?: string | null }): Promise<ApiBaselineSummary> {
    return request<ApiBaselineSummary>(`/api/v1/projects/${encodeURIComponent(projectId)}/baselines`, { method: 'POST', body: JSON.stringify(input) });
  },
  listBaselines(projectId: string): Promise<{ items: ApiBaselineSummary[] }> {
    return request<{ items: ApiBaselineSummary[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/baselines`);
  },
  projectForecast(projectId: string): Promise<ApiProjectForecast> {
    return request<ApiProjectForecast>(`/api/v1/projects/${encodeURIComponent(projectId)}/forecast`);
  },
  resourceCapacity(projectId: string): Promise<ApiResourceCapacityResponse> {
    return request<ApiResourceCapacityResponse>(`/api/v1/projects/${encodeURIComponent(projectId)}/resource-capacity`);
  },
  materialSetup(projectId: string): Promise<ApiMaterialSetupV2> {
    return request<ApiMaterialSetupV2>(`/api/v2/projects/${encodeURIComponent(projectId)}/materials/setup`);
  },
  materialOverview(projectId: string): Promise<ApiMaterialOverviewV2> {
    return request<ApiMaterialOverviewV2>(`/api/v2/projects/${encodeURIComponent(projectId)}/materials/overview`);
  },
  createMaterialMaster(input: Record<string, unknown>): Promise<ApiMaterialMasterV2> {
    return request<ApiMaterialMasterV2>('/api/v2/materials/master', { method: 'POST', body: JSON.stringify(input) });
  },
  createSupplier(input: Record<string, unknown>): Promise<ApiSupplierV2> {
    return request<ApiSupplierV2>('/api/v2/materials/suppliers', { method: 'POST', body: JSON.stringify(input) });
  },
  createWarehouse(input: Record<string, unknown>): Promise<ApiWarehouseV2> {
    return request<ApiWarehouseV2>('/api/v2/materials/warehouses', { method: 'POST', body: JSON.stringify(input) });
  },
  materialEngineBackfill(projectId: string): Promise<MaterialEngineBackfillV2Response> {
    return request<MaterialEngineBackfillV2Response>(`/api/v2/projects/${encodeURIComponent(projectId)}/materials/backfill`, { method: 'POST' });
  },
  createMaterialRequirement(input: CreateMaterialRequirementV2Input): Promise<unknown> {
    return request('/api/v2/materials/requirements', { method: 'POST', body: JSON.stringify(input) });
  },
  createReservation(input: CreateReservationV2Input): Promise<unknown> {
    return request('/api/v2/materials/reservations', { method: 'POST', body: JSON.stringify(input) });
  },
  createPurchaseOrder(input: CreatePurchaseOrderV2Input): Promise<unknown> {
    return request('/api/v2/materials/purchase-orders', { method: 'POST', body: JSON.stringify(input) });
  },
  createGoodsReceipt(input: CreateGoodsReceiptV2Input): Promise<unknown> {
    return request('/api/v2/materials/goods-receipts', { method: 'POST', body: JSON.stringify(input) });
  },
  createMaterialIssue(input: CreateMaterialIssueV2Input): Promise<unknown> {
    return request('/api/v2/materials/issues', { method: 'POST', body: JSON.stringify(input) });
  },
  costCatalog(projectId: string): Promise<ApiCostCatalogV2> {
    return request<ApiCostCatalogV2>(`/api/v2/projects/${encodeURIComponent(projectId)}/costs/catalog`);
  },
  projectCostOverview(projectId: string): Promise<ApiProjectCostOverviewV2> {
    return request<ApiProjectCostOverviewV2>(`/api/v2/projects/${encodeURIComponent(projectId)}/costs/overview`);
  },
  createCostCode(input: CreateApiCostCodeV2Input): Promise<unknown> {
    return request('/api/v2/costs/codes', { method: 'POST', body: JSON.stringify(input) });
  },
  updateCostProfile(projectId: string, input: UpdateApiCostProfileV2Input): Promise<unknown> {
    return request(`/api/v2/projects/${encodeURIComponent(projectId)}/costs/profile`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  createBudgetLine(input: CreateApiBudgetLineV2Input): Promise<unknown> {
    return request('/api/v2/costs/budget-lines', { method: 'POST', body: JSON.stringify(input) });
  },
  updateBudgetLine(id: string, input: UpdateApiBudgetLineV2Input): Promise<unknown> {
    return request(`/api/v2/costs/budget-lines/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  createCommitment(input: CreateApiCommitmentV2Input): Promise<unknown> {
    return request('/api/v2/costs/commitments', { method: 'POST', body: JSON.stringify(input) });
  },
  createActualCost(input: CreateApiActualCostV2Input): Promise<unknown> {
    return request('/api/v2/costs/actuals', { method: 'POST', body: JSON.stringify(input) });
  },
  costBackfill(projectId: string): Promise<ApiCostBackfillV2Response> {
    return request<ApiCostBackfillV2Response>(`/api/v2/projects/${encodeURIComponent(projectId)}/costs/backfill`, { method: 'POST' });
  },
  listAutomations(): Promise<{ items: ApiAutomationDefinitionV1[] }> {
    return request('/api/v1/automations');
  },
  createAutomation(input: CreateApiAutomationDefinitionV1Input): Promise<ApiAutomationDefinitionV1> {
    return request('/api/v1/automations', { method: 'POST', body: JSON.stringify(input) });
  },
  listAutomationVersions(definitionId: string): Promise<{ items: ApiAutomationVersionV1[] }> {
    return request(`/api/v1/automations/${encodeURIComponent(definitionId)}/versions`);
  },
  publishAutomationVersion(definitionId: string, input: PublishApiAutomationVersionV1Input): Promise<ApiAutomationVersionV1> {
    return request(`/api/v1/automations/${encodeURIComponent(definitionId)}/versions`, { method: 'POST', body: JSON.stringify(input) });
  },
  publishInternalNotificationAutomationV2(definitionId: string, input: PublishInternalNotificationAutomationV2Input): Promise<PublishInternalNotificationAutomationV2Response> {
    return request(`/api/v2/automations/${encodeURIComponent(definitionId)}/publish-internal-notification`, { method: 'POST', body: JSON.stringify(input) });
  },
  listAutomationRuns(status?: ApiAutomationStatusV1): Promise<{ items: ApiAutomationRunV1[] }> {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    const suffix = query.toString();
    return request(suffix ? `/api/v1/automation-runs?${suffix}` : '/api/v1/automation-runs');
  },
  listAutomationApprovals(status?: ApiAutomationApprovalStatusV1): Promise<{ items: ApiAutomationApprovalV1[] }> {
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    const suffix = query.toString();
    return request(suffix ? `/api/v1/automation-approvals?${suffix}` : '/api/v1/automation-approvals');
  },
  decideAutomationApproval(approvalId: string, decision: 'APPROVE' | 'REJECT'): Promise<ApiAutomationApprovalV1> {
    return request(`/api/v1/automation-approvals/${encodeURIComponent(approvalId)}/decision`, { method: 'POST', body: JSON.stringify({ decision }) });
  },
  listInbox(params: ListApiInboxV1Params = {}): Promise<ApiInboxListV1> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.requiresAction !== undefined) query.set('requiresAction', String(params.requiresAction));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return request(suffix ? `/api/v1/inbox?${suffix}` : '/api/v1/inbox');
  },
  markInboxRead(itemId: string): Promise<ApiInboxItemV1> {
    return request(`/api/v1/inbox/${encodeURIComponent(itemId)}/read`, { method: 'POST' });
  },
  archiveInboxItem(itemId: string): Promise<ApiInboxItemV1> {
    return request(`/api/v1/inbox/${encodeURIComponent(itemId)}/archive`, { method: 'POST' });
  },
  getNotificationPreferences(): Promise<ApiNotificationPreferencesV1> {
    return request('/api/v1/notification-preferences');
  },
  updateNotificationPreferences(input: UpdateApiNotificationPreferencesV1Input): Promise<ApiNotificationPreferencesV1> {
    return request('/api/v1/notification-preferences', { method: 'PUT', body: JSON.stringify(input) });
  },
  getNotificationCapabilities(): Promise<ApiNotificationCapabilitiesV1> {
    return request('/api/v1/notification-capabilities');
  },
  listBoards(workspaceId?: string): Promise<{ items: ApiWorkBoardSummaryV1[] }> {
    const query = new URLSearchParams();
    if (workspaceId) query.set('workspaceId', workspaceId);
    const suffix = query.toString();
    return request(suffix ? `/api/v1/work-os/boards-v1?${suffix}` : '/api/v1/work-os/boards-v1');
  },
  createBoard(input: { workspaceId: string; objectDefinitionId: string; name: string; description?: string | null }): Promise<ApiWorkBoardDetailV1> {
    return request('/api/v1/work-os/boards-v1', { method: 'POST', body: JSON.stringify(input) });
  },
  boardData(boardId: string, viewId?: string): Promise<ApiWorkBoardDataV1> {
    const query = new URLSearchParams();
    if (viewId) query.set('viewId', viewId);
    const suffix = query.toString();
    return request(`/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/data${suffix ? `?${suffix}` : ''}`);
  },
  addBoardGroup(boardId: string, input: { name: string; position?: number }): Promise<unknown> {
    return request(`/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/groups`, { method: 'POST', body: JSON.stringify(input) });
  },
  addBoardColumn(boardId: string, input: { key: string; label: string; columnType: ApiWorkBoardColumnTypeV1; source: ApiWorkBoardColumnSourceV1; coreField?: string; fieldDefinitionId?: string; position?: number; isRequired?: boolean }): Promise<unknown> {
    return request(`/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/columns`, { method: 'POST', body: JSON.stringify(input) });
  },
  addBoardView(boardId: string, input: { name: string; viewType: ApiWorkViewTypeV1; isDefault?: boolean }): Promise<unknown> {
    return request(`/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/views`, { method: 'POST', body: JSON.stringify(input) });
  },
  addBoardItem(boardId: string, input: { objectId: string; groupId?: string | null; position?: number }): Promise<unknown> {
    return request(`/api/v1/work-os/boards-v1/${encodeURIComponent(boardId)}/items`, { method: 'POST', body: JSON.stringify(input) });
  },
};
