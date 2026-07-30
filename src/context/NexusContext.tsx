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

  // Navigation & View States
  activeTab: string; // 'home' | 'project' | 'portfolios' | 'governance' | 'meetings' | 'documents' | 'reports' | 'settings' | 'timeline'
  setActiveTab: (tab: string) => void;
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
  projectActiveSubTab: string; // 'table' | 'kanban' | 'gantt' | 'timeline' | 'governance' | 'finance' | 'workload' | 'meetings'
  setProjectActiveSubTab: (subTab: string) => void;

  // Universal Peek View Drawer
  selectedObject: NexusObject | null;
  isDrawerOpen: boolean;
  openObjectDrawer: (objectId: string) => void;
  closeObjectDrawer: () => void;

  // Modals & Triggers
  isCreateModalOpen: boolean;
  createModalDefaultType: ObjectType;
  openCreateModal: (type?: ObjectType) => void;
  closeCreateModal: () => void;
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (open: boolean) => void;

  // CRUD & Business Engine Actions
  createNexusObject: (data: Partial<NexusObject>) => NexusObject;
  updateNexusObject: (id: string, updates: Partial<NexusObject>) => void;
  deleteNexusObject: (id: string) => void;
  addRelation: (sourceId: string, targetId: string, relationType: ObjectRelation['relationType'], notes?: string) => void;
  addComment: (objectId: string, content: string) => void;
  decideApproval: (approvalId: string, status: 'APPROVED' | 'REJECTED', comment?: string) => void;

  // Calculated Metrics
  getProjectHealth: (projectId: string) => ProjectHealthMetrics;
  getLinkedObjects: (objectId: string) => { object: NexusObject; relationType: string; notes?: string }[];
}

const NexusContext = createContext<NexusContextType | undefined>(undefined);

