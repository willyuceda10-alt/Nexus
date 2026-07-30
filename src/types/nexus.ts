export type ObjectType =
  | 'PROJECT'
  | 'TASK'
  | 'RISK'
  | 'DOCUMENT'
  | 'MEETING'
  | 'DECISION'
  | 'CHANGE_REQUEST'
  | 'DELIVERABLE'
  | 'MILESTONE'
  | 'INCIDENT';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ObjectStatus =
  // Project & Task statuses
  | 'DRAFT'
  | 'PLANNING'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  // Risk statuses
  | 'IDENTIFIED'
  | 'MITIGATING'
  | 'REALIZED'
  | 'CLOSED'
  // Approval / Document / Change statuses
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

export type UserRoleKey = 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'PROJECT_MANAGER' | 'MEMBER' | 'CLIENT';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  roleKey: UserRoleKey;
  roleName: string;
  department: string;
  tenantId: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'Enterprise' | 'Business' | 'Pro';
  currency: string;
  timezone: string;
  locale: string;
  logo?: string;
}

export interface Workspace {
  id: string;
  tenantId: string;
  organizationName: string;
  name: string;
  description: string;
  membersCount: number;
}

export interface Portfolio {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string;
  strategicObjective: string;
  budgetAllocated: number;
  budgetSpent: number;
  projectIds: string[];
}

export interface ObjectRelation {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationType: 'BLOCKS' | 'DEPENDS_ON' | 'DERIVED_FROM' | 'RELATES_TO' | 'MITIGATES' | 'REQUIRES_APPROVAL';
  notes?: string;
}

export interface ActivityLog {
  id: string;
  objectId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  action: string;
  oldValue?: string;
  newValue?: string;
  timestamp: string;
}

export interface Comment {
  id: string;
  objectId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  content: string;
  createdAt: string;
  attachments?: string[];
}

export interface ApprovalStep {
  id: string;
  objectId: string;
  approverId: string;
  approverName: string;
  approverRole: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  comment?: string;
  decidedAt?: string;
}

export interface NexusObject {
  id: string;
  tenantId: string;
  workspaceId: string;
  projectId?: string; // Optional if this object is itself a project or portfolio-level
  type: ObjectType;
  title: string;
  description: string;
  status: ObjectStatus;
  priority: Priority;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
  assigneeId?: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
  progress: number; // 0 - 100

  // Specialized extensions (stored dynamically depending on type)
  // Project specific
  portfolioId?: string;
  healthScore?: number; // 0 - 100
  budgetTotal?: number;
  budgetSpent?: number;
  baselineStartDate?: string;
  baselineEndDate?: string;
  
  // Risk specific
  probability?: number; // 1-5
  impact?: number; // 1-5
  riskScore?: number; // prob * impact (1-25)
  mitigationPlan?: string;
  isRealized?: boolean;

  // Meeting specific
  meetingDate?: string;
  meetingAgenda?: string;
  meetingMinutes?: string;
  participants?: string[];

  // Decision specific
  decisionJustification?: string;
  decisionAuthorizerId?: string;
  meetingId?: string;

  // Change Request specific
  costImpact?: number;
  timeImpactDays?: number;
  changeReason?: string;

  // Document specific
  fileVersion?: string;
  fileSizeMb?: number;
  fileCategory?: string;

  // Custom metadata fields
  customFields?: Record<string, any>;
}

export interface ProjectHealthMetrics {
  healthScore: number;
  scheduleScore: number;
  budgetScore: number;
  riskScore: number;
  teamScore: number;
  overdueTasksCount: number;
  criticalRisksCount: number;
  budgetBurnPercentage: number;
}
