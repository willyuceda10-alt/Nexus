import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';
import {
  registerBridataEntraAccessTokenProvider,
} from './accessTokenProvider';
import { runtimeConfig } from '../config/runtime';

let msalInstance: PublicClientApplication | null = null;
let msalInitialization: Promise<void> | null = null;

function requireEntraConfiguration(): {
  clientId: string;
  scope: string;
} {
  if (!runtimeConfig.entraWebClientId || !runtimeConfig.entraApiScope) {
    throw new Error(
      'La configuración Microsoft Entra de Bridata está incompleta.',
    );
  }

  return {
    clientId: runtimeConfig.entraWebClientId,
    scope: runtimeConfig.entraApiScope,
  };
}

function getOrCreateMsal(): PublicClientApplication {
  if (msalInstance) {
    return msalInstance;
  }

  const { clientId } = requireEntraConfiguration();

  msalInstance = new PublicClientApplication({
    auth: {
      clientId,
      authority: runtimeConfig.entraAuthority,
      redirectUri: `${window.location.origin}/`,
      postLogoutRedirectUri: `${window.location.origin}/`,
    },
    cache: {
      cacheLocation: BrowserCacheLocation.SessionStorage,
    },
  });

  return msalInstance;
}

function resolveAccount(instance: PublicClientApplication): AccountInfo | null {
  const active = instance.getActiveAccount();

  if (active) {
    return active;
  }

  const accounts = instance.getAllAccounts();

  if (accounts.length === 1) {
    instance.setActiveAccount(accounts[0]);
    return accounts[0];
  }

  return null;
}

export function isBridataMsalConfigured(): boolean {
  return runtimeConfig.entraConfigured;
}

export function hasBridataMicrosoftAccount(): boolean {
  if (!msalInstance) {
    return false;
  }

  return resolveAccount(msalInstance) !== null;
}

export async function initializeBridataMsal(): Promise<void> {
  if (runtimeConfig.authMode !== 'entra') {
    return;
  }

  if (msalInitialization) {
    return msalInitialization;
  }

  msalInitialization = (async () => {
    const { scope } = requireEntraConfiguration();
    const instance = getOrCreateMsal();

    await instance.initialize();

    const redirectResult = await instance.handleRedirectPromise();

    if (redirectResult?.account) {
      instance.setActiveAccount(redirectResult.account);
    } else {
      resolveAccount(instance);
    }

    registerBridataEntraAccessTokenProvider(async () => {
      const account = resolveAccount(instance);

      if (!account) {
        return null;
      }

      try {
        const result = await instance.acquireTokenSilent({
          account,
          scopes: [scope],
        });

        return result.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          await instance.acquireTokenRedirect({
            account,
            scopes: [scope],
          });

          return null;
        }

        throw error;
      }
    });
  })();

  return msalInitialization;
}

export async function signInBridataWithMicrosoft(): Promise<void> {
  const { scope } = requireEntraConfiguration();

  await initializeBridataMsal();

  const instance = getOrCreateMsal();

  if (resolveAccount(instance)) {
    return;
  }

  await instance.loginRedirect({
    scopes: [scope],
    prompt: 'select_account',
  });
}

export async function signOutBridataMicrosoft(): Promise<void> {
  if (!msalInstance) {
    return;
  }

  const account = resolveAccount(msalInstance);

  registerBridataEntraAccessTokenProvider(null);

  await msalInstance.logoutRedirect({
    account: account ?? undefined,
  });
}
