import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { bridataApi, BridataApiError } from '../api/client';
import type { BootstrapResponse } from '../api/contracts';
import { runtimeConfig, type DataMode } from '../config/runtime';

export type ApiBootstrapStatus = 'mock' | 'loading' | 'ready' | 'error';

interface ApiBootstrapContextValue {
  dataMode: DataMode;
  status: ApiBootstrapStatus;
  bootstrap: BootstrapResponse | null;
  error: string | null;
  correlationId: string | null;
  retry: () => Promise<void>;
}

const ApiBootstrapContext = createContext<ApiBootstrapContextValue | null>(null);

export function ApiBootstrapProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ApiBootstrapStatus>(
    runtimeConfig.dataMode === 'api' ? 'loading' : 'mock',
  );
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (runtimeConfig.dataMode !== 'api') {
      setStatus('mock');
      setBootstrap(null);
      setError(null);
      setCorrelationId(null);
      return;
    }

    setStatus('loading');
    setError(null);
    setCorrelationId(null);

    try {
      const result = await bridataApi.bootstrap();
      setBootstrap(result);
      setStatus('ready');
    } catch (cause) {
      setBootstrap(null);
      setStatus('error');
      if (cause instanceof BridataApiError) {
        setError(cause.message);
        setCorrelationId(cause.correlationId ?? null);
      } else if (cause instanceof Error) {
        setError(cause.message);
      } else {
        setError('No se pudo conectar con Bridata Project API.');
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<ApiBootstrapContextValue>(
    () => ({
      dataMode: runtimeConfig.dataMode,
      status,
      bootstrap,
      error,
      correlationId,
      retry: load,
    }),
    [status, bootstrap, error, correlationId, load],
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
