from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'PATCH_OK {path}')


route = 'apps/api/src/routes/sap-integration-foundation-v1a.ts'
replace_once(
    route,
    "            AND is_active = true\n            AND source_key = ANY(${body.data.allowedSourceKeys}::text[])\n",
    "            AND is_active = true\n",
)
replace_once(
    route,
    "        const rows = await tx.$queryRaw<ServicePrincipalRow[]>(Prisma.sql`\n          INSERT INTO integration_service_principals\n",
    "        const allowedSourceKeysSql = Prisma.sql`ARRAY[${Prisma.join(body.data.allowedSourceKeys)}]::text[]`;\n"
    "        const rows = await tx.$queryRaw<ServicePrincipalRow[]>(Prisma.sql`\n"
    "          INSERT INTO integration_service_principals\n",
)
replace_once(
    route,
    "             ${body.data.displayName}, ${body.data.allowedSourceKeys}::text[], 'ACTIVE', CURRENT_TIMESTAMP)\n",
    "             ${body.data.displayName}, ${allowedSourceKeysSql}, 'ACTIVE', CURRENT_TIMESTAMP)\n",
)
replace_once(
    route,
    "  app.get('/api/v1/integrations/sap/foundation-capabilities', async (_request, _reply) => ({\n",
    "  app.get(\n"
    "    '/api/v1/integrations/sap/foundation-capabilities',\n"
    "    { preHandler: [authenticate, resolveActor] },\n"
    "    async (_request, _reply) => ({\n",
)
replace_once(
    route,
    "    servicePrincipalAuthenticationEnabled: false,\n  }));\n}\n",
    "      servicePrincipalAuthenticationEnabled: false,\n    }),\n  );\n}\n",
)

Path(__file__).unlink()
print('SAP_INTEGRATION_FOUNDATION_V1A_HARDENING_OK')
