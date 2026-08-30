from pathlib import Path

route = Path('apps/api/src/routes/sap-integration-orchestration-v1f2.ts')
text = route.read_text()

import_anchor = "import { authenticate, resolveActor } from '../auth.js';\n"
health_import = "import { resolveSapFreshnessMinutesV1e } from '../domain/sap-integration-health-v1e.js';\n"
if health_import not in text:
    if import_anchor not in text:
        raise SystemExit('F2 freshness import anchor missing')
    text = text.replace(import_anchor, import_anchor + health_import, 1)

old_type = "type SourceStatusRow = { source_key: string; latest_status: string | null };\n"
new_type = """type SourceStatusRow = {
  source_key: string;
  config: Prisma.JsonValue | null;
  latest_status: string | null;
  latest_source_generated_at: Date | null;
  latest_received_at: Date | null;
};
"""
if new_type not in text:
    if old_type not in text:
        raise SystemExit('F2 source readiness type anchor missing')
    text = text.replace(old_type, new_type, 1)

old_fn = """async function sourceReadiness(tenantId: string, connectionId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<SourceStatusRow[]>(Prisma.sql`
      SELECT s.source_key,
             latest.status AS latest_status
      FROM integration_sources s
      LEFT JOIN LATERAL (
        SELECT b.status
        FROM integration_import_batches b
        WHERE b.tenant_id = s.tenant_id
          AND b.integration_source_id = s.id
        ORDER BY b.received_at DESC, b.id DESC
        LIMIT 1
      ) latest ON true
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.integration_connection_id = ${connectionId}::uuid
        AND s.is_active = true
        AND s.source_key IN (${Prisma.join([...SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2])})
    `);
    return rows.map((row) => ({ sourceKey: row.source_key, latestStatus: row.latest_status }));
  });
}
"""
new_fn = """async function sourceReadiness(tenantId: string, connectionId: string) {
  const now = new Date();
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<SourceStatusRow[]>(Prisma.sql`
      SELECT s.source_key,
             s.config,
             latest.status AS latest_status,
             latest.source_generated_at AS latest_source_generated_at,
             latest.received_at AS latest_received_at
      FROM integration_sources s
      LEFT JOIN LATERAL (
        SELECT b.status, b.source_generated_at, b.received_at
        FROM integration_import_batches b
        WHERE b.tenant_id = s.tenant_id
          AND b.integration_source_id = s.id
        ORDER BY b.received_at DESC, b.id DESC
        LIMIT 1
      ) latest ON true
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.integration_connection_id = ${connectionId}::uuid
        AND s.is_active = true
        AND s.source_key IN (${Prisma.join([...SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2])})
    `);
    return rows.map((row) => {
      const status = row.latest_status?.toUpperCase() ?? null;
      if (status !== 'SUCCEEDED' && status !== 'PARTIAL') {
        return { sourceKey: row.source_key, latestStatus: status };
      }
      const generatedAt = row.latest_source_generated_at ?? row.latest_received_at;
      if (!generatedAt) return { sourceKey: row.source_key, latestStatus: 'NEVER' };
      const freshnessMinutes = resolveSapFreshnessMinutesV1e(row.config);
      const ageMinutes = Math.max(0, Math.round((now.getTime() - generatedAt.getTime()) / 60_000));
      return {
        sourceKey: row.source_key,
        latestStatus: ageMinutes > freshnessMinutes ? 'STALE' : 'FRESH',
      };
    });
  });
}
"""
if new_fn not in text:
    if old_fn not in text:
        raise SystemExit('F2 source readiness function anchor missing')
    text = text.replace(old_fn, new_fn, 1)

route.write_text(text)
Path('scripts/dev/apply-sap-orchestration-v1f2-freshness.py').unlink()
print('SAP_ORCHESTRATION_V1F2_FRESHNESS_OK')
