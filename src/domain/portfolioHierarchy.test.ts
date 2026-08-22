import { describe, expect, it } from 'vitest';
import { buildPortfolioHierarchy } from './portfolioHierarchy';
import type { NexusObject } from '../types/nexus';

const base = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  description: '',
  status: 'IN_PROGRESS' as const,
  priority: 'MEDIUM' as const,
  ownerId: 'user-1',
  ownerName: 'Owner',
  ownerAvatar: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  progress: 0,
};

function object(value: Partial<NexusObject> & Pick<NexusObject, 'id' | 'type' | 'title'>): NexusObject {
  return { ...base, ...value } as NexusObject;
}

describe('buildPortfolioHierarchy', () => {
  it('derives program membership and portfolio budget from projects only', () => {
    const portfolio = object({
      id: 'portfolio-1',
      type: 'PORTFOLIO',
      title: 'Portfolio',
      code: 'PORT-1',
      strategicObjective: 'Grow',
      budgetTotal: 9_999_999,
      budgetSpent: 9_999_999,
    });
    const program = object({
      id: 'program-1',
      type: 'PROGRAM',
      title: 'Program',
      portfolioId: portfolio.id,
      budgetTotal: 8_888_888,
      budgetSpent: 8_888_888,
    });
    const projectA = object({
      id: 'project-a',
      type: 'PROJECT',
      title: 'A',
      portfolioId: portfolio.id,
      programId: program.id,
      budgetTotal: 100,
      budgetSpent: 40,
      progress: 50,
    });
    const projectB = object({
      id: 'project-b',
      type: 'PROJECT',
      title: 'B',
      portfolioId: portfolio.id,
      budgetTotal: 200,
      budgetSpent: 20,
      progress: 30,
    });

    const [result] = buildPortfolioHierarchy([portfolio, program, projectA, projectB]);

    expect(result).toMatchObject({
      id: portfolio.id,
      budgetAllocated: 300,
      budgetSpent: 60,
      averageProgress: 40,
      projectIds: ['project-a', 'project-b'],
    });
    expect(result.programs).toHaveLength(1);
    expect(result.programs[0]).toMatchObject({
      projectIds: ['project-a'],
      budgetTotal: 100,
      budgetSpent: 40,
      averageProgress: 50,
    });
  });

  it('includes a project through its program even when portfolioId is omitted', () => {
    const portfolio = object({ id: 'portfolio-1', type: 'PORTFOLIO', title: 'Portfolio' });
    const program = object({
      id: 'program-1',
      type: 'PROGRAM',
      title: 'Program',
      portfolioId: portfolio.id,
    });
    const project = object({
      id: 'project-1',
      type: 'PROJECT',
      title: 'Project',
      programId: program.id,
      budgetTotal: 500,
      budgetSpent: 125,
      progress: 25,
    });

    const [result] = buildPortfolioHierarchy([portfolio, program, project]);

    expect(result.projectIds).toEqual([project.id]);
    expect(result.budgetAllocated).toBe(500);
    expect(result.programs[0].projectIds).toEqual([project.id]);
  });
});
