from pathlib import Path

# Route type hardening.
route = Path('apps/api/src/routes/sap-integration-orchestration-v1f2.ts')
text = route.read_text()
text = text.replace(
    "import type { FastifyInstance, LightMyRequestResponse } from 'fastify';\n",
    "import type { FastifyInstance } from 'fastify';\n",
)
anchor = "type SourceStatusRow = { source_key: string; latest_status: string | null };\ntype LeaseRow = { id: string };\n"
insert = anchor + "type InjectResponseV1f2 = { statusCode: number; body: string };\n"
if "type InjectResponseV1f2" not in text:
    if anchor not in text:
        raise SystemExit('F2 route response type anchor missing')
    text = text.replace(anchor, insert, 1)
text = text.replace("response: LightMyRequestResponse", "response: InjectResponseV1f2")
route.write_text(text)

# Internal actor support in auth.ts.
auth = Path('apps/api/src/auth.ts')
text = auth.read_text()
import_anchor = "import { withTenant } from './tenant-transaction.js';\n"
internal_import = """import {
  SAP_INTERNAL_ORCHESTRATION_HEADER_V1F2,
  SAP_INTERNAL_OWNER_HEADER_V1F2,
  isAllowedSapInternalOrchestrationPathV1f2,
  matchesSapInternalOrchestrationSecretV1f2,
} from './internal-sap-orchestration-auth-v1f2.js';
"""
if internal_import not in text:
    if import_anchor not in text:
        raise SystemExit('auth import anchor missing')
    text = text.replace(import_anchor, import_anchor + internal_import, 1)

text = text.replace(
    "export type AuthProvider = 'ENTRA_ID' | 'DEV';",
    "export type AuthProvider = 'ENTRA_ID' | 'DEV' | 'INTERNAL_AUTOMATION';",
    1,
)
principal_anchor = "  devTenantId?: string;\n"
principal_insert = principal_anchor + "  internalUserId?: string;\n  internalTenantId?: string;\n"
if "internalUserId?: string;" not in text:
    if principal_anchor not in text:
        raise SystemExit('auth principal anchor missing')
    text = text.replace(principal_anchor, principal_insert, 1)

helper_anchor = "export function registerRequestContext(app: FastifyInstance): void {\n"
uuid_helper = """function isUuidV1f2(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

"""
if "function isUuidV1f2" not in text:
    if helper_anchor not in text:
        raise SystemExit('auth helper anchor missing')
    text = text.replace(helper_anchor, uuid_helper + helper_anchor, 1)

auth_anchor = "  if (config.AUTH_MODE === 'dev') {\n"
internal_auth = """  const internalToken = readHeader(request, SAP_INTERNAL_ORCHESTRATION_HEADER_V1F2);
  if (internalToken) {
    if (
      !isAllowedSapInternalOrchestrationPathV1f2(request.method, request.raw.url)
      || !matchesSapInternalOrchestrationSecretV1f2(internalToken)
    ) {
      await reply.code(401).send({ error: 'unauthorized_internal_orchestration' });
      return;
    }
    const internalTenantId = getTenantHeader(request);
    const internalUserId = readHeader(request, SAP_INTERNAL_OWNER_HEADER_V1F2);
    if (
      !internalTenantId
      || !internalUserId
      || !isUuidV1f2(internalTenantId)
      || !isUuidV1f2(internalUserId)
    ) {
      await reply.code(400).send({ error: 'invalid_internal_orchestration_actor' });
      return;
    }
    request.authPrincipal = {
      provider: 'INTERNAL_AUTOMATION',
      issuer: 'bridata://internal/sap-orchestration-v1f2',
      subject: internalUserId,
      internalUserId,
      internalTenantId,
    };
    return;
  }

"""
if "provider: 'INTERNAL_AUTOMATION'" not in text:
    if auth_anchor not in text:
        raise SystemExit('authenticate anchor missing')
    text = text.replace(auth_anchor, internal_auth + auth_anchor, 1)

resolve_user_anchor = "  const identity = await prisma.userIdentity.findUnique({\n"
internal_user_guard = """  if (principal.provider === 'INTERNAL_AUTOMATION') {
    return null;
  }

"""
if internal_user_guard not in text:
    if resolve_user_anchor not in text:
        raise SystemExit('resolveAuthenticatedUser anchor missing')
    text = text.replace(resolve_user_anchor, internal_user_guard + resolve_user_anchor, 1)

