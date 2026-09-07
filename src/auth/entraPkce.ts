import { runtimeConfig } from '../config/runtime';

const TOKEN_KEY = 'bridata.entra.access-token.v1';
const TOKEN_EXPIRY_KEY = 'bridata.entra.access-token-expiry.v1';
const PKCE_VERIFIER_KEY = 'bridata.entra.pkce-verifier.v1';
const OAUTH_STATE_KEY = 'bridata.entra.oauth-state.v1';
const RETURN_URL_KEY = 'bridata.entra.return-url.v1';

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function requireEntraConfig() {
  const { entraTenantId, entraWebClientId, entraApiScope } = runtimeConfig;
  if (!entraTenantId || !entraWebClientId || !entraApiScope) {
    throw new Error(
      'Bridata Web Entra configuration is incomplete. Set VITE_ENTRA_TENANT_ID, VITE_ENTRA_WEB_CLIENT_ID and VITE_ENTRA_API_SCOPE.',
    );
  }
  return { entraTenantId, entraWebClientId, entraApiScope };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomValue(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

// Dedicated blank page (public/auth-silent.html) so a silent renewal does not boot a
// second copy of the SPA inside the hidden iframe. Must also be registered as a SPA
// redirect URI on the Entra app registration.
function silentRedirectUri(): string {
  return `${window.location.origin}/auth-silent.html`;
}

/**
 * Thrown when a token cannot be obtained without showing UI to the person — their
 * Entra SSO session is gone, or Entra wants MFA/consent.
 *
 * This exists so an expired token surfaces as a catchable error instead of the caller
 * hanging forever, and so the redirect to Entra happens from an explicit user action
 * rather than from inside a background data fetch (which would discard unsaved work).
 */
export class AuthInteractionRequiredError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super('Tu sesión de Microsoft expiró. Vuelve a iniciar sesión para continuar.');
    this.name = 'AuthInteractionRequiredError';
    this.reason = reason;
  }
}

const SILENT_TIMEOUT_MS = 12_000;

async function exchangeCodeForToken(code: string, verifier: string, usedRedirectUri: string): Promise<void> {
  const { entraTenantId, entraWebClientId, entraApiScope } = requireEntraConfig();
  const body = new URLSearchParams({
    client_id: entraWebClientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: usedRedirectUri,
    code_verifier: verifier,
    scope: `openid profile ${entraApiScope}`,
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || 'Microsoft Entra did not return an access token.',
    );
  }

  storeToken(payload.access_token, payload.expires_in ?? 3600);
}

/**
 * Renews the access token without any user interaction, using the Entra SSO cookie via
 * a hidden iframe with prompt=none. This is how a public SPA with no refresh token stays
 * signed in for the life of the SSO session.
 */
