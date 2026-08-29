export type ObjectType =
  | 'PORTFOLIO'
  | 'PROGRAM'
  | 'PROJECT'
  | 'RESOURCE'
  | 'MATERIAL'
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
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type ScheduleCalendarMode = 'CALENDAR_DAYS_V1' | 'WORKING_DAYS_V1';
export type ResourceKind = 'PERSON' | 'EQUIPMENT' | 'VENDOR';

export type ObjectStatus =
  | 'DRAFT'
  | 'PLANNING'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'IDENTIFIED'
  | 'MITIGATING'
  | 'REALIZED'
  | 'CLOSED'
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
  programIds?: string[];
}

export interface ObjectRelation {
  id: string;
  sourceObjectId: string;
  targetObjectId: string;
  relationType: 'BLOCKS' | 'DEPENDS_ON' | 'DERIVED_FROM' | 'RELATES_TO' | 'MITIGATES' | 'REQUIRES_APPROVAL';
  notes?: string;
  dependencyType?: DependencyType;
  lagDays?: number;
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
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  comment?: string;
  decidedAt?: string;
  requestedById?: string;
  requestedByName?: string;
  title?: string;
  description?: string;
  previousObjectStatus?: string;
  decisionById?: string;
  decisionByName?: string;
  decisionComment?: string;
  createdAt?: string;
}

export interface NexusObject {
  id: string;
  tenantId: string;
  workspaceId: string;
  objectDefinitionId?: string;
  version?: number;
  projectId?: string;
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
  progress: number;

  portfolioId?: string;
  programId?: string;
  code?: string;
  strategicObjective?: string;
  healthScore?: number;
  budgetTotal?: number;
  budgetSpent?: number;
  baselineStartDate?: string;
  baselineEndDate?: string;
  scheduleCalendarMode?: ScheduleCalendarMode;
  scheduleWorkingWeekdays?: number[];
  scheduleHolidays?: string[];

  // Scheduling / resource planning
  effortHours?: number;
  linkedUserId?: string;
  resourceKind?: ResourceKind;
  capacityHoursPerDay?: number;
  resourceWorkingWeekdays?: number[];
  resourceHolidays?: string[];
  skills?: string[];

  probability?: number;
  impact?: number;
  riskScore?: number;
  mitigationPlan?: string;
  isRealized?: boolean;

  meetingDate?: string;
  meetingAgenda?: string;
  meetingMinutes?: string;
  participants?: string[];

  decisionJustification?: string;
  decisionAuthorizerId?: string;
  meetingId?: string;

  costImpact?: number;
  timeImpactDays?: number;
  changeReason?: string;

  fileVersion?: string;
  fileSizeMb?: number;
  fileCategory?: string;

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
