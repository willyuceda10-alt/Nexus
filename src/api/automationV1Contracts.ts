export type ApiAutomationStatusV1 = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type ApiAutomationRunStatusV1 = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'WAITING_APPROVAL' | 'SKIPPED' | 'CANCELLED';
export type ApiAutomationApprovalStatusV1 = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ApiAutomationScalarV1 = string | number | boolean | null;
export type ApiAutomationValueV1 =
  | { kind: 'LITERAL'; value: ApiAutomationScalarV1 }
  | { kind: 'EVENT_PATH'; path: string };

export type ApiAutomationConditionV1 =
  | {
      kind: 'GROUP';
      operator: 'AND' | 'OR';
      conditions: ApiAutomationConditionV1[];
    }
  | {
      kind: 'PREDICATE';
      left: ApiAutomationValueV1;
      operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN' | 'NOT_IN' | 'CONTAINS' | 'EXISTS';
      right?: ApiAutomationValueV1;
    };

export type ApiAutomationActionV1 =
  | {
      type: 'EMIT_EVENT';
      eventType: string;
      aggregateId?: ApiAutomationValueV1;
      payload?: Record<string, ApiAutomationValueV1>;
    }
  | {
      type: 'CREATE_TASK';
      title: ApiAutomationValueV1;
      description?: ApiAutomationValueV1;
      projectId?: ApiAutomationValueV1;
      workspaceId?: ApiAutomationValueV1;
      assigneeId?: ApiAutomationValueV1;
      dueDate?: ApiAutomationValueV1;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    }
  | {
      type: 'REQUEST_APPROVAL';
      title: ApiAutomationValueV1;
      description?: ApiAutomationValueV1;
      approverUserId?: ApiAutomationValueV1;
    };

export interface ApiAutomationDefinitionV1 {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  name: string;
  description: string | null;
  status: ApiAutomationStatusV1;
  activeVersion: number | null;
  maxRunsPerHour: number;
  maxDepth: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiAutomationDefinitionV1Input {
  workspaceId?: string | null;
  projectId?: string | null;
  name: string;
  description?: string | null;
  maxRunsPerHour?: number;
  maxDepth?: number;
}

export interface PublishApiAutomationVersionV1Input {
  triggerEventType: string;
  condition?: ApiAutomationConditionV1 | null;
  actions: ApiAutomationActionV1[];
  changeNote?: string | null;
  activate?: boolean;
}

export interface ApiAutomationVersionV1 {
  id: string;
  definitionId: string;
  version: number;
  triggerEventType: string;
  condition: unknown;
  actions: unknown;
  changeNote: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface ApiAutomationRunV1 {
  id: string;
  definitionId: string;
  versionId: string;
  sourceEventId: string;
  sourceEventType: string;
  rootEventId: string;
  depth: number;
  status: ApiAutomationRunStatusV1;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface ApiAutomationApprovalV1 {
  id: string;
  runId: string;
  stepIndex: number;
  automationDefinitionId: string;
  approverUserId: string | null;
  title: string;
  description: string | null;
  status: ApiAutomationApprovalStatusV1;
  decisionByUserId: string | null;
  decisionComment: string | null;
  decidedAt: string | null;
  createdAt: string;
}
