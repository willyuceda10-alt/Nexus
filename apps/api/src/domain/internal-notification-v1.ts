import type { AutomationEventEnvelopeV1 } from './automation-engine-v1.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = new Set<InternalNotificationPriorityV1>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export type InternalNotificationPriorityV1 = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface InternalNotificationRequestV1 {
  eventId: string;
  tenantId: string;
  targetUserId: string;
  title: string;
  body: string | null;
  priority: InternalNotificationPriorityV1;
  requiresAction: boolean;
  workspaceId: string | null;
  projectId: string | null;
}

export class InternalNotificationValidationErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalNotificationValidationErrorV1';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InternalNotificationValidationErrorV1(`${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new InternalNotificationValidationErrorV1(`${field} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new InternalNotificationValidationErrorV1(`${field} must be a string.`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new InternalNotificationValidationErrorV1(`${field} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new InternalNotificationValidationErrorV1(`${field} must be a UUID.`);
  }
  return value;
}

export function parseInternalNotificationRequestV1(event: AutomationEventEnvelopeV1): InternalNotificationRequestV1 | null {
  if (event.eventType !== 'bridata.notification.requested') return null;
  if (!UUID_RE.test(event.eventId) || !UUID_RE.test(event.tenantId)) {
    throw new InternalNotificationValidationErrorV1('Notification event envelope contains an invalid UUID.');
  }

  const payload = record(event.payload);
  const targetUserId = requiredString(payload.targetUserId, 'targetUserId', 36);
  if (!UUID_RE.test(targetUserId)) {
    throw new InternalNotificationValidationErrorV1('targetUserId must be a UUID.');
  }

  const title = requiredString(payload.notificationTitle, 'notificationTitle', 500);
  const body = optionalString(payload.notificationBody, 'notificationBody', 8000);
  const rawPriority = typeof payload.priority === 'string' ? payload.priority.toUpperCase() : 'MEDIUM';
  if (!PRIORITIES.has(rawPriority as InternalNotificationPriorityV1)) {
    throw new InternalNotificationValidationErrorV1('priority must be LOW, MEDIUM, HIGH or CRITICAL.');
  }

  return {
    eventId: event.eventId,
    tenantId: event.tenantId,
    targetUserId,
    title,
    body,
    priority: rawPriority as InternalNotificationPriorityV1,
    requiresAction: payload.requiresAction === true,
    workspaceId: optionalUuid(payload.scopeWorkspaceId, 'scopeWorkspaceId'),
    projectId: optionalUuid(payload.scopeProjectId, 'scopeProjectId'),
  };
}