export const NexusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<Tenant>(mockTenant);
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

  // App Navigation
  const [activeTab, setActiveTab] = useState<string>('home');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>('prj-101');
  const [projectActiveSubTab, setProjectActiveSubTab] = useState<string>('table');

  // Peek Drawer State
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Modals & Command Palette
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createModalDefaultType, setCreateModalDefaultType] = useState<ObjectType>('TASK');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);

  // Current logged in user object
  const currentUser = useMemo(() => {
    return users.find((u) => u.id === currentUserId) || users[0];
  }, [users, currentUserId]);

  // Current active workspace object
  const currentWorkspace = useMemo(() => {
    if (!currentWorkspaceId) return null;
    return workspaces.find((w) => w.id === currentWorkspaceId) || null;
  }, [workspaces, currentWorkspaceId]);

  // Selected object for drawer
  const selectedObject = useMemo(() => {
    if (!selectedObjectId) return null;
    return objects.find((o) => o.id === selectedObjectId) || null;
  }, [objects, selectedObjectId]);

  // Command Palette Keyboard Listener (Ctrl + K / Cmd + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Universal Drawer Opener
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

  // Business Action: Create Object
  const createNexusObject = (data: Partial<NexusObject>): NexusObject => {
    const newId = `${data.type?.toLowerCase().slice(0, 3) || 'obj'}-${Date.now().toString().slice(-4)}`;
    const now = new Date().toISOString();

    const newObj: NexusObject = {
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

    setObjects((prev) => [newObj, ...prev]);

    // Record activity log
    const log: ActivityLog = {
      id: `act-${Date.now()}`,
      objectId: newId,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatar,
      action: `Creó el objeto (${newObj.type}) "${newObj.title}"`,
      newValue: newObj.status,
      timestamp: now,
    };
    setActivityLogs((prev) => [log, ...prev]);

    return newObj;
  };

  // Business Action: Update Object
  const updateNexusObject = (id: string, updates: Partial<NexusObject>) => {
    const now = new Date().toISOString();
    setObjects((prev) =>
      prev.map((obj) => {
        if (obj.id === id) {
          const updated = { ...obj, ...updates, updatedAt: now };

          // If status changed, record log
          if (updates.status && updates.status !== obj.status) {
            const log: ActivityLog = {
              id: `act-${Date.now()}`,
              objectId: id,
              userId: currentUser.id,
              userName: currentUser.name,
              userAvatar: currentUser.avatar,
              action: `Cambió estado a ${updates.status}`,
              oldValue: obj.status,
              newValue: updates.status,
              timestamp: now,
            };
            setActivityLogs((prevLogs) => [log, ...prevLogs]);
          }

          return updated;
        }
        return obj;
      })
    );
  };

  // Business Action: Delete Object
  const deleteNexusObject = (id: string) => {
    setObjects((prev) => prev.filter((o) => o.id !== id));
    if (selectedObjectId === id) {
      closeObjectDrawer();
    }
  };

  // Business Action: Add Relation
  const addRelation = (
    sourceObjectId: string,
    targetObjectId: string,
    relationType: ObjectRelation['relationType'],
    notes?: string
  ) => {
    const newRel: ObjectRelation = {
      id: `rel-${Date.now()}`,
      sourceObjectId,
      targetObjectId,
      relationType,
      notes,
    };
    setRelations((prev) => [...prev, newRel]);
  };

  // Business Action: Add Comment
  const addComment = (objectId: string, content: string) => {
    const newComment: Comment = {
      id: `cmt-${Date.now()}`,
      objectId,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatar,
      content,
      createdAt: new Date().toISOString(),
    };
    setComments((prev) => [newComment, ...prev]);
  };

  // Business Action: Approval Decision
  const decideApproval = (approvalId: string, status: 'APPROVED' | 'REJECTED', comment?: string) => {
    const now = new Date().toISOString();
    setApprovals((prev) =>
      prev.map((app) => {
        if (app.id === approvalId) {
          const updated = { ...app, status, comment, decidedAt: now };

          // Also update target object status if applicable
          if (app.objectId) {
            updateNexusObject(app.objectId, {
              status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
            });
          }
          return updated;
        }
        return app;
      })
    );
  };

  // Get Linked Objects Graph
  const getLinkedObjects = (objectId: string) => {
    const linked: { object: NexusObject; relationType: string; notes?: string }[] = [];

    relations.forEach((rel) => {
      if (rel.sourceObjectId === objectId) {
        const target = objects.find((o) => o.id === rel.targetObjectId);
        if (target) {
          linked.push({ object: target, relationType: rel.relationType, notes: rel.notes });
        }
      } else if (rel.targetObjectId === objectId) {
        const source = objects.find((o) => o.id === rel.sourceObjectId);
        if (source) {
          linked.push({ object: source, relationType: `INVERSE_${rel.relationType}`, notes: rel.notes });
        }
      }
    });

    return linked;
  };

  // Project Health Calculation Engine
  const getProjectHealth = (projectId: string): ProjectHealthMetrics => {
    const proj = objects.find((o) => o.id === projectId);
    const projObjects = objects.filter((o) => o.projectId === projectId);

    const tasks = projObjects.filter((o) => o.type === 'TASK' || o.type === 'DELIVERABLE' || o.type === 'MILESTONE');
    const risks = projObjects.filter((o) => o.type === 'RISK');

    // Progress & schedule variance
    const progressAvg = tasks.length ? tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length : proj?.progress || 0;
    const scheduleScore = Math.min(100, Math.round(progressAvg * 1.1));

    // Budget Score
    const budgetTotal = proj?.budgetTotal || 1;
    const budgetSpent = proj?.budgetSpent || 0;
    const budgetBurnPercentage = Math.round((budgetSpent / budgetTotal) * 100);
    const budgetScore = Math.max(0, 100 - (budgetBurnPercentage > 85 ? (budgetBurnPercentage - 85) * 3 : 0));

    // Risk Score
    const criticalRisks = risks.filter((r) => (r.riskScore || 0) >= 15 && !r.isRealized);
    const riskScore = Math.max(0, 100 - criticalRisks.length * 15);

    // Health Score Formula
    const healthScore = Math.round(
      0.35 * scheduleScore + 0.25 * budgetScore + 0.2 * riskScore + 0.2 * 90
    );

    return {
      healthScore,
      scheduleScore,
      budgetScore,
      riskScore,
      teamScore: 92,
      overdueTasksCount: tasks.filter((t) => t.status === 'BLOCKED').length,
      criticalRisksCount: criticalRisks.length,
      budgetBurnPercentage,
    };
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
