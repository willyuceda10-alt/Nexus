import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const DEV_RESOURCE_ID = '00000000-0000-4000-8000-000000000080';
const DEV_TASK_WEB_API_ID = '00000000-0000-4000-8000-000000000102';
const DEV_TASK_AZURE_ID = '00000000-0000-4000-8000-000000000103';
const DEV_TASK_ENTRA_ID = '00000000-0000-4000-8000-000000000104';

function asRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, Prisma.JsonValue>) };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The DEV resource capacity seed must never run with NODE_ENV=production.');
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${DEV_TENANT_ID}, true)`;

    const [workspace, user] = await Promise.all([
      tx.workspace.findFirst({ where: { id: DEV_WORKSPACE_ID, tenantId: DEV_TENANT_ID }, select: { id: true } }),
      tx.user.findUnique({ where: { id: DEV_USER_ID }, select: { id: true, fullName: true } }),
    ]);
    if (!workspace || !user) {
      throw new Error('Run the Bridata Core DEV seed before the resource capacity seed.');
    }

    const resourceDefinition = await tx.objectDefinition.upsert({
      where: { tenantId_key: { tenantId: DEV_TENANT_ID, key: 'RESOURCE' } },
      update: {
        name: 'Recurso',
        icon: 'users-round',
        isSystem: true,
      },
      create: {
        tenantId: DEV_TENANT_ID,
        key: 'RESOURCE',
        name: 'Recurso',
        icon: 'users-round',
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          title: 'RESOURCE',
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
        isSystem: true,
      },
    });

    await tx.nexusObject.upsert({
      where: { id: DEV_RESOURCE_ID },
      update: {
        workspaceId: DEV_WORKSPACE_ID,
        objectDefinitionId: resourceDefinition.id,
        objectTypeKey: 'RESOURCE',
        title: user.fullName,
        description: 'Perfil de capacidad DEV vinculado al usuario propietario de Bridata Project.',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        progress: 100,
        ownerId: DEV_USER_ID,
        assigneeId: DEV_USER_ID,
        metadata: {
          resourceKind: 'PERSON',
          linkedUserId: DEV_USER_ID,
          capacityHoursPerDay: 8,
          resourceWorkingWeekdays: [1, 2, 3, 4, 5],
          resourceHolidays: [],
          skills: ['Product', 'Engineering', 'Azure'],
          seedKey: 'BRIDATA-DEV-RESOURCE-OWNER',
        },
        deletedAt: null,
      },
      create: {
        id: DEV_RESOURCE_ID,
        tenantId: DEV_TENANT_ID,
        workspaceId: DEV_WORKSPACE_ID,
        objectDefinitionId: resourceDefinition.id,
        objectTypeKey: 'RESOURCE',
        title: user.fullName,
        description: 'Perfil de capacidad DEV vinculado al usuario propietario de Bridata Project.',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        progress: 100,
        ownerId: DEV_USER_ID,
        assigneeId: DEV_USER_ID,
        metadata: {
          resourceKind: 'PERSON',
          linkedUserId: DEV_USER_ID,
          capacityHoursPerDay: 8,
          resourceWorkingWeekdays: [1, 2, 3, 4, 5],
          resourceHolidays: [],
          skills: ['Product', 'Engineering', 'Azure'],
          seedKey: 'BRIDATA-DEV-RESOURCE-OWNER',
        },
      },
    });

    const efforts = new Map<string, number>([
      [DEV_TASK_WEB_API_ID, 48],
      [DEV_TASK_AZURE_ID, 72],
      [DEV_TASK_ENTRA_ID, 40],
    ]);

    for (const [taskId, effortHours] of efforts) {
      const task = await tx.nexusObject.findFirst({
        where: { id: taskId, tenantId: DEV_TENANT_ID, workspaceId: DEV_WORKSPACE_ID, deletedAt: null },
        select: { metadata: true },
      });
      if (!task) throw new Error(`DEV task ${taskId} is missing.`);
      const metadata = asRecord(task.metadata);
      metadata.effortHours = effortHours;
      await tx.nexusObject.update({
        where: { id: taskId },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
    }

    return {
      resourceId: DEV_RESOURCE_ID,
      resourceDefinitionId: resourceDefinition.id,
      effortHours: [...efforts.values()].reduce((sum, value) => sum + value, 0),
    };
  });

  console.info(JSON.stringify({ resourceCapacitySeed: 'PASS', ...result }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
