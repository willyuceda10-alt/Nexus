from pathlib import Path


def patch(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH_MISS {path}: {old[:120]!r}')
    text = text.replace(old, new, 1)
    file.write_text(text, encoding='utf-8')
    print(f'PATCH_OK {path}')


# -----------------------------------------------------------------------------
# Backend: eligible approvers endpoint.
# -----------------------------------------------------------------------------
patch(
    'apps/api/src/routes/object-approvals-v1.ts',
    "const createApprovalSchema = z.object({\n",
    "const eligibleApproverQuerySchema = z.object({ objectId: uuid });\n\nconst createApprovalSchema = z.object({\n",
)

patch(
    'apps/api/src/routes/object-approvals-v1.ts',
    "type UserSummary = {\n  id: string;\n  fullName: string;\n  email: string;\n  avatarUrl: string | null;\n};\n\n",
    "type UserSummary = {\n  id: string;\n  fullName: string;\n  email: string;\n  avatarUrl: string | null;\n};\n\ntype EligibleApproverRow = {\n  id: string;\n  full_name: string;\n  email: string;\n  avatar_url: string | null;\n  tenant_role: string;\n  workspace_role: string | null;\n};\n\n",
)

eligible_route = r'''export async function objectApprovalsV1Routes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/object-approvals-v1/eligible-approvers',
    { preHandler: [authenticate, resolveActor] },
    async (request, reply) => {
      const query = eligibleApproverQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: 'validation_error', details: query.error.flatten() });
      }

      const actor = request.actor!;
      const result = await withTenant(actor.tenantId, async (tx) => {
        const object = await accessibleObject(tx, actor, query.data.objectId);
        if (!object) return { kind: 'not_found' as const };
        if (object === 'forbidden') return { kind: 'forbidden' as const };

        const rows = await tx.$queryRaw<EligibleApproverRow[]>(Prisma.sql`
          SELECT
            u.id,
            u.full_name,
            u.email,
            u.avatar_url,
            tm.role::text AS tenant_role,
            wm.role::text AS workspace_role
          FROM tenant_memberships tm
          JOIN users u
            ON u.id = tm.user_id
          LEFT JOIN workspace_members wm
            ON wm.tenant_id = tm.tenant_id
           AND wm.user_id = tm.user_id
           AND wm.workspace_id = ${object.workspaceId}::uuid
          WHERE tm.tenant_id = ${actor.tenantId}::uuid
            AND tm.status::text = 'ACTIVE'
            AND u.is_active = TRUE
            AND (
              tm.role::text IN ('OWNER', 'TENANT_ADMIN')
              OR wm.id IS NOT NULL
            )
          ORDER BY
            CASE tm.role::text
              WHEN 'OWNER' THEN 0
              WHEN 'TENANT_ADMIN' THEN 1
              ELSE 2
            END,
            u.full_name,
            u.email
        `);

        return {
          kind: 'ok' as const,
          objectId: object.id,
          items: rows.map((row) => ({
            id: row.id,
            fullName: row.full_name,
            email: row.email,
            avatarUrl: row.avatar_url,
            tenantRole: row.tenant_role,
            workspaceRole: row.workspace_role,
          })),
        };
      });

      if (result.kind === 'not_found') return reply.code(404).send({ error: 'object_not_found' });
      if (result.kind === 'forbidden') return reply.code(403).send({ error: 'workspace_access_denied' });
      return { objectId: result.objectId, items: result.items };
    },
  );

'''
patch(
    'apps/api/src/routes/object-approvals-v1.ts',
    "export async function objectApprovalsV1Routes(app: FastifyInstance): Promise<void> {\n  app.get(\n    '/api/v1/object-approvals-v1',\n",
    eligible_route + "  app.get(\n    '/api/v1/object-approvals-v1',\n",
)

# -----------------------------------------------------------------------------
# Backend: approval-owned statuses cannot be forged through generic PATCH.
# -----------------------------------------------------------------------------
patch(
    'apps/api/src/routes/objects.ts',
    "        if (\n          updates.status !== undefined &&\n          updates.status !== current.status &&\n          current.status === 'PENDING_APPROVAL'\n        ) {\n",
    "        if (\n          updates.status !== undefined &&\n          updates.status !== current.status &&\n          ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(updates.status)\n        ) {\n          return { kind: 'approval_managed_status' as const };\n        }\n\n        if (\n          updates.status !== undefined &&\n          updates.status !== current.status &&\n          current.status === 'PENDING_APPROVAL'\n        ) {\n",
)

patch(
    'apps/api/src/routes/objects.ts',
    "      if (result.kind === 'approval_pending') {\n",
    "      if (result.kind === 'approval_managed_status') {\n        return reply.code(409).send({\n          error: 'approval_status_managed_by_workflow',\n          message: 'PENDING_APPROVAL, APPROVED and REJECTED are managed by Object Approval Core.',\n        });\n      }\n      if (result.kind === 'approval_pending') {\n",
)

# -----------------------------------------------------------------------------
# Backend smoke: direct APPROVED cannot be forged + eligible approver discovery.
# -----------------------------------------------------------------------------
patch(
    'apps/api/test/object-approvals-v1-smoke.ts',
    "    assert(created.status === 'DRAFT', 'Approval smoke object must start as DRAFT.');\n\n    const requestApproval = await app.inject({\n",
    "    assert(created.status === 'DRAFT', 'Approval smoke object must start as DRAFT.');\n\n    const forgedApprovalStatus = await app.inject({\n      method: 'PATCH',\n      url: `/api/v1/objects/${created.id}`,\n      headers: { 'x-correlation-id': 'ci-object-approval-forged-status' },\n      payload: { version: created.version, status: 'APPROVED' },\n    });\n    assert(\n      forgedApprovalStatus.statusCode === 409,\n      `Direct APPROVED status must be governed by Approval Core, got ${forgedApprovalStatus.statusCode}: ${forgedApprovalStatus.body}`,\n    );\n    assert(\n      (forgedApprovalStatus.json() as { error?: string }).error === 'approval_status_managed_by_workflow',\n      'Direct APPROVED status must return approval_status_managed_by_workflow.',\n    );\n\n    const eligibleApprovers = await app.inject({\n      method: 'GET',\n      url: `/api/v1/object-approvals-v1/eligible-approvers?objectId=${created.id}`,\n      headers: { 'x-correlation-id': 'ci-object-approval-eligible-approvers' },\n    });\n    assert(\n      eligibleApprovers.statusCode === 200,\n      `Eligible approvers returned ${eligibleApprovers.statusCode}: ${eligibleApprovers.body}`,\n    );\n    const eligiblePayload = eligibleApprovers.json() as {\n      objectId: string;\n      items: Array<{ id: string; fullName: string; tenantRole: string; workspaceRole: string | null }>;\n    };\n    assert(eligiblePayload.objectId === created.id, 'Eligible approver objectId mismatch.');\n    assert(\n      eligiblePayload.items.some((item) => item.id === DEV_USER_ID),\n      'DEV owner must be discoverable as an eligible approver.',\n    );\n\n    const requestApproval = await app.inject({\n",
)

patch(
    'apps/api/test/object-approvals-v1-smoke.ts',
    "      statusBypassProtection: true,\n      immutableDecision: true,\n",
    "      statusBypassProtection: true,\n      directApprovalStatusGuard: true,\n      eligibleApproverDiscovery: true,\n      immutableDecision: true,\n",
)

# -----------------------------------------------------------------------------
# Frontend type: preserve old mock shape while enriching persistent approvals.
# -----------------------------------------------------------------------------
patch(
    'src/types/nexus.ts',
    "export interface ApprovalStep {\n  id: string;\n  objectId: string;\n  approverId: string;\n  approverName: string;\n  approverRole: string;\n  status: 'PENDING' | 'APPROVED' | 'REJECTED';\n  comment?: string;\n  decidedAt?: string;\n}\n",
    "export interface ApprovalStep {\n  id: string;\n  objectId: string;\n  approverId: string;\n  approverName: string;\n  approverRole: string;\n  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';\n  comment?: string;\n  decidedAt?: string;\n  requestedById?: string;\n  requestedByName?: string;\n  title?: string;\n  description?: string;\n  previousObjectStatus?: string;\n  decisionById?: string;\n  decisionByName?: string;\n  decisionComment?: string;\n  createdAt?: string;\n}\n",
)

# -----------------------------------------------------------------------------
# Drawer: local API approval state, candidate picker and governed actions.
# -----------------------------------------------------------------------------
patch(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "import React, { useState } from 'react';\n",
    "import React, { useEffect, useState } from 'react';\n",
)

patch(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "import { useNexus } from '../../context/NexusContext';\nimport { ObjectStatus, Priority, ObjectType } from '../../types/nexus';\n",
    "import { useNexus } from '../../context/NexusContext';\nimport { useApiBootstrap } from '../../context/ApiBootstrapContext';\nimport { BridataApiError } from '../../api/client';\nimport { objectApprovalsV1Api } from '../../api/objectApprovalsV1Client';\nimport {\n  mapApiObjectApprovalV1,\n  mapEligibleApproverV1,\n  type ApprovalCandidateV1,\n} from '../../domain/objectApprovalsV1';\nimport { ObjectStatus, Priority, ObjectType, type ApprovalStep } from '../../types/nexus';\n\nfunction approvalErrorMessage(cause: unknown): string {\n  if (cause instanceof BridataApiError) {\n    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;\n  }\n  if (cause instanceof Error) return cause.message;\n  return 'No se pudo completar la operación de aprobación.';\n}\n",
)

patch(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "    currentUser,\n    decideApproval,\n    approvals,\n  } = useNexus();\n\n  const [activeDrawerTab",
    "    currentUser,\n    decideApproval,\n    approvals,\n    reloadObjects,\n  } = useNexus();\n  const apiBootstrap = useApiBootstrap();\n  const isApiMode = apiBootstrap.dataMode === 'api';\n\n  const [activeDrawerTab",
)

patch(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "  const [linkRelationType, setLinkRelationType] = useState<'BLOCKS' | 'DEPENDS_ON' | 'DERIVED_FROM' | 'RELATES_TO' | 'MITIGATES' | 'REQUIRES_APPROVAL'>('RELATES_TO');\n\n  if (!isDrawerOpen || !selectedObject) return null;\n\n  const objComments = selectedObjectComments;\n  const objLogs = selectedObjectActivityLogs;\n  const linked = getLinkedObjects(selectedObject.id);\n  const pendingApproval = approvals.find((a) => a.objectId === selectedObject.id && a.status === 'PENDING');\n",
    "  const [linkRelationType, setLinkRelationType] = useState<'BLOCKS' | 'DEPENDS_ON' | 'DERIVED_FROM' | 'RELATES_TO' | 'MITIGATES' | 'REQUIRES_APPROVAL'>('RELATES_TO');\n  const [apiApprovals, setApiApprovals] = useState<ApprovalStep[]>([]);\n  const [approvalCandidates, setApprovalCandidates] = useState<ApprovalCandidateV1[]>([]);\n  const [approvalLoadStatus, setApprovalLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');\n  const [approvalError, setApprovalError] = useState<string | null>(null);\n  const [isApprovalRequestOpen, setIsApprovalRequestOpen] = useState(false);\n  const [selectedApproverId, setSelectedApproverId] = useState('');\n  const [approvalRequestDescription, setApprovalRequestDescription] = useState('');\n  const [approvalDecisionComment, setApprovalDecisionComment] = useState('');\n  const [isApprovalMutationPending, setIsApprovalMutationPending] = useState(false);\n\n  useEffect(() => {\n    let active = true;\n    const objectId = selectedObject?.id;\n    if (!isApiMode || !isDrawerOpen || !objectId) {\n      setApiApprovals([]);\n      setApprovalCandidates([]);\n      setApprovalLoadStatus('idle');\n      setApprovalError(null);\n      setIsApprovalRequestOpen(false);\n      setSelectedApproverId('');\n      setApprovalRequestDescription('');\n      setApprovalDecisionComment('');\n      return () => { active = false; };\n    }\n\n    setApprovalLoadStatus('loading');\n    setApprovalError(null);\n    void objectApprovalsV1Api.list(objectId)\n      .then((response) => {\n        if (!active) return;\n        setApiApprovals(response.items.map(mapApiObjectApprovalV1));\n        setApprovalLoadStatus('ready');\n      })\n      .catch((cause) => {\n        if (!active) return;\n        setApiApprovals([]);\n        setApprovalLoadStatus('error');\n        setApprovalError(approvalErrorMessage(cause));\n      });\n\n    return () => { active = false; };\n  }, [isApiMode, isDrawerOpen, selectedObject?.id]);\n\n  if (!isDrawerOpen || !selectedObject) return null;\n\n  const objComments = selectedObjectComments;\n  const objLogs = selectedObjectActivityLogs;\n  const linked = getLinkedObjects(selectedObject.id);\n  const objectApprovals = isApiMode\n    ? apiApprovals\n    : approvals.filter((approval) => approval.objectId === selectedObject.id);\n  const pendingApproval = objectApprovals.find((approval) => approval.status === 'PENDING');\n  const isApprovalAdmin = currentUser.roleKey === 'OWNER' || currentUser.roleKey === 'ADMIN';\n  const canDecidePendingApproval = Boolean(\n    pendingApproval && (pendingApproval.approverId === currentUser.id || isApprovalAdmin),\n  );\n  const canCancelPendingApproval = Boolean(\n    pendingApproval && (pendingApproval.requestedById === currentUser.id || isApprovalAdmin),\n  );\n",
)

# Insert approval action handlers before return.
patch(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "  const handleAddLink = async () => {\n    if (!targetLinkObjectId || isRelationSubmitting) return;\n    setIsRelationSubmitting(true);\n    try {\n      await addRelation(selectedObject.id, targetLinkObjectId, linkRelationType);\n      setIsLinkingOpen(false);\n      setTargetLinkObjectId('');\n    } catch {\n      // NexusContext exposes a user-safe relation error.\n    } finally {\n      setIsRelationSubmitting(false);\n    }\n  };\n\n  return (\n",
    "  const handleAddLink = async () => {\n    if (!targetLinkObjectId || isRelationSubmitting) return;\n    setIsRelationSubmitting(true);\n    try {\n      await addRelation(selectedObject.id, targetLinkObjectId, linkRelationType);\n      setIsLinkingOpen(false);\n      setTargetLinkObjectId('');\n    } catch {\n      // NexusContext exposes a user-safe relation error.\n    } finally {\n      setIsRelationSubmitting(false);\n    }\n  };\n\n  const loadEligibleApprovers = async () => {\n    if (!isApiMode) return;\n    setApprovalLoadStatus('loading');\n    setApprovalError(null);\n    try {\n      const response = await objectApprovalsV1Api.eligibleApprovers(selectedObject.id);\n      const allowSelf = currentUser.roleKey === 'OWNER' || currentUser.roleKey === 'ADMIN';\n      const candidates = response.items\n        .map(mapEligibleApproverV1)\n        .filter((candidate) => allowSelf || candidate.id !== currentUser.id);\n      setApprovalCandidates(candidates);\n      setSelectedApproverId((current) =>\n        current && candidates.some((candidate) => candidate.id === current)\n          ? current\n          : candidates[0]?.id ?? '',\n      );\n      setApprovalLoadStatus('ready');\n      if (candidates.length === 0) {\n        setApprovalError('No hay un aprobador elegible con acceso a este workspace.');\n      }\n    } catch (cause) {\n      setApprovalCandidates([]);\n      setApprovalLoadStatus('error');\n      setApprovalError(approvalErrorMessage(cause));\n    }\n  };\n\n  const handleOpenApprovalRequest = async () => {\n    setIsApprovalRequestOpen(true);\n    await loadEligibleApprovers();\n  };\n\n  const handleRequestApproval = async () => {\n    if (!isApiMode || !selectedApproverId || isApprovalMutationPending) return;\n    setIsApprovalMutationPending(true);\n    setApprovalError(null);\n    try {\n      const response = await objectApprovalsV1Api.create({\n        objectId: selectedObject.id,\n        approverUserId: selectedApproverId,\n        ...(approvalRequestDescription.trim()\n          ? { description: approvalRequestDescription.trim() }\n          : {}),\n      });\n      const mapped = mapApiObjectApprovalV1(response.approval);\n      setApiApprovals((previous) => [mapped, ...previous.filter((item) => item.id !== mapped.id)]);\n      setIsApprovalRequestOpen(false);\n      setApprovalRequestDescription('');\n      setSelectedApproverId('');\n      await reloadObjects();\n      await reloadObjectCollaboration(selectedObject.id);\n    } catch (cause) {\n      setApprovalError(approvalErrorMessage(cause));\n    } finally {\n      setIsApprovalMutationPending(false);\n    }\n  };\n\n  const handleApprovalDecision = async (decision: 'APPROVED' | 'REJECTED') => {\n    if (!pendingApproval || isApprovalMutationPending) return;\n    if (!isApiMode) {\n      await decideApproval(pendingApproval.id, decision, approvalDecisionComment || undefined);\n      setApprovalDecisionComment('');\n      return;\n    }\n\n    setIsApprovalMutationPending(true);\n    setApprovalError(null);\n    try {\n      const response = await objectApprovalsV1Api.decide(pendingApproval.id, {\n        decision,\n        ...(approvalDecisionComment.trim() ? { comment: approvalDecisionComment.trim() } : {}),\n      });\n      const mapped = mapApiObjectApprovalV1(response.approval);\n      setApiApprovals((previous) =>\n        previous.map((item) => (item.id === mapped.id ? mapped : item)),\n      );\n      setApprovalDecisionComment('');\n      await reloadObjects();\n      await reloadObjectCollaboration(selectedObject.id);\n    } catch (cause) {\n      setApprovalError(approvalErrorMessage(cause));\n    } finally {\n      setIsApprovalMutationPending(false);\n    }\n  };\n\n  const handleCancelApproval = async () => {\n    if (!isApiMode || !pendingApproval || isApprovalMutationPending) return;\n    setIsApprovalMutationPending(true);\n    setApprovalError(null);\n    try {\n      const response = await objectApprovalsV1Api.cancel(pendingApproval.id, {\n        ...(approvalDecisionComment.trim() ? { comment: approvalDecisionComment.trim() } : {}),\n      });\n      const mapped = mapApiObjectApprovalV1(response.approval);\n      setApiApprovals((previous) =>\n        previous.map((item) => (item.id === mapped.id ? mapped : item)),\n      );\n      setApprovalDecisionComment('');\n      await reloadObjects();\n      await reloadObjectCollaboration(selectedObject.id);\n    } catch (cause) {\n      setApprovalError(approvalErrorMessage(cause));\n    } finally {\n      setIsApprovalMutationPending(false);\n    }\n  };\n\n  return (\n",
)

# Govern status selector in API mode.
patch(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "                value={selectedObject.status}\n                onChange={(e) => updateNexusObject(selectedObject.id, { status: e.target.value as ObjectStatus })}\n                className=\"rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200\"\n",
    "                value={selectedObject.status}\n                disabled={Boolean(isApiMode && pendingApproval)}\n                onChange={(e) => {\n                  const nextStatus = e.target.value as ObjectStatus;\n                  if (isApiMode && ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(nextStatus)) return;\n                  void updateNexusObject(selectedObject.id, { status: nextStatus });\n                }}\n                className=\"rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-800 outline-none focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200\"\n",
)

patch(
    'src/components/layout/UniversalObjectDrawer.tsx',
    "                <option value=\"PENDING_APPROVAL\">Pendiente Aprobación</option>\n                <option value=\"APPROVED\">Aprobado</option>\n                <option value=\"REJECTED\">Rechazado</option>\n",
    "                <option value=\"PENDING_APPROVAL\" disabled={isApiMode}>Pendiente Aprobación</option>\n                <option value=\"APPROVED\" disabled={isApiMode}>Aprobado</option>\n                <option value=\"REJECTED\" disabled={isApiMode}>Rechazado</option>\n",
)

old_banner = r'''        {/* Approval Banner if pending */}
        {pendingApproval && (
          <div className="bg-amber-50 border-b border-amber-200 p-3 flex items-center justify-between dark:bg-amber-950/40 dark:border-amber-900/60">
            <div className="flex items-center space-x-2 text-xs text-amber-900 dark:text-amber-200">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <span><strong>Aprobación requerida:</strong> {pendingApproval.comment || 'Firma ejecutiva pendiente'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => decideApproval(pendingApproval.id, 'APPROVED', 'Aprobado desde Peek View')}
                className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
              >
                Aprobar
              </button>
              <button
                onClick={() => decideApproval(pendingApproval.id, 'REJECTED', 'Rechazado desde Peek View')}
                className="rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-rose-700"
              >
                Rechazar
              </button>
            </div>
          </div>
        )}

'''
new_banner = r'''        {/* Persistent approval workflow */}
        {approvalError && (
          <div role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {approvalError}
          </div>
        )}

        {pendingApproval ? (
          <div className="border-b border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <div className="font-bold">{pendingApproval.title || 'Aprobación requerida'}</div>
                  <div className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
                    Aprobador: {pendingApproval.approverName}
                    {pendingApproval.requestedByName ? ` · Solicitó: ${pendingApproval.requestedByName}` : ''}
                  </div>
                  {(pendingApproval.description || pendingApproval.comment) && (
                    <div className="mt-1 text-[11px]">{pendingApproval.description || pendingApproval.comment}</div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {canDecidePendingApproval && (
                  <>
                    <button
                      disabled={isApprovalMutationPending}
                      onClick={() => void handleApprovalDecision('APPROVED')}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Aprobar
                    </button>
                    <button
                      disabled={isApprovalMutationPending}
                      onClick={() => void handleApprovalDecision('REJECTED')}
                      className="rounded bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                  </>
                )}
                {isApiMode && canCancelPendingApproval && (
                  <button
                    disabled={isApprovalMutationPending}
                    onClick={() => void handleCancelApproval()}
                    className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"
                  >
                    Cancelar solicitud
                  </button>
                )}
              </div>
            </div>

            {isApiMode && (canDecidePendingApproval || canCancelPendingApproval) && (
              <input
                value={approvalDecisionComment}
                onChange={(event) => setApprovalDecisionComment(event.target.value)}
                maxLength={4000}
                placeholder="Comentario de decisión o cancelación (opcional)"
                className="mt-2 w-full rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-amber-500 dark:border-amber-900 dark:bg-slate-900 dark:text-slate-200"
              />
            )}
          </div>
        ) : isApiMode ? (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/60">
            {!isApprovalRequestOpen ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <FileCheck2 className="h-4 w-4 text-emerald-600" />
                  <span>Este objeto no tiene una aprobación pendiente.</span>
                </div>
                <button
                  disabled={approvalLoadStatus === 'loading'}
                  onClick={() => void handleOpenApprovalRequest()}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Solicitar aprobación
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Nueva solicitud de aprobación</div>
                  <button
                    onClick={() => setIsApprovalRequestOpen(false)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Cerrar
                  </button>
                </div>
                <select
                  value={selectedApproverId}
                  onChange={(event) => setSelectedApproverId(event.target.value)}
                  disabled={approvalLoadStatus === 'loading' || isApprovalMutationPending}
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-emerald-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {approvalCandidates.length === 0 && <option value="">Sin aprobadores disponibles</option>}
                  {approvalCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name} · {candidate.workspaceRole || candidate.tenantRole}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={2}
                  maxLength={10000}
                  value={approvalRequestDescription}
                  onChange={(event) => setApprovalRequestDescription(event.target.value)}
                  placeholder="Motivo o contexto para el aprobador (opcional)"
                  className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
                <div className="flex justify-end">
                  <button
                    disabled={!selectedApproverId || isApprovalMutationPending || approvalLoadStatus === 'loading'}
                    onClick={() => void handleRequestApproval()}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isApprovalMutationPending ? 'Enviando…' : 'Enviar solicitud'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

'''
patch('src/components/layout/UniversalObjectDrawer.tsx', old_banner, new_banner)

# -----------------------------------------------------------------------------
# Frontend smoke belongs to the normal local test command.
# -----------------------------------------------------------------------------
patch(
    'package.json',
    '"test": "tsx src/domain/myWork.smoke.ts && tsx src/domain/collaborationV1.smoke.ts && npm run test --workspace @nexus/api",',
    '"test": "tsx src/domain/myWork.smoke.ts && tsx src/domain/collaborationV1.smoke.ts && tsx src/domain/objectApprovalsV1.smoke.ts && npm run test --workspace @nexus/api",',
)

# Self-delete so the final product branch contains no patch utility.
Path(__file__).unlink()
print('OBJECT_APPROVALS_V1B_PATCH_OK')
