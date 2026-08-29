import { mapApiObjectApprovalV1, mapEligibleApproverV1 } from './objectApprovalsV1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const mapped = mapApiObjectApprovalV1({
  id: 'approval-1',
  objectId: 'object-1',
  requestedByUserId: 'requester-1',
  approverUserId: 'approver-1',
  title: 'Aprobar cambio',
  description: 'Validación ejecutiva',
  previousObjectStatus: 'IN_REVIEW',
  status: 'APPROVED',
  decisionByUserId: 'approver-1',
  decisionComment: 'Conforme',
  decidedAt: '2026-08-29T17:00:00.000Z',
  createdAt: '2026-08-29T16:00:00.000Z',
  updatedAt: '2026-08-29T17:00:00.000Z',
  requester: {
    id: 'requester-1',
    fullName: 'Solicitante Demo',
    email: 'solicitante@example.com',
    avatarUrl: null,
  },
  approver: {
    id: 'approver-1',
    fullName: 'Aprobador Demo',
    email: 'aprobador@example.com',
    avatarUrl: 'https://example.com/avatar.png',
  },
  decisionBy: {
    id: 'approver-1',
    fullName: 'Aprobador Demo',
    email: 'aprobador@example.com',
    avatarUrl: 'https://example.com/avatar.png',
  },
});

assert(mapped.objectId === 'object-1', 'Approval object mapping failed.');
assert(mapped.approverId === 'approver-1', 'Approval approver mapping failed.');
assert(mapped.requestedById === 'requester-1', 'Approval requester mapping failed.');
assert(mapped.status === 'APPROVED', 'Approval status mapping failed.');
assert(mapped.decisionComment === 'Conforme', 'Approval decision comment mapping failed.');
assert(mapped.previousObjectStatus === 'IN_REVIEW', 'Previous object status mapping failed.');

const candidate = mapEligibleApproverV1({
  id: 'approver-2',
  fullName: 'Aprobador Dos',
  email: 'aprobador2@example.com',
  avatarUrl: null,
  tenantRole: 'MEMBER',
  workspaceRole: 'MANAGER',
});

assert(candidate.name === 'Aprobador Dos', 'Eligible approver name mapping failed.');
assert(candidate.workspaceRole === 'MANAGER', 'Eligible approver workspace role mapping failed.');

console.info(JSON.stringify({
  objectApprovalsV1Frontend: 'PASS',
  persistentApprovalMapping: true,
  requesterAndApproverResolution: true,
  decisionMetadataMapping: true,
  eligibleApproverMapping: true,
}));
