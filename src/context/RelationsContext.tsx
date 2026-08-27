import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { bridataApi, BridataApiError } from '../api/client';
import type { ApiGenericRelation, ApiGenericRelationType } from '../api/relationContracts';
import { mockRelations } from '../data/mockData';
import type { ObjectRelation } from '../types/nexus';
import { useApiBootstrap } from './ApiBootstrapContext';
import { useNexus } from './NexusContext';

export type RelationsStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';

interface RelationsContextType {
  relations: ObjectRelation[];
  status: RelationsStatus;
  error: string | null;
  isMutationPending: boolean;
  reloadRelations: () => Promise<void>;
  createRelation: (
    sourceObjectId: string,
    targetObjectId: string,
    relationType: ApiGenericRelationType,
    notes?: string,
  ) => Promise<ObjectRelation>;
  deleteRelation: (id: string) => Promise<void>;
}

const RelationsContext = createContext<RelationsContextType | undefined>(undefined);

function apiRelationToObjectRelation(relation: ApiGenericRelation): ObjectRelation {
  return {
    id: relation.id,
    sourceObjectId: relation.sourceObjectId,
    targetObjectId: relation.targetObjectId,
    relationType: relation.relationType,
    ...(relation.notes ? { notes: relation.notes } : {}),
  };
}

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudieron cargar las relaciones del Object Engine.';
}

const mockGenericRelations = mockRelations.filter((relation) => relation.relationType !== 'DEPENDS_ON');

export const RelationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const apiBootstrap = useApiBootstrap();
  const { currentWorkspace } = useNexus();
  const isApiMode = apiBootstrap.dataMode === 'api';
  const apiReady = isApiMode && apiBootstrap.status === 'ready';

  const [relations, setRelations] = useState<ObjectRelation[]>(isApiMode ? [] : mockGenericRelations);
  const [status, setStatus] = useState<RelationsStatus>(isApiMode ? 'waiting' : 'mock');
  const [error, setError] = useState<string | null>(null);
  const [mutationCount, setMutationCount] = useState(0);

  const reloadRelations = useCallback(async () => {
    if (!isApiMode) {
      setRelations(mockGenericRelations);
      setStatus('mock');
      setError(null);
      return;
    }
    if (!apiReady || !currentWorkspace) {
      setRelations([]);
      setStatus(apiBootstrap.status === 'error' ? 'error' : 'waiting');
      setError(apiBootstrap.status === 'error' ? apiBootstrap.error : null);
      return;
    }

    setStatus('loading');
    setError(null);
    try {
      const response = await bridataApi.listRelations(currentWorkspace.id);
      setRelations(response.items.map(apiRelationToObjectRelation));
      setStatus('ready');
    } catch (cause) {
      setRelations([]);
      setStatus('error');
      setError(messageOf(cause));
    }
  }, [apiBootstrap.error, apiBootstrap.status, apiReady, currentWorkspace, isApiMode]);

  useEffect(() => {
    void reloadRelations();
  }, [reloadRelations]);

  const createRelation = useCallback(async (
    sourceObjectId: string,
    targetObjectId: string,
    relationType: ApiGenericRelationType,
    notes?: string,
  ): Promise<ObjectRelation> => {
    if (sourceObjectId === targetObjectId) throw new Error('Un objeto no puede relacionarse consigo mismo.');
    setMutationCount((count) => count + 1);
    setError(null);

    try {
      if (!isApiMode) {
        const duplicate = relations.some(
          (relation) =>
            relation.sourceObjectId === sourceObjectId &&
            relation.targetObjectId === targetObjectId &&
            relation.relationType === relationType,
        );
        if (duplicate) throw new Error('Esta relación ya existe.');

        const created: ObjectRelation = {
          id: `rel-${crypto.randomUUID()}`,
          sourceObjectId,
          targetObjectId,
          relationType,
          ...(notes ? { notes } : {}),
        };
        setRelations((previous) => [...previous, created]);
        return created;
      }

      const created = apiRelationToObjectRelation(
        await bridataApi.createRelation({
          sourceObjectId,
          targetObjectId,
          relationType,
          ...(notes ? { notes } : {}),
        }),
      );
      setRelations((previous) => [...previous, created]);
      return created;
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    } finally {
      setMutationCount((count) => Math.max(0, count - 1));
    }
  }, [isApiMode, relations]);

  const deleteRelation = useCallback(async (id: string): Promise<void> => {
    setMutationCount((count) => count + 1);
    setError(null);
    try {
      if (isApiMode) await bridataApi.deleteRelation(id);
      setRelations((previous) => previous.filter((relation) => relation.id !== id));
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    } finally {
      setMutationCount((count) => Math.max(0, count - 1));
    }
  }, [isApiMode]);

  return (
    <RelationsContext.Provider
      value={{
        relations,
        status,
        error,
        isMutationPending: mutationCount > 0,
        reloadRelations,
        createRelation,
        deleteRelation,
      }}
    >
      {children}
    </RelationsContext.Provider>
  );
};

export function useRelations(): RelationsContextType {
  const context = useContext(RelationsContext);
  if (!context) throw new Error('useRelations must be used within RelationsProvider');
  return context;
}
