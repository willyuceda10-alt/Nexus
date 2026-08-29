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
  Tenant,
  Workspace,
  User,
  Portfolio,
  NexusObject,
  ObjectRelation,
  ActivityLog,
  Comment,
  ApprovalStep,
  ObjectType,
  ProjectHealthMetrics,
} from '../types/nexus';
import {
  mockTenant,
  mockWorkspaces,
  mockUsers,
  mockPortfolios,
  mockObjects,
  mockRelations,
  mockActivityLogs,
  mockComments,
  mockApprovals,
} from '../data/mockData';
import { calculateProjectHealth } from '../domain/projectHealth';
import { useApiBootstrap } from './ApiBootstrapContext';
import { configureApiSession, BridataApiError, bridataApi } from '../api/client';
import { collaborationV1Api } from '../api/collaborationV1Client';
import { objectRelationsV1Api } from '../api/objectRelationsV1Client';
import { mapApiObjectCommentV1, mapObjectCollaborationV1 } from '../domain/collaborationV1';
import {
  apiActorToUser,
  apiTenantToTenant,
  apiWorkspaceToWorkspace,
} from '../data/apiAdapters';
import {
  ApiObjectRepository,
  InMemoryObjectRepository,
  type ObjectRepository,
  type ObjectRepositoryContext,
} from '../data/objectRepository';

export type ObjectDataStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';
export type CollaborationDataStatus = 'mock' | 'idle' | 'loading' | 'ready' | 'error';
export type RelationDataStatus = 'mock' | 'waiting' | 'loading' | 'ready' | 'error';

interface NexusContextType {
  tenant: Tenant;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  setCurrentWorkspaceId: (id: string | null) => void;
  users: User[];
  currentUser: User;
  setCurrentUserId: (id: string) => void;
  portfolios: Portfolio[];
  objects: NexusObject[];
  relations: ObjectRelation[];
  relationDataStatus: RelationDataStatus;
  relationDataError: string | null;
  reloadRelations: () => Promise<void>;
  activityLogs: ActivityLog[];
  comments: Comment[];
  selectedObjectActivityLogs: ActivityLog[];
  selectedObjectComments: Comment[];
  collaborationStatus: CollaborationDataStatus;
  collaborationError: string | null;
  reloadObjectCollaboration: (objectId?: string) => Promise<void>;
  approvals: ApprovalStep[];
  objectDataStatus: ObjectDataStatus;
  objectDataError: string | null;
  isObjectMutationPending: boolean;
  reloadObjects: () => Promise<void>;

  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  projectActiveSubTab: string;
  setProjectActiveSubTab: (subTab: string) => void;

  selectedObject: NexusObject | null;
  isDrawerOpen: boolean;
  openObjectDrawer: (objectId: string) => void;
  closeObjectDrawer: () => void;

  isCreateModalOpen: boolean;
  createModalDefaultType: ObjectType;
  openCreateModal: (type?: ObjectType) => void;
  closeCreateModal: () => void;
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (open: boolean) => void;

  createNexusObject: (data: Partial<NexusObject>) => Promise<NexusObject>;
  updateNexusObject: (id: string, updates: Partial<NexusObject>) => Promise<NexusObject>;
  deleteNexusObject: (id: string) => Promise<void>;
  addRelation: (
    sourceId: string,
    targetId: string,
    relationType: ObjectRelation['relationType'],
    notes?: string,
  ) => Promise<ObjectRelation>;
  removeRelation: (relationId: string) => Promise<void>;
  addComment: (objectId: string, content: string) => Promise<Comment>;
  decideApproval: (
    approvalId: string,
    status: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) => Promise<void>;

  getProjectHealth: (projectId: string) => ProjectHealthMetrics;
  getLinkedObjects: (
    objectId: string,
  ) => { relationId: string; object: NexusObject; relationType: string; notes?: string }[];
}

const NexusContext = createContext<NexusContextType | undefined>(undefined);

function dataErrorMessage(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId
      ? `${cause.message} · Ref: ${cause.correlationId}`
      : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo completar la operación de datos.';
}

