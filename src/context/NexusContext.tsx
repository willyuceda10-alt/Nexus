import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
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
  activityLogs: ActivityLog[];
  comments: Comment[];
  approvals: ApprovalStep[];

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

  createNexusObject: (data: Partial<NexusObject>) => NexusObject;
  updateNexusObject: (id: string, updates: Partial<NexusObject>) => void;
  deleteNexusObject: (id: string) => void;
  addRelation: (
    sourceId: string,
    targetId: string,
    relationType: ObjectRelation['relationType'],
    notes?: string,
  ) => void;
  addComment: (objectId: string, content: string) => void;
  decideApproval: (
    approvalId: string,
    status: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) => void;

  getProjectHealth: (projectId: string) => ProjectHealthMetrics;
  getLinkedObjects: (
    objectId: string,
  ) => { object: NexusObject; relationType: string; notes?: string }[];
}

const NexusContext = createContext<NexusContextType | undefined>(undefined);

export const NexusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant] = useState<Tenant>(mockTenant);
  const [workspaces] = useState<Workspace[]>(mockWorkspaces);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>('ws-001');
  const [users] = useState<User[]>(mockUsers);
  const [currentUserId, setCurrentUserId] = useState<string>('u-001');
  const [portfolios] = useState<Portfolio[]>(mockPortfolios);
  const [objects, setObjects] = useState<NexusObject[]>(mockObjects);
  const [relations, setRelations] = useState<ObjectRelation[]>(mockRelations);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(mockActivityLogs);
  const [comments, setComments] = useState<Comment[]>(mockComments);
  const [approvals, setApprovals] = useState<ApprovalStep[]>(mockApprovals);

  const [activeTab, setActiveTab] = useState<string>('home');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>('prj-101');
  const [projectActiveSubTab, setProjectActiveSubTab] = useState<string>('table');

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createModalDefaultType, setCreateModalDefaultType] = useState<ObjectType>('TASK');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);

  const currentUser = useMemo<User>(() => {
    const user = users.find((item) => item.id === currentUserId) ?? users[0];
    if (!user) {
      throw new Error('Nexus requires at least one user in the current prototype dataset.');
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
    setSelectedObjectId(objectId);
    setIsDrawerOpen(true);
  };

  const closeObjectDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedObjectId(null);
  };

  const openCreateModal = (type: ObjectType = 'TASK') => {
    setCreateModalDefaultType(type);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
  };

  // Prototype-only local write. The API becomes authoritative once the UI is
  // switched from mockData to /api/v1.
  const createNexusObject = (data: Partial<NexusObject>): NexusObject => {
    const newId = `${data.type?.toLowerCase().slice(0, 3) || 'obj'}-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const newObject: NexusObject = {
      id: newId,
      tenantId: tenant.id,
      workspaceId: currentWorkspaceId || 'ws-001',
      projectId: selectedProjectId || undefined,
      type: data.type || 'TASK',
      title: data.title || 'Nuevo Objeto sin Título',
      description: data.description || '',
      status: data.status || 'DRAFT',
      priority: data.priority || 'MEDIUM',
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      ownerAvatar: currentUser.avatar,
      assigneeId: data.assigneeId || currentUser.id,
      assigneeName: data.assigneeName || currentUser.name,
      assigneeAvatar: data.assigneeAvatar || currentUser.avatar,
      startDate: data.startDate || now.split('T')[0],
      endDate: data.endDate || now.split('T')[0],
      createdAt: now,
      updatedAt: now,
      progress: data.progress || 0,
      ...data,
    };

    setObjects((previous) => [newObject, ...previous]);

    const log: ActivityLog = {
      id: `act-${crypto.randomUUID()}`,
      objectId: newId,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatar,
      action: `Creó el objeto (${newObject.type}) "${newObject.title}"`,
      newValue: newObject.status,
      timestamp: now,
    };
    setActivityLogs((previous) => [log, ...previous]);

    return newObject;
  };

  const updateNexusObject = (id: string, updates: Partial<NexusObject>) => {
    const now = new Date().toISOString();
    setObjects((previous) =>
      previous.map((object) => {
        if (object.id !== id) return object;

        const updated = { ...object, ...updates, updatedAt: now };

        if (updates.status && updates.status !== object.status) {
          const log: ActivityLog = {
            id: `act-${crypto.randomUUID()}`,
            objectId: id,
            userId: currentUser.id,
            userName: currentUser.name,
            userAvatar: currentUser.avatar,
            action: `Cambió estado a ${updates.status}`,
            oldValue: object.status,
            newValue: updates.status,
            timestamp: now,
          };
          setActivityLogs((previousLogs) => [log, ...previousLogs]);
        }

        return updated;
      }),
    );
  };

  const deleteNexusObject = (id: string) => {
    setObjects((previous) => previous.filter((object) => object.id !== id));
    if (selectedObjectId === id) closeObjectDrawer();
  };

  const addRelation = (
    sourceObjectId: string,
    targetObjectId: string,
    relationType: ObjectRelation['relationType'],
    notes?: string,
  ) => {
    const newRelation: ObjectRelation = {
      id: `rel-${crypto.randomUUID()}`,
      sourceObjectId,
      targetObjectId,
      relationType,
      ...(notes ? { notes } : {}),
    };
    setRelations((previous) => [...previous, newRelation]);
  };

  const addComment = (objectId: string, content: string) => {
    const newComment: Comment = {
      id: `cmt-${crypto.randomUUID()}`,
      objectId,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatar,
      content,
      createdAt: new Date().toISOString(),
    };
    setComments((previous) => [newComment, ...previous]);
  };

  const decideApproval = (
    approvalId: string,
    status: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) => {
    const now = new Date().toISOString();
    setApprovals((previous) =>
      previous.map((approval) => {
        if (approval.id !== approvalId) return approval;

        const updated: ApprovalStep = {
          ...approval,
          status,
          decidedAt: now,
          ...(comment ? { comment } : {}),
        };

        updateNexusObject(approval.objectId, {
          status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        });

        return updated;
      }),
    );
  };

  const getLinkedObjects = (objectId: string) => {
    const linked: { object: NexusObject; relationType: string; notes?: string }[] = [];

    relations.forEach((relation) => {
      if (relation.sourceObjectId === objectId) {
        const target = objects.find((object) => object.id === relation.targetObjectId);
        if (target) {
          linked.push({
            object: target,
            relationType: relation.relationType,
            ...(relation.notes ? { notes: relation.notes } : {}),
          });
        }
      } else if (relation.targetObjectId === objectId) {
        const source = objects.find((object) => object.id === relation.sourceObjectId);
        if (source) {
          linked.push({
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
        activityLogs,
        comments,
        approvals,
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
