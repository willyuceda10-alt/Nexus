import type {
  ApiActor,
  ApiNexusObject,
  ApiTenant,
  ApiWorkspace,
} from '../api/contracts';
import type {
  NexusObject,
  ObjectStatus,
  ObjectType,
  Priority,
  ScheduleCalendarMode,
  Tenant,
  User,
  UserRoleKey,
  Workspace,
} from '../types/nexus';

const objectTypes = new Set<ObjectType>([
  'PROJECT',
  'TASK',
  'RISK',
  'DOCUMENT',
  'MEETING',
  'DECISION',
  'CHANGE_REQUEST',
  'DELIVERABLE',
  'MILESTONE',
  'INCIDENT',
]);

const statuses = new Set<ObjectStatus>([
  'DRAFT',
  'PLANNING',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
  'IDENTIFIED',
  'MITIGATING',
  'REALIZED',
  'CLOSED',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
]);

const priorities = new Set<Priority>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function stringArrayValue(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value;
}

function numberArrayValue(record: Record<string, unknown>, key: string): number[] | undefined {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return undefined;
  }
  return value;
}

function dateOnly(value: string | null): string | undefined {
  return value ? value.slice(0, 10) : undefined;
}

function objectType(value: string): ObjectType {
  return objectTypes.has(value as ObjectType) ? (value as ObjectType) : 'TASK';
}

function objectStatus(value: string): ObjectStatus {
  return statuses.has(value as ObjectStatus) ? (value as ObjectStatus) : 'DRAFT';
}

function priority(value: string): Priority {
  return priorities.has(value as Priority) ? (value as Priority) : 'MEDIUM';
}

function scheduleCalendarMode(value: string | undefined): ScheduleCalendarMode | undefined {
  return value === 'CALENDAR_DAYS_V1' || value === 'WORKING_DAYS_V1' ? value : undefined;
}

function tenantPlan(plan: ApiTenant['plan']): Tenant['plan'] {
  if (plan === 'ENTERPRISE' || plan === 'CUSTOM') return 'Enterprise';
  if (plan === 'PROFESSIONAL') return 'Business';
  return 'Pro';
}

function actorRole(role: string): UserRoleKey {
  switch (role) {
    case 'OWNER':
      return 'OWNER';
    case 'TENANT_ADMIN':
      return 'ADMIN';
    case 'GUEST':
      return 'CLIENT';
    default:
      return 'MEMBER';
  }
}

export function apiTenantToTenant(value: ApiTenant): Tenant {
  const metadata = asRecord(value.metadata);
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    plan: tenantPlan(value.plan),
    currency: stringValue(metadata, 'currency') ?? 'USD',
    timezone: stringValue(metadata, 'timezone') ?? 'UTC',
    locale: stringValue(metadata, 'locale') ?? 'es-ES',
    ...(stringValue(metadata, 'logo') ? { logo: stringValue(metadata, 'logo') } : {}),
  };
}

export function apiWorkspaceToWorkspace(
  value: ApiWorkspace,
  tenant: ApiTenant,
): Workspace {
  return {
    id: value.id,
    tenantId: tenant.id,
    organizationName: tenant.name,
    name: value.name,
    description: value.description ?? '',
    membersCount: 0,
  };
}

export function apiActorToUser(value: ApiActor): User {
  return {
    id: value.userId,
    name: value.name,
    email: value.email,
    avatar: '',
    roleKey: actorRole(value.role),
    roleName: value.role.replaceAll('_', ' '),
    department: 'Bridata Project',
    tenantId: value.tenantId,
  };
}

