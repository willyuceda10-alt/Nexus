import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, resolveActor } from '../auth.js';

import {
  authorizePermission,
  canAccessWorkspace,
} from '../authorization.js';

import {
  evaluateProjectRiskAlert,
} from '../project-risk-evaluation-service.js';

import { withTenant } from '../tenant-transaction.js';

import {
  validProject,
} from './cost-engine-v2-utils.js';

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

const bodySchema = z.object({
  targetUserId: z.string().uuid(),
});

export async function projectRiskAlertsV1g8Routes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/api/v1/projects/:projectId/risk-alert-v1g8/evaluate',
    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },
    async (request, reply) => {
      const params =
        paramsSchema.safeParse(
          request.params,
        );

      const body =
        bodySchema.safeParse(
          request.body,
        );

      if (
        !params.success ||
        !body.success
      ) {
        return reply
          .code(400)
          .send({
            error:
              'validation_error',
          });
      }

      const actor =
        request.actor!;

      const result =
        await withTenant(
          actor.tenantId,
          async (tx) => {
            const project =
              await validProject(
                tx,
                actor.tenantId,
                params.data.projectId,
              );

            if (!project) {
              return {
                kind:
                  'not_found' as const,
              };
            }

            if (
              !(
                await canAccessWorkspace(
                  tx,
                  actor,
                  project.workspaceId,
                )
              )
            ) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            const permission =
              await authorizePermission(
                tx,
                actor,
                'workspace.manage_automation',
                {
                  workspaceId:
                    project.workspaceId,
                  projectId:
                    project.id,
                },
              );

            if (!permission.allowed) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            const target =
              await tx.tenantMembership
                .findUnique({
                  where: {
                    tenantId_userId: {
                      tenantId:
                        actor.tenantId,
                      userId:
                        body.data
                          .targetUserId,
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
              !target ||
              target.status !==
                'ACTIVE' ||
              !target.user.isActive
            ) {
              return {
                kind: 'invalid_target' as const,
              };
            }

            const workspaceMember =
              await tx.workspaceMember
                .findUnique({
                  where: {
                    workspaceId_userId:
                      {
                        workspaceId:
                          project.workspaceId,
                        userId:
                          body.data
                            .targetUserId,
                      },
                  },
                  select: {
                    tenantId: true,
                  },
                });

            if (
              !workspaceMember ||
              workspaceMember.tenantId !==
                actor.tenantId
            ) {
              return {
                kind: 'invalid_target_scope' as const,
              };
            }

            const {
              current,
              alert,
              assessment,
              notification,
            } = await evaluateProjectRiskAlert(
              tx,
              {
                tenantId: actor.tenantId,
                project,
                targetUserId:
                  body.data.targetUserId,
              },
            );

            if (
              assessment.created ||
              notification?.created
            ) {
              await tx.auditLog.create({
                data: {
                  tenantId:
                    actor.tenantId,

                  userId:
                    actor.userId,

                  action:
                    'PROJECT_RISK_ALERT_EVALUATED',

                  resource:
                    'PROJECT',

                  resourceId:
                    project.id,

                  correlationId:
                    request.id,

                  ipAddress:
                    request.ip,

                  details: {
                    version:
                      'v1g8',

                    targetUserId:
                      body.data
                        .targetUserId,

                    fingerprint:
                      alert.fingerprint,

                    riskLevel:
                      current.risk
                        .riskLevel,

                    priority:
                      alert.priority,

                    assessmentCreated:
                      assessment.created,

                    notificationCreated:
                      notification
                        ?.created ??
                      false,
                  },
                },
              });
            }

            return {
              kind: 'ok' as const,
              project,
              current,
              alert,
              assessment,
              notification,
            };
          },
        );

      if (
        result.kind ===
        'not_found'
      ) {
        return reply
          .code(404)
          .send({
            error:
              'project_not_found',
          });
      }

      if (
        result.kind ===
        'forbidden'
      ) {
        return reply
          .code(403)
          .send({
            error:
              'project_risk_alert_denied',
          });
      }

      if (
        result.kind ===
        'invalid_target'
      ) {
        return reply
          .code(400)
          .send({
            error:
              'notification_target_invalid',
          });
      }

      if (
        result.kind ===
        'invalid_target_scope'
      ) {
        return reply
          .code(400)
          .send({
            error:
              'notification_target_outside_project_workspace',
          });
      }

      const queued =
        result.notification
          ?.created ?? false;

      return reply
        .code(queued ? 202 : 200)
        .send({
          version: 'v1g8',

          project: {
            id:
              result.project.id,
            title:
              result.project.title,
            workspaceId:
              result.project
                .workspaceId,
          },

          currency:
            result.current.currency,

          risk:
            result.current.risk,

          alert: {
            fingerprint:
              result.alert
                .fingerprint,

            shouldNotify:
              result.alert
                .shouldNotify,

            priority:
              result.alert
                .priority,

            assessmentEventId:
              result.assessment.id,

            assessmentCreated:
              result.assessment
                .created,

            notificationEventId:
              result.notification
                ?.id ??
              null,

            notificationQueued:
              queued,

            deduplicated:
              result.alert
                .shouldNotify &&
              !queued,
          },
        });
    },
  );
}
