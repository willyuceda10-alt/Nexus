import type {
  FastifyInstance,
} from 'fastify';

import {
  Prisma,
} from '@prisma/client';

import {
  z,
} from 'zod';

import {
  authenticate,
  resolveActor,
} from '../auth.js';

import {
  canAccessProject,
  canManageProject,
} from '../authorization.js';

import {
  buildProjectRiskAlertV1g8,
} from '../domain/project-risk-alert-v1g8.js';

import {
  findProjectRiskCaseV1g15,
  projectIdFromRiskCaseV1g15,
  syncProjectRiskCaseV1g15,
} from '../domain/project-risk-case-v1g15.js';

import {
  calculateCurrentRisk,
} from '../project-risk-evaluation-service.js';

import {
  withTenant,
} from '../tenant-transaction.js';

const projectParamsSchema =
  z.object({
    projectId:
      z.string().uuid(),
  });

const riskParamsSchema =
  z.object({
    riskId:
      z.string().uuid(),
  });

const mitigationSchema =
  z.object({
    mitigationObjectId:
      z.string().uuid(),

    notes:
      z.string()
        .trim()
        .min(1)
        .max(4000)
        .optional(),
  });

const assignSchema =
  z.object({
    assigneeId:
      z.string().uuid(),
  });

const resolveSchema =
  z.object({
    resolutionNote:
      z.string()
        .trim()
        .min(3)
        .max(4000),
  });

function jsonRecord(
  value:
    | Prisma.JsonValue
    | null,
):
Record<string, Prisma.JsonValue> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value as
    Record<
      string,
      Prisma.JsonValue
    >;
}

