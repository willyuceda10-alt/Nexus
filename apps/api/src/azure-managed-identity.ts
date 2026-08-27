import { config } from './config.js';

type ManagedIdentityTokenResponse = {
  access_token?: string;
  expires_on?: string | number;
  expires_in?: string | number;
};

function parseExpiryMs(payload: ManagedIdentityTokenResponse): number {
  const numeric = Number(payload.expires_on);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = typeof payload.expires_on === 'string' ? Date.parse(payload.expires_on) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  const expiresIn = Number(payload.expires_in);
  return Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 5 * 60 * 1000);
}

export class AzureManagedIdentityTokenProvider {
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;

  constructor(private readonly resource: string) {}

  async token(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && Date.now() + 120_000 < this.accessTokenExpiresAtMs) {
      return this.accessToken;
    }

    const endpoint = process.env.IDENTITY_ENDPOINT;
    const identityHeader = process.env.IDENTITY_HEADER;
    if (!endpoint || !identityHeader) {
      throw new Error('Container Apps managed identity endpoint is unavailable. IDENTITY_ENDPOINT and IDENTITY_HEADER are required.');
    }

    const tokenUrl = new URL(endpoint);
    tokenUrl.searchParams.set('resource', this.resource);
    tokenUrl.searchParams.set('api-version', '2019-08-01');
    if (config.AZURE_CLIENT_ID) tokenUrl.searchParams.set('client_id', config.AZURE_CLIENT_ID);

    const response = await fetch(tokenUrl, {
      method: 'GET',
      headers: { 'X-IDENTITY-HEADER': identityHeader },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Managed identity token request failed (${response.status} ${response.statusText}).`);
    }

    const payload = await response.json() as ManagedIdentityTokenResponse;
    if (!payload.access_token) throw new Error('Managed identity token response did not include access_token.');
    this.accessToken = payload.access_token;
    this.accessTokenExpiresAtMs = parseExpiryMs(payload);
    return payload.access_token;
  }

  reset(): void {
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
  }
}
