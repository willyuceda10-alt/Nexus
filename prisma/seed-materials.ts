import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The DEV materials seed must never run with NODE_ENV=production.');
  }

  const definition = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${DEV_TENANT_ID}, true)`;

    const tenant = await tx.tenant.findUnique({
      where: { id: DEV_TENANT_ID },
      select: { id: true },
    });

    if (!tenant) {
      throw new Error('Run the Bridata Core DEV seed before the materials seed.');
    }

    return tx.objectDefinition.upsert({
      where: { tenantId_key: { tenantId: DEV_TENANT_ID, key: 'MATERIAL' } },
      update: {
        name: 'Material',
        description: 'Material, insumo o componente requerido por un proyecto o actividad.',
        icon: 'package-search',
        isSystem: true,
      },
      create: {
        tenantId: DEV_TENANT_ID,
        key: 'MATERIAL',
        name: 'Material',
        description: 'Material, insumo o componente requerido por un proyecto o actividad.',
        icon: 'package-search',
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          title: 'MATERIAL',
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
        isSystem: true,
      },
    });
  });

  console.info(JSON.stringify({ materialsSeed: 'PASS', materialDefinitionId: definition.id }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
