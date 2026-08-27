export type ApiWorkViewTypeV1 = 'TABLE' | 'KANBAN' | 'CALENDAR' | 'GANTT' | 'TIMELINE';
export type ApiWorkBoardColumnSourceV1 = 'CORE' | 'CUSTOM';
export type ApiWorkBoardColumnTypeV1 =
  | 'TEXT' | 'LONG_TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'BOOLEAN'
  | 'STATUS' | 'PRIORITY' | 'PROGRESS' | 'PERSON' | 'TAGS' | 'LINK' | 'FILE' | 'FORMULA' | 'RELATION';

export interface ApiWorkBoardSummaryV1 {
  id: string;
  workspaceId: string;
  objectDefinitionId: string;
  name: string;
  description: string | null;
  icon: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiWorkBoardGroupV1 {
  id: string;
  key: string;
  name: string;
  color: string | null;
  sort_order: number;
}

export interface ApiWorkBoardColumnV1 {
  id: string;
  key: string;
  label: string;
  source: ApiWorkBoardColumnSourceV1;
  data_type: ApiWorkBoardColumnTypeV1;
  field_key: string;
  width: number | null;
  sort_order: number;
  is_visible: boolean;
  is_editable: boolean;
  config: Record<string, unknown> | null;
}

export interface ApiWorkViewV1 {
  id: string;
  name: string;
  view_type: ApiWorkViewTypeV1;
  is_default: boolean;
  sort_order: number;
  config: Record<string, unknown>;
}

export interface ApiWorkBoardItemV1 {
  object: {
    id: string;
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
    createdAt: string;
    updatedAt: string;
    version: number;
    owner: { id: string; fullName: string; email: string; avatarUrl: string | null };
    assignee: { id: string; fullName: string; email: string; avatarUrl: string | null } | null;
  };
  customFields: Record<string, unknown>;
  placement: { groupId: string | null; sortOrder: number };
}

export interface ApiWorkBoardDetailV1 extends ApiWorkBoardSummaryV1 {
  groups: ApiWorkBoardGroupV1[];
  columns: ApiWorkBoardColumnV1[];
  views: ApiWorkViewV1[];
}

export interface ApiWorkBoardDataV1 {
  board: ApiWorkBoardSummaryV1;
  groups: ApiWorkBoardGroupV1[];
  columns: ApiWorkBoardColumnV1[];
  views: ApiWorkViewV1[];
  selectedView: ApiWorkViewV1 | null;
  items: ApiWorkBoardItemV1[];
}
