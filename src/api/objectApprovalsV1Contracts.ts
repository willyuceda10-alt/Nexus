export type ApiObjectApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ApiApprovalUserSummaryV1 {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
}

export interface ApiObjectApprovalV1 {
  id: string;
  objectId: string;
  requestedByUserId: string;
  approverUserId: string;
  title: string;
  description: string | null;
  previousObjectStatus: string;
  status: ApiObjectApprovalStatus;
  decisionByUserId: string | null;
  decisionComment: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: ApiApprovalUserSummaryV1 | null;
  approver: ApiApprovalUserSummaryV1 | null;
  decisionBy: ApiApprovalUserSummaryV1 | null;
}

export interface ApiObjectApprovalListV1 {
  objectId: string;
  items: ApiObjectApprovalV1[];
}

export interface ApiEligibleApproverV1 extends ApiApprovalUserSummaryV1 {
  tenantRole: string;
  workspaceRole: string | null;
}

export interface ApiEligibleApproversResponseV1 {
  objectId: string;
  items: ApiEligibleApproverV1[];
}

export interface CreateObjectApprovalV1Input {
  objectId: string;
  approverUserId: string;
  title?: string;
  description?: string | null;
}

export interface DecideObjectApprovalV1Input {
  decision: 'APPROVED' | 'REJECTED';
  comment?: string | null;
}

export interface CancelObjectApprovalV1Input {
  comment?: string | null;
}

export interface ObjectApprovalMutationResponseV1 {
  kind?: 'created' | 'decided' | 'cancelled';
  approval: ApiObjectApprovalV1;
  objectStatus: string;
  objectVersion: number;
}
