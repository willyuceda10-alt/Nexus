import { Prisma } from '@prisma/client';

import { prisma } from './db.js';

import {
  evaluateProjectRiskAlert,
} from './project-risk-evaluation-service.js';

import { withTenant } from './tenant-transaction.js';

type TenantPartitionRow = {
  tenant_id: string;
};

type ProjectCandidateV1g9 = {
  id: string;
  title: string;
  workspaceId: string;
  ownerId: string;
  status: string;
};

export type ProjectRiskMonitorV1g9Summary = {
  version: 'v1g9';

  tenantsScanned: number;
  projectsScanned: number;

  alertsQueued: number;
  alertsDeduplicated: number;

  projectsWithoutAlert: number;
  terminalProjectsSkipped: number;
  invalidOwnersSkipped: number;
  failedProjects: number;

  failures: Array<{
    tenantId: string;
    projectId: string;
    error: string;
  }>;
};

export type ProjectRiskMonitorV1g9Options = {
  tenantIds?: string[];
  projectIds?: string[];
};

const TERMINAL_PROJECT_STATUSES =
  new Set([
    'DONE',
    'COMPLETED',
    'CANCELLED',
    'CANCELED',
    'CLOSED',
    'ARCHIVED',
  ]);

export function shouldMonitorProjectV1g9(
  status: string,
): boolean {
  return !TERMINAL_PROJECT_STATUSES.has(
    status.trim().toUpperCase(),
  );
}

export async function listRiskMonitorTenantsV1g9():
Promise<string[]> {
  const rows = await prisma.$queryRaw<
    TenantPartitionRow[]
  >(Prisma.sql`
    SELECT tenant_id
    FROM outbox_tenant_partitions
    ORDER BY tenant_id
  `);

  return rows.map(
    (row) => row.tenant_id,
  );
}

async function listTenantProjectsV1g9(
  tenantId: string,
  projectFilter?: Set<string>,
): Promise<{
  candidates: ProjectCandidateV1g9[];
  terminalSkipped: number;
}> {
  return withTenant(
    tenantId,
    async (tx) => {
      const rows =
        await tx.nexusObject.findMany({
          where: {
            tenantId,
            objectTypeKey: 'PROJECT',
            deletedAt: null,
          },

          select: {
            id: true,
            title: true,
            workspaceId: true,
            ownerId: true,
            status: true,
          },

          orderBy: {
            id: 'asc',
          },
        });

      let terminalSkipped = 0;

      const candidates =
        rows.filter((project) => {
          if (
            projectFilter &&
            !projectFilter.has(project.id)
          ) {
            return false;
          }

          if (
            !shouldMonitorProjectV1g9(
              project.status,
            )
          ) {
            terminalSkipped += 1;
            return false;
          }

          return true;
        });

      return {
        candidates,
        terminalSkipped,
      };
    },
  );
}

