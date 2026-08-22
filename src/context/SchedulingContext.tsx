import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { bridataApi, BridataApiError } from '../api/client';
import type {
  ApiBaselineSummary,
  ApiDependency,
  ApiScheduleAnalysis,
  CreateApiDependencyInput,
  UpdateApiDependencyInput,
} from '../api/contracts';
import { mockRelations } from '../data/mockData';
import { calculateLocalSchedule } from '../domain/scheduling';
import type { DependencyType, ObjectRelation } from '../types/nexus';
import { useApiBootstrap } from './ApiBootstrapContext';
import { useNexus } from './NexusContext';

export type SchedulingStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';

interface CreateDependencyInput {
  predecessorId: string;
  successorId: string;
  dependencyType: DependencyType;
  lagDays: number;
  notes?: string;
}

interface UpdateDependencyInput {
  dependencyType?: DependencyType;
  lagDays?: number;
  notes?: string | null;
}

interface SchedulingContextType {
  dependencies: ObjectRelation[];
  status: SchedulingStatus;
  error: string | null;
  isMutationPending: boolean;
  reloadDependencies: () => Promise<void>;
  createDependency: (input: CreateDependencyInput) => Promise<ObjectRelation>;
  updateDependency: (id: string, input: UpdateDependencyInput) => Promise<ObjectRelation>;
  deleteDependency: (id: string) => Promise<void>;
  analyzeProject: (projectId: string) => Promise<ApiScheduleAnalysis>;
  saveProjectBaseline: (projectId: string, overwrite?: boolean) => Promise<ApiBaselineSummary>;
}

const SchedulingContext = createContext<SchedulingContextType | undefined>(undefined);

function apiDependencyToRelation(dependency: ApiDependency): ObjectRelation {
  return {
    id: dependency.id,
    sourceObjectId: dependency.successorId,
    targetObjectId: dependency.predecessorId,
    relationType: 'DEPENDS_ON',
    dependencyType: dependency.dependencyType,
    lagDays: dependency.lagDays,
    ...(dependency.notes ? { notes: dependency.notes } : {}),
  };
}

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo completar la operación de programación.';
}