resolve_actor_anchor = "  const tenantId = getTenantHeader(request);\n"
internal_actor = """  if (principal.provider === 'INTERNAL_AUTOMATION') {
    const tenantId = principal.internalTenantId!;
    const userId = principal.internalUserId!;
    const membership = await withTenant(tenantId, (tx) =>
      tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: { user: true },
      }),
    );
    if (
      !membership
      || membership.status !== 'ACTIVE'
      || !membership.user.isActive
      || (membership.role !== 'OWNER' && membership.role !== 'TENANT_ADMIN')
    ) {
      await reply.code(403).send({
        error: 'internal_automation_owner_not_authorized',
        message: 'The configured SAP automation owner must remain an active tenant administrator.',
      });
      return;
    }
    request.actor = {
      tenantId,
      userId,
      membershipId: membership.id,
      role: membership.role,
      email: membership.user.email,
      name: membership.user.fullName,
    };
    return;
  }

"""
if "internal_automation_owner_not_authorized" not in text:
    if resolve_actor_anchor not in text:
        raise SystemExit('resolveActor anchor missing')
    text = text.replace(resolve_actor_anchor, internal_actor + resolve_actor_anchor, 1)

auth.write_text(text)

# Register route and redact the process-local orchestration secret.
app = Path('apps/api/src/app.ts')
text = app.read_text()
app_import_anchor = "import { sapIntegrationServiceImportV1f1Routes } from './routes/sap-integration-service-import-v1f1.js';\n"
app_import = "import { sapIntegrationOrchestrationV1f2Routes } from './routes/sap-integration-orchestration-v1f2.js';\n"
if app_import not in text:
    if app_import_anchor not in text:
        raise SystemExit('app SAP F1 import anchor missing')
    text = text.replace(app_import_anchor, app_import_anchor + app_import, 1)

redact_anchor = "          'headers.authorization',\n"
redact_lines = """          'headers.authorization',
          'req.headers[\"x-bridata-internal-sap-orchestration\"]',
          'request.headers[\"x-bridata-internal-sap-orchestration\"]',
          'headers[\"x-bridata-internal-sap-orchestration\"]',
"""
if 'x-bridata-internal-sap-orchestration' not in text:
    if redact_anchor not in text:
        raise SystemExit('logger redact anchor missing')
    text = text.replace(redact_anchor, redact_lines, 1)

register_anchor = "  await sapIntegrationServiceImportV1f1Routes(app, integrationBinaryStore);\n"
register_line = "  await app.register(sapIntegrationOrchestrationV1f2Routes);\n"
if register_line not in text:
    if register_anchor not in text:
        raise SystemExit('app SAP F1 registration anchor missing')
    text = text.replace(register_anchor, register_anchor + register_line, 1)
app.write_text(text)

# Expose capability accurately.
foundation = Path('apps/api/src/routes/sap-integration-foundation-v1a.ts')
text = foundation.read_text()
cap_anchor = "      servicePrincipalAuthenticationEnabled: true,\n"
cap_line = "      servicePrincipalOrchestrationEnabled: true,\n"
if cap_line not in text:
    if cap_anchor not in text:
        raise SystemExit('foundation F1 capability anchor missing')
    text = text.replace(cap_anchor, cap_anchor + cap_line, 1)
foundation.write_text(text)

# CI step adjacent to F1.
ci = Path('.github/workflows/ci.yml')
text = ci.read_text()
ci_anchor = "      - name: Verify SAP integration freshness and health V1-E\n"
ci_step = '''      - name: Verify governed SAP canonical orchestration V1-F2
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: "true"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
          INTEGRATION_STORAGE_MODE: memory
          INTEGRATION_PARSE_MAX_FILE_BYTES: "26214400"
        run: |
          node --check scripts/sap/bridata-sap-service-orchestrate.mjs
          npx tsx apps/api/test/sap-integration-orchestration-v1f2-smoke.ts

'''
if ci_step not in text:
    if ci_anchor not in text:
        raise SystemExit('CI V1-E anchor missing')
    text = text.replace(ci_anchor, ci_step + ci_anchor, 1)
ci.write_text(text)

Path('scripts/dev/apply-sap-orchestration-v1f2.py').unlink()
print('SAP_ORCHESTRATION_V1F2_WIRING_OK')
