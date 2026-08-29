export interface ApiCollaborationUserV1 {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

export interface ApiObjectCommentV1 {
  id: string;
  objectId: string;
  userId: string;
  content: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  author: ApiCollaborationUserV1 | null;
}

export interface ApiObjectHistoryEntryV1 {
  id: string;
  objectId: string;
  userId: string | null;
  fieldKey: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  actor: ApiCollaborationUserV1 | null;
}

export interface ApiObjectAuditEntryV1 {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: unknown;
  correlationId: string | null;
  createdAt: string;
  actor: ApiCollaborationUserV1 | null;
}

export interface ApiObjectCollaborationV1 {
  objectId: string;
  comments: ApiObjectCommentV1[];
  history: ApiObjectHistoryEntryV1[];
  audit: ApiObjectAuditEntryV1[];
}

export interface ListObjectCollaborationV1Params {
  commentLimit?: number;
  auditLimit?: number;
  historyLimit?: number;
}

export interface CreateObjectCommentV1Input {
  content: string;
}
