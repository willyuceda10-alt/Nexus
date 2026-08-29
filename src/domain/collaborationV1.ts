import type {
  ApiObjectAuditEntryV1,
  ApiObjectCollaborationV1,
  ApiObjectCommentV1,
  ApiObjectHistoryEntryV1,
} from '../api/collaborationV1Contracts';
import type { ActivityLog, Comment } from '../types/nexus';

function actorName(
  actor: { fullName: string; email: string } | null,
  fallback = 'Sistema',
): string {
  return actor?.fullName?.trim() || actor?.email?.trim() || fallback;
}

function toDisplayValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function changedFields(details: unknown): string[] {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
  const candidate = (details as { changedFields?: unknown }).changedFields;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter((value): value is string => typeof value === 'string');
}

function auditAction(entry: ApiObjectAuditEntryV1): string {
  switch (entry.action) {
    case 'OBJECT_CREATED':
      return 'Creó el objeto';
    case 'OBJECT_UPDATED': {
      const fields = changedFields(entry.details);
      return fields.length > 0
        ? `Actualizó: ${fields.join(', ')}`
        : 'Actualizó el objeto';
    }
    case 'OBJECT_COMMENT_CREATED':
      return 'Agregó un comentario';
    case 'OBJECT_SOFT_DELETED':
      return 'Eliminó el objeto';
    default:
      return entry.action
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/^./, (letter) => letter.toUpperCase());
  }
}

export function mapApiObjectCommentV1(comment: ApiObjectCommentV1): Comment {
  return {
    id: comment.id,
    objectId: comment.objectId,
    userId: comment.userId,
    userName: actorName(comment.author, 'Usuario'),
    userAvatar: comment.author?.avatarUrl ?? '',
    content: comment.content,
    createdAt: comment.createdAt,
  };
}

function mapHistoryEntry(entry: ApiObjectHistoryEntryV1): ActivityLog {
  const oldValue = toDisplayValue(entry.oldValue);
  const newValue = toDisplayValue(entry.newValue);
  return {
    id: `history:${entry.id}`,
    objectId: entry.objectId,
    userId: entry.userId ?? 'system',
    userName: actorName(entry.actor),
    ...(entry.actor?.avatarUrl ? { userAvatar: entry.actor.avatarUrl } : {}),
    action: `Cambió ${entry.fieldKey}`,
    ...(oldValue !== undefined ? { oldValue } : {}),
    ...(newValue !== undefined ? { newValue } : {}),
    timestamp: entry.createdAt,
  };
}

function mapAuditEntry(objectId: string, entry: ApiObjectAuditEntryV1): ActivityLog {
  return {
    id: `audit:${entry.id}`,
    objectId,
    userId: entry.userId ?? 'system',
    userName: actorName(entry.actor),
    ...(entry.actor?.avatarUrl ? { userAvatar: entry.actor.avatarUrl } : {}),
    action: auditAction(entry),
    timestamp: entry.createdAt,
  };
}

export function mapObjectCollaborationV1(payload: ApiObjectCollaborationV1): {
  comments: Comment[];
  activityLogs: ActivityLog[];
} {
  const activityLogs = [
    ...payload.history.map(mapHistoryEntry),
    ...payload.audit.map((entry) => mapAuditEntry(payload.objectId, entry)),
  ].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));

  return {
    comments: payload.comments.map(mapApiObjectCommentV1),
    activityLogs,
  };
}
