export interface ApiActor {
  tenantId: string;
  userId: string;
  membershipId: string;
  role: string;
  email: string;
  name: string;
}

export interface ApiTenant {
  id: string;
  name: string;
  slug: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM';
  status: 'ACTIVE' | 'SUSPENDED' | 'PROVISIONING' | 'DELETED';
  metadata: unknown;
}

export interface SessionTenant extends ApiTenant {
  membershipId: string;
  role: string;
}

export interface SessionResponse {
  product: {
    name: string;
    apiVersion: string;
  };
  identity: {
    provider: 'ENTRA_ID' | 'DEV';
    providerTenantId: string | null;
  };
  user: {
    id: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
  };
  tenants: SessionTenant[];
  preferredTenantId: string | null;
}

export interface ApiWorkspace {
  id: string;
  name: string;
  code: string;
  description: string | null;
  role: string;
}

export interface ApiObjectDefinition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  schema: unknown;
  permissions: unknown;
  isSystem: boolean;
}

export interface ApiUserSummary {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

export interface ApiNexusObject {
  id: string;
  tenantId: string;
  workspaceId: string;
  objectDefinitionId: string;
  objectTypeKey: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  progress: number;
  ownerId: string;
  assigneeId: string | null;
  startDate: string | null;
  dueDate: string | null;
  metadata: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  owner?: ApiUserSummary;
  assignee?: ApiUserSummary | null;
}

export interface ApiObjectListResponse {
  items: ApiNexusObject[];
  nextCursor: string | null;
}

export interface ListObjectsParams {
  workspaceId?: string;
  type?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface CreateApiObjectInput {
  workspaceId: string;
  objectDefinitionId: string;
  objectTypeKey: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  progress?: number;
  assigneeId?: string;
  startDate?: string;
  dueDate?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateApiObjectInput {
  version: number;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  progress?: number;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  metadata?: Record<string, unknown> | null;
}

export type ApiDependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface ApiDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  dependencyType: ApiDependencyType;
  lagDays: number;
  notes: string | null;
  createdAt: string;
}

export interface ApiDependencyListResponse {
  items: ApiDependency[];
}

export interface CreateApiDependencyInput {
  predecessorId: string;
  successorId: string;
  dependencyType?: ApiDependencyType;
  lagDays?: number;
  notes?: string;
}

export interface UpdateApiDependencyInput {
  dependencyType?: ApiDependencyType;
  lagDays?: number;
  notes?: string | null;
}

export interface ApiScheduleTaskAnalysis {
  id: string;
  title: string;
  objectTypeKey: string;
  durationDays: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
}

export interface ApiScheduleDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: ApiDependencyType;
  lagDays: number;
}

export interface ApiScheduleAnalysis {
  projectId: string;
  workspaceId: string;
  calendar: 'CALENDAR_DAYS_V1';
  projectDurationDays: number;
  criticalTaskIds: string[];
  topologicalOrder: string[];
  tasks: ApiScheduleTaskAnalysis[];
  dependencies: ApiScheduleDependency[];
  unscheduledObjectIds: string[];
}

export interface ApiBaselineSummary {
  projectId: string;
  workspaceId: string;
  baselineVersion: number;
  capturedAt: string;
  updatedCount: number;
  scheduledCount: number;
  skippedUnscheduledCount: number;
  overwritten: boolean;
}

export interface BootstrapResponse {
  product: {
    name: string;
    apiVersion: string;
  };
  actor: ApiActor;
  tenant: ApiTenant;
  workspaces: ApiWorkspace[];
  objectDefinitions: ApiObjectDefinition[];
}

export interface ApiErrorPayload {
  error?: string;
  message?: string;
  correlationId?: string;
  details?: unknown;
}
