import { Prisma } from '@prisma/client';
import type { ActorContext } from './auth.js';
import { authorizePermission } from './authorization.js';
import { withTenant } from './tenant-transaction.js';
import {
  automationRecursionBlockedV1,
  automationTraceFromEventV1,
  evaluateAutomationConditionV1,
  nextAutomationTraceV1,
  resolvedActionScalarV1,
  type AutomationActionV1,
  type AutomationConditionV1,
  type AutomationEventEnvelopeV1,
} from './domain/automation-engine-v1.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RUN_ATTEMPTS = 3;

type DefinitionRow = {
  id: string;
  workspace_id: string | null;
  project_object_id: string | null;
  name: string;
  active_version: number;
  max_runs_per_hour: number;
  max_depth: number;
  created_by_user_id: string;
};

type VersionRow = {
  id: string;
  definition_id: string;
  version: number;
  trigger_event_type: string;
  condition_dsl: Prisma.JsonValue | null;
  actions: Prisma.JsonValue;
};

type RunRow = {
  id: string;
  definition_id: string;
  version_id: string;
  source_event_id: string;
  source_event_type: string;
  root_event_id: string;
  depth: number;
  status: string;
  attempts: number;
  context_json: Prisma.JsonValue;
};

type StepRow = {
  id: string;
  run_id: string;
  step_index: number;
  action_type: string;
  status: string;
  attempts: number;
};

export interface AutomationEventProcessingResultV1 {
  matched: number;
  succeeded: number;
  waitingApproval: number;
  skipped: number;
  failed: number;
  retryableFailure: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function commonPayloadProjectId(event: AutomationEventEnvelopeV1): string | null {
  const payload = record(event.payload);
  return stringValue(payload.projectId) ?? stringValue(payload.projectObjectId);
}

function commonPayloadWorkspaceId(event: AutomationEventEnvelopeV1): string | null {
  return stringValue(record(event.payload).workspaceId);
}

async function automationOwnerActor(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  tenantId: string,
): Promise<ActorContext> {
  const membership = await tx.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId: definition.created_by_user_id } },
    include: { user: { select: { email: true, fullName: true, isActive: true } } },
  });
  if (!membership || membership.status !== 'ACTIVE' || !membership.user.isActive) {
    throw new Error('Automation owner is no longer an active tenant member.');
  }
  return {
    tenantId,
    userId: definition.created_by_user_id,
    membershipId: membership.id,
    role: membership.role,
    email: membership.user.email,
    name: membership.user.fullName,
  };
}

async function definitionScopeMatches(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  event: AutomationEventEnvelopeV1,
): Promise<boolean> {
  if (!definition.workspace_id && !definition.project_object_id) return true;

  const directProjectId = commonPayloadProjectId(event);
  const directWorkspaceId = commonPayloadWorkspaceId(event);
  if (definition.project_object_id && directProjectId === definition.project_object_id) return true;
  if (!definition.project_object_id && definition.workspace_id && directWorkspaceId === definition.workspace_id) return true;
  if (definition.project_object_id && event.aggregateId === definition.project_object_id) return true;

  const aggregate = await tx.nexusObject.findFirst({
    where: { id: event.aggregateId, tenantId: event.tenantId, deletedAt: null },
    select: { workspaceId: true, objectTypeKey: true, metadata: true },
  });
  if (!aggregate) return false;

  if (!definition.project_object_id) return aggregate.workspaceId === definition.workspace_id;
  if (aggregate.objectTypeKey === 'PROJECT') return event.aggregateId === definition.project_object_id;
  const metadata = record(aggregate.metadata);
  return stringValue(metadata.projectId) === definition.project_object_id;
}

