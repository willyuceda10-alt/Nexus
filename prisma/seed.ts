import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000002';
const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';
const DEV_PORTFOLIO_ID = '00000000-0000-4000-8000-000000000090';
const DEV_PROGRAM_ID = '00000000-0000-4000-8000-000000000091';
const DEV_PROJECT_ID = '00000000-0000-4000-8000-000000000101';
const DEV_TASK_WEB_API_ID = '00000000-0000-4000-8000-000000000102';
const DEV_TASK_AZURE_ID = '00000000-0000-4000-8000-000000000103';
const DEV_TASK_ENTRA_ID = '00000000-0000-4000-8000-000000000104';

const systemDefinitions = [
  { key: 'PORTFOLIO', name: 'Portafolio', icon: 'layers-3' },
  { key: 'PROGRAM', name: 'Programa', icon: 'network' },
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

    const definitionIds = new Map<string, string>();
    for (const definition of systemDefinitions) {
      const savedDefinition = await tx.objectDefinition.upsert({
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
      definitionIds.set(definition.key, savedDefinition.id);
    }

    const portfolioDefinitionId = definitionIds.get('PORTFOLIO');
    const programDefinitionId = definitionIds.get('PROGRAM');
    const projectDefinitionId = definitionIds.get('PROJECT');
    const taskDefinitionId = definitionIds.get('TASK');
    if (!portfolioDefinitionId || !programDefinitionId || !projectDefinitionId || !taskDefinitionId) {
      throw new Error('Required PORTFOLIO/PROGRAM/PROJECT/TASK definitions were not created.');
    }

    await tx.nexusObject.upsert({
      where: { id: DEV_PORTFOLIO_ID },
      update: {
        workspaceId: workspace.id,
        objectDefinitionId: portfolioDefinitionId,
        objectTypeKey: 'PORTFOLIO',
        title: 'Bridata Enterprise Delivery 2026',
        description: 'Portafolio DEV para gobernar la evolución del producto, plataforma Azure y adopción operativa.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        progress: 35,
        ownerId: user.id,
        assigneeId: user.id,
        metadata: {
          code: 'PORT-BRIDATA-26',
          strategicObjective: 'Consolidar Bridata Project como plataforma empresarial multi-tenant con gobierno, trazabilidad y despliegue Azure.',
          seedKey: 'BRIDATA-DEV-PORTFOLIO',
        },
        deletedAt: null,
      },
      create: {
        id: DEV_PORTFOLIO_ID,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        objectDefinitionId: portfolioDefinitionId,
        objectTypeKey: 'PORTFOLIO',
        title: 'Bridata Enterprise Delivery 2026',
        description: 'Portafolio DEV para gobernar la evolución del producto, plataforma Azure y adopción operativa.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        progress: 35,
        ownerId: user.id,
        assigneeId: user.id,
        metadata: {
          code: 'PORT-BRIDATA-26',
          strategicObjective: 'Consolidar Bridata Project como plataforma empresarial multi-tenant con gobierno, trazabilidad y despliegue Azure.',
          seedKey: 'BRIDATA-DEV-PORTFOLIO',
        },
      },
    });

    await tx.nexusObject.upsert({
      where: { id: DEV_PROGRAM_ID },
      update: {
        workspaceId: workspace.id,
        objectDefinitionId: programDefinitionId,
        objectTypeKey: 'PROGRAM',
        title: 'Programa Core Platform & Azure',
        description: 'Programa que agrupa la estabilización del núcleo de Bridata Project y su plataforma cloud.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        progress: 35,
        ownerId: user.id,
        assigneeId: user.id,
        metadata: {
          portfolioId: DEV_PORTFOLIO_ID,
          code: 'PRG-CORE-AZURE',
          strategicObjective: 'Cerrar persistencia real, seguridad, planificación avanzada y despliegue DEV reproducible en Azure.',
          seedKey: 'BRIDATA-DEV-PROGRAM',
        },
        deletedAt: null,
      },
      create: {
        id: DEV_PROGRAM_ID,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        objectDefinitionId: programDefinitionId,
        objectTypeKey: 'PROGRAM',
        title: 'Programa Core Platform & Azure',
        description: 'Programa que agrupa la estabilización del núcleo de Bridata Project y su plataforma cloud.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        progress: 35,
        ownerId: user.id,
        assigneeId: user.id,
        metadata: {
          portfolioId: DEV_PORTFOLIO_ID,
          code: 'PRG-CORE-AZURE',
          strategicObjective: 'Cerrar persistencia real, seguridad, planificación avanzada y despliegue DEV reproducible en Azure.',
          seedKey: 'BRIDATA-DEV-PROGRAM',
        },
      },
    });

    await tx.nexusObject.upsert({
      where: { id: DEV_PROJECT_ID },
      update: {
        workspaceId: workspace.id,
        objectDefinitionId: projectDefinitionId,
        objectTypeKey: 'PROJECT',
        title: 'Implementación Bridata Project — Core DEV',
        description: 'Proyecto base para validar persistencia real, seguridad multi-tenant y posterior despliegue Azure.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        progress: 35,
        ownerId: user.id,
        assigneeId: user.id,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        dueDate: new Date('2026-11-30T00:00:00.000Z'),
        metadata: {
          portfolioId: DEV_PORTFOLIO_ID,
          programId: DEV_PROGRAM_ID,
          budgetTotal: 250000,
          budgetSpent: 65000,
          baselineStartDate: '2026-08-01',
          baselineEndDate: '2026-11-30',
          seedKey: 'BRIDATA-DEV-CORE',
        },
        deletedAt: null,
      },
      create: {
        id: DEV_PROJECT_ID,
        tenantId: tenant.id,
        workspaceId: workspace.id,
        objectDefinitionId: projectDefinitionId,
        objectTypeKey: 'PROJECT',
        title: 'Implementación Bridata Project — Core DEV',
        description: 'Proyecto base para validar persistencia real, seguridad multi-tenant y posterior despliegue Azure.',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        progress: 35,
        ownerId: user.id,
        assigneeId: user.id,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        dueDate: new Date('2026-11-30T00:00:00.000Z'),
        metadata: {
          portfolioId: DEV_PORTFOLIO_ID,
          programId: DEV_PROGRAM_ID,
          budgetTotal: 250000,
          budgetSpent: 65000,
          baselineStartDate: '2026-08-01',
          baselineEndDate: '2026-11-30',
          seedKey: 'BRIDATA-DEV-CORE',
        },
      },
    });

    const taskFixtures = [
      {
        id: DEV_TASK_WEB_API_ID,
        title: 'Conectar interfaz web con API real',
        description: 'Sustituir la fuente mock de proyectos y tareas por el repositorio API con optimistic locking.',
        status: 'IN_PROGRESS',
        priority: 'CRITICAL',
        progress: 70,
        startDate: '2026-08-18T00:00:00.000Z',
        dueDate: '2026-08-24T00:00:00.000Z',
      },
      {
        id: DEV_TASK_AZURE_ID,
        title: 'Preparar despliegue DEV en Azure',
        description: 'Validar IaC y preparar el primer aprovisionamiento controlado sin consumir servicios innecesarios.',
        status: 'PLANNING',
        priority: 'HIGH',
        progress: 10,
        startDate: '2026-08-25T00:00:00.000Z',
        dueDate: '2026-09-05T00:00:00.000Z',
      },
      {
        id: DEV_TASK_ENTRA_ID,
        title: 'Configurar autenticación Microsoft Entra ID',
        description: 'Conectar login runtime de Bridata Project sin reutilizar la identidad OIDC de GitHub Actions.',
        status: 'DRAFT',
        priority: 'HIGH',
        progress: 0,
        startDate: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-12T00:00:00.000Z',
      },
    ] as const;

    for (const task of taskFixtures) {
      await tx.nexusObject.upsert({
        where: { id: task.id },
        update: {
          workspaceId: workspace.id,
          objectDefinitionId: taskDefinitionId,
          objectTypeKey: 'TASK',
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          progress: task.progress,
          ownerId: user.id,
          assigneeId: user.id,
          startDate: new Date(task.startDate),
          dueDate: new Date(task.dueDate),
          metadata: {
            projectId: DEV_PROJECT_ID,
            seedKey: task.id,
          },
          deletedAt: null,
        },
        create: {
          id: task.id,
          tenantId: tenant.id,
          workspaceId: workspace.id,
          objectDefinitionId: taskDefinitionId,
          objectTypeKey: 'TASK',
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          progress: task.progress,
          ownerId: user.id,
          assigneeId: user.id,
          startDate: new Date(task.startDate),
          dueDate: new Date(task.dueDate),
          metadata: {
            projectId: DEV_PROJECT_ID,
            seedKey: task.id,
          },
        },
      });
    }

    return {
      tenantId: tenant.id,
      userId: user.id,
      workspaceId: workspace.id,
      portfolioId: DEV_PORTFOLIO_ID,
      programId: DEV_PROGRAM_ID,
      projectId: DEV_PROJECT_ID,
      seededObjects: 3 + taskFixtures.length,
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