export const NexusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const apiBootstrap = useApiBootstrap();
  const isApiMode = apiBootstrap.dataMode === 'api';
  const apiReady = isApiMode && apiBootstrap.status === 'ready' && apiBootstrap.bootstrap !== null;

  const tenant = useMemo<Tenant>(() => {
    if (apiReady) return apiTenantToTenant(apiBootstrap.bootstrap!.tenant);
    return mockTenant;
  }, [apiReady, apiBootstrap.bootstrap]);

  const workspaces = useMemo<Workspace[]>(() => {
    if (apiReady) {
      return apiBootstrap.bootstrap!.workspaces.map((workspace) =>
        apiWorkspaceToWorkspace(workspace, apiBootstrap.bootstrap!.tenant),
      );
    }
    return mockWorkspaces;
  }, [apiReady, apiBootstrap.bootstrap]);

  const users = useMemo<User[]>(() => {
    if (apiReady) return [apiActorToUser(apiBootstrap.bootstrap!.actor)];
    return mockUsers;
  }, [apiReady, apiBootstrap.bootstrap]);

  const portfolios = useMemo<Portfolio[]>(
    () => (isApiMode ? [] : mockPortfolios),
    [isApiMode],
  );

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(
    isApiMode ? null : 'ws-001',
  );
  const [currentUserId, setCurrentUserId] = useState<string>(
    isApiMode ? '' : 'u-001',
  );
  const [objects, setObjects] = useState<NexusObject[]>(isApiMode ? [] : mockObjects);
  const [relations, setRelations] = useState<ObjectRelation[]>(isApiMode ? [] : mockRelations);
  const [relationDataStatus, setRelationDataStatus] = useState<RelationDataStatus>(isApiMode ? 'waiting' : 'mock');
  const [relationDataError, setRelationDataError] = useState<string | null>(null);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(isApiMode ? [] : mockActivityLogs);
  const [comments, setComments] = useState<Comment[]>(isApiMode ? [] : mockComments);
  const [apiObjectComments, setApiObjectComments] = useState<Comment[]>([]);
  const [apiObjectActivityLogs, setApiObjectActivityLogs] = useState<ActivityLog[]>([]);
  const [collaborationStatus, setCollaborationStatus] = useState<CollaborationDataStatus>(
    isApiMode ? 'idle' : 'mock',
  );
  const [collaborationError, setCollaborationError] = useState<string | null>(null);
  const collaborationRequestVersionRef = useRef(0);
  const collaborationObjectIdRef = useRef<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalStep[]>(isApiMode ? [] : mockApprovals);
  const [objectDataStatus, setObjectDataStatus] = useState<ObjectDataStatus>(
    isApiMode ? 'waiting' : 'mock',
  );
  const [objectDataError, setObjectDataError] = useState<string | null>(null);
  const [objectMutationCount, setObjectMutationCount] = useState(0);

  const [activeTab, setActiveTab] = useState<string>('home');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    isApiMode ? null : 'prj-101',
  );
  const [projectActiveSubTab, setProjectActiveSubTab] = useState<string>('table');

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createModalDefaultType, setCreateModalDefaultType] = useState<ObjectType>('TASK');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);

  const repository = useMemo<ObjectRepository>(
    () => (isApiMode ? new ApiObjectRepository() : new InMemoryObjectRepository(mockObjects)),
    [isApiMode],
  );

  useEffect(() => {
    if (!apiReady) return;

    const bootstrap = apiBootstrap.bootstrap!;
    setCurrentUserId(bootstrap.actor.userId);
    setCurrentWorkspaceId((current) => {
      if (current && bootstrap.workspaces.some((workspace) => workspace.id === current)) {
        return current;
      }
      return bootstrap.workspaces[0]?.id ?? null;
    });

    configureApiSession({
      getTenantId: () => bootstrap.tenant.id,
    });
  }, [apiReady, apiBootstrap.bootstrap]);

  const currentUser = useMemo<User>(() => {
    const user = users.find((item) => item.id === currentUserId) ?? users[0];
    if (!user) {
      throw new Error('Bridata Project requires an authenticated or development user.');
    }
    return user;
  }, [users, currentUserId]);

  const currentWorkspace = useMemo(() => {
    if (!currentWorkspaceId) return null;
    return workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;
  }, [workspaces, currentWorkspaceId]);

  const selectedObject = useMemo(() => {
    if (!selectedObjectId) return null;
    return objects.find((object) => object.id === selectedObjectId) ?? null;
  }, [objects, selectedObjectId]);

  const selectedObjectComments = useMemo<Comment[]>(() => {
    if (!selectedObjectId) return [];
    return isApiMode
      ? apiObjectComments
      : comments.filter((comment) => comment.objectId === selectedObjectId);
  }, [selectedObjectId, isApiMode, apiObjectComments, comments]);

  const selectedObjectActivityLogs = useMemo<ActivityLog[]>(() => {
    if (!selectedObjectId) return [];
    return isApiMode
      ? apiObjectActivityLogs
      : activityLogs.filter((log) => log.objectId === selectedObjectId);
  }, [selectedObjectId, isApiMode, apiObjectActivityLogs, activityLogs]);

  const reloadObjectCollaboration = useCallback(async (objectId?: string): Promise<void> => {
    const requestVersion = ++collaborationRequestVersionRef.current;
    if (!isApiMode) {
      setCollaborationStatus('mock');
      setCollaborationError(null);
      return;
    }

    const targetId = objectId ?? selectedObjectId;
    if (!apiReady || !targetId) {
      setApiObjectComments([]);
      setApiObjectActivityLogs([]);
      setCollaborationStatus('idle');
      setCollaborationError(null);
      return;
    }

    setCollaborationStatus('loading');
    setCollaborationError(null);
    try {
      const payload = await collaborationV1Api.getObjectCollaboration(targetId, {
        commentLimit: 100,
        auditLimit: 100,
        historyLimit: 100,
      });
      if (requestVersion !== collaborationRequestVersionRef.current || collaborationObjectIdRef.current !== targetId) return;
      const mapped = mapObjectCollaborationV1(payload);
      setApiObjectComments(mapped.comments);
      setApiObjectActivityLogs(mapped.activityLogs);
      setCollaborationStatus('ready');
    } catch (cause) {
      if (requestVersion !== collaborationRequestVersionRef.current || collaborationObjectIdRef.current !== targetId) return;
      setApiObjectComments([]);
      setApiObjectActivityLogs([]);
      setCollaborationStatus('error');
      setCollaborationError(dataErrorMessage(cause));
    }
  }, [isApiMode, apiReady, selectedObjectId]);

  const repositoryContext = useCallback((): ObjectRepositoryContext => {
    const workspaceId = currentWorkspaceId ?? workspaces[0]?.id;
    if (!workspaceId) {
      throw new Error('No hay un workspace disponible para esta operación.');
    }

    return {
      tenantId: tenant.id,
      workspaceId,
      currentUser,
      ...(apiReady
        ? { objectDefinitions: apiBootstrap.bootstrap!.objectDefinitions }
        : {}),
    };
  }, [currentWorkspaceId, workspaces, tenant.id, currentUser, apiReady, apiBootstrap.bootstrap]);

  const reloadObjects = useCallback(async () => {
    if (!isApiMode) {
      const result = await repository.list();
      setObjects(result.items);
      setObjectDataStatus('mock');
      setObjectDataError(null);
      return;
    }

    if (!apiReady || !currentWorkspaceId) {
      setObjects([]);
      setObjectDataStatus(apiBootstrap.status === 'error' ? 'error' : 'waiting');
      setObjectDataError(apiBootstrap.status === 'error' ? apiBootstrap.error : null);
      return;
    }

    setObjectDataStatus('loading');
    setObjectDataError(null);
    try {
      const result = await repository.list({
        workspaceId: currentWorkspaceId,
        limit: 100,
      });
      setObjects(result.items);
      setObjectDataStatus('ready');
    } catch (cause) {
      setObjects([]);
      setObjectDataStatus('error');
      setObjectDataError(dataErrorMessage(cause));
    }
  }, [
    isApiMode,
    repository,
    apiReady,
    currentWorkspaceId,
    apiBootstrap.status,
    apiBootstrap.error,
  ]);

  const reloadRelations = useCallback(async (): Promise<void> => {
    if (!isApiMode) {
      setRelationDataStatus('mock');
      setRelationDataError(null);
      return;
    }
    if (!apiReady || !currentWorkspaceId) {
      setRelations([]);
      setRelationDataStatus('waiting');
      setRelationDataError(null);
      return;
    }

    setRelationDataStatus('loading');
    setRelationDataError(null);
    try {
      const response = await objectRelationsV1Api.list(currentWorkspaceId);
      setRelations(response.items.map((item) => ({
        id: item.id,
        sourceObjectId: item.sourceObjectId,
        targetObjectId: item.targetObjectId,
        relationType: item.relationType,
        ...(item.notes ? { notes: item.notes } : {}),
      })));
      setRelationDataStatus('ready');
    } catch (cause) {
      setRelations([]);
      setRelationDataStatus('error');
      setRelationDataError(dataErrorMessage(cause));
    }
  }, [isApiMode, apiReady, currentWorkspaceId]);

  useEffect(() => {
    void reloadObjects();
  }, [reloadObjects]);

  useEffect(() => {
    void reloadRelations();
  }, [reloadRelations]);

  useEffect(() => {
    if (!isDrawerOpen || !selectedObjectId) return;
    void reloadObjectCollaboration(selectedObjectId);
  }, [isDrawerOpen, selectedObjectId, reloadObjectCollaboration]);

  useEffect(() => {
    if (!isApiMode || objectDataStatus !== 'ready') return;
    const selectedStillExists = selectedProjectId
      ? objects.some((object) => object.id === selectedProjectId && object.type === 'PROJECT')
      : false;
    if (!selectedStillExists) {
      setSelectedProjectId(objects.find((object) => object.type === 'PROJECT')?.id ?? null);
    }
  }, [isApiMode, objectDataStatus, objects, selectedProjectId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen((previous) => !previous);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openObjectDrawer = (objectId: string) => {
    collaborationRequestVersionRef.current += 1;
    collaborationObjectIdRef.current = objectId;
    if (isApiMode) {
      setApiObjectComments([]);
      setApiObjectActivityLogs([]);
      setCollaborationStatus('loading');
      setCollaborationError(null);
    }
    setSelectedObjectId(objectId);
    setIsDrawerOpen(true);
  };

  const closeObjectDrawer = () => {
    collaborationRequestVersionRef.current += 1;
    collaborationObjectIdRef.current = null;
    setIsDrawerOpen(false);
    setSelectedObjectId(null);
    if (isApiMode) {
      setApiObjectComments([]);
      setApiObjectActivityLogs([]);
      setCollaborationStatus('idle');
      setCollaborationError(null);
    }
  };

  const openCreateModal = (type: ObjectType = 'TASK') => {
    setCreateModalDefaultType(type);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
  };

  const createNexusObject = async (data: Partial<NexusObject>): Promise<NexusObject> => {
    setObjectMutationCount((count) => count + 1);
    setObjectDataError(null);
    try {
      const created = await repository.create(data, repositoryContext());
      setObjects((previous) => [created, ...previous]);

      if (!isApiMode) {
        const log: ActivityLog = {
          id: `act-${crypto.randomUUID()}`,
          objectId: created.id,
          userId: currentUser.id,
          userName: currentUser.name,
          userAvatar: currentUser.avatar,
          action: `Creó el objeto (${created.type}) "${created.title}"`,
          newValue: created.status,
          timestamp: new Date().toISOString(),
        };
        setActivityLogs((previous) => [log, ...previous]);
      }

      if (created.type === 'PROJECT') setSelectedProjectId(created.id);
      return created;
    } catch (cause) {
      setObjectDataError(dataErrorMessage(cause));
      throw cause;
    } finally {
      setObjectMutationCount((count) => Math.max(0, count - 1));
    }
  };

  const updateNexusObject = async (
    id: string,
    updates: Partial<NexusObject>,
  ): Promise<NexusObject> => {
    const existing = objects.find((object) => object.id === id);
    if (!existing) throw new Error('El objeto ya no existe en la vista actual.');

    // The UI is optimistic. ApiObjectRepository buffers rapid calls and serializes
    // each object by the latest confirmed server version.
    setObjects((previous) =>
      previous.map((object) =>
        object.id === id ? { ...object, ...updates } : object,
      ),
    );
    setObjectMutationCount((count) => count + 1);
    setObjectDataError(null);

    try {
      const updated = await repository.update(existing, updates, repositoryContext());
      setObjects((previous) =>
        previous.map((object) =>
          object.id === id
            ? {
                ...updated,
                ...object,
                version: updated.version,
                updatedAt: updated.updatedAt,
              }
            : object,
        ),
      );

      if (!isApiMode && updates.status && updates.status !== existing.status) {
        const log: ActivityLog = {
          id: `act-${crypto.randomUUID()}`,
          objectId: id,
          userId: currentUser.id,
          userName: currentUser.name,
          userAvatar: currentUser.avatar,
          action: `Cambió estado a ${updates.status}`,
          oldValue: existing.status,
          newValue: updates.status,
          timestamp: new Date().toISOString(),
        };
        setActivityLogs((previous) => [log, ...previous]);
      }

      return updated;
    } catch (cause) {
      setObjectDataError(dataErrorMessage(cause));
      if (isApiMode) {
        await reloadObjects();
      } else {
        setObjects((previous) =>
          previous.map((object) => (object.id === id ? existing : object)),
        );
      }
      throw cause;
    } finally {
      setObjectMutationCount((count) => Math.max(0, count - 1));
    }
  };

  const deleteNexusObject = async (id: string): Promise<void> => {
    const existing = objects.find((object) => object.id === id);
    if (!existing) return;

    setObjectMutationCount((count) => count + 1);
    setObjectDataError(null);
    try {
      await repository.delete(existing);
      setObjects((previous) => previous.filter((object) => object.id !== id));
      if (selectedObjectId === id) closeObjectDrawer();
      if (selectedProjectId === id) setSelectedProjectId(null);
    } catch (cause) {
      setObjectDataError(dataErrorMessage(cause));
      throw cause;
    } finally {
      setObjectMutationCount((count) => Math.max(0, count - 1));
    }
  };

  const addRelation = async (
    sourceObjectId: string,
    targetObjectId: string,
    relationType: ObjectRelation['relationType'],
    notes?: string,
  ): Promise<ObjectRelation> => {
    if (!isApiMode) {
      const newRelation: ObjectRelation = {
        id: `rel-${crypto.randomUUID()}`,
        sourceObjectId,
        targetObjectId,
        relationType,
        ...(notes ? { notes } : {}),
      };
      setRelations((previous) => [...previous, newRelation]);
      return newRelation;
    }

    if (!apiReady) throw new Error('La API todavía no está lista para guardar relaciones.');
    setRelationDataError(null);
    try {
      let newRelation: ObjectRelation;
      if (relationType === 'DEPENDS_ON') {
        const dependency = await bridataApi.createDependency({
          predecessorId: targetObjectId,
          successorId: sourceObjectId,
          dependencyType: 'FS',
          lagDays: 0,
          ...(notes ? { notes } : {}),
        });
        newRelation = {
          id: dependency.id,
          sourceObjectId: dependency.successorId,
          targetObjectId: dependency.predecessorId,
          relationType: 'DEPENDS_ON',
          ...(dependency.notes ? { notes: dependency.notes } : {}),
          dependencyType: dependency.dependencyType,
          lagDays: dependency.lagDays,
        };
      } else {
        const relation = await objectRelationsV1Api.create({
          sourceObjectId,
          targetObjectId,
          relationType,
          ...(notes ? { notes } : {}),
        });
        newRelation = {
          id: relation.id,
          sourceObjectId: relation.sourceObjectId,
          targetObjectId: relation.targetObjectId,
          relationType: relation.relationType,
          ...(relation.notes ? { notes: relation.notes } : {}),
        };
      }
      setRelations((previous) => [...previous.filter((item) => item.id !== newRelation.id), newRelation]);
      setRelationDataStatus('ready');
      if (selectedObjectId === sourceObjectId || selectedObjectId === targetObjectId) {
        void reloadObjectCollaboration(selectedObjectId);
      }
      return newRelation;
    } catch (cause) {
      setRelationDataStatus('error');
      setRelationDataError(dataErrorMessage(cause));
      throw cause;
    }
  };

  const removeRelation = async (relationId: string): Promise<void> => {
    const relation = relations.find((item) => item.id === relationId);
    if (!relation) return;

    if (!isApiMode) {
      setRelations((previous) => previous.filter((item) => item.id !== relationId));
      return;
    }

    setRelationDataError(null);
    try {
      if (relation.relationType === 'DEPENDS_ON') {
        await bridataApi.deleteDependency(relationId);
      } else {
        await objectRelationsV1Api.delete(relationId);
      }
      setRelations((previous) => previous.filter((item) => item.id !== relationId));
      setRelationDataStatus('ready');
      if (selectedObjectId === relation.sourceObjectId || selectedObjectId === relation.targetObjectId) {
        void reloadObjectCollaboration(selectedObjectId);
      }
    } catch (cause) {
      setRelationDataStatus('error');
      setRelationDataError(dataErrorMessage(cause));
      throw cause;
    }
  };

  const addComment = async (objectId: string, content: string): Promise<Comment> => {
    const normalized = content.trim();
    if (!normalized) throw new Error('El comentario no puede estar vacío.');

    if (isApiMode) {
      if (!apiReady) throw new Error('La API todavía no está lista para guardar comentarios.');
      setCollaborationError(null);
      try {
        const created = await collaborationV1Api.createObjectComment(objectId, { content: normalized });
        const mapped = mapApiObjectCommentV1(created);
        if (collaborationObjectIdRef.current === objectId) {
          setApiObjectComments((previous) => [mapped, ...previous.filter((item) => item.id !== mapped.id)]);
          await reloadObjectCollaboration(objectId);
        }
        return mapped;
      } catch (cause) {
        if (collaborationObjectIdRef.current === objectId) {
          setCollaborationStatus('error');
          setCollaborationError(dataErrorMessage(cause));
        }
        throw cause;
      }
    }

    const newComment: Comment = {
      id: `cmt-${crypto.randomUUID()}`,
      objectId,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatar,
      content: normalized,
      createdAt: new Date().toISOString(),
    };
    setComments((previous) => [newComment, ...previous]);
    return newComment;
  };

  const decideApproval = async (
    approvalId: string,
    status: 'APPROVED' | 'REJECTED',
    comment?: string,
  ): Promise<void> => {
    const approval = approvals.find((item) => item.id === approvalId);
    if (!approval) return;

    await updateNexusObject(approval.objectId, {
      status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
    });

    const now = new Date().toISOString();
    setApprovals((previous) =>
      previous.map((item) =>
        item.id === approvalId
          ? {
              ...item,
              status,
              decidedAt: now,
              ...(comment ? { comment } : {}),
            }
          : item,
      ),
    );
  };

  const getLinkedObjects = (objectId: string) => {
    const linked: { relationId: string; object: NexusObject; relationType: string; notes?: string }[] = [];

    relations.forEach((relation) => {
      if (relation.sourceObjectId === objectId) {
        const target = objects.find((object) => object.id === relation.targetObjectId);
        if (target) {
          linked.push({
            relationId: relation.id,
            object: target,
            relationType: relation.relationType,
            ...(relation.notes ? { notes: relation.notes } : {}),
          });
        }
      } else if (relation.targetObjectId === objectId) {
        const source = objects.find((object) => object.id === relation.sourceObjectId);
        if (source) {
          linked.push({
            relationId: relation.id,
            object: source,
            relationType: `INVERSE_${relation.relationType}`,
            ...(relation.notes ? { notes: relation.notes } : {}),
          });
        }
      }
    });

    return linked;
  };

  const getProjectHealth = (projectId: string): ProjectHealthMetrics => {
    const project = objects.find((object) => object.id === projectId);
    const projectObjects = objects.filter((object) => object.projectId === projectId);
    return calculateProjectHealth(project, projectObjects);
  };

  return (
    <NexusContext.Provider
      value={{
        tenant,
        workspaces,
        currentWorkspace,
        setCurrentWorkspaceId,
        users,
        currentUser,
        setCurrentUserId,
        portfolios,
        objects,
        relations,
        relationDataStatus,
        relationDataError,
        reloadRelations,
        activityLogs,
        comments,
        selectedObjectActivityLogs,
        selectedObjectComments,
        collaborationStatus,
        collaborationError,
        reloadObjectCollaboration,
        approvals,
        objectDataStatus,
        objectDataError,
        isObjectMutationPending: objectMutationCount > 0,
        reloadObjects,
        activeTab,
        setActiveTab,
        selectedProjectId,
        setSelectedProjectId,
        projectActiveSubTab,
        setProjectActiveSubTab,
        selectedObject,
        isDrawerOpen,
        openObjectDrawer,
        closeObjectDrawer,
        isCreateModalOpen,
        createModalDefaultType,
        openCreateModal,
        closeCreateModal,
        isCommandPaletteOpen,
        setIsCommandPaletteOpen,
        createNexusObject,
        updateNexusObject,
        deleteNexusObject,
        addRelation,
        removeRelation,
        addComment,
        decideApproval,
        getProjectHealth,
        getLinkedObjects,
      }}
    >
      {children}
    </NexusContext.Provider>
  );
};

export const useNexus = () => {
  const context = useContext(NexusContext);
  if (!context) {
    throw new Error('useNexus must be used within a NexusProvider');
  }
  return context;
};
