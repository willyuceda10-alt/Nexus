from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'apps/api/test/sap-integration-canonical-sync-v1d1-smoke.ts'
text = path.read_text()

old_import = "import { createMemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';"
new_import = "import { MemoryIntegrationBinaryStoreV1 } from '../src/integration-binary-store-v1.js';"
if old_import not in text and new_import not in text:
    raise SystemExit('memory store import anchor missing')
text = text.replace(old_import, new_import)

old_usage = "createMemoryIntegrationBinaryStoreV1()"
new_usage = "new MemoryIntegrationBinaryStoreV1()"
if old_usage not in text and new_usage not in text:
    raise SystemExit('memory store constructor anchor missing')
text = text.replace(old_usage, new_usage)

path.write_text(text)
Path(__file__).unlink()
print('SAP_CANONICAL_SYNC_V1D1_SMOKE_STORE_FIX_OK')
