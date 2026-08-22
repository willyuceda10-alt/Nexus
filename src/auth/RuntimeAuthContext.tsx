import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser';
import { bridataApi, configureApiSession } from '../api/client';
import type { SessionResponse } from '../api/contracts';
import { runtimeConfig, type AuthMode } from '../config/runtime';

const ACTIVE_TENANT_STORAGE_KEY = 'bridata.activeTenantId';

export type RuntimeAuthStatus =
  | 'initializing'
  | 'signed_out'
  | 'tenant_selection'
  | 'ready'
  | 'error';

interface RuntimeAuthContextValue {
  mode: AuthMode;
  status: RuntimeAuthStatus;
  session: SessionResponse | null;
  activeTenantId: string | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  selectTenant: (tenantId: string) => void;
  retry: () => Promise<void>;
}

const RuntimeAuthContext = createContext<RuntimeAuthContextValue | undefined>(undefined);

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return 'No se pudo inicializar la autenticación de Bridata Project.';
}

function rememberedTenantId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberTenantId(tenantId: string): void {
  try {
    window.localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, tenantId);
  } catch {
    // Persistence is optional; authentication itself does not depend on it.
  }
}

function clearRememberedTenant(): void {
  try {
    window.localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

export const RuntimeAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<RuntimeAuthStatus>('initializing');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeTenantRef = useRef<string | null>(null);
  const msalRef = useRef<PublicClientApplication | null>(null);
  const accountRef = useRef<AccountInfo | null>(null);

  const setTenant = useCallback((tenantId: string | null) => {
    activeTenantRef.current = tenantId;
    setActiveTenantId(tenantId);
  }, []);

  const acquireAccessToken = useCallback(async (): Promise<string | null> => {
    if (runtimeConfig.authMode !== 'entra') return null;

    const msal = msalRef.current;
    const account = accountRef.current;
    if (!msal || !account) return null;

    try {
      const result = await msal.acquireTokenSilent({
        account,
        scopes: [runtimeConfig.entra.apiScope],
      });
      return result.accessToken;
    } catch (cause) {
      if (cause instanceof InteractionRequiredAuthError) {
        throw new Error('Microsoft Entra requiere interacción para renovar el acceso. Inicia sesión nuevamente.');
      }
      throw cause;
    }
  }, []);

  const applySession = useCallback((nextSession: SessionResponse) => {
    setSession(nextSession);

    const remembered = rememberedTenantId();
    const rememberedIsAllowed =
      remembered !== null && nextSession.tenants.some((tenant) => tenant.id === remembered);
    const preferredIsAllowed =
      nextSession.preferredTenantId !== null &&
      nextSession.tenants.some((tenant) => tenant.id === nextSession.preferredTenantId);

    const nextTenantId = rememberedIsAllowed
      ? remembered
      : preferredIsAllowed
        ? nextSession.preferredTenantId
        : nextSession.tenants.length === 1
          ? nextSession.tenants[0]!.id
          : null;

    if (nextTenantId) {
      setTenant(nextTenantId);
      rememberTenantId(nextTenantId);
      setStatus('ready');
      return;
    }

    setTenant(null);
    if (nextSession.tenants.length === 0) {
      setError('Tu identidad está autenticada, pero todavía no tiene una empresa activa asignada en Bridata Project.');
      setStatus('error');
      return;
    }

    setStatus('tenant_selection');
  }, [setTenant]);

  const loadSession = useCallback(async () => {
    setError(null);
    const nextSession = await bridataApi.session();
    applySession(nextSession);
  }, [applySession]);

  const initialize = useCallback(async () => {
    setStatus('initializing');
    setError(null);
    setSession(null);
    setTenant(null);

    if (runtimeConfig.authMode === 'dev') {
      configureApiSession({
        getAccessToken: null,
        getTenantId: () => activeTenantRef.current,
      });

      if (runtimeConfig.dataMode === 'mock') {
        setStatus('ready');
        return;
      }

      try {
        await loadSession();
      } catch (cause) {
        setError(errorMessage(cause));
        setStatus('error');
      }
      return;
    }

    if (runtimeConfig.authConfigurationError) {
      setError(runtimeConfig.authConfigurationError);
      setStatus('error');
      return;
    }

    try {
      const msal = new PublicClientApplication({
        auth: {
          clientId: runtimeConfig.entra.webClientId,
          authority: `https://login.microsoftonline.com/${runtimeConfig.entra.tenantId}`,
          redirectUri: runtimeConfig.entra.redirectUri || window.location.origin,
          postLogoutRedirectUri: runtimeConfig.entra.redirectUri || window.location.origin,
        },
        cache: {
          cacheLocation: BrowserCacheLocation.SessionStorage,
        },
      });

      msalRef.current = msal;
      await msal.initialize();
      const redirectResult = await msal.handleRedirectPromise();
      const account =
        redirectResult?.account ??
        msal.getActiveAccount() ??
        msal.getAllAccounts()[0] ??
        null;

      if (!account) {
        accountRef.current = null;
        configureApiSession({ getAccessToken: null, getTenantId: null });
        setStatus('signed_out');
        return;
      }

      accountRef.current = account;
      msal.setActiveAccount(account);
      configureApiSession({
        getAccessToken: acquireAccessToken,
        getTenantId: () => activeTenantRef.current,
      });

      await loadSession();
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus('error');
    }
  }, [acquireAccessToken, loadSession, setTenant]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const signIn = useCallback(async () => {
    if (runtimeConfig.authMode !== 'entra') return;
    const msal = msalRef.current;
    if (!msal) {
      await initialize();
      return;
    }

    setError(null);
    await msal.loginRedirect({
      scopes: [runtimeConfig.entra.apiScope],
    });
  }, [initialize]);

  const signOut = useCallback(async () => {
    clearRememberedTenant();
    setTenant(null);
    setSession(null);
    configureApiSession({ getAccessToken: null, getTenantId: null });

    if (runtimeConfig.authMode !== 'entra') {
      setStatus('ready');
      return;
    }

    const msal = msalRef.current;
    const account = accountRef.current;
    accountRef.current = null;
    if (!msal) {
      setStatus('signed_out');
      return;
    }

    await msal.logoutRedirect({ account: account ?? undefined });
  }, [setTenant]);

  const selectTenant = useCallback((tenantId: string) => {
    if (!session?.tenants.some((tenant) => tenant.id === tenantId)) {
      setError('No tienes acceso a la empresa seleccionada.');
      return;
    }

    setError(null);
    setTenant(tenantId);
    rememberTenantId(tenantId);
    setStatus('ready');
  }, [session, setTenant]);

  const retry = useCallback(async () => {
    if (runtimeConfig.authMode === 'entra' && accountRef.current) {
      setStatus('initializing');
      setError(null);
      try {
        configureApiSession({
          getAccessToken: acquireAccessToken,
          getTenantId: () => activeTenantRef.current,
        });
        await loadSession();
      } catch (cause) {
        setError(errorMessage(cause));
        setStatus('error');
      }
      return;
    }

    await initialize();
  }, [acquireAccessToken, initialize, loadSession]);

  const value = useMemo<RuntimeAuthContextValue>(
    () => ({
      mode: runtimeConfig.authMode,
      status,
      session,
      activeTenantId,
      error,
      signIn,
      signOut,
      selectTenant,
      retry,
    }),
    [status, session, activeTenantId, error, signIn, signOut, selectTenant, retry],
  );

  return <RuntimeAuthContext.Provider value={value}>{children}</RuntimeAuthContext.Provider>;
};

export function useRuntimeAuth(): RuntimeAuthContextValue {
  const context = useContext(RuntimeAuthContext);
  if (!context) {
    throw new Error('useRuntimeAuth must be used within RuntimeAuthProvider');
  }
  return context;
}