async function activeAutomationsForEvent(
  tx: Prisma.TransactionClient,
  event: AutomationEventEnvelopeV1,
): Promise<Array<{ definition: DefinitionRow; version: VersionRow }>> {
  const rows = await tx.$queryRaw<Array<DefinitionRow & {
    version_id: string;
    version_number: number;
    trigger_event_type: string;
    condition_dsl: Prisma.JsonValue | null;
    actions: Prisma.JsonValue;
  }>>(Prisma.sql`
    SELECT d.id, d.workspace_id, d.project_object_id, d.name, d.active_version,
           d.max_runs_per_hour, d.max_depth, d.created_by_user_id,
           v.id AS version_id, v.version AS version_number, v.trigger_event_type,
           v.condition_dsl, v.actions
    FROM automation_definitions_v1 d
    JOIN automation_versions_v1 v
      ON v.tenant_id = d.tenant_id AND v.definition_id = d.id AND v.version = d.active_version
    WHERE d.tenant_id = ${event.tenantId}::uuid
      AND d.status = 'ACTIVE'
      AND v.trigger_event_type = ${event.eventType}
    ORDER BY d.id
  `);

  const result: Array<{ definition: DefinitionRow; version: VersionRow }> = [];
  for (const row of rows) {
    const definition: DefinitionRow = {
      id: row.id,
      workspace_id: row.workspace_id,
      project_object_id: row.project_object_id,
      name: row.name,
      active_version: row.active_version,
      max_runs_per_hour: row.max_runs_per_hour,
      max_depth: row.max_depth,
      created_by_user_id: row.created_by_user_id,
    };
    if (!(await definitionScopeMatches(tx, definition, event))) continue;
    result.push({
      definition,
      version: {
        id: row.version_id,
        definition_id: row.id,
        version: row.version_number,
        trigger_event_type: row.trigger_event_type,
        condition_dsl: row.condition_dsl,
        actions: row.actions,
      },
    });
  }
  return result;
}

async function ensureRun(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  version: VersionRow,
  event: AutomationEventEnvelopeV1,
): Promise<{ run: RunRow; created: boolean }> {
  const trace = automationTraceFromEventV1(event);
  const rootEventId = UUID_RE.test(trace.rootEventId) ? trace.rootEventId : event.eventId;
  const safeDepth = Math.min(10, Math.max(0, trace.depth));
  const rows = await tx.$queryRaw<RunRow[]>(Prisma.sql`
    INSERT INTO automation_runs_v1
      (tenant_id, definition_id, version_id, source_event_id, source_event_type,
       root_event_id, depth, status, attempts, context_json)
    VALUES
      (${event.tenantId}::uuid, ${definition.id}::uuid, ${version.id}::uuid,
       ${event.eventId}::uuid, ${event.eventType}, ${rootEventId}::uuid,
       ${safeDepth}, 'RUNNING', 1, ${JSON.stringify(event)}::jsonb)
    ON CONFLICT (definition_id, source_event_id) DO NOTHING
    RETURNING id, definition_id, version_id, source_event_id, source_event_type,
              root_event_id, depth, status, attempts, context_json
  `);
  if (rows[0]) return { run: rows[0], created: true };

  const existing = await tx.$queryRaw<RunRow[]>(Prisma.sql`
    SELECT id, definition_id, version_id, source_event_id, source_event_type,
           root_event_id, depth, status, attempts, context_json
    FROM automation_runs_v1
    WHERE tenant_id = ${event.tenantId}::uuid
      AND definition_id = ${definition.id}::uuid
      AND source_event_id = ${event.eventId}::uuid
    FOR UPDATE
  `);
  const run = existing[0];
  if (!run) throw new Error('Automation run idempotency conflict could not be resolved.');
  if (run.status === 'FAILED' && run.attempts < MAX_RUN_ATTEMPTS) {
    const retried = await tx.$queryRaw<RunRow[]>(Prisma.sql`
      UPDATE automation_runs_v1
      SET status = 'RUNNING', attempts = attempts + 1, last_error = NULL,
          started_at = CURRENT_TIMESTAMP, finished_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${run.id}::uuid
      RETURNING id, definition_id, version_id, source_event_id, source_event_type,
                root_event_id, depth, status, attempts, context_json
    `);
    return { run: retried[0]!, created: false };
  }
  return { run, created: false };
}

