import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import {
  bridataApi,
  BridataApiError,
  configureApiSession,
} from '../api/client';
import type {
  BootstrapResponse,
  SessionResponse,
} from '../api/contracts';
import {
  runtimeConfig,
  type DataMode,
} from '../config/runtime';
import {
  getEntraAccessToken,
} from '../auth/entraPkce';

export type ApiBootstrapStatus =
  | 'mock'
  | 'loading'
  | 'ready'
  | 'error';

interface ApiBootstrapContextValue {
  dataMode: DataMode;
  status: ApiBootstrapStatus;
  bootstrap: BootstrapResponse | null;
  session: SessionResponse | null;
  activeTenantId: string | null;
  error: string | null;
  correlationId: string | null;
  retry: () => Promise<void>;
  selectTenant: (tenantId: string) => Promise<void>;
}

const ACTIVE_TENANT_KEY = 'bridata.active-tenant-id.v1';

const ApiBootstrapContext =
  createContext<ApiBootstrapContextValue | null>(null);

function chooseTenant(
  session: SessionResponse,
  storedTenantId: string | null,
): string | null {
  const authorizedTenantIds =
    new Set(session.tenants.map((tenant) => tenant.id));

  if (
    storedTenantId &&
    authorizedTenantIds.has(storedTenantId)
  ) {
    return storedTenantId;
  }

  if (
    session.preferredTenantId &&
    authorizedTenantIds.has(session.preferredTenantId)
  ) {
    return session.preferredTenantId;
  }

  return session.tenants[0]?.id ?? null;
}

export function ApiBootstrapProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [status, setStatus] =
    useState<ApiBootstrapStatus>(
      runtimeConfig.dataMode === 'api'
        ? 'loading'
        : 'mock',
    );
  const [bootstrap, setBootstrap] =
    useState<BootstrapResponse | null>(null);
  const [session, setSession] =
    useState<SessionResponse | null>(null);
  const [activeTenantId, setActiveTenantId] =
    useState<string | null>(null);
  const [error, setError] =
    useState<string | null>(null);
  const [correlationId, setCorrelationId] =
    useState<string | null>(null);

  const tenantRef = useRef<string | null>(null);

  const configureSessionProviders =
    useCallback(() => {
      configureApiSession({
        getAccessToken:
          runtimeConfig.authMode === 'entra'
            ? getEntraAccessToken
            : null,
        getTenantId: () => tenantRef.current,
      });
    }, []);

  const bootstrapTenant =
    useCallback(
      async (tenantId: string) => {
        tenantRef.current = tenantId;
        setActiveTenantId(tenantId);
        localStorage.setItem(
          ACTIVE_TENANT_KEY,
          tenantId,
        );

        const result =
          await bridataApi.bootstrap();
        setBootstrap(result);
        setStatus('ready');
      },
      [],
    );

  const load =
    useCallback(async () => {
      if (
        runtimeConfig.dataMode !== 'api'
      ) {
        configureApiSession({
          getAccessToken: null,
          getTenantId: null,
        });
        tenantRef.current = null;
        setStatus('mock');
        setBootstrap(null);
        setSession(null);
        setActiveTenantId(null);
        setError(null);
        setCorrelationId(null);
        return;
      }

      setStatus('loading');
      setError(null);
      setCorrelationId(null);
      setBootstrap(null);

      try {
        configureSessionProviders();

        if (
          runtimeConfig.authMode === 'entra'
        ) {
          tenantRef.current = null;

          const sessionResult =
            await bridataApi.session();
          setSession(sessionResult);

          const tenantId =
            chooseTenant(
              sessionResult,
              localStorage.getItem(
                ACTIVE_TENANT_KEY,
              ),
            );

          if (!tenantId) {
            throw new Error(
              'La identidad autenticada no tiene ningún tenant activo en Bridata Project.',
            );
          }

          await bootstrapTenant(tenantId);
          return;
        }

        setSession(null);
        tenantRef.current = null;
        setActiveTenantId(null);

        const result =
          await bridataApi.bootstrap();
        setBootstrap(result);
        setStatus('ready');
      } catch (cause) {
        setBootstrap(null);
        setStatus('error');

        if (
          cause instanceof BridataApiError
        ) {
          setError(cause.message);
          setCorrelationId(
            cause.correlationId ?? null,
          );
        } else if (
          cause instanceof Error
        ) {
          setError(cause.message);
        } else {
          setError(
            'No se pudo conectar con Bridata Project API.',
          );
        }
      }
    }, [
      bootstrapTenant,
      configureSessionProviders,
    ]);

  const selectTenant =
    useCallback(
      async (tenantId: string) => {
        if (
          !session?.tenants.some(
            (tenant) => tenant.id === tenantId,
          )
        ) {
          throw new Error(
            'El tenant seleccionado no pertenece a la sesión autenticada.',
          );
        }

        setStatus('loading');
        setError(null);
        setCorrelationId(null);

        try {
          await bootstrapTenant(tenantId);
        } catch (cause) {
          setBootstrap(null);
          setStatus('error');

          if (
            cause instanceof BridataApiError
          ) {
            setError(cause.message);
            setCorrelationId(
              cause.correlationId ?? null,
            );
          } else if (
            cause instanceof Error
          ) {
            setError(cause.message);
          }
        }
      },
      [
        bootstrapTenant,
        session,
      ],
    );

  useEffect(() => {
    void load();
  }, [load]);

  const value =
    useMemo<ApiBootstrapContextValue>(
      () => ({
        dataMode: runtimeConfig.dataMode,
        status,
        bootstrap,
        session,
        activeTenantId,
        error,
        correlationId,
        retry: load,
        selectTenant,
      }),
      [
        status,
        bootstrap,
        session,
        activeTenantId,
        error,
        correlationId,
        load,
        selectTenant,
      ],
    );

  return (
    <ApiBootstrapContext.Provider
      value={value}
    >
      {children}
    </ApiBootstrapContext.Provider>
  );
}

export function useApiBootstrap():
ApiBootstrapContextValue {
  const context =
    useContext(ApiBootstrapContext);

  if (!context) {
    throw new Error(
      'useApiBootstrap must be used within ApiBootstrapProvider',
    );
  }

  return context;
}
