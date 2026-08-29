from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'apps/api/test/sap-integration-canonical-sync-v1d1-smoke.ts'
text = path.read_text()

old = "status: 'CONNECTED'"
new = "status: 'ACTIVE'"
if old not in text and new not in text:
    raise SystemExit('integration status anchor missing')
text = text.replace(old, new)

path.write_text(text)
Path(__file__).unlink()
print('SAP_CANONICAL_SYNC_V1D1_SMOKE_STATUS_FIX_OK')
