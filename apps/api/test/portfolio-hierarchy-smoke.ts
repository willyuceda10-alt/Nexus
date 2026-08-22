import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000003';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await buildApp();
  const createdIds: string[] = [];

  try {
    const bootstrapResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { 'x-correlation-id': 'ci-portfolio-bootstrap' },
    });
    assert(bootstrapResponse.statusCode === 200, `Bootstrap failed: ${bootstrapResponse.statusCode} ${bootstrapResponse.body}`);

    const bootstrap = bootstrapResponse.json() as {
      objectDefinitions: Array<{ id: string; key: string }>;
    };
    const definition = (key: string) => bootstrap.objectDefinitions.find((item) => item.key === key)?.id;
    const portfolioDefinitionId = definition('PORTFOLIO');
    const programDefinitionId = definition('PROGRAM');
    const projectDefinitionId = definition('PROJECT');
    assert(portfolioDefinitionId, 'PORTFOLIO definition missing from bootstrap.');
    assert(programDefinitionId, 'PROGRAM definition missing from bootstrap.');
    assert(projectDefinitionId, 'PROJECT definition missing from bootstrap.');

    const create = async (payload: Record<string, unknown>) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/objects',
        headers: { 'x-correlation-id': `ci-hierarchy-${createdIds.length + 1}` },
        payload,
      });
      assert(response.statusCode === 201, `Hierarchy create failed: ${response.statusCode} ${response.body}`);
      const body = response.json() as { id: string; metadata: Record<string, unknown> | null };
      createdIds.push(body.id);
      return body;
    };

    const portfolio = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: portfolioDefinitionId,
      objectTypeKey: 'PORTFOLIO',
      title: 'CI Portfolio',
      status: 'PLANNING',
      priority: 'HIGH',
      progress: 0,
      metadata: {
        code: 'PORT-CI',
        strategicObjective: 'Validate persistent hierarchy',
      },
    });

    const program = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: programDefinitionId,
      objectTypeKey: 'PROGRAM',
      title: 'CI Program',
      status: 'PLANNING',
      priority: 'HIGH',
      progress: 0,
      metadata: {
        portfolioId: portfolio.id,
        code: 'PRG-CI',
      },
    });

    const project = await create({
      workspaceId: WORKSPACE_ID,
      objectDefinitionId: projectDefinitionId,
      objectTypeKey: 'PROJECT',
      title: 'CI Project',
      status: 'PLANNING',
      priority: 'MEDIUM',
      progress: 20,
      metadata: {
        portfolioId: portfolio.id,
        programId: program.id,
        budgetTotal: 1000,
        budgetSpent: 250,
      },
    });

    assert(program.metadata?.portfolioId === portfolio.id, 'Program did not persist portfolioId.');
    assert(project.metadata?.portfolioId === portfolio.id, 'Project did not persist portfolioId.');
    assert(project.metadata?.programId === program.id, 'Project did not persist programId.');

    const portfoliosResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects?workspaceId=${WORKSPACE_ID}&type=PORTFOLIO&limit=100`,
      headers: { 'x-correlation-id': 'ci-hierarchy-list-portfolios' },
    });
    assert(portfoliosResponse.statusCode === 200, `Portfolio list failed: ${portfoliosResponse.statusCode}`);
    const portfolios = portfoliosResponse.json() as { items: Array<{ id: string }> };
    assert(portfolios.items.some((item) => item.id === portfolio.id), 'Created portfolio was not returned by API list.');

    const programsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/objects?workspaceId=${WORKSPACE_ID}&type=PROGRAM&limit=100`,
      headers: { 'x-correlation-id': 'ci-hierarchy-list-programs' },
    });
    assert(programsResponse.statusCode === 200, `Program list failed: ${programsResponse.statusCode}`);
    const programs = programsResponse.json() as { items: Array<{ id: string }> };
    assert(programs.items.some((item) => item.id === program.id), 'Created program was not returned by API list.');

    console.info(JSON.stringify({
      portfolioHierarchy: 'PASS',
      portfolioId: portfolio.id,
      programId: program.id,
      projectId: project.id,
      definitions: ['PORTFOLIO', 'PROGRAM', 'PROJECT'],
    }));
  } finally {
    for (const id of [...createdIds].reverse()) {
      await app.inject({ method: 'DELETE', url: `/api/v1/objects/${id}` });
    }
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
