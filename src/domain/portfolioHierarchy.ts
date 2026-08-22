import type { NexusObject, Portfolio } from '../types/nexus';

export interface ProgramHierarchy {
  object: NexusObject;
  projectIds: string[];
  budgetTotal: number;
  budgetSpent: number;
  averageProgress: number;
}

export interface PortfolioHierarchy {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string;
  strategicObjective: string;
  object: NexusObject | null;
  programs: ProgramHierarchy[];
  projectIds: string[];
  budgetAllocated: number;
  budgetSpent: number;
  averageProgress: number;
}

function average(values: number[]): number {
  return values.length > 0
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

function projectBudget(projects: NexusObject[]): { total: number; spent: number } {
  return projects.reduce(
    (result, project) => ({
      total: result.total + (project.budgetTotal ?? 0),
      spent: result.spent + (project.budgetSpent ?? 0),
    }),
    { total: 0, spent: 0 },
  );
}

export function buildPortfolioHierarchy(
  objects: NexusObject[],
  legacyPortfolios: Portfolio[] = [],
): PortfolioHierarchy[] {
  const portfolioObjects = objects.filter((object) => object.type === 'PORTFOLIO');
  const programObjects = objects.filter((object) => object.type === 'PROGRAM');
  const projects = objects.filter((object) => object.type === 'PROJECT');

  if (portfolioObjects.length === 0) {
    return legacyPortfolios.map((portfolio) => {
      const portfolioProjects = projects.filter((project) => portfolio.projectIds.includes(project.id));
      return {
        id: portfolio.id,
        tenantId: portfolio.tenantId,
        name: portfolio.name,
        code: portfolio.code,
        description: portfolio.description,
        strategicObjective: portfolio.strategicObjective,
        object: null,
        programs: [],
        projectIds: [...portfolio.projectIds],
        budgetAllocated: portfolio.budgetAllocated,
        budgetSpent: portfolio.budgetSpent,
        averageProgress: average(portfolioProjects.map((project) => project.progress)),
      };
    });
  }

  const programById = new Map(programObjects.map((program) => [program.id, program]));

  return portfolioObjects.map((portfolio) => {
    const programs = programObjects
      .filter((program) => program.portfolioId === portfolio.id)
      .map((program): ProgramHierarchy => {
        const programProjects = projects.filter((project) => project.programId === program.id);
        const budget = projectBudget(programProjects);
        return {
          object: program,
          projectIds: programProjects.map((project) => project.id),
          budgetTotal: budget.total,
          budgetSpent: budget.spent,
          averageProgress: average(programProjects.map((project) => project.progress)),
        };
      });

    const portfolioProjects = projects.filter((project) => {
      if (project.portfolioId === portfolio.id) return true;
      if (!project.programId) return false;
      return programById.get(project.programId)?.portfolioId === portfolio.id;
    });
    const budget = projectBudget(portfolioProjects);

    return {
      id: portfolio.id,
      tenantId: portfolio.tenantId,
      name: portfolio.title,
      code: portfolio.code ?? `PORT-${portfolio.id.slice(0, 8).toUpperCase()}`,
      description: portfolio.description,
      strategicObjective: portfolio.strategicObjective ?? '',
      object: portfolio,
      programs,
      projectIds: portfolioProjects.map((project) => project.id),
      budgetAllocated: budget.total,
      budgetSpent: budget.spent,
      averageProgress: average(portfolioProjects.map((project) => project.progress)),
    };
  });
}
