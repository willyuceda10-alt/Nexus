from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / 'apps/api/test/sap-integration-canonical-sync-v1d1-smoke.ts'
text = path.read_text()

old_vars = """  const prNumber = `10${Date.now().toString().slice(-8)}`;
  const poNumber = `45${Date.now().toString().slice(-8)}`;
  const material = `13${Date.now().toString().slice(-6)}`;
"""
new_vars = old_vars + """  const supplier = `9${Date.now().toString().slice(-8)}`;
"""
if new_vars not in text:
    if old_vars not in text:
        raise SystemExit('V1-D1 synthetic identifier anchor missing')
    text = text.replace(old_vars, new_vars, 1)

old_supplier = "'0000123456 PROVEEDOR V1D1'"
new_supplier = "`${supplier} PROVEEDOR V1D1`"
if new_supplier not in text:
    if old_supplier not in text:
        raise SystemExit('V1-D1 fixed supplier anchor missing')
    text = text.replace(old_supplier, new_supplier, 1)

path.write_text(text)
Path(__file__).unlink()
print('SAP_V1D1_SMOKE_ISOLATION_FIX_OK')
