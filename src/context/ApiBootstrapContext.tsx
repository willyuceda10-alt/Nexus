import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { bridataApi, BridataApiError, configureApiSession } from '../api/client';
import type { BootstrapResponse, SessionResponse } from '../api/contracts';
import { getBridataAccessToken } from '../auth/accessTokenProvider';
import { runtimeConfig, type DataMode, type WebAuthMode } from '../config/runtime';

export type ApiBootstrapStatus = 'mock' | 'loading' | 'ready' | 'error';

interface ApiBootstrapContextValue {
  dataMode: DataMode;
  authMode: WebAuthMode;
  status: ApiBootstrapStatus;
  session: SessionResponse | null;
  selectedTenantId: string | null;
  bootstrap: BootstrapResponse | null;
  error: string | null;
  correlationId: string | null;
  retry: () => Promise<void>;
  selectTenant: (tenantId: string) => Promise<void>;
}

const ApiBootstrapContext = createContext<ApiBootstrapContextValue | null>(null);
const TENANT_STORAGE_KEY = 'bridata.api.selected-tenant.v1';

function storedTenantId(): string | null {
  try {
    return localStorage.getItem(TENANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistTenantId(tenantId: string): void {
  try {
    localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  } catch {
    // Tenant preference is convenience only; authorization remains server-side.
  }
}

function chooseTenantId(session: SessionResponse, requestedTenantId?: string | null): string {
  const allowedTenantIds = new Set(session.tenants.map((tenant) => tenant.id));
  const candidates = [
    requestedTenantId ?? null,
    storedTenantId(),
    session.preferredTenantId,
    session.tenants[0]?.id ?? null,
  ];

  for (const candidate of candidates) {
    if (candidate && allowedTenantIds.has(candidate)) return candidate;
  }

  throw new Error('La identidad autenticada no tiene ningún tenant activo disponible en Bridata.');
}

function setAuthenticatedApiSession(tenantId: string | null): void {
  configureApiSession({
    getAccessToken: getBridataAccessToken,
    getTenantId: tenantId ? () => tenantId : null,
  });
}

export function ApiBootstrapProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ApiBootstrapStatus>(
    runtimeConfig.dataMode === 'api' ? 'loading' : 'mock',
  );
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  const fail = useCallback((cause: unknown) => {
    setBootstrap(null);
    setStatus('error');
    if (cause instanceof BridataApiError) {
      setError(cause.message);
      setCorrelationId(cause.correlationId ?? null);
    } else if (cause instanceof Error) {
      setError(cause.message);
      setCorrelationId(null);
    } else {
      setError('No se pudo conectar con Bridata Project API.');
      setCorrelationId(null);
    }
  }, []);

  const bootstrapForTenant = useCallback(async (
    sessionValue: SessionResponse,
    tenantId: string,
  ): Promise<void> => {
    if (!sessionValue.tenants.some((tenant) => tenant.id === tenantId)) {
      throw new Error('El tenant seleccionado no pertenece a la sesión autenticada.');
    }

    setAuthenticatedApiSession(tenantId);
    const result = await bridataApi.bootstrap();
    if (result.tenant.id !== tenantId) {
      throw new Error('La API devolvió un tenant distinto al seleccionado para la sesión.');
    }

    persistTenantId(tenantId);
    setSelectedTenantId(tenantId);
    setBootstrap(result);
    setStatus('ready');
  }, []);

  const load = useCallback(async (requestedTenantId?: string | null) => {
    if (runtimeConfig.dataMode !== 'api') {
      configureApiSession({ getAccessToken: null, getTenantId: null });
      setStatus('mock');
      setSession(null);
      setSelectedTenantId(null);
      setBootstrap(null);
      setError(null);
      setCorrelationId(null);
      return;
    }

    setStatus('loading');
    setBootstrap(null);
    setError(null);
    setCorrelationId(null);

    try {
      // Session discovery authenticates the user but intentionally carries no tenant
      // header. The server returns only active memberships that the identity can use.
      setAuthenticatedApiSession(null);
      const sessionValue = await bridataApi.session();
      setSession(sessionValue);
      const tenantId = chooseTenantId(sessionValue, requestedTenantId);
      await bootstrapForTenant(sessionValue, tenantId);
    } catch (cause) {
      fail(cause);
    }
  }, [bootstrapForTenant, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (runtimeConfig.dataMode !== 'api' || status !== 'ready' || !bootstrap) return;
    // NexusProvider also binds the tenant after bootstrap. Reassert both providers here
    // so the Entra access-token adapter can never be cleared by a tenant-only binding.
    setAuthenticatedApiSession(bootstrap.tenant.id);
  }, [status, bootstrap]);

  const retry = useCallback(async () => {
    await load(selectedTenantId);
  }, [load, selectedTenantId]);

  const selectTenant = useCallback(async (tenantId: string) => {
    if (runtimeConfig.dataMode !== 'api') return;
    if (!session) {
      await load(tenantId);
      return;
    }

    setStatus('loading');
    setError(null);
    setCorrelationId(null);
    try {
      await bootstrapForTenant(session, tenantId);
    } catch (cause) {
      fail(cause);
    }
  }, [bootstrapForTenant, fail, load, session]);

  const value = useMemo<ApiBootstrapContextValue>(
    () => ({
      dataMode: runtimeConfig.dataMode,
      authMode: runtimeConfig.authMode,
      status,
      session,
      selectedTenantId,
      bootstrap,
      error,
      correlationId,
      retry,
      selectTenant,
    }),
    [status, session, selectedTenantId, bootstrap, error, correlationId, retry, selectTenant],
  );

  return <ApiBootstrapContext.Provider value={value}>{children}</ApiBootstrapContext.Provider>;
}

export function useApiBootstrap(): ApiBootstrapContextValue {
  const context = useContext(ApiBootstrapContext);
  if (!context) {
    throw new Error('useApiBootstrap must be used within ApiBootstrapProvider');
  }
  return context;
}
