export type ApiInboxPriorityV1 = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ApiInboxStatusV1 = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export interface ApiInboxItemV1 {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  sourceType: string;
  sourceId: string | null;
  title: string;
  body: string | null;
  priority: ApiInboxPriorityV1;
  status: ApiInboxStatusV1;
  requiresAction: boolean;
  unread: boolean;
  snoozedUntil: string | null;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiInboxSummaryV1 {
  unread: number;
  requiresAction: number;
  snoozed: number;
}

export interface ApiInboxListV1 {
  items: ApiInboxItemV1[];
  summary: ApiInboxSummaryV1;
}

export interface ListApiInboxV1Params {
  status?: ApiInboxStatusV1;
  unread?: boolean;
  includeSnoozed?: boolean;
  limit?: number;
}
