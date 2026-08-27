import { config } from './config.js';
import { AzureManagedIdentityTokenProvider } from './azure-managed-identity.js';

export class MicrosoftGraphCalendarConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicrosoftGraphCalendarConfigurationError';
  }
}

export class MicrosoftGraphCalendarError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MicrosoftGraphCalendarError';
    this.status = status;
  }
  get retryable(): boolean {
    return this.status === 408 || this.status === 409 || this.status === 429 || this.status >= 500;
  }
}

export interface GraphCalendarEventResultV1 {
  id: string;
  changeKey: string | null;
  joinUrl: string | null;
  webLink: string | null;
}

export interface GraphCalendarEventInputV1 {
  collaborationId: string;
  organizerGraphUser: string;
  subject: string;
  body: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  attendees: Array<{ email: string; displayName: string; type: 'required' | 'optional' | 'resource' }>;
  isOnline: boolean;
}

export class MicrosoftGraphCalendarClient {
  private readonly tokenProvider = new AzureManagedIdentityTokenProvider('https://graph.microsoft.com/');

  private async graphFetch(path: string, init: RequestInit, forceRefresh = false): Promise<Response> {
    if (!config.M365_CALENDAR_SYNC_ENABLED) {
      throw new MicrosoftGraphCalendarConfigurationError('Microsoft 365 calendar sync is disabled.');
    }
    const token = await this.tokenProvider.token(forceRefresh);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    if (response.status === 401 && !forceRefresh) {
      this.tokenProvider.reset();
      response = await this.graphFetch(path, init, true);
    }
    return response;
  }

  private eventBody(input: GraphCalendarEventInputV1): Record<string, unknown> {
    return {
      subject: input.subject,
      body: { contentType: 'text', content: input.body ?? input.subject },
      start: { dateTime: input.startAt.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
      end: { dateTime: input.endAt.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
      location: input.location ? { displayName: input.location } : undefined,
      attendees: input.attendees.map((attendee) => ({
        emailAddress: { address: attendee.email, name: attendee.displayName },
        type: attendee.type,
      })),
      isOnlineMeeting: input.isOnline,
      ...(input.isOnline ? { onlineMeetingProvider: 'teamsForBusiness' } : {}),
      transactionId: `bridata-meeting-${input.collaborationId}`,
    };
  }

  private async parseEvent(response: Response): Promise<GraphCalendarEventResultV1> {
    if (!response.ok) {
      const text = (await response.text()).slice(0, 5000);
      throw new MicrosoftGraphCalendarError(response.status, `Graph calendar request failed (${response.status}): ${text}`);
    }
    const payload = await response.json() as {
      id?: string;
      changeKey?: string | null;
      webLink?: string | null;
      onlineMeeting?: { joinUrl?: string | null } | null;
    };
    if (!payload.id) throw new MicrosoftGraphCalendarError(502, 'Graph calendar response did not include an event id.');
    return {
      id: payload.id,
      changeKey: payload.changeKey ?? null,
      joinUrl: payload.onlineMeeting?.joinUrl ?? null,
      webLink: payload.webLink ?? null,
    };
  }

  private async readEvent(organizerGraphUser: string, graphEventId: string): Promise<GraphCalendarEventResultV1> {
    const path = `/users/${encodeURIComponent(organizerGraphUser)}/events/${encodeURIComponent(graphEventId)}`
      + '?$select=id,changeKey,webLink,onlineMeeting';
    return this.parseEvent(await this.graphFetch(path, { method: 'GET' }));
  }

  async createEvent(input: GraphCalendarEventInputV1): Promise<GraphCalendarEventResultV1> {
    const response = await this.graphFetch(`/users/${encodeURIComponent(input.organizerGraphUser)}/events`, {
      method: 'POST',
      body: JSON.stringify(this.eventBody(input)),
    });
    const created = await this.parseEvent(response);
    if (input.isOnline && !created.joinUrl) {
      return this.readEvent(input.organizerGraphUser, created.id);
    }
    return created;
  }

  async updateEvent(graphEventId: string, input: GraphCalendarEventInputV1): Promise<GraphCalendarEventResultV1> {
    const path = `/users/${encodeURIComponent(input.organizerGraphUser)}/events/${encodeURIComponent(graphEventId)}`;
    const patchBody = { ...this.eventBody(input) };
    delete (patchBody as { transactionId?: unknown }).transactionId;
    const patch = await this.graphFetch(path, { method: 'PATCH', body: JSON.stringify(patchBody) });
    if (!patch.ok) {
      const text = (await patch.text()).slice(0, 5000);
      throw new MicrosoftGraphCalendarError(patch.status, `Graph calendar update failed (${patch.status}): ${text}`);
    }
    return this.readEvent(input.organizerGraphUser, graphEventId);
  }

  async cancelEvent(organizerGraphUser: string, graphEventId: string, comment: string | null): Promise<void> {
    const path = `/users/${encodeURIComponent(organizerGraphUser)}/events/${encodeURIComponent(graphEventId)}/cancel`;
    const response = await this.graphFetch(path, {
      method: 'POST',
      body: JSON.stringify({ comment: comment ?? 'Reunión cancelada desde Bridata.' }),
    });
    if (response.status === 404) return;
    if (response.status !== 202) {
      const text = (await response.text()).slice(0, 5000);
      throw new MicrosoftGraphCalendarError(response.status, `Graph calendar cancellation failed (${response.status}): ${text}`);
    }
  }

  close(): void {
    this.tokenProvider.reset();
  }
}
