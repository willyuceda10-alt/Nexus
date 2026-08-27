import type { ApiWorkViewTypeV1 } from './workOsBoardV1Contracts';

export interface ApiBoardTemporalConfigV1 {
  startFieldKey: string;
  endFieldKey?: string | null;
  titleFieldKey?: string;
  colorFieldKey?: string | null;
  allDay?: boolean;
}

export interface ApiBoardTemporalItemV1 {
  objectId: string;
  objectTypeKey: string;
  title: string;
  displayTitle: string;
  colorValue: string | null;
  status: string;
  priority: string;
  progress: number;
  start: string;
  end: string;
  groupId: string | null;
  sortOrder: number;
  assignee: { id: string; fullName: string; avatarUrl: string | null } | null;
}

export interface ApiBoardTemporalDataV1 {
  viewId: string;
  viewType: Extract<ApiWorkViewTypeV1, 'CALENDAR' | 'TIMELINE'>;
  temporal: ApiBoardTemporalConfigV1;
  items: ApiBoardTemporalItemV1[];
}