async function acquireTokenSilently(): Promise<string> {
  const { entraTenantId, entraWebClientId, entraApiScope } = requireEntraConfig();
  const verifier = randomValue(64);
  const state = randomValue(32);
  const challenge = await codeChallenge(verifier);
  const uri = silentRedirectUri();

  const authorize = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/oauth2/v2.0/authorize`,
  );
  authorize.searchParams.set('client_id', entraWebClientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', uri);
  authorize.searchParams.set('response_mode', 'fragment');
  authorize.searchParams.set('scope', `openid profile ${entraApiScope}`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('prompt', 'none');

  const params = await new Promise<URLSearchParams>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.display = 'none';

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      iframe.remove();
      fn();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; hash?: string } | null;
      if (!data || data.type !== 'bridata:entra-silent-result') return;
      finish(() => resolve(new URLSearchParams((data.hash ?? '').replace(/^#/, ''))));
    };

    const timer = setTimeout(
      () => finish(() => reject(new AuthInteractionRequiredError('silent_renewal_timeout'))),
      SILENT_TIMEOUT_MS,
    );

    window.addEventListener('message', onMessage);
    iframe.src = authorize.toString();
    document.body.appendChild(iframe);
  });

  const error = params.get('error');
  if (error) {
    // login_required / interaction_required / consent_required all mean the same thing
    // to us: we cannot proceed without showing the person something.
    throw new AuthInteractionRequiredError(error);
  }

  const code = params.get('code');
  if (!code || params.get('state') !== state) {
    throw new AuthInteractionRequiredError('silent_renewal_invalid_response');
  }

  await exchangeCodeForToken(code, verifier, uri);

  const token = cachedToken();
  if (!token) throw new AuthInteractionRequiredError('silent_renewal_token_not_stored');
  return token;
}

function clearTransientAuthState(): void {
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
}

function cleanOAuthQuery(): void {
  const url = new URL(window.location.href);
  for (const key of ['code', 'state', 'session_state', 'error', 'error_description']) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function storeToken(accessToken: string, expiresInSeconds: number): void {
  sessionStorage.setItem(TOKEN_KEY, accessToken);
  const expiresAt = Date.now() + Math.max(60, expiresInSeconds) * 1000;
  sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
}

function cachedToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(sessionStorage.getItem(TOKEN_EXPIRY_KEY) || '0');
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    return null;
  }
  return token;
}

export async function handleEntraRedirectCallback(): Promise<void> {
  if (runtimeConfig.authMode !== 'entra') return;

  const url = new URL(window.location.href);
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const description = url.searchParams.get('error_description') || oauthError;
    clearTransientAuthState();
    cleanOAuthQuery();
    throw new Error(`Microsoft Entra authentication failed: ${description}`);
  }

  const code = url.searchParams.get('code');
  if (!code) return;

  const returnedState = url.searchParams.get('state');
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);

  if (!returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    clearTransientAuthState();
    cleanOAuthQuery();
    throw new Error('Microsoft Entra callback state validation failed.');
  }

  try {
    await exchangeCodeForToken(code, verifier, redirectUri());
  } finally {
    // Always clear the one-time verifier/state and strip the code from the URL, so a
    // failed exchange cannot be retried from history with a burned authorization code.
    clearTransientAuthState();
    cleanOAuthQuery();
  }

  const returnUrl = sessionStorage.getItem(RETURN_URL_KEY);
  sessionStorage.removeItem(RETURN_URL_KEY);
  if (returnUrl && returnUrl !== window.location.href) {
    window.history.replaceState({}, document.title, returnUrl);
  }
}

export async function beginEntraLogin(): Promise<never> {
  const { entraTenantId, entraWebClientId, entraApiScope } = requireEntraConfig();
  const verifier = randomValue(64);
  const state = randomValue(32);
  const challenge = await codeChallenge(verifier);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(
    RETURN_URL_KEY,
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );

  const authorize = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/oauth2/v2.0/authorize`,
  );
  authorize.searchParams.set('client_id', entraWebClientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', redirectUri());
  authorize.searchParams.set('response_mode', 'query');
  authorize.searchParams.set('scope', `openid profile ${entraApiScope}`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');

  window.location.assign(authorize.toString());
  return new Promise<never>(() => undefined);
}

// Collapses N parallel requests hitting an expired token into one renewal.
let inFlightRenewal: Promise<string> | null = null;

export async function getEntraAccessToken(): Promise<string | null> {
  if (runtimeConfig.authMode !== 'entra') return null;
  await handleEntraRedirectCallback();

  const token = cachedToken();
  if (token) return token;

  // Never redirect from here: this runs inside data fetches, and navigating away would
  // destroy unsaved work. Renew silently, or throw so the caller can surface a re-login.
  if (!inFlightRenewal) {
    inFlightRenewal = acquireTokenSilently().finally(() => {
      inFlightRenewal = null;
    });
  }
  return inFlightRenewal;
}

export function clearEntraSession(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  sessionStorage.removeItem(RETURN_URL_KEY);
  inFlightRenewal = null;
  clearTransientAuthState();
}

export function signOutFromEntra(): void {
  if (runtimeConfig.authMode !== 'entra') return;
  const { entraTenantId } = requireEntraConfig();
  clearEntraSession();
  const logout = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(entraTenantId)}/oauth2/v2.0/logout`,
  );
  logout.searchParams.set('post_logout_redirect_uri', redirectUri());
  window.location.assign(logout.toString());
}
