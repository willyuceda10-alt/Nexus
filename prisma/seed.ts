import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';

const systemDefinitions = [
  { key: 'PROJECT', name: 'Proyecto', icon: 'briefcase' },
  { key: 'TASK', name: 'Tarea', icon: 'check-square' },
  { key: 'DELIVERABLE', name: 'Entregable', icon: 'package-check' },
  { key: 'MILESTONE', name: 'Hito', icon: 'flag' },
  { key: 'RISK', name: 'Riesgo', icon: 'shield-alert' },
  { key: 'CHANGE_REQUEST', name: 'Solicitud de Cambio', icon: 'git-pull-request' },
  { key: 'DECISION', name: 'Decisión', icon: 'scale' },
  { key: 'MEETING', name: 'Reunión', icon: 'calendar-days' },
  { key: 'DOCUMENT', name: 'Documento', icon: 'file-text' },
  { key: 'INCIDENT', name: 'Incidente', icon: 'triangle-alert' },
] as const;

function baseSchema(key: string) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: key,
    type: 'object',
    properties: {},
    additionalProperties: true,
  };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The DEV seed must never run with NODE_ENV=production.');
  }

  // User is global and intentionally not tenant-scoped by RLS.
  const user = await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: {
      email: 'owner@bridata.local',
      fullName: 'Bridata DEV Owner',
      isActive: true,
    },
    create: {
      id: DEV_USER_ID,
      email: 'owner@bridata.local',
      fullName: 'Bridata DEV Owner',
      isActive: true,
    },
  });

  const result = await prisma.$transaction(async (tx) => {
    // FORCE RLS requires the tenant context before touching any tenant-scoped row,
    // including the tenant row itself.
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${DEV_TENANT_ID}, true)`;

    const tenant = await tx.tenant.upsert({
      where: { id: DEV_TENANT_ID },
      update: {
        name: 'Bridata Project Development',
        slug: 'bridata-project-dev',
        status: 'ACTIVE',
      },
      create: {
        id: DEV_TENANT_ID,
        name: 'Bridata Project Development',
        slug: 'bridata-project-dev',
        plan: 'ENTERPRISE',
        status: 'ACTIVE',
      },
    });

    await tx.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      update: { role: 'OWNER', status: 'ACTIVE' },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    const workspace = await tx.workspace.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: 'CORE',
        },
      },
      update: {
        name: 'Bridata Project Core Development',
        description: 'Workspace bootstrap for Bridata Project local and Azure DEV validation.',
      },
      create: {
        id: DEV_WORKSPACE_ID,
        tenantId: tenant.id,
        code: 'CORE',
        name: 'Bridata Project Core Development',
        description: 'Workspace bootstrap for Bridata Project local and Azure DEV validation.',
      },
    });

    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id,
        },
      },
      update: { role: 'OWNER', tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: 'OWNER',
      },
    });

    for (const definition of systemDefinitions) {
      await tx.objectDefinition.upsert({
        where: {
          tenantId_key: {
            tenantId: tenant.id,
            key: definition.key,
          },
        },
        update: {
          name: definition.name,
          icon: definition.icon,
          isSystem: true,
        },
        create: {
          tenantId: tenant.id,
          key: definition.key,
          name: definition.name,
          icon: definition.icon,
          schema: baseSchema(definition.key),
          isSystem: true,
        },
      });
    }

    return {
      tenantId: tenant.id,
      userId: user.id,
      workspaceId: workspace.id,
    };
  });

  console.info(
    JSON.stringify(
      {
        seeded: true,
        product: 'Bridata Project',
        ...result,
        objectDefinitions: systemDefinitions.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
