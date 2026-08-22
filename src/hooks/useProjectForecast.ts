import { useCallback, useEffect, useState } from 'react';
import { bridataApi, BridataApiError } from '../api/client';
import type { ApiProjectForecast } from '../api/contracts';
import { useApiBootstrap } from '../context/ApiBootstrapContext';
import { useNexus } from '../context/NexusContext';
import { calculateLocalForecast } from '../domain/forecast';

function currentUtcDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo calcular el forecast del proyecto.';
}

export function useProjectForecast(projectId: string) {
  const apiBootstrap = useApiBootstrap();
  const { objects, currentWorkspace } = useNexus();
  const isApiMode = apiBootstrap.dataMode === 'api';
  const [forecast, setForecast] = useState<ApiProjectForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (isApiMode && apiBootstrap.status !== 'ready') {
      setForecast(null);
      setError(apiBootstrap.status === 'error' ? apiBootstrap.error : null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (isApiMode) {
        setForecast(await bridataApi.projectForecast(projectId));
      } else {
        const workspaceId = currentWorkspace?.id
          ?? objects.find((object) => object.id === projectId)?.workspaceId
          ?? 'mock';
        setForecast(calculateLocalForecast(projectId, workspaceId, objects, currentUtcDateOnly()));
      }
    } catch (cause) {
      setForecast(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [apiBootstrap.error, apiBootstrap.status, currentWorkspace?.id, isApiMode, objects, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { forecast, loading, error, reload };
}