async function markRun(
  tx: Prisma.TransactionClient,
  tenantId: string,
  runId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'WAITING_APPROVAL' | 'SKIPPED' | 'CANCELLED',
  error?: string | null,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE automation_runs_v1
    SET status = ${status},
        finished_at = CASE WHEN ${status} IN ('SUCCEEDED','FAILED','SKIPPED','CANCELLED') THEN CURRENT_TIMESTAMP ELSE NULL END,
        last_error = ${error ?? null}, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId}::uuid AND id = ${runId}::uuid
  `);
}

async function stepByIndex(
  tx: Prisma.TransactionClient,
  tenantId: string,
  runId: string,
  stepIndex: number,
): Promise<StepRow | null> {
  const rows = await tx.$queryRaw<StepRow[]>(Prisma.sql`
    SELECT id, run_id, step_index, action_type, status, attempts
    FROM automation_step_runs_v1
    WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid AND step_index = ${stepIndex}
    FOR UPDATE
  `);
  return rows[0] ?? null;
}

async function beginStep(
  tx: Prisma.TransactionClient,
  tenantId: string,
  runId: string,
  stepIndex: number,
  action: AutomationActionV1,
): Promise<StepRow> {
  const existing = await stepByIndex(tx, tenantId, runId, stepIndex);
  if (existing) {
    if (existing.status === 'FAILED') {
      const rows = await tx.$queryRaw<StepRow[]>(Prisma.sql`
        UPDATE automation_step_runs_v1
        SET status = 'RUNNING', attempts = attempts + 1, started_at = CURRENT_TIMESTAMP,
            finished_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND id = ${existing.id}::uuid
        RETURNING id, run_id, step_index, action_type, status, attempts
      `);
      return rows[0]!;
    }
    return existing;
  }

  const rows = await tx.$queryRaw<StepRow[]>(Prisma.sql`
    INSERT INTO automation_step_runs_v1
      (tenant_id, run_id, step_index, action_type, status, attempts, input_json)
    VALUES (${tenantId}::uuid, ${runId}::uuid, ${stepIndex}, ${action.type}, 'RUNNING', 1,
            ${JSON.stringify(action)}::jsonb)
    RETURNING id, run_id, step_index, action_type, status, attempts
  `);
  return rows[0]!;
}

async function completeStep(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stepId: string,
  output: unknown,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE automation_step_runs_v1
    SET status = 'SUCCEEDED', output_json = ${JSON.stringify(output ?? null)}::jsonb,
        finished_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId}::uuid AND id = ${stepId}::uuid
  `);
}

