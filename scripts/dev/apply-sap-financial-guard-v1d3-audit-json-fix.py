from pathlib import Path

root = Path(__file__).resolve().parents[2]
route_path = root / 'apps/api/src/routes/sap-integration-financial-guard-v1d3.ts'
route = route_path.read_text()

anchor = """function dateTimeOrNull(value: string | null): Date | null {\n  if (!value) return null;\n  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);\n  return Number.isNaN(parsed.getTime()) ? null : parsed;\n}\n"""
helper = anchor + """\nfunction toInputJson(value: unknown): Prisma.InputJsonValue {\n  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;\n}\n"""
if "function toInputJson(value: unknown): Prisma.InputJsonValue" not in route:
    if anchor not in route:
        raise SystemExit('dateTimeOrNull anchor missing')
    route = route.replace(anchor, helper, 1)

old = """            details: {\n              counters,\n              blockers: blockers.slice(0, 100),\n              commitmentAuthority: 'PR_UNTIL_PO_THEN_PURCHASE_ORDER_LEDGER',\n              actualCostCanonicalWriteEnabled: false,\n            },\n"""
new = """            details: toInputJson({\n              counters,\n              blockers: blockers.slice(0, 100),\n              commitmentAuthority: 'PR_UNTIL_PO_THEN_PURCHASE_ORDER_LEDGER',\n              actualCostCanonicalWriteEnabled: false,\n            }),\n"""
if new not in route:
    if old not in route:
        raise SystemExit('audit details anchor missing')
    route = route.replace(old, new, 1)

route_path.write_text(route)
Path(__file__).unlink()
print('SAP_FINANCIAL_GUARD_V1D3_AUDIT_JSON_FIX_OK')
