from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        print(f"PATCH_ALREADY_OK {path}")
        return
    if old not in text:
        raise RuntimeError(f"PATCH_MARKER_NOT_FOUND {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"PATCH_OK {path}")


approval_model = '''model ObjectApprovalRequestV1 {
  id                   String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId             String    @map("tenant_id") @db.Uuid
  objectId             String    @map("object_id") @db.Uuid
  requestedByUserId    String    @map("requested_by_user_id") @db.Uuid
  approverUserId       String    @map("approver_user_id") @db.Uuid
  title                String    @db.VarChar(500)
  description          String?   @db.Text
  previousObjectStatus String    @map("previous_object_status") @db.VarChar(100)
  status               String    @default("PENDING") @db.VarChar(32)
  decisionByUserId     String?   @map("decision_by_user_id") @db.Uuid
  decisionComment      String?   @map("decision_comment") @db.Text
  decidedAt            DateTime? @map("decided_at") @db.Timestamptz(6)
  createdAt            DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([tenantId, objectId, createdAt])
  @@index([tenantId, approverUserId, status, createdAt])
  @@map("object_approval_requests_v1")
}

'''

replace_once(
    "prisma/schema.prisma",
    "// -----------------------------------------------------------------------------\n// 5. WORKFLOW ENGINE\n// -----------------------------------------------------------------------------\n",
    approval_model
    + "// -----------------------------------------------------------------------------\n// 5. WORKFLOW ENGINE\n// -----------------------------------------------------------------------------\n",
)

replace_once(
    "apps/api/src/app.ts",
    "import { objectRelationsV1Routes } from './routes/object-relations-v1.js';\nimport { objectRoutes } from './routes/objects.js';\n",
    "import { objectApprovalsV1Routes } from './routes/object-approvals-v1.js';\nimport { objectRelationsV1Routes } from './routes/object-relations-v1.js';\nimport { objectRoutes } from './routes/objects.js';\n",
)

replace_once(
    "apps/api/src/app.ts",
    "  await app.register(collaborationV1Routes);\n  await app.register(objectRelationsV1Routes);\n",
    "  await app.register(collaborationV1Routes);\n  await app.register(objectRelationsV1Routes);\n  await app.register(objectApprovalsV1Routes);\n",
)

replace_once(
    "apps/api/src/routes/objects.ts",
    """        if (!(await canAccessWorkspace(tx, actor, current.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        if (
          updates.assigneeId &&
""",
    """        if (!(await canAccessWorkspace(tx, actor, current.workspaceId))) {
          return { kind: 'forbidden' as const };
        }

        if (
          updates.status !== undefined &&
          updates.status !== current.status &&
          current.status === 'PENDING_APPROVAL'
        ) {
          const pendingApproval = await tx.objectApprovalRequestV1.findFirst({
            where: {
              tenantId: actor.tenantId,
              objectId: current.id,
              status: 'PENDING',
            },
            select: { id: true },
          });
          if (pendingApproval) return { kind: 'approval_pending' as const };
        }

        if (
          updates.assigneeId &&
""",
)

replace_once(
    "apps/api/src/routes/objects.ts",
    """      if (result.kind === 'invalid_assignee') {
        return reply.code(400).send({ error: 'invalid_assignee' });
      }
      if (result.kind === 'version_conflict') {
""",
    """      if (result.kind === 'invalid_assignee') {
        return reply.code(400).send({ error: 'invalid_assignee' });
      }
      if (result.kind === 'approval_pending') {
        return reply.code(409).send({
          error: 'approval_pending',
          message: 'The object status is governed by a pending approval request.',
        });
      }
      if (result.kind === 'version_conflict') {
""",
)

ci_marker = '''      - name: Verify per-field object history and governed persistent relations
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: "true"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
        run: npx tsx apps/api/test/object-history-relations-v1-smoke.ts
'''
ci_replacement = ci_marker + '''
      - name: Verify persistent object approval lifecycle
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: "true"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
        run: npx tsx apps/api/test/object-approvals-v1-smoke.ts
'''
replace_once(".github/workflows/ci.yml", ci_marker, ci_replacement)

Path(__file__).unlink()
print("OBJECT_APPROVALS_V1A_PATCH_OK")