async function failStep(
  tx: Prisma.TransactionClient,
  tenantId: string,
  stepId: string,
  error: unknown,
): Promise<string> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
  await tx.$executeRaw(Prisma.sql`
    UPDATE automation_step_runs_v1
    SET status = 'FAILED', last_error = ${message}, finished_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId}::uuid AND id = ${stepId}::uuid
  `);
  return message;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} resolved to an empty or non-string value.`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function executeEmitEvent(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  run: RunRow,
  stepIndex: number,
  action: Extract<AutomationActionV1, { type: 'EMIT_EVENT' }>,
  event: AutomationEventEnvelopeV1,
): Promise<{ eventId: string }> {
  await automationOwnerActor(tx, definition, event.tenantId);
  const aggregateId = optionalString(resolvedActionScalarV1(action.aggregateId, event)) ?? event.aggregateId;
  if (!UUID_RE.test(aggregateId)) throw new Error('EMIT_EVENT aggregateId must resolve to a UUID.');
  const trace = nextAutomationTraceV1(automationTraceFromEventV1(event), definition.id);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(action.payload ?? {})) {
    payload[key] = resolvedActionScalarV1(value, event) ?? null;
  }
  payload._automation = trace;
  const created = await tx.domainEvent.create({
    data: {
      tenantId: event.tenantId,
      aggregateId,
      eventType: action.eventType,
      idempotencyKey: `automation:${run.id}:step:${stepIndex}:emit`,
      payload: payload as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { eventId: created.id };
}

async function executeCreateTask(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  run: RunRow,
  stepIndex: number,
  action: Extract<AutomationActionV1, { type: 'CREATE_TASK' }>,
  event: AutomationEventEnvelopeV1,
): Promise<{ objectId: string }> {
  const title = requiredString(resolvedActionScalarV1(action.title, event), 'CREATE_TASK title');
  const description = optionalString(resolvedActionScalarV1(action.description, event));
  const projectId = optionalString(resolvedActionScalarV1(action.projectId, event))
    ?? definition.project_object_id
    ?? commonPayloadProjectId(event);
  if (!projectId || !UUID_RE.test(projectId)) throw new Error('CREATE_TASK requires a project UUID.');

  const project = await tx.nexusObject.findFirst({
    where: { id: projectId, tenantId: event.tenantId, objectTypeKey: 'PROJECT', deletedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!project) throw new Error('CREATE_TASK project does not exist in the tenant.');
  if (definition.workspace_id && project.workspaceId !== definition.workspace_id) {
    throw new Error('CREATE_TASK cannot escape the automation workspace scope.');
  }
  if (definition.project_object_id && project.id !== definition.project_object_id) {
    throw new Error('CREATE_TASK cannot escape the automation project scope.');
  }

  const owner = await automationOwnerActor(tx, definition, event.tenantId);
  const taskPermission = await authorizePermission(tx, owner, 'project.manage', { projectId });
  if (!taskPermission.allowed) {
    throw new Error('Automation owner no longer has project.manage permission for CREATE_TASK.');
  }

  const requestedWorkspaceId = optionalString(resolvedActionScalarV1(action.workspaceId, event));
  if (requestedWorkspaceId && requestedWorkspaceId !== project.workspaceId) {
    throw new Error('CREATE_TASK workspace does not match the project workspace.');
  }

  const objectDefinition = await tx.objectDefinition.findUnique({
    where: { tenantId_key: { tenantId: event.tenantId, key: 'TASK' } },
    select: { id: true },
  });
  if (!objectDefinition) throw new Error('TASK object definition is not configured.');

  const assigneeId = optionalString(resolvedActionScalarV1(action.assigneeId, event));
  if (assigneeId) {
    if (!UUID_RE.test(assigneeId)) throw new Error('CREATE_TASK assigneeId must resolve to a UUID.');
    const assignee = await tx.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: event.tenantId, userId: assigneeId } },
      select: { status: true },
    });
    if (!assignee || assignee.status !== 'ACTIVE') throw new Error('CREATE_TASK assignee is not an active tenant member.');
  }

  const dueRaw = optionalString(resolvedActionScalarV1(action.dueDate, event));
  const dueDate = dueRaw ? new Date(dueRaw) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) throw new Error('CREATE_TASK dueDate is invalid.');

  const created = await tx.nexusObject.create({
    data: {
      tenantId: event.tenantId,
      workspaceId: project.workspaceId,
      objectDefinitionId: objectDefinition.id,
      objectTypeKey: 'TASK',
      title,
      description,
      status: 'DRAFT',
      priority: action.priority ?? 'MEDIUM',
      progress: 0,
      ownerId: owner.userId,
      assigneeId,
      dueDate,
      metadata: {
        projectId,
        automationRunId: run.id,
        automationStepIndex: stepIndex,
      },
    },
    select: { id: true },
  });

  await Promise.all([
    tx.domainEvent.create({
      data: {
        tenantId: event.tenantId,
        aggregateId: created.id,
        eventType: 'bridata.object.created',
        idempotencyKey: `automation:${run.id}:step:${stepIndex}:task-event`,
        payload: {
          objectId: created.id,
          objectTypeKey: 'TASK',
          workspaceId: project.workspaceId,
          projectId,
          automationRunId: run.id,
          _automation: nextAutomationTraceV1(automationTraceFromEventV1(event), definition.id),
        },
      },
    }),
    tx.auditLog.create({
      data: {
        tenantId: event.tenantId,
        userId: owner.userId,
        action: 'AUTOMATION_TASK_CREATED',
        resource: 'NEXUS_OBJECT',
        resourceId: created.id,
        details: { automationId: definition.id, runId: run.id, stepIndex, projectId },
      },
    }),
  ]);
  return { objectId: created.id };
}

async function executeRequestApproval(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  run: RunRow,
  step: StepRow,
  action: Extract<AutomationActionV1, { type: 'REQUEST_APPROVAL' }>,
  event: AutomationEventEnvelopeV1,
): Promise<'WAITING_APPROVAL' | 'APPROVED' | 'REJECTED'> {
  await automationOwnerActor(tx, definition, event.tenantId);
  const existing = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT status FROM automation_approval_requests_v1
    WHERE tenant_id = ${event.tenantId}::uuid AND run_id = ${run.id}::uuid AND step_index = ${step.step_index}
  `);
  if (existing[0]?.status === 'APPROVED') return 'APPROVED';
  if (existing[0]?.status === 'REJECTED') return 'REJECTED';
  if (existing[0]?.status === 'PENDING') return 'WAITING_APPROVAL';

  const title = requiredString(resolvedActionScalarV1(action.title, event), 'REQUEST_APPROVAL title');
  const description = optionalString(resolvedActionScalarV1(action.description, event));
  const approverUserId = optionalString(resolvedActionScalarV1(action.approverUserId, event));
  if (approverUserId && !UUID_RE.test(approverUserId)) throw new Error('REQUEST_APPROVAL approverUserId must be a UUID.');

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO automation_approval_requests_v1
      (tenant_id, run_id, step_index, automation_definition_id, approver_user_id, title, description, status)
    VALUES
      (${event.tenantId}::uuid, ${run.id}::uuid, ${step.step_index}, ${definition.id}::uuid,
       ${approverUserId}::uuid, ${title}, ${description}, 'PENDING')
    ON CONFLICT (run_id, step_index) DO NOTHING
  `);
  await tx.$executeRaw(Prisma.sql`
    UPDATE automation_step_runs_v1
    SET status = 'WAITING_APPROVAL', updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${event.tenantId}::uuid AND id = ${step.id}::uuid
  `);
  return 'WAITING_APPROVAL';
}

async function executeRunActions(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  version: VersionRow,
  run: RunRow,
  event: AutomationEventEnvelopeV1,
): Promise<'SUCCEEDED' | 'WAITING_APPROVAL' | 'CANCELLED'> {
  const actions = version.actions as unknown as AutomationActionV1[];
  for (let stepIndex = 0; stepIndex < actions.length; stepIndex += 1) {
    const action = actions[stepIndex]!;
    const step = await beginStep(tx, event.tenantId, run.id, stepIndex, action);
    if (step.status === 'SUCCEEDED') continue;

    if (step.status === 'WAITING_APPROVAL') {
      if (action.type !== 'REQUEST_APPROVAL') {
        throw new Error(`Step ${stepIndex} is WAITING_APPROVAL but action type is ${action.type}.`);
      }
      const approval = await executeRequestApproval(tx, definition, run, step, action, event);
      if (approval === 'WAITING_APPROVAL') return 'WAITING_APPROVAL';
      if (approval === 'REJECTED') return 'CANCELLED';
      await completeStep(tx, event.tenantId, step.id, { approval: 'APPROVED' });
      continue;
    }

    try {
      if (action.type === 'EMIT_EVENT') {
        await completeStep(tx, event.tenantId, step.id, await executeEmitEvent(tx, definition, run, stepIndex, action, event));
      } else if (action.type === 'CREATE_TASK') {
        await completeStep(tx, event.tenantId, step.id, await executeCreateTask(tx, definition, run, stepIndex, action, event));
      } else {
        const approval = await executeRequestApproval(tx, definition, run, step, action, event);
        if (approval === 'WAITING_APPROVAL') return 'WAITING_APPROVAL';
        if (approval === 'REJECTED') return 'CANCELLED';
        await completeStep(tx, event.tenantId, step.id, { approval: 'APPROVED' });
      }
    } catch (error) {
      const message = await failStep(tx, event.tenantId, step.id, error);
      throw new Error(message);
    }
  }
  return 'SUCCEEDED';
}

async function processOneAutomation(
  tx: Prisma.TransactionClient,
  definition: DefinitionRow,
  version: VersionRow,
  event: AutomationEventEnvelopeV1,
): Promise<'SUCCEEDED' | 'WAITING_APPROVAL' | 'SKIPPED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL'> {
  const ensured = await ensureRun(tx, definition, version, event);
  const run = ensured.run;
  if (!ensured.created && ['SUCCEEDED', 'SKIPPED', 'CANCELLED', 'WAITING_APPROVAL'].includes(run.status)) {
    if (run.status === 'WAITING_APPROVAL') return 'WAITING_APPROVAL';
    return run.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'SKIPPED';
  }
  if (!ensured.created && run.status === 'FAILED' && run.attempts >= MAX_RUN_ATTEMPTS) return 'FAILED_TERMINAL';

  const trace = automationTraceFromEventV1(event);
  if (automationRecursionBlockedV1({ trace, automationDefinitionId: definition.id, maxDepth: definition.max_depth })) {
    await markRun(tx, event.tenantId, run.id, 'SKIPPED', 'Recursion or maximum automation depth blocked this run.');
    return 'SKIPPED';
  }

  const rateRows = await tx.$queryRaw<Array<{ count: bigint | number | string }>>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM automation_runs_v1
    WHERE tenant_id = ${event.tenantId}::uuid
      AND definition_id = ${definition.id}::uuid
      AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
      AND id <> ${run.id}::uuid
  `);
  if (Number(rateRows[0]?.count ?? 0) >= definition.max_runs_per_hour) {
    await markRun(tx, event.tenantId, run.id, 'SKIPPED', 'Automation hourly run quota exceeded.');
    return 'SKIPPED';
  }

  const condition = version.condition_dsl as unknown as AutomationConditionV1 | null;
  if (!evaluateAutomationConditionV1(condition, event)) {
    await markRun(tx, event.tenantId, run.id, 'SKIPPED', null);
    return 'SKIPPED';
  }

  try {
    const result = await executeRunActions(tx, definition, version, run, event);
    await markRun(tx, event.tenantId, run.id, result, null);
    return result === 'CANCELLED' ? 'SKIPPED' : result;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
    await markRun(tx, event.tenantId, run.id, 'FAILED', message);
    return run.attempts < MAX_RUN_ATTEMPTS ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
  }
}