function serializeRiskCase(
  riskCase: {
    id: string;
    workspaceId: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    progress: number;
    ownerId: string;
    assigneeId: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  const metadata =
    jsonRecord(
      riskCase.metadata,
    );

  return {
    version:
      'v1g15',

    id:
      riskCase.id,

    projectId:
      typeof metadata
        .projectId ===
        'string'
        ? metadata.projectId
        : null,

    workspaceId:
      riskCase.workspaceId,

    title:
      riskCase.title,

    description:
      riskCase.description,

    status:
      riskCase.status,

    priority:
      riskCase.priority,

    progress:
      riskCase.progress,

    ownerId:
      riskCase.ownerId,

    assigneeId:
      riskCase.assigneeId,

    riskLevel:
      metadata.riskLevel ??
      null,

    drivers:
      metadata.drivers ??
      [],

    fingerprint:
      metadata.fingerprint ??
      null,

    financialHealth:
      metadata.financialHealth ??
      null,

    scheduleHealth:
      metadata.scheduleHealth ??
      null,

    acknowledgedAt:
      metadata.acknowledgedAt ??
      null,

    acknowledgedBy:
      metadata.acknowledgedBy ??
      null,

    resolvedAt:
      metadata.resolvedAt ??
      null,

    resolutionNote:
      metadata.resolutionNote ??
      null,

    createdAt:
      riskCase.createdAt
        .toISOString(),

    updatedAt:
      riskCase.updatedAt
        .toISOString(),
  };
}

async function loadRiskCaseContext(
  tx:
    Prisma.TransactionClient,

  tenantId:
    string,

  riskId:
    string,
) {
  const riskCase =
    await tx.nexusObject
      .findFirst({
        where: {
          id:
            riskId,

          tenantId,

          objectTypeKey:
            'RISK',

          deletedAt:
            null,
        },
      });

  if (!riskCase) {
    return null;
  }

  const projectId =
    projectIdFromRiskCaseV1g15(
      riskCase.metadata,
    );

  if (!projectId) {
    return null;
  }

  const project =
    await tx.nexusObject
      .findFirst({
        where: {
          id:
            projectId,

          tenantId,

          objectTypeKey:
            'PROJECT',

          deletedAt:
            null,
        },

        select: {
          id: true,
          workspaceId: true,
        },
      });

  if (!project) {
    return null;
  }

  return {
    riskCase,
    project,
  };
}

export async function
projectRiskCasesV1g15Routes(
  app:
    FastifyInstance,
): Promise<void> {
  app.get(
    '/api/v1/projects/:projectId/risk-case-v1g15',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) => {
      const params =
        projectParamsSchema
          .safeParse(
            request.params,
          );

      if (!params.success) {
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
              await tx.nexusObject
                .findFirst({
                  where: {
                    id:
                      params.data
                        .projectId,

                    tenantId:
                      actor.tenantId,

                    objectTypeKey:
                      'PROJECT',

                    deletedAt:
                      null,
                  },

                  select: {
                    id: true,
                  },
                });

            if (!project) {
              return {
                kind:
                  'not_found' as const,
              };
            }

            if (
              !await canAccessProject(
                tx,
                actor,
                project.id,
              )
            ) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            const riskCase =
              await findProjectRiskCaseV1g15(
                tx,
                actor.tenantId,
                project.id,
              );

            return {
              kind:
                'ok' as const,

              riskCase,
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
              'project_access_denied',
          });
      }

      return reply.send({
        version:
          'v1g15',

        exists:
          Boolean(
            result.riskCase,
          ),

        riskCase:
          result.riskCase
            ? serializeRiskCase(
                result.riskCase,
              )
            : null,
      });
    },
  );


  app.post(
    '/api/v1/projects/:projectId/risk-case-v1g15/sync',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) => {
      const params =
        projectParamsSchema
          .safeParse(
            request.params,
          );

      if (!params.success) {
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
              await tx.nexusObject
                .findFirst({
                  where: {
                    id:
                      params.data
                        .projectId,

                    tenantId:
                      actor.tenantId,

                    objectTypeKey:
                      'PROJECT',

                    deletedAt:
                      null,
                  },

                  select: {
                    id: true,
                    title: true,
                    workspaceId: true,
                    ownerId: true,
                    metadata: true,
                  },
                });

            if (!project) {
              return {
                kind:
                  'not_found' as const,
              };
            }

            if (
              !await canManageProject(
                tx,
                actor,
                project.id,
              )
            ) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            const current =
              await calculateCurrentRisk(
                tx,
                actor.tenantId,
                {
                  id:
                    project.id,

                  workspaceId:
                    project.workspaceId,

                  metadata:
                    project.metadata,
                },
              );

            const alert =
              buildProjectRiskAlertV1g8({
                tenantId:
                  actor.tenantId,

                projectId:
                  project.id,

                projectTitle:
                  project.title,

                workspaceId:
                  project.workspaceId,

                targetUserId:
                  project.ownerId,

                risk:
                  current.risk,
              });

            const sync =
              await syncProjectRiskCaseV1g15(
                tx,
                {
                  tenantId:
                    actor.tenantId,

                  project: {
                    id:
                      project.id,

                    title:
                      project.title,

                    workspaceId:
                      project.workspaceId,

                    ownerId:
                      project.ownerId,
                  },

                  snapshot: {
                    riskLevel:
                      current.risk
                        .riskLevel,

                    drivers:
                      current.risk
                        .drivers,

                    fingerprint:
                      alert.fingerprint,

                    financialHealth:
                      current.risk
                        .financial
                        .health,

                    scheduleHealth:
                      current.risk
                        .schedule
                        .health,
                  },
                },
              );

            await tx.auditLog.create({
              data: {
                tenantId:
                  actor.tenantId,

                userId:
                  actor.userId,

                action:
                  'PROJECT_RISK_CASE_SYNCED_V1G15',

                resource:
                  'PROJECT',

                resourceId:
                  project.id,

                correlationId:
                  request.id,

                ipAddress:
                  request.ip,

                details: {
                  action:
                    sync.action,

                  riskCaseId:
                    sync.riskCase
                      ?.id ??
                    null,

                  riskLevel:
                    current.risk
                      .riskLevel,
                },
              },
            });

            return {
              kind:
                'ok' as const,

              sync,
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
              'project_manage_denied',
          });
      }

      return reply.send({
        version:
          'v1g15',

        action:
          result.sync.action,

        riskCase:
          result.sync.riskCase
            ? serializeRiskCase(
                result.sync
                  .riskCase,
              )
            : null,
      });
    },
  );


  app.post(
    '/api/v1/project-risk-cases-v1g15/:riskId/acknowledge',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) => {
      const params =
        riskParamsSchema
          .safeParse(
            request.params,
          );

      if (!params.success) {
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
            const context =
              await loadRiskCaseContext(
                tx,
                actor.tenantId,
                params.data.riskId,
              );

            if (!context) {
              return {
                kind:
                  'not_found' as const,
              };
            }

            if (
              !await canManageProject(
                tx,
                actor,
                context.project.id,
              )
            ) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            if (
              context.riskCase
                .status ===
              'RESOLVED'
            ) {
              return {
                kind:
                  'resolved' as const,
              };
            }

            const metadata = {
              ...jsonRecord(
                context.riskCase
                  .metadata,
              ),

              acknowledgedAt:
                new Date()
                  .toISOString(),

              acknowledgedBy:
                actor.userId,
            };

            const riskCase =
              await tx.nexusObject
                .update({
                  where: {
                    id:
                      context
                        .riskCase
                        .id,
                  },

                  data: {
                    status:
                      context
                        .riskCase
                        .status ===
                        'MITIGATING'
                        ? 'MITIGATING'
                        : 'ACKNOWLEDGED',

                    progress:
                      context
                        .riskCase
                        .status ===
                        'MITIGATING'
                        ? context
                            .riskCase
                            .progress
                        : Math.max(
                            context
                              .riskCase
                              .progress,
                            10,
                          ),

                    metadata:
                      metadata as
                        Prisma.InputJsonValue,
                  },
                });

            await Promise.all([
              tx.domainEvent.create({
                data: {
                  tenantId:
                    actor.tenantId,

                  aggregateId:
                    riskCase.id,

                  eventType:
                    'bridata.project.risk.case.acknowledged',

                  idempotencyKey:
                    `risk-case-ack:${riskCase.id}:${request.id}`,

                  payload: {
                    version:
                      'v1g15',

                    riskCaseId:
                      riskCase.id,

                    projectId:
                      context.project
                        .id,

                    actorId:
                      actor.userId,
                  },
                },
              }),

              tx.auditLog.create({
                data: {
                  tenantId:
                    actor.tenantId,

                  userId:
                    actor.userId,

                  action:
                    'PROJECT_RISK_CASE_ACKNOWLEDGED_V1G15',

                  resource:
                    'RISK',

                  resourceId:
                    riskCase.id,

                  correlationId:
                    request.id,

                  ipAddress:
                    request.ip,
                },
              }),
            ]);

            return {
              kind:
                'ok' as const,

              riskCase,
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
              'risk_case_not_found',
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
              'risk_case_manage_denied',
          });
      }

      if (
        result.kind ===
          'resolved'
      ) {
        return reply
          .code(409)
          .send({
            error:
              'risk_case_already_resolved',
          });
      }

      return reply.send(
        serializeRiskCase(
          result.riskCase,
        ),
      );
    },
  );


  app.put(
    '/api/v1/project-risk-cases-v1g15/:riskId/assignee',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) => {
      const params =
        riskParamsSchema
          .safeParse(
            request.params,
          );

      const body =
        assignSchema
          .safeParse(
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
            const context =
              await loadRiskCaseContext(
                tx,
                actor.tenantId,
                params.data.riskId,
              );

            if (!context) {
              return {
                kind:
                  'not_found' as const,
              };
            }

            if (
              !await canManageProject(
                tx,
                actor,
                context.project.id,
              )
            ) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            const membership =
              await tx.workspaceMember
                .findUnique({
                  where: {
                    workspaceId_userId: {
                      workspaceId:
                        context.project
                          .workspaceId,

                      userId:
                        body.data
                          .assigneeId,
                    },
                  },

                  include: {
                    user: {
                      select: {
                        isActive:
                          true,
                      },
                    },
                  },
                });

            if (
              !membership ||
              membership.tenantId !==
                actor.tenantId ||
              !membership.user
                .isActive
            ) {
              return {
                kind:
                  'invalid_assignee' as const,
              };
            }

            const riskCase =
              await tx.nexusObject
                .update({
                  where: {
                    id:
                      context
                        .riskCase
                        .id,
                  },

                  data: {
                    assigneeId:
                      body.data
                        .assigneeId,
                  },
                });

            await tx.domainEvent.create({
              data: {
                tenantId:
                  actor.tenantId,

                aggregateId:
                  riskCase.id,

                eventType:
                  'bridata.project.risk.case.assigned',

                idempotencyKey:
                  `risk-case-assign:${riskCase.id}:${request.id}`,

                payload: {
                  version:
                    'v1g15',

                  riskCaseId:
                    riskCase.id,

                  projectId:
                    context.project.id,

                  assigneeId:
                    body.data
                      .assigneeId,

                  actorId:
                    actor.userId,
                },
              },
            });

            return {
              kind:
                'ok' as const,

              riskCase,
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
              'risk_case_not_found',
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
              'risk_case_manage_denied',
          });
      }

      if (
        result.kind ===
          'invalid_assignee'
      ) {
        return reply
          .code(400)
          .send({
            error:
              'invalid_risk_assignee',
          });
      }

      return reply.send(
        serializeRiskCase(
          result.riskCase,
        ),
      );
    },
  );


  app.post(
    '/api/v1/project-risk-cases-v1g15/:riskId/mitigations',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) => {
      const params =
        riskParamsSchema
          .safeParse(
            request.params,
          );

      const body =
        mitigationSchema
          .safeParse(
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
            const context =
              await loadRiskCaseContext(
                tx,
                actor.tenantId,
                params.data.riskId,
              );

            if (!context) {
              return {
                kind:
                  'not_found' as const,
              };
            }

            if (
              !await canManageProject(
                tx,
                actor,
                context.project.id,
              )
            ) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            if (
              context.riskCase
                .status ===
              'RESOLVED'
            ) {
              return {
                kind:
                  'resolved' as const,
              };
            }

            const mitigation =
              await tx.nexusObject
                .findFirst({
                  where: {
                    id:
                      body.data
                        .mitigationObjectId,

                    tenantId:
                      actor.tenantId,

                    workspaceId:
                      context.project
                        .workspaceId,

                    deletedAt:
                      null,
                  },

                  select: {
                    id: true,
                  },
                });

            if (!mitigation) {
              return {
                kind:
                  'mitigation_not_found' as const,
              };
            }

            const existingRelation =
              await tx.objectRelation
                .findFirst({
                  where: {
                    tenantId:
                      actor.tenantId,

                    sourceObjectId:
                      mitigation.id,

                    targetObjectId:
                      context
                        .riskCase
                        .id,

                    relationType:
                      'MITIGATES',
                  },
                });

            const relation =
              existingRelation ??
              await tx.objectRelation
                .create({
                  data: {
                    tenantId:
                      actor.tenantId,

                    sourceObjectId:
                      mitigation.id,

                    targetObjectId:
                      context
                        .riskCase
                        .id,

                    relationType:
                      'MITIGATES',

                    ...(body.data.notes
                      ? {
                          notes:
                            body.data
                              .notes,
                        }
                      : {}),
                  },
                });

            const riskCase =
              await tx.nexusObject
                .update({
                  where: {
                    id:
                      context
                        .riskCase
                        .id,
                  },

                  data: {
                    status:
                      'MITIGATING',

                    progress:
                      Math.max(
                        context
                          .riskCase
                          .progress,
                        50,
                      ),
                  },
                });

            if (
              !existingRelation
            ) {
              await tx.domainEvent.create({
                data: {
                  tenantId:
                    actor.tenantId,

                  aggregateId:
                    riskCase.id,

                  eventType:
                    'bridata.project.risk.case.mitigation_linked',

                  idempotencyKey:
                    `risk-case-mitigation:${relation.id}`,

                  payload: {
                    version:
                      'v1g15',

                    riskCaseId:
                      riskCase.id,

                    projectId:
                      context.project
                        .id,

                    mitigationObjectId:
                      mitigation.id,

                    relationId:
                      relation.id,

                    actorId:
                      actor.userId,
                  },
                },
              });
            }

            return {
              kind:
                'ok' as const,

              riskCase,

              relation,

              created:
                !existingRelation,
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
              'risk_case_not_found',
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
              'risk_case_manage_denied',
          });
      }

      if (
        result.kind ===
          'resolved'
      ) {
        return reply
          .code(409)
          .send({
            error:
              'risk_case_already_resolved',
          });
      }

      if (
        result.kind ===
          'mitigation_not_found'
      ) {
        return reply
          .code(404)
          .send({
            error:
              'mitigation_object_not_found',
          });
      }

      return reply
        .code(
          result.created
            ? 201
            : 200,
        )
        .send({
          version:
            'v1g15',

          created:
            result.created,

          relation: {
            id:
              result.relation.id,

            relationType:
              result.relation
                .relationType,

            mitigationObjectId:
              result.relation
                .sourceObjectId,

            riskCaseId:
              result.relation
                .targetObjectId,
          },

          riskCase:
            serializeRiskCase(
              result.riskCase,
            ),
        });
    },
  );


  app.post(
    '/api/v1/project-risk-cases-v1g15/:riskId/resolve',

    {
      preHandler: [
        authenticate,
        resolveActor,
      ],
    },

    async (
      request,
      reply,
    ) => {
      const params =
        riskParamsSchema
          .safeParse(
            request.params,
          );

      const body =
        resolveSchema
          .safeParse(
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
            const context =
              await loadRiskCaseContext(
                tx,
                actor.tenantId,
                params.data.riskId,
              );

            if (!context) {
              return {
                kind:
                  'not_found' as const,
              };
            }

            if (
              !await canManageProject(
                tx,
                actor,
                context.project.id,
              )
            ) {
              return {
                kind:
                  'forbidden' as const,
              };
            }

            const metadata = {
              ...jsonRecord(
                context.riskCase
                  .metadata,
              ),

              resolvedAt:
                new Date()
                  .toISOString(),

              resolvedBy:
                actor.userId,

              resolutionMode:
                'MANUAL',

              resolutionNote:
                body.data
                  .resolutionNote,
            };

            const riskCase =
              await tx.nexusObject
                .update({
                  where: {
                    id:
                      context
                        .riskCase
                        .id,
                  },

                  data: {
                    status:
                      'RESOLVED',

                    progress:
                      100,

                    metadata:
                      metadata as
                        Prisma.InputJsonValue,
                  },
                });

            await Promise.all([
              tx.domainEvent.create({
                data: {
                  tenantId:
                    actor.tenantId,

                  aggregateId:
                    riskCase.id,

                  eventType:
                    'bridata.project.risk.case.resolved',

                  idempotencyKey:
                    `risk-case-resolve:${riskCase.id}:${request.id}`,

                  payload: {
                    version:
                      'v1g15',

                    riskCaseId:
                      riskCase.id,

                    projectId:
                      context.project.id,

                    resolutionNote:
                      body.data
                        .resolutionNote,

                    actorId:
                      actor.userId,
                  },
                },
              }),

              tx.auditLog.create({
                data: {
                  tenantId:
                    actor.tenantId,

                  userId:
                    actor.userId,

                  action:
                    'PROJECT_RISK_CASE_RESOLVED_V1G15',

                  resource:
                    'RISK',

                  resourceId:
                    riskCase.id,

                  correlationId:
                    request.id,

                  ipAddress:
                    request.ip,

                  details: {
                    projectId:
                      context.project.id,

                    resolutionNote:
                      body.data
                        .resolutionNote,
                  },
                },
              }),
            ]);

            return {
              kind:
                'ok' as const,

              riskCase,
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
              'risk_case_not_found',
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
              'risk_case_manage_denied',
          });
      }

      return reply.send(
        serializeRiskCase(
          result.riskCase,
        ),
      );
    },
  );
}
