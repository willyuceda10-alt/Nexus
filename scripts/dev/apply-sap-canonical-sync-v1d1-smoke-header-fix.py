from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'apps/api/test/sap-integration-canonical-sync-v1d1-smoke.ts'
text = path.read_text()

old = "headers: { 'content-type': 'application/octet-stream', 'x-file-name': name },"
new = "headers: { 'content-type': 'application/octet-stream', 'x-bridata-file-name': name },"
if old not in text and new not in text:
    raise SystemExit('import filename header anchor missing')
text = text.replace(old, new)

path.write_text(text)
Path(__file__).unlink()
print('SAP_CANONICAL_SYNC_V1D1_SMOKE_HEADER_FIX_OK')
