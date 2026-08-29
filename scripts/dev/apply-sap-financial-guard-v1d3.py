from pathlib import Path

root = Path(__file__).resolve().parents[2]

# -----------------------------------------------------------------------------
# 1. Use queryRaw for PostgreSQL advisory lock SELECT.
# -----------------------------------------------------------------------------
route_path = root / 'apps/api/src/routes/sap-integration-financial-guard-v1d3.ts'
route = route_path.read_text()
old_lock = """  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:${connectionId}:SAP_FINANCIAL:${externalKey}`}, 0)
    )
  `);
"""
new_lock = """  await tx.$queryRaw<Array<{ lock_result: unknown }>>(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:${connectionId}:SAP_FINANCIAL:${externalKey}`}, 0)
    ) AS lock_result
  `);
"""
if new_lock not in route:
    if old_lock not in route:
        raise SystemExit('financial advisory lock anchor missing')
    route = route.replace(old_lock, new_lock, 1)
route_path.write_text(route)

# -----------------------------------------------------------------------------
# 2. Register V1-D3 in the API runtime.
# -----------------------------------------------------------------------------
app_path = root / 'apps/api/src/app.ts'
app = app_path.read_text()
old_import = "import { sapIntegrationInventorySyncV1d2Routes } from './routes/sap-integration-inventory-sync-v1d2.js';\n"
new_import = old_import + "import { sapIntegrationFinancialGuardV1d3Routes } from './routes/sap-integration-financial-guard-v1d3.js';\n"
if new_import not in app:
    if old_import not in app:
        raise SystemExit('V1-D2 app import anchor missing')
    app = app.replace(old_import, new_import, 1)

old_register = "  await app.register(sapIntegrationInventorySyncV1d2Routes);\n"
new_register = old_register + "  await app.register(sapIntegrationFinancialGuardV1d3Routes);\n"
if new_register not in app:
    if old_register not in app:
        raise SystemExit('V1-D2 app registration anchor missing')
    app = app.replace(old_register, new_register, 1)
app_path.write_text(app)

# -----------------------------------------------------------------------------
# 3. Add V1-D3 smoke to CI for when GitHub Actions quota is available again.
# -----------------------------------------------------------------------------
ci_path = root / '.github/workflows/ci.yml'
ci = ci_path.read_text()
anchor = """      - name: Verify persistent object approval lifecycle
"""
step = """      - name: Verify SAP financial anti-double-count guard V1-D3
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: "true"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
          INTEGRATION_STORAGE_MODE: memory
          INTEGRATION_PARSE_MAX_FILE_BYTES: "26214400"
        run: npx tsx apps/api/test/sap-integration-financial-guard-v1d3-smoke.ts

"""
if step not in ci:
    if anchor not in ci:
        raise SystemExit('CI insertion anchor missing')
    ci = ci.replace(anchor, step + anchor, 1)
ci_path.write_text(ci)

Path(__file__).unlink()
print('SAP_FINANCIAL_GUARD_V1D3_WIRING_OK')
