export type RecurrencePatternTypeV1 = 'DAILY' | 'WEEKLY' | 'ABSOLUTE_MONTHLY';
export type RecurrenceRangeTypeV1 = 'NUMBERED' | 'END_DATE';
export type RecurrenceDayV1 = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
export type RecurringLifecycleStatusV1 = 'SCHEDULED' | 'CANCEL_PENDING' | 'CANCELLED';
export type RecurringSyncStatusV1 = 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'FAILED';

export interface ApiRecurringMeetingOccurrenceV1 {
  id: string;
  sequence: number;
  occurrenceDate: string;
  originalStartAt: string;
  startAt: string;
  endAt: string;
  version: number;
  lifecycleStatus: RecurringLifecycleStatusV1;
  isException: boolean;
  graphEventId: string | null;
  cancellationComment: string | null;
}

export interface ApiRecurringMeetingSeriesV1 {
  id: string;
  masterMeetingObjectId: string;
  collaborationId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  version: number;
  lifecycleStatus: RecurringLifecycleStatusV1;
  syncStatus: RecurringSyncStatusV1;
  graphSeriesMasterId: string | null;
  recurrence: {
    patternType: RecurrencePatternTypeV1;
    interval: number;
    daysOfWeek: RecurrenceDayV1[];
    dayOfMonth: number | null;
    rangeType: RecurrenceRangeTypeV1;
    startDate: string;
    endDate: string | null;
    numberOfOccurrences: number | null;
    timezone: 'America/Lima';
  };
  resources: Array<{ id: string; name: string; resourceType: 'ROOM' | 'EQUIPMENT'; capacity: number | null }>;
  occurrences: ApiRecurringMeetingOccurrenceV1[];
}

export interface CreateRecurringMeetingV1Input {
  workspaceId: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  location?: string | null;
  isOnline?: boolean;
  attendeeUserIds?: string[];
  externalAttendees?: Array<{ email: string; displayName: string; attendeeType?: 'REQUIRED' | 'OPTIONAL' }>;
  resourceIds?: string[];
  requestM365Sync?: boolean;
  recurrence: {
    patternType: RecurrencePatternTypeV1;
    interval: number;
    daysOfWeek?: RecurrenceDayV1[];
    dayOfMonth?: number | null;
    rangeType: RecurrenceRangeTypeV1;
    numberOfOccurrences?: number | null;
    endDate?: string | null;
    timezone: 'America/Lima';
  };
}
