from pathlib import Path

root = Path(__file__).resolve().parents[2]

app_path = root / 'apps/api/src/app.ts'
app = app_path.read_text()

import_anchor = "import { sapIntegrationActualCostSyncV1d4Routes } from './routes/sap-integration-actual-cost-sync-v1d4.js';\n"
import_line = "import { sapIntegrationHealthV1eRoutes } from './routes/sap-integration-health-v1e.js';\n"
if import_line not in app:
    if import_anchor not in app:
        raise SystemExit('V1-D4 app import anchor missing')
    app = app.replace(import_anchor, import_anchor + import_line, 1)

register_anchor = "  await app.register(sapIntegrationActualCostSyncV1d4Routes);\n"
register_line = "  await app.register(sapIntegrationHealthV1eRoutes);\n"
if register_line not in app:
    if register_anchor not in app:
        raise SystemExit('V1-D4 app register anchor missing')
    app = app.replace(register_anchor, register_anchor + register_line, 1)

app_path.write_text(app)

ci_path = root / '.github/workflows/ci.yml'
ci = ci_path.read_text()
anchor = "      - name: Verify persistent object approval lifecycle\n"
step = """      - name: Verify SAP integration freshness and health V1-E
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: \"true\"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
          INTEGRATION_STORAGE_MODE: memory
          INTEGRATION_PARSE_MAX_FILE_BYTES: \"26214400\"
        run: npx tsx apps/api/test/sap-integration-health-v1e-smoke.ts

"""
if step not in ci:
    if anchor not in ci:
        raise SystemExit('CI object approval anchor missing')
    ci = ci.replace(anchor, step + anchor, 1)
ci_path.write_text(ci)

Path(__file__).unlink()
print('SAP_INTEGRATION_HEALTH_V1E_WIRING_OK')
