import { config } from './config.js';
import { AzureManagedIdentityTokenProvider } from './azure-managed-identity.js';

export class MicrosoftGraphDeliveryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicrosoftGraphDeliveryConfigurationError';
  }
}

export class MicrosoftGraphDeliveryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MicrosoftGraphDeliveryError';
    this.status = status;
  }

  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export class MicrosoftGraphNotificationClient {
  private readonly tokenProvider = new AzureManagedIdentityTokenProvider('https://graph.microsoft.com/');

  private async graphFetch(path: string, init: RequestInit, forceRefresh = false): Promise<Response> {
    if (!config.M365_GRAPH_DELIVERY_ENABLED) {
      throw new MicrosoftGraphDeliveryConfigurationError('Microsoft 365 Graph delivery is disabled.');
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

  async sendOutlookEmail(input: {
    recipientEmail: string;
    subject: string;
    body: string | null;
  }): Promise<void> {
    if (!config.M365_OUTLOOK_SENDER_USER) {
      throw new MicrosoftGraphDeliveryConfigurationError('M365_OUTLOOK_SENDER_USER is required for Outlook delivery.');
    }
    const response = await this.graphFetch(
      `/users/${encodeURIComponent(config.M365_OUTLOOK_SENDER_USER)}/sendMail`,
      {
        method: 'POST',
        body: JSON.stringify({
          message: {
            subject: input.subject,
            body: {
              contentType: 'Text',
              content: input.body ?? input.subject,
            },
            toRecipients: [
              {
                emailAddress: {
                  address: input.recipientEmail,
                },
              },
            ],
          },
        }),
      },
    );
    if (response.status !== 202) {
      const body = (await response.text()).slice(0, 4000);
      throw new MicrosoftGraphDeliveryError(response.status, `Graph sendMail failed (${response.status}): ${body}`);
    }
  }

  async sendTeamsActivity(input: {
    targetEntraUserId: string;
    title: string;
    body: string | null;
  }): Promise<void> {
    if (!config.M365_TEAMS_ACTIVITY_TYPE || !config.M365_TEAMS_TOPIC_WEB_URL) {
      throw new MicrosoftGraphDeliveryConfigurationError(
        'M365_TEAMS_ACTIVITY_TYPE and M365_TEAMS_TOPIC_WEB_URL are required for Teams activity delivery.',
      );
    }
    const response = await this.graphFetch(
      `/users/${encodeURIComponent(input.targetEntraUserId)}/teamwork/sendActivityNotification`,
      {
        method: 'POST',
        body: JSON.stringify({
          topic: {
            source: 'text',
            value: config.M365_TEAMS_TOPIC_VALUE,
            webUrl: config.M365_TEAMS_TOPIC_WEB_URL,
          },
          activityType: config.M365_TEAMS_ACTIVITY_TYPE,
          previewText: {
            content: (input.body || input.title).slice(0, 150),
          },
        }),
      },
    );
    if (response.status !== 204) {
      const body = (await response.text()).slice(0, 4000);
      throw new MicrosoftGraphDeliveryError(response.status, `Graph Teams activity failed (${response.status}): ${body}`);
    }
  }

  close(): void {
    this.tokenProvider.reset();
  }
}