export function apiObjectToNexusObject(
  value: ApiNexusObject,
  fallbackUser?: User,
  fallback?: NexusObject,
): NexusObject {
  const metadata = asRecord(value.metadata);
  const ownerName = value.owner?.fullName ?? fallback?.ownerName ?? fallbackUser?.name ?? 'Sin responsable';
  const ownerAvatar = value.owner?.avatarUrl ?? fallback?.ownerAvatar ?? fallbackUser?.avatar ?? '';
  const assigneeName = value.assignee?.fullName ?? fallback?.assigneeName;
  const assigneeAvatar = value.assignee?.avatarUrl ?? fallback?.assigneeAvatar;
  const customFields = asRecord(metadata.customFields);
  const calendarMode = scheduleCalendarMode(stringValue(metadata, 'scheduleCalendarMode'));

  return {
    id: value.id,
    tenantId: value.tenantId,
    workspaceId: value.workspaceId,
    objectDefinitionId: value.objectDefinitionId,
    version: value.version,
    type: objectType(value.objectTypeKey),
    title: value.title,
    description: value.description ?? '',
    status: objectStatus(value.status),
    priority: priority(value.priority),
    ownerId: value.ownerId,
    ownerName,
    ownerAvatar,
    ...(value.assigneeId ? { assigneeId: value.assigneeId } : {}),
    ...(assigneeName ? { assigneeName } : {}),
    ...(assigneeAvatar ? { assigneeAvatar } : {}),
    ...(dateOnly(value.startDate) ? { startDate: dateOnly(value.startDate) } : {}),
    ...(dateOnly(value.dueDate) ? { endDate: dateOnly(value.dueDate) } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    progress: value.progress,
    ...(stringValue(metadata, 'projectId') ? { projectId: stringValue(metadata, 'projectId') } : {}),
    ...(stringValue(metadata, 'portfolioId') ? { portfolioId: stringValue(metadata, 'portfolioId') } : {}),
    ...(numberValue(metadata, 'healthScore') !== undefined ? { healthScore: numberValue(metadata, 'healthScore') } : {}),
    ...(numberValue(metadata, 'budgetTotal') !== undefined ? { budgetTotal: numberValue(metadata, 'budgetTotal') } : {}),
    ...(numberValue(metadata, 'budgetSpent') !== undefined ? { budgetSpent: numberValue(metadata, 'budgetSpent') } : {}),
    ...(stringValue(metadata, 'baselineStartDate') ? { baselineStartDate: stringValue(metadata, 'baselineStartDate') } : {}),
    ...(stringValue(metadata, 'baselineEndDate') ? { baselineEndDate: stringValue(metadata, 'baselineEndDate') } : {}),
    ...(calendarMode ? { scheduleCalendarMode: calendarMode } : {}),
    ...(numberArrayValue(metadata, 'scheduleWorkingWeekdays') ? { scheduleWorkingWeekdays: numberArrayValue(metadata, 'scheduleWorkingWeekdays') } : {}),
    ...(stringArrayValue(metadata, 'scheduleHolidays') ? { scheduleHolidays: stringArrayValue(metadata, 'scheduleHolidays') } : {}),
    ...(numberValue(metadata, 'probability') !== undefined ? { probability: numberValue(metadata, 'probability') } : {}),
    ...(numberValue(metadata, 'impact') !== undefined ? { impact: numberValue(metadata, 'impact') } : {}),
    ...(numberValue(metadata, 'riskScore') !== undefined ? { riskScore: numberValue(metadata, 'riskScore') } : {}),
    ...(stringValue(metadata, 'mitigationPlan') ? { mitigationPlan: stringValue(metadata, 'mitigationPlan') } : {}),
    ...(booleanValue(metadata, 'isRealized') !== undefined ? { isRealized: booleanValue(metadata, 'isRealized') } : {}),
    ...(stringValue(metadata, 'meetingDate') ? { meetingDate: stringValue(metadata, 'meetingDate') } : {}),
    ...(stringValue(metadata, 'meetingAgenda') ? { meetingAgenda: stringValue(metadata, 'meetingAgenda') } : {}),
    ...(stringValue(metadata, 'meetingMinutes') ? { meetingMinutes: stringValue(metadata, 'meetingMinutes') } : {}),
    ...(stringArrayValue(metadata, 'participants') ? { participants: stringArrayValue(metadata, 'participants') } : {}),
    ...(stringValue(metadata, 'decisionJustification') ? { decisionJustification: stringValue(metadata, 'decisionJustification') } : {}),
    ...(stringValue(metadata, 'decisionAuthorizerId') ? { decisionAuthorizerId: stringValue(metadata, 'decisionAuthorizerId') } : {}),
    ...(stringValue(metadata, 'meetingId') ? { meetingId: stringValue(metadata, 'meetingId') } : {}),
    ...(numberValue(metadata, 'costImpact') !== undefined ? { costImpact: numberValue(metadata, 'costImpact') } : {}),
    ...(numberValue(metadata, 'timeImpactDays') !== undefined ? { timeImpactDays: numberValue(metadata, 'timeImpactDays') } : {}),
    ...(stringValue(metadata, 'changeReason') ? { changeReason: stringValue(metadata, 'changeReason') } : {}),
    ...(stringValue(metadata, 'fileVersion') ? { fileVersion: stringValue(metadata, 'fileVersion') } : {}),
    ...(numberValue(metadata, 'fileSizeMb') !== undefined ? { fileSizeMb: numberValue(metadata, 'fileSizeMb') } : {}),
    ...(stringValue(metadata, 'fileCategory') ? { fileCategory: stringValue(metadata, 'fileCategory') } : {}),
    ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
  };
}

const metadataKeys = [
  'projectId',
  'portfolioId',
  'healthScore',
  'budgetTotal',
  'budgetSpent',
  'baselineStartDate',
  'baselineEndDate',
  'scheduleCalendarMode',
  'scheduleWorkingWeekdays',
  'scheduleHolidays',
  'probability',
  'impact',
  'riskScore',
  'mitigationPlan',
  'isRealized',
  'meetingDate',
  'meetingAgenda',
  'meetingMinutes',
  'participants',
  'decisionJustification',
  'decisionAuthorizerId',
  'meetingId',
  'costImpact',
  'timeImpactDays',
  'changeReason',
  'fileVersion',
  'fileSizeMb',
  'fileCategory',
] as const;

export function nexusObjectMetadata(value: Partial<NexusObject>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;

  for (const key of metadataKeys) {
    const field = source[key];
    if (field !== undefined) metadata[key] = field;
  }

  if (value.customFields && Object.keys(value.customFields).length > 0) {
    metadata.customFields = value.customFields;
  }

  return metadata;
}

export function hasMetadataChanges(value: Partial<NexusObject>): boolean {
  return metadataKeys.some((key) => (value as Record<string, unknown>)[key] !== undefined) ||
    value.customFields !== undefined;
}
