export type ApiMeetingLifecycleStatusV2 = 'SCHEDULED' | 'CANCEL_PENDING' | 'CANCELLED';

export interface ApiMeetingLifecycleItemV2 {
  meetingObjectId: string;
  lifecycleStatus: ApiMeetingLifecycleStatusV2;
  cancelledAt: string | null;
  cancellationComment: string | null;
}

export interface RescheduleMeetingV2Input {
  version: number;
  startAt: string;
  endAt: string;
  timezone?: string;
  location?: string | null;
  requestM365Sync?: boolean;
}

export interface CancelMeetingV2Input {
  version: number;
  comment?: string | null;
}