function wouldCreateLocalCycle(
  dependencies: ObjectRelation[],
  predecessorId: string,
  successorId: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (dependency.relationType !== 'DEPENDS_ON') continue;
    const successors = adjacency.get(dependency.targetObjectId) ?? [];
    successors.push(dependency.sourceObjectId);
    adjacency.set(dependency.targetObjectId, successors);
  }

  const stack = [successorId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === predecessorId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export const SchedulingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const apiBootstrap = useApiBootstrap();
  const {
    currentWorkspace,
    objects,
    reloadObjects,
    updateNexusObject,
  } = useNexus();
  const isApiMode = apiBootstrap.dataMode === 'api';
  const apiReady = isApiMode && apiBootstrap.status === 'ready';

  const initialMockDependencies = useMemo(
    () => mockRelations.filter((relation) => relation.relationType === 'DEPENDS_ON'),
    [],
  );
  const [dependencies, setDependencies] = useState<ObjectRelation[]>(
    isApiMode ? [] : initialMockDependencies,
  );
  const [status, setStatus] = useState<SchedulingStatus>(isApiMode ? 'waiting' : 'mock');
  const [error, setError] = useState<string | null>(null);
  const [mutationCount, setMutationCount] = useState(0);

  const reloadDependencies = useCallback(async () => {
    if (!isApiMode) {
      setStatus('mock');
      setError(null);
      return;
    }
    if (!apiReady || !currentWorkspace) {
      setDependencies([]);
      setStatus(apiBootstrap.status === 'error' ? 'error' : 'waiting');
      setError(apiBootstrap.status === 'error' ? apiBootstrap.error : null);
      return;
    }

    setStatus('loading');
    setError(null);
    try {
      const response = await bridataApi.listDependencies(currentWorkspace.id);
      setDependencies(response.items.map(apiDependencyToRelation));
      setStatus('ready');
    } catch (cause) {
      setDependencies([]);
      setStatus('error');
      setError(messageOf(cause));
    }
  }, [apiBootstrap.error, apiBootstrap.status, apiReady, currentWorkspace, isApiMode]);

  useEffect(() => {
    void reloadDependencies();
  }, [reloadDependencies]);

  const createDependency = useCallback(async (input: CreateDependencyInput): Promise<ObjectRelation> => {
    setMutationCount((count) => count + 1);
    setError(null);
    try {
      if (input.predecessorId === input.successorId) {
        throw new Error('Una actividad no puede depender de sí misma.');
      }

      if (!isApiMode) {
        const relation: ObjectRelation = {
          id: `rel-${crypto.randomUUID()}`,
          sourceObjectId: input.successorId,
          targetObjectId: input.predecessorId,
          relationType: 'DEPENDS_ON',
          dependencyType: input.dependencyType,
          lagDays: input.lagDays,
          ...(input.notes ? { notes: input.notes } : {}),
        };

        const duplicate = dependencies.some(
          (dependency) =>
            dependency.relationType === 'DEPENDS_ON' &&
            dependency.sourceObjectId === relation.sourceObjectId &&
            dependency.targetObjectId === relation.targetObjectId,
        );
        if (duplicate) throw new Error('Esta dependencia ya existe.');
        if (wouldCreateLocalCycle(dependencies, input.predecessorId, input.successorId)) {
          throw new Error('Esta dependencia crearía un ciclo en el cronograma.');
        }

        setDependencies((previous) => [...previous, relation]);
        return relation;
      }

      const payload: CreateApiDependencyInput = {
        predecessorId: input.predecessorId,
        successorId: input.successorId,
        dependencyType: input.dependencyType,
        lagDays: input.lagDays,
        ...(input.notes ? { notes: input.notes } : {}),
      };
      const created = apiDependencyToRelation(await bridataApi.createDependency(payload));
      setDependencies((previous) => [...previous, created]);
      return created;
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    } finally {
      setMutationCount((count) => Math.max(0, count - 1));
    }
  }, [dependencies, isApiMode]);

  const updateDependency = useCallback(async (
    id: string,
    input: UpdateDependencyInput,
  ): Promise<ObjectRelation> => {
    const existing = dependencies.find((dependency) => dependency.id === id);
    if (!existing) throw new Error('La dependencia ya no existe.');

    setMutationCount((count) => count + 1);
    setError(null);
    try {
      if (!isApiMode) {
        const updated: ObjectRelation = { ...existing };
        if (input.dependencyType !== undefined) updated.dependencyType = input.dependencyType;
        if (input.lagDays !== undefined) updated.lagDays = input.lagDays;
        if (input.notes !== undefined) {
          if (input.notes) updated.notes = input.notes;
          else delete updated.notes;
        }
        setDependencies((previous) => previous.map((dependency) => dependency.id === id ? updated : dependency));
        return updated;
      }

      const payload: UpdateApiDependencyInput = {
        ...(input.dependencyType !== undefined ? { dependencyType: input.dependencyType } : {}),
        ...(input.lagDays !== undefined ? { lagDays: input.lagDays } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      };
      const updated = apiDependencyToRelation(await bridataApi.updateDependency(id, payload));
      setDependencies((previous) => previous.map((dependency) => dependency.id === id ? updated : dependency));
      return updated;
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    } finally {
      setMutationCount((count) => Math.max(0, count - 1));
    }
  }, [dependencies, isApiMode]);

  const deleteDependency = useCallback(async (id: string): Promise<void> => {
    setMutationCount((count) => count + 1);
    setError(null);
    try {
      if (isApiMode) await bridataApi.deleteDependency(id);
      setDependencies((previous) => previous.filter((dependency) => dependency.id !== id));
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    } finally {
      setMutationCount((count) => Math.max(0, count - 1));
    }
  }, [isApiMode]);

  const analyzeProject = useCallback(async (projectId: string): Promise<ApiScheduleAnalysis> => {
    if (isApiMode) return bridataApi.scheduleAnalysis(projectId);
    const workspaceId = currentWorkspace?.id ?? objects.find((object) => object.id === projectId)?.workspaceId ?? 'mock';
    return calculateLocalSchedule(projectId, workspaceId, objects, dependencies);
  }, [currentWorkspace?.id, dependencies, isApiMode, objects]);

  const saveProjectBaseline = useCallback(async (
    projectId: string,
    overwrite = false,
  ): Promise<ApiBaselineSummary> => {
    setMutationCount((count) => count + 1);
    setError(null);

    try {
      if (isApiMode) {
        const summary = await bridataApi.saveProjectBaseline(projectId, overwrite);
        await reloadObjects();
        return summary;
      }

      const project = objects.find((object) => object.id === projectId && object.type === 'PROJECT');
      if (!project) throw new Error('El proyecto ya no existe en la vista actual.');

      const children = objects.filter(
        (object) =>
          object.projectId === projectId &&
          ['TASK', 'DELIVERABLE', 'MILESTONE'].includes(object.type),
      );
      const snapshotObjects = [project, ...children];
      const existingBaselineCount = snapshotObjects.filter(
        (object) => object.baselineStartDate || object.baselineEndDate,
      ).length;

      if (existingBaselineCount > 0 && !overwrite) {
        throw new Error('El proyecto ya tiene una línea base. Confirma el reemplazo para continuar.');
      }

      const capturedAt = new Date().toISOString();
      let scheduledCount = 0;
      let skippedUnscheduledCount = 0;

      for (const object of snapshotObjects) {
        const baselineUpdates = {
          ...(object.startDate ? { baselineStartDate: object.startDate } : {}),
          ...(object.endDate ? { baselineEndDate: object.endDate } : {}),
        };

        if (Object.keys(baselineUpdates).length > 0) {
          scheduledCount += 1;
          await updateNexusObject(object.id, baselineUpdates);
        } else {
          skippedUnscheduledCount += 1;
        }
      }

      return {
        projectId,
        workspaceId: project.workspaceId,
        baselineVersion: existingBaselineCount > 0 ? 2 : 1,
        capturedAt,
        updatedCount: scheduledCount,
        scheduledCount,
        skippedUnscheduledCount,
        overwritten: existingBaselineCount > 0,
      };
    } catch (cause) {
      setError(messageOf(cause));
      throw cause;
    } finally {
      setMutationCount((count) => Math.max(0, count - 1));
    }
  }, [isApiMode, objects, reloadObjects, updateNexusObject]);

  return (
    <SchedulingContext.Provider
      value={{
        dependencies,
        status,
        error,
        isMutationPending: mutationCount > 0,
        reloadDependencies,
        createDependency,
        updateDependency,
        deleteDependency,
        analyzeProject,
        saveProjectBaseline,
      }}
    >
      {children}
    </SchedulingContext.Provider>
  );
};

export function useScheduling(): SchedulingContextType {
  const context = useContext(SchedulingContext);
  if (!context) throw new Error('useScheduling must be used within SchedulingProvider');
  return context;
}
