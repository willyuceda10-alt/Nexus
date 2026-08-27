export type ApiMeetingResourceTypeV1 = 'ROOM' | 'EQUIPMENT';

export interface ApiMeetingResourceV1 {
  id: string;
  workspaceId: string;
  resourceType: ApiMeetingResourceTypeV1;
  name: string;
  email: string;
  location: string | null;
  capacity: number | null;
  features: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiMeetingResourceAvailabilityParticipantV1 {
  key: string;
  kind: 'PERSON' | 'ROOM' | 'EQUIPMENT';
  id: string;
  fullName: string;
  email: string;
  isOrganizer: boolean;
  location: string | null;
  capacity: number | null;
  availabilityView: string;
  conflicts: Array<{ start: string; end: string; status: string }>;
  resolved: boolean;
}

export interface ApiMeetingResourceAvailabilityV1 {
  source: 'MICROSOFT_GRAPH';
  intervalMinutes: number;
  durationMinutes: number;
  range: { start: string; end: string };
  participants: ApiMeetingResourceAvailabilityParticipantV1[];
  suggestions: Array<{ start: string; end: string }>;
}

export interface CreateApiMeetingResourceV1Input {
  workspaceId: string;
  resourceType: ApiMeetingResourceTypeV1;
  name: string;
  email: string;
  location?: string | null;
  capacity?: number | null;
  features?: string[];
  isActive?: boolean;
}
