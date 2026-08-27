export type ApiMeetingSyncStatusV1 = 'LOCAL_ONLY' | 'PENDING' | 'SYNCED' | 'FAILED';

export interface ApiMeetingWorkspacePersonV1 {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  workspaceRole: string;
  isCurrentUser: boolean;
}

export interface ApiMeetingAvailabilityConflictV1 {
  status: string;
  start: string;
  end: string;
}

export interface ApiMeetingAvailabilityParticipantV1 {
  userId: string;
  fullName: string;
  email: string;
  isOrganizer: boolean;
  availabilityView: string;
  conflicts: ApiMeetingAvailabilityConflictV1[];
  resolved: boolean;
}

export interface ApiMeetingAvailabilitySuggestionV1 {
  start: string;
  end: string;
}

export interface ApiMeetingAvailabilityV1 {
  source: 'MICROSOFT_GRAPH';
  intervalMinutes: number;
  durationMinutes: number;
  range: { start: string; end: string };
  participants: ApiMeetingAvailabilityParticipantV1[];
  suggestions: ApiMeetingAvailabilitySuggestionV1[];
}

export interface ApiMeetingAttendeeV1 {
  userId: string | null;
  email: string;
  displayName: string;
  attendeeType: 'REQUIRED' | 'OPTIONAL';
}

export interface ApiMeetingV1 {
  id: string;
  meetingObjectId: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: string;
  version: number;
  organizer: { id: string; name: string };
  startAt: string;
  endAt: string;
  timezone: string;
  location: string | null;
  isOnline: boolean;
  onlineProvider: string;
  syncStatus: ApiMeetingSyncStatusV1;
  graphEventId: string | null;
  joinUrl: string | null;
  webLink: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  attendees: ApiMeetingAttendeeV1[];
}

export interface ApiMeetingCapabilitiesV1 {
  m365CalendarSyncEnabled: boolean;
  meetingCalendarWorkerAvailable: boolean;
  m365AvailabilityEnabled: boolean;
  teamsOnlineMeetingSupported: boolean;
  canonicalStore: 'BRIDATA';
}

export interface CreateApiMeetingV1Input {
  workspaceId: string;
  projectId?: string | null;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  timezone?: string;
  location?: string | null;
  isOnline?: boolean;
  attendeeUserIds?: string[];
  externalAttendees?: Array<{ email: string; displayName: string; attendeeType?: 'REQUIRED' | 'OPTIONAL' }>;
  requestM365Sync?: boolean;
}

export interface UpdateApiMeetingV1Input extends Omit<CreateApiMeetingV1Input, 'workspaceId'> {
  version: number;
}