async function evaluateProjectV1g9(
  tenantId: string,
  projectId: string,
) {
  return withTenant(
    tenantId,
    async (tx) => {
      const project =
        await tx.nexusObject.findFirst({
          where: {
            id: projectId,
            tenantId,
            objectTypeKey: 'PROJECT',
            deletedAt: null,
          },

          select: {
            id: true,
            title: true,
            workspaceId: true,
            ownerId: true,
            metadata: true,
            status: true,
          },
        });

      if (!project) {
        return {
          kind: 'missing' as const,
        };
      }

      if (
        !shouldMonitorProjectV1g9(
          project.status,
        )
      ) {
        return {
          kind: 'terminal' as const,
        };
      }

      const tenantMembership =
        await tx.tenantMembership.findUnique({
          where: {
            tenantId_userId: {
              tenantId,
              userId: project.ownerId,
            },
          },

          include: {
            user: {
              select: {
                isActive: true,
              },
            },
          },
        });

      if (
        !tenantMembership ||
        tenantMembership.status !== 'ACTIVE' ||
        !tenantMembership.user.isActive
      ) {
        return {
          kind: 'invalid_owner' as const,
        };
      }

      const workspaceMembership =
        await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId:
                project.workspaceId,
              userId:
                project.ownerId,
            },
          },

          select: {
            tenantId: true,
          },
        });

      if (
        !workspaceMembership ||
        workspaceMembership.tenantId !==
          tenantId
      ) {
        return {
          kind: 'invalid_owner' as const,
        };
      }

      const evaluation =
        await evaluateProjectRiskAlert(
          tx,
          {
            tenantId,

            project: {
              id: project.id,
              title: project.title,
              workspaceId:
                project.workspaceId,
              metadata:
                project.metadata,
            },

            targetUserId:
              project.ownerId,
          },
        );

      if (
        evaluation.assessment.created ||
        evaluation.notification?.created
      ) {
        await tx.auditLog.create({
          data: {
            tenantId,

            userId: null,

            action:
              'PROJECT_RISK_MONITOR_EVALUATED_V1G9',

            resource: 'PROJECT',

            resourceId:
              project.id,

            details: {
              version: 'v1g9',

              targetUserId:
                project.ownerId,

              fingerprint:
                evaluation.alert
                  .fingerprint,

              riskLevel:
                evaluation.current.risk
                  .riskLevel,

              priority:
                evaluation.alert.priority,

              assessmentCreated:
                evaluation.assessment
                  .created,

              notificationCreated:
                evaluation.notification
                  ?.created ?? false,

              mode:
                'AUTOMATIC_MONITOR',
            },
          },
        });
      }

      return {
        kind: 'evaluated' as const,
        evaluation,
      };
    },
  );
}

function errorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function runProjectRiskMonitorV1g9(
  options: ProjectRiskMonitorV1g9Options = {},
): Promise<ProjectRiskMonitorV1g9Summary> {
  const tenantIds =
    options.tenantIds
      ? [...new Set(options.tenantIds)]
      : await listRiskMonitorTenantsV1g9();

  const projectFilter =
    options.projectIds
      ? new Set(options.projectIds)
      : undefined;

  const summary:
    ProjectRiskMonitorV1g9Summary = {
      version: 'v1g9',

      tenantsScanned: 0,
      projectsScanned: 0,

      alertsQueued: 0,
      alertsDeduplicated: 0,

      projectsWithoutAlert: 0,
      terminalProjectsSkipped: 0,
      invalidOwnersSkipped: 0,
      failedProjects: 0,

      failures: [],
    };

  for (const tenantId of tenantIds) {
    summary.tenantsScanned += 1;

    let projectList;

    try {
      projectList =
        await listTenantProjectsV1g9(
          tenantId,
          projectFilter,
        );
    } catch (error) {
      summary.failedProjects += 1;

      summary.failures.push({
        tenantId,
        projectId: '*',
        error: errorMessage(error),
      });

      continue;
    }

    summary.terminalProjectsSkipped +=
      projectList.terminalSkipped;

    for (
      const project
      of projectList.candidates
    ) {
      summary.projectsScanned += 1;

      try {
        const result =
          await evaluateProjectV1g9(
            tenantId,
            project.id,
          );

        if (
          result.kind ===
          'invalid_owner'
        ) {
          summary.invalidOwnersSkipped += 1;
          continue;
        }

        if (
          result.kind === 'missing' ||
          result.kind === 'terminal'
        ) {
          continue;
        }

        const {
          alert,
          notification,
        } = result.evaluation;

        if (!alert.shouldNotify) {
          summary.projectsWithoutAlert += 1;
          continue;
        }

        if (notification?.created) {
          summary.alertsQueued += 1;
        } else {
          summary.alertsDeduplicated += 1;
        }
      } catch (error) {
        summary.failedProjects += 1;

        summary.failures.push({
          tenantId,
          projectId: project.id,
          error: errorMessage(error),
        });
      }
    }
  }

  return summary;
}
