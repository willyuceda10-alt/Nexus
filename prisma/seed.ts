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

  const tenant = await prisma.tenant.upsert({
    where: { id: DEV_TENANT_ID },
    update: { status: 'ACTIVE' },
    create: {
      id: DEV_TENANT_ID,
      name: 'Nexus Development',
      slug: 'nexus-dev',
      plan: 'ENTERPRISE',
      status: 'ACTIVE',
    },
  });

  const user = await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    update: { isActive: true },
    create: {
      id: DEV_USER_ID,
      email: 'owner@nexus.local',
      fullName: 'Nexus DEV Owner',
      isActive: true,
    },
  });

  await prisma.tenantMembership.upsert({
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

  const workspace = await prisma.workspace.upsert({
    where: {
      tenantId_code: {
        tenantId: tenant.id,
        code: 'CORE',
      },
    },
    update: { name: 'Nexus Core Development' },
    create: {
      id: DEV_WORKSPACE_ID,
      tenantId: tenant.id,
      code: 'CORE',
      name: 'Nexus Core Development',
      description: 'Workspace bootstrap for local and Azure DEV validation.',
    },
  });

  await prisma.workspaceMember.upsert({
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
    await prisma.objectDefinition.upsert({
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

  console.info(
    JSON.stringify(
      {
        seeded: true,
        tenantId: tenant.id,
        userId: user.id,
        workspaceId: workspace.id,
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
