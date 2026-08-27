import { config } from './config.js';
import { AzureManagedIdentityTokenProvider } from './azure-managed-identity.js';

export class MicrosoftGraphAvailabilityConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicrosoftGraphAvailabilityConfigurationError';
  }
}

export class MicrosoftGraphAvailabilityError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MicrosoftGraphAvailabilityError';
    this.status = status;
  }

  get retryable(): boolean {
    return this.status === 408 || this.status === 409 || this.status === 429 || this.status >= 500;
  }
}

export interface GraphScheduleInformationV1 {
  scheduleId: string;
  availabilityView: string;
  conflicts: Array<{
    status: string;
    start: string;
    end: string;
  }>;
}

export interface GraphGetScheduleInputV1 {
  organizerGraphUser: string;
  schedules: string[];
  startAt: Date;
  endAt: Date;
  intervalMinutes: number;
}

function utcGraphDate(value: Date): string {
  return value.toISOString().replace(/Z$/, '');
}

export class MicrosoftGraphAvailabilityClient {
  private readonly tokenProvider = new AzureManagedIdentityTokenProvider('https://graph.microsoft.com/');

  private async graphFetch(path: string, init: RequestInit, forceRefresh = false): Promise<Response> {
    if (!config.M365_AVAILABILITY_ENABLED) {
      throw new MicrosoftGraphAvailabilityConfigurationError('Microsoft 365 availability lookup is disabled.');
    }

    const token = await this.tokenProvider.token(forceRefresh);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');
    headers.set('Prefer', 'outlook.timezone="UTC"');

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

  async getSchedule(input: GraphGetScheduleInputV1): Promise<GraphScheduleInformationV1[]> {
    const schedules = [...new Set(input.schedules.map((value) => value.trim().toLowerCase()).filter(Boolean))];
    if (!schedules.length) return [];

    const response = await this.graphFetch(
      `/users/${encodeURIComponent(input.organizerGraphUser)}/calendar/getSchedule`,
      {
        method: 'POST',
        body: JSON.stringify({
          schedules,
          startTime: { dateTime: utcGraphDate(input.startAt), timeZone: 'UTC' },
          endTime: { dateTime: utcGraphDate(input.endAt), timeZone: 'UTC' },
          availabilityViewInterval: input.intervalMinutes,
        }),
      },
    );

    if (!response.ok) {
      const text = (await response.text()).slice(0, 5000);
      throw new MicrosoftGraphAvailabilityError(
        response.status,
        `Graph getSchedule failed (${response.status}): ${text}`,
      );
    }

    const payload = await response.json() as {
      value?: Array<{
        scheduleId?: string;
        availabilityView?: string;
        scheduleItems?: Array<{
          status?: string;
          start?: { dateTime?: string; timeZone?: string };
          end?: { dateTime?: string; timeZone?: string };
        }>;
      }>;
    };

    return (payload.value ?? []).flatMap((item) => {
      if (!item.scheduleId || typeof item.availabilityView !== 'string') return [];
      return [{
        scheduleId: item.scheduleId.toLowerCase(),
        availabilityView: item.availabilityView,
        conflicts: (item.scheduleItems ?? []).flatMap((conflict) => {
          const start = conflict.start?.dateTime;
          const end = conflict.end?.dateTime;
          if (!start || !end) return [];
          return [{
            status: conflict.status ?? 'unknown',
            start: start.endsWith('Z') ? start : `${start}Z`,
            end: end.endsWith('Z') ? end : `${end}Z`,
          }];
        }),
      }];
    });
  }

  close(): void {
    this.tokenProvider.reset();
  }
}
