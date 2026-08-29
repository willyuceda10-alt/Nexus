from pathlib import Path

root = Path(__file__).resolve().parents[2]

app_path = root / 'apps/api/src/app.ts'
app = app_path.read_text()
old_import = "import { sapIntegrationReconciliationV1cRoutes } from './routes/sap-integration-reconciliation-v1c.js';\n"
new_import = old_import + "import { sapIntegrationCanonicalSyncV1d1Routes } from './routes/sap-integration-canonical-sync-v1d1.js';\n"
if old_import not in app and new_import not in app:
    raise SystemExit('app import anchor missing')
if new_import not in app:
    app = app.replace(old_import, new_import, 1)
old_register = "  await app.register(sapIntegrationReconciliationV1cRoutes);\n"
new_register = old_register + "  await app.register(sapIntegrationCanonicalSyncV1d1Routes);\n"
if old_register not in app and new_register not in app:
    raise SystemExit('app registration anchor missing')
if new_register not in app:
    app = app.replace(old_register, new_register, 1)
app_path.write_text(app)

smoke_path = root / 'apps/api/test/sap-integration-canonical-sync-v1d1-smoke.ts'
smoke = smoke_path.read_text()
smoke = smoke.replace("import { sapIntegrationCanonicalSyncV1d1Routes } from '../src/routes/sap-integration-canonical-sync-v1d1.js';\n", '')
smoke = smoke.replace('  await sapIntegrationCanonicalSyncV1d1Routes(app);\n', '')
smoke = smoke.replace('FROM project_commitments_v2 ', 'FROM project_commitments ')
smoke = smoke.replace('FROM project_actual_costs_v2 ', 'FROM project_actual_costs ')
smoke_path.write_text(smoke)

ci_path = root / '.github/workflows/ci.yml'
ci = ci_path.read_text()
anchor = '''      - name: Verify persistent object approval lifecycle\n'''
step = '''      - name: Verify SAP canonical procurement sync into Bridata PostgreSQL\n        env:\n          AUTH_MODE: dev\n          DEV_AUTH_ENABLED: "true"\n          DEV_USER_ID: 00000000-0000-4000-8000-000000000001\n          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002\n          INTEGRATION_STORAGE_MODE: memory\n          INTEGRATION_PARSE_MAX_FILE_BYTES: "26214400"\n        run: npx tsx apps/api/test/sap-integration-canonical-sync-v1d1-smoke.ts\n\n'''
if step not in ci:
    if anchor not in ci:
        raise SystemExit('CI anchor missing')
    ci = ci.replace(anchor, step + anchor, 1)
ci_path.write_text(ci)

Path(__file__).unlink()
print('SAP_CANONICAL_SYNC_V1D1_WIRING_OK')
