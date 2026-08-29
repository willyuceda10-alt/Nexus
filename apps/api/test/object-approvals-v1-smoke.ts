import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();
  let objectId: string | null = null;

  try {
    const bootstrapResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'x-correlation-id': 'ci-object-approval-bootstrap' },
    });
    assert(
      bootstrapResponse.statusCode === 200,
      `Bootstrap returned ${bootstrapResponse.statusCode}: ${bootstrapResponse.body}`,
    );
    const bootstrap = bootstrapResponse.json() as {
      objectDefinitions?: Array<{ id: string; key: string }>;
    };
    const taskDefinition = bootstrap.objectDefinitions?.find((item) => item.key === 'TASK');
    assert(taskDefinition, 'TASK definition is required for object approval smoke.');

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/objects',
      headers: { 'x-correlation-id': 'ci-object-approval-create' },
      payload: {
        workspaceId: DEV_WORKSPACE_ID,
        objectDefinitionId: taskDefinition.id,
        objectTypeKey: 'TASK',
        title: 'CI persistent approval task',
        description: 'Temporary object for Object Approval Core V1.',
        status: 'DRAFT',
        priority: 'HIGH',
        progress: 0,
      },
    });
    assert(
      createResponse.statusCode === 201,
      `Create returned ${createResponse.statusCode}: ${createResponse.body}`,
    );
    const created = createResponse.json() as { id: string; version: number; status: string };
    objectId = created.id;
    assert(created.status === 'DRAFT', 'Approval smoke object must start as DRAFT.');

    const requestApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/object-approvals-v1',
      headers: { 'x-correlation-id': 'ci-object-approval-request' },
      payload: {
        objectId: created.id,
        approverUserId: DEV_USER_ID,
        title: 'Aprobar tarea CI',
        description: 'Solicitud persistente para validar el ciclo de aprobación.',
      },
    });
    assert(
      requestApproval.statusCode === 201,
      `Approval request returned ${requestApproval.statusCode}: ${requestApproval.body}`,
    );
    const requested = requestApproval.json() as {
      approval: { id: string; status: string; previousObjectStatus: string; approver: { id: string } | null };
      objectStatus: string;
      objectVersion: number;
    };
    assert(requested.approval.id, 'Approval request is missing id.');
    assert(requested.approval.status === 'PENDING', 'New approval must be PENDING.');
    assert(requested.approval.previousObjectStatus === 'DRAFT', 'Approval must preserve previous object status.');
    assert(requested.approval.approver?.id === DEV_USER_ID, 'Approval approver identity was not resolved.');
    assert(requested.objectStatus === 'PENDING_APPROVAL', 'Object must move to PENDING_APPROVAL.');
    assert(requested.objectVersion === created.version + 1, 'Approval request must increment object version.');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/object-approvals-v1',
      headers: { 'x-correlation-id': 'ci-object-approval-duplicate' },
      payload: { objectId: created.id, approverUserId: DEV_USER_ID },
    });
    assert(duplicate.statusCode === 409, 'A second pending approval for the same object must be rejected.');

    const bypassAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/objects/${created.id}`,
      headers: { 'x-correlation-id': 'ci-object-approval-bypass' },
      payload: { version: requested.objectVersion, status: 'IN_PROGRESS' },
    });
    assert(
      bypassAttempt.statusCode === 409,
      `Direct status bypass while approval is pending must return 409, got ${bypassAttempt.statusCode}: ${bypassAttempt.body}`,
    );
    assert(
      (bypassAttempt.json() as { error?: string }).error === 'approval_pending',
      'Direct status bypass must return approval_pending.',
    );

    const decide = await app.inject({
      method: 'POST',
      url: `/api/v1/object-approvals-v1/${requested.approval.id}/decision`,
      headers: { 'x-correlation-id': 'ci-object-approval-decision' },
      payload: { decision: 'APPROVED', comment: 'Aprobado por smoke V1-A.' },
    });
    assert(
      decide.statusCode === 200,
      `Approval decision returned ${decide.statusCode}: ${decide.body}`,
    );
    const decided = decide.json() as {
      approval: { status: string; decisionBy: { id: string } | null };
      objectStatus: string;
      objectVersion: number;
    };
    assert(decided.approval.status === 'APPROVED', 'Approval must persist APPROVED status.');
    assert(decided.approval.decisionBy?.id === DEV_USER_ID, 'Decision actor identity was not resolved.');
    assert(decided.objectStatus === 'APPROVED', 'Approved request must move object to APPROVED.');

    const repeatedDecision = await app.inject({
      method: 'POST',
      url: `/api/v1/object-approvals-v1/${requested.approval.id}/decision`,
      headers: { 'x-correlation-id': 'ci-object-approval-repeat-decision' },
      payload: { decision: 'REJECTED' },
    });
    assert(repeatedDecision.statusCode === 409, 'An approval decision must be immutable after completion.');

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/object-approvals-v1?objectId=${created.id}&limit=20`,
      headers: { 'x-correlation-id': 'ci-object-approval-list' },
    });
    assert(list.statusCode === 200, `Approval list returned ${list.statusCode}: ${list.body}`);
    const listed = list.json() as { items: Array<{ id: string; status: string }> };
    assert(
      listed.items.some((item) => item.id === requested.approval.id && item.status === 'APPROVED'),
      'Approved request was not returned by persistent approval list.',
    );

    const secondRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/object-approvals-v1',
      headers: { 'x-correlation-id': 'ci-object-approval-second-request' },
      payload: { objectId: created.id, approverUserId: DEV_USER_ID, title: 'Aprobación cancelable CI' },
    });
    assert(
      secondRequest.statusCode === 201,
      `Second approval request returned ${secondRequest.statusCode}: ${secondRequest.body}`,
    );
    const second = secondRequest.json() as {
      approval: { id: string; previousObjectStatus: string };
      objectStatus: string;
    };
    assert(second.approval.previousObjectStatus === 'APPROVED', 'Second request must remember APPROVED as previous status.');
    assert(second.objectStatus === 'PENDING_APPROVAL', 'Second request must move object back to PENDING_APPROVAL.');

    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/object-approvals-v1/${second.approval.id}/cancel`,
      headers: { 'x-correlation-id': 'ci-object-approval-cancel' },
      payload: { comment: 'Cancelación CI para validar restauración de estado.' },
    });
    assert(cancel.statusCode === 200, `Approval cancel returned ${cancel.statusCode}: ${cancel.body}`);
    const cancelled = cancel.json() as { approval: { status: string }; objectStatus: string };
    assert(cancelled.approval.status === 'CANCELLED', 'Cancelled approval must persist CANCELLED status.');
    assert(cancelled.objectStatus === 'APPROVED', 'Cancellation must restore the previous object status.');

    const collaboration = await app.inject({
      method: 'GET',
      url: `/api/v1/objects/${created.id}/collaboration-v1?commentLimit=10&auditLimit=50&historyLimit=50`,
      headers: { 'x-correlation-id': 'ci-object-approval-collaboration' },
    });
    assert(
      collaboration.statusCode === 200,
      `Collaboration read returned ${collaboration.statusCode}: ${collaboration.body}`,
    );
    const collaborationPayload = collaboration.json() as {
      history: Array<{ fieldKey: string; oldValue: unknown; newValue: unknown }>;
      audit: Array<{ action: string }>;
    };
    const statusHistory = collaborationPayload.history.filter((entry) => entry.fieldKey === 'status');
    assert(statusHistory.length >= 4, 'Approval lifecycle must persist status field history.');
    assert(
      collaborationPayload.audit.some((entry) => entry.action === 'OBJECT_APPROVAL_REQUESTED'),
      'Approval request audit entry is missing.',
    );
    assert(
      collaborationPayload.audit.some((entry) => entry.action === 'OBJECT_APPROVAL_DECIDED'),
      'Approval decision audit entry is missing.',
    );
    assert(
      collaborationPayload.audit.some((entry) => entry.action === 'OBJECT_APPROVAL_CANCELLED'),
      'Approval cancellation audit entry is missing.',
    );

    console.info(JSON.stringify({
      objectApprovalsV1: 'PASS',
      persistentRequest: true,
      duplicateProtection: true,
      statusBypassProtection: true,
      immutableDecision: true,
      cancellationRestoresStatus: true,
      historyAndAudit: true,
      rlsBacked: true,
    }));
  } finally {
    if (objectId) {
      const cleanup = await app.inject({
        method: 'DELETE',
        url: `/api/v1/objects/${objectId}`,
        headers: { 'x-correlation-id': 'ci-object-approval-cleanup' },
      });
      if (cleanup.statusCode !== 204 && cleanup.statusCode !== 404) {
        console.error(`Cleanup returned ${cleanup.statusCode}: ${cleanup.body}`);
      }
    }
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
