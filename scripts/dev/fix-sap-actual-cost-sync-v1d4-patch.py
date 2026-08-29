from pathlib import Path

root = Path(__file__).resolve().parents[2]
patch_path = root / 'scripts/dev/apply-sap-actual-cost-sync-v1d4.py'
patch = patch_path.read_text()

old = '''    closing = "\\n});\\n"
    if not cost_test.endswith(closing):
        raise SystemExit('Cost Engine test closing anchor missing')
    cost_test = cost_test[:-len(closing)] + negative_test + closing
'''

new = '''    closing = "});"
    closing_index = cost_test.rfind(closing)
    if closing_index < 0:
        raise SystemExit('Cost Engine test closing anchor missing')
    trailing = cost_test[closing_index + len(closing):]
    if trailing.strip():
        raise SystemExit('Unexpected content after Cost Engine test closing anchor')
    cost_test = cost_test[:closing_index] + negative_test + closing + trailing
'''

if new not in patch:
    if old not in patch:
        raise SystemExit('V1-D4 patch closing-anchor block missing')
    patch = patch.replace(old, new, 1)

patch_path.write_text(patch)
Path(__file__).unlink()
print('SAP_ACTUAL_COST_SYNC_V1D4_PATCH_ANCHOR_FIX_OK')
