export type MeetingCalendarProjectionItemTypeV1 = 'MEETING' | 'RECURRING_OCCURRENCE';
export type MeetingLifecycleStatusProjectionV1 = 'SCHEDULED' | 'CANCEL_PENDING' | 'CANCELLED';
export type MeetingM365SyncStatusProjectionV1 = 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'FAILED';

export interface ApiMeetingCalendarProjectionItemV1 {
  id: string;
  itemType: MeetingCalendarProjectionItemTypeV1;
  meetingObjectId: string;
  seriesId: string | null;
  occurrenceId: string | null;
  sequence: number | null;
  title: string;
  startAt: string;
  endAt: string;
  lifecycleStatus: MeetingLifecycleStatusProjectionV1;
  syncStatus: MeetingM365SyncStatusProjectionV1;
  isException: boolean;
  joinUrl: string | null;
  webLink: string | null;
  location: string | null;
}

export interface ApiMeetingCalendarProjectionV1 {
  range: { startAt: string; endAt: string };
  items: ApiMeetingCalendarProjectionItemV1[];
}
