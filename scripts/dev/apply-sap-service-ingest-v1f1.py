from pathlib import Path

app = Path('apps/api/src/app.ts')
text = app.read_text()
import_anchor = "import { sapIntegrationHealthV1eRoutes } from './routes/sap-integration-health-v1e.js';\n"
import_line = "import { sapIntegrationServiceImportV1f1Routes } from './routes/sap-integration-service-import-v1f1.js';\n"
if import_line not in text:
    if import_anchor not in text:
        raise SystemExit('app import anchor missing')
    text = text.replace(import_anchor, import_anchor + import_line, 1)
route_anchor = "  await app.register(sapIntegrationHealthV1eRoutes);\n"
route_line = "  await sapIntegrationServiceImportV1f1Routes(app, integrationBinaryStore);\n"
if route_line not in text:
    if route_anchor not in text:
        raise SystemExit('app route anchor missing')
    text = text.replace(route_anchor, route_anchor + route_line, 1)
app.write_text(text)

foundation = Path('apps/api/src/routes/sap-integration-foundation-v1a.ts')
text = foundation.read_text()
old = '      servicePrincipalAuthenticationEnabled: false,\n'
new = '      servicePrincipalAuthenticationEnabled: true,\n'
if new not in text:
    if old not in text:
        raise SystemExit('foundation capability anchor missing')
    text = text.replace(old, new, 1)
foundation.write_text(text)

ci = Path('.github/workflows/ci.yml')
text = ci.read_text()
anchors = [
    "      - name: Verify SAP integration freshness and health V1-E\n",
    "      - name: Verify SAP integration health and freshness V1-E\n",
    "      - name: Verify SAP integration health V1-E\n",
]
anchor = next((candidate for candidate in anchors if candidate in text), None)
if anchor is None:
    raise SystemExit('CI V1-E anchor missing')
step = '''      - name: Verify governed SAP service-principal ingest V1-F1
        env:
          AUTH_MODE: dev
          DEV_AUTH_ENABLED: "true"
          DEV_USER_ID: 00000000-0000-4000-8000-000000000001
          DEV_TENANT_ID: 00000000-0000-4000-8000-000000000002
          INTEGRATION_STORAGE_MODE: memory
          INTEGRATION_PARSE_MAX_FILE_BYTES: "26214400"
        run: npx tsx apps/api/test/sap-integration-service-import-v1f1-smoke.ts

'''
if step not in text:
    text = text.replace(anchor, step + anchor, 1)
ci.write_text(text)

Path('scripts/dev/apply-sap-service-ingest-v1f1.py').unlink()
print('SAP_SERVICE_INGEST_V1F1_WIRING_OK')
