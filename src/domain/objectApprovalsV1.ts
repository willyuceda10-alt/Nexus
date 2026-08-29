import type { ApiEligibleApproverV1, ApiObjectApprovalV1 } from '../api/objectApprovalsV1Contracts';
import type { ApprovalStep } from '../types/nexus';

export interface ApprovalCandidateV1 {
  id: string;
  name: string;
  email: string;
  avatar: string;
  tenantRole: string;
  workspaceRole: string | null;
}

function userName(user: { fullName: string; email: string } | null, fallback: string): string {
  return user?.fullName?.trim() || user?.email?.trim() || fallback;
}

export function mapApiObjectApprovalV1(value: ApiObjectApprovalV1): ApprovalStep {
  return {
    id: value.id,
    objectId: value.objectId,
    approverId: value.approverUserId,
    approverName: userName(value.approver, 'Aprobador'),
    approverRole: 'Aprobador',
    status: value.status,
    ...(value.description ? { comment: value.description } : {}),
    ...(value.decidedAt ? { decidedAt: value.decidedAt } : {}),
    requestedById: value.requestedByUserId,
    requestedByName: userName(value.requester, 'Solicitante'),
    title: value.title,
    ...(value.description ? { description: value.description } : {}),
    previousObjectStatus: value.previousObjectStatus,
    ...(value.decisionByUserId ? { decisionById: value.decisionByUserId } : {}),
    ...(value.decisionBy ? { decisionByName: userName(value.decisionBy, 'Usuario') } : {}),
    ...(value.decisionComment ? { decisionComment: value.decisionComment } : {}),
    createdAt: value.createdAt,
  };
}

export function mapEligibleApproverV1(value: ApiEligibleApproverV1): ApprovalCandidateV1 {
  return {
    id: value.id,
    name: value.fullName?.trim() || value.email,
    email: value.email,
    avatar: value.avatarUrl ?? '',
    tenantRole: value.tenantRole,
    workspaceRole: value.workspaceRole,
  };
}
