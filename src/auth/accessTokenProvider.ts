import { runtimeConfig } from '../config/runtime';

export type BridataAccessTokenProvider = () => Promise<string | null>;

let entraAccessTokenProvider: BridataAccessTokenProvider | null = null;

/**
 * Registers the browser-side Entra token acquisition adapter.
 *
 * H4 intentionally does not manufacture or persist access tokens. A production
 * host (for example an MSAL bootstrap) must register a provider that returns a
 * delegated token for the Bridata API scope.
 */
export function registerBridataEntraAccessTokenProvider(
  provider: BridataAccessTokenProvider | null,
): void {
  entraAccessTokenProvider = provider;
}

export function hasBridataEntraAccessTokenProvider(): boolean {
  return entraAccessTokenProvider !== null;
}

export async function getBridataAccessToken(): Promise<string | null> {
  if (runtimeConfig.authMode === 'dev') return null;

  if (!entraAccessTokenProvider) {
    throw new Error(
      'Bridata está configurado con autenticación Entra, pero no existe un proveedor de access token registrado. Conecta MSAL/SSO antes de habilitar VITE_AUTH_MODE=entra.',
    );
  }

  const token = await entraAccessTokenProvider();
  if (!token?.trim()) {
    throw new Error('El proveedor Entra no devolvió un access token válido para Bridata API.');
  }
  return token.trim();
}
