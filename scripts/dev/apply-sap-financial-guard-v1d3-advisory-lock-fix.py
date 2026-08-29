from pathlib import Path

root = Path(__file__).resolve().parents[2]
route_path = root / 'apps/api/src/routes/sap-integration-financial-guard-v1d3.ts'
route = route_path.read_text()

unsafe = """  await tx.$queryRaw<Array<{ lock_result: unknown }>>(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:${connectionId}:SAP_FINANCIAL:${externalKey}`}, 0)
    ) AS lock_result
  `);
"""
safe = """  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`${tenantId}:${connectionId}:SAP_FINANCIAL:${externalKey}`}, 0)
    )
  `);
"""

if safe not in route:
    if unsafe not in route:
        raise SystemExit('V1-D3 advisory lock anchor missing')
    route = route.replace(unsafe, safe, 1)

route_path.write_text(route)
Path(__file__).unlink()
print('SAP_FINANCIAL_GUARD_V1D3_ADVISORY_LOCK_FIX_OK')