export async function processAutomationEventV1(event: AutomationEventEnvelopeV1): Promise<AutomationEventProcessingResultV1> {
  if (!UUID_RE.test(event.eventId) || !UUID_RE.test(event.tenantId) || !UUID_RE.test(event.aggregateId)) {
    throw new Error('Automation event envelope contains an invalid UUID.');
  }

  return withTenant(event.tenantId, async (tx) => {
    const candidates = await activeAutomationsForEvent(tx, event);
    const summary: AutomationEventProcessingResultV1 = {
      matched: candidates.length,
      succeeded: 0,
      waitingApproval: 0,
      skipped: 0,
      failed: 0,
      retryableFailure: false,
    };

    for (const candidate of candidates) {
      const result = await processOneAutomation(tx, candidate.definition, candidate.version, event);
      if (result === 'SUCCEEDED') summary.succeeded += 1;
      else if (result === 'WAITING_APPROVAL') summary.waitingApproval += 1;
      else if (result === 'SKIPPED') summary.skipped += 1;
      else {
        summary.failed += 1;
        if (result === 'FAILED_RETRYABLE') summary.retryableFailure = true;
      }
    }
    return summary;
  });
}

export async function resumeAutomationApprovalRunV1(event: AutomationEventEnvelopeV1): Promise<boolean> {
  if (event.eventType !== 'bridata.automation.approval.resolved') return false;
  const payload = record(event.payload);
  const runId = stringValue(payload.runId);
  const decision = stringValue(payload.decision);
  if (!runId || !UUID_RE.test(runId) || !['APPROVED', 'REJECTED'].includes(decision ?? '')) return true;

  await withTenant(event.tenantId, async (tx) => {
    const runs = await tx.$queryRaw<RunRow[]>(Prisma.sql`
      SELECT id, definition_id, version_id, source_event_id, source_event_type, root_event_id,
             depth, status, attempts, context_json
      FROM automation_runs_v1
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${runId}::uuid
      FOR UPDATE
    `);
    let run = runs[0];
    if (!run || !['WAITING_APPROVAL', 'FAILED'].includes(run.status)) return;
    if (decision === 'REJECTED') {
      await markRun(tx, event.tenantId, run.id, 'CANCELLED', 'Human approval rejected.');
      return;
    }
    if (run.status === 'FAILED' && run.attempts >= MAX_RUN_ATTEMPTS) return;

    const definitions = await tx.$queryRaw<DefinitionRow[]>(Prisma.sql`
      SELECT id, workspace_id, project_object_id, name, active_version, max_runs_per_hour,
             max_depth, created_by_user_id
      FROM automation_definitions_v1
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${run.definition_id}::uuid
    `);
    const versions = await tx.$queryRaw<VersionRow[]>(Prisma.sql`
      SELECT id, definition_id, version, trigger_event_type, condition_dsl, actions
      FROM automation_versions_v1
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${run.version_id}::uuid
    `);
    const definition = definitions[0];
    const version = versions[0];
    if (!definition || !version) {
      await markRun(tx, event.tenantId, run.id, 'FAILED', 'Automation definition/version missing during approval resume.');
      return;
    }

    const incrementAttempt = run.status === 'FAILED';
    const updated = await tx.$queryRaw<RunRow[]>(Prisma.sql`
      UPDATE automation_runs_v1
      SET status = 'RUNNING',
          attempts = attempts + ${incrementAttempt ? 1 : 0},
          finished_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${event.tenantId}::uuid AND id = ${run.id}::uuid
      RETURNING id, definition_id, version_id, source_event_id, source_event_type,
                root_event_id, depth, status, attempts, context_json
    `);
    run = updated[0]!;
    const original = run.context_json as unknown as AutomationEventEnvelopeV1;
    try {
      const result = await executeRunActions(tx, definition, version, run, original);
      await markRun(tx, event.tenantId, run.id, result, null);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 8000);
      await markRun(tx, event.tenantId, run.id, 'FAILED', message);
      if (run.attempts < MAX_RUN_ATTEMPTS) throw error;
    }
  });
  return true;
}
