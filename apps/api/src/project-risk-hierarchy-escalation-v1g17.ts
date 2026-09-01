import {
  Prisma,
} from '@prisma/client';

import {
  z,
} from 'zod';

import {
  buildProjectRiskAlertV1g8,
  type ProjectRiskAlertInputV1g8,
} from './domain/project-risk-alert-v1g8.js';

import {
  projectRiskAssessmentPayloadSchemaV1,
} from './domain/project-risk-assessment-event-v1.js';

import {
  automaticRiskNotificationIdempotencyKeyV1g13,
  buildProjectRiskAutomaticNotificationPolicyV1g13,
  type ProjectRiskPolicyAssessmentV1g13,
  type ProjectRiskPolicyNotificationV1g13,
} from './domain/project-risk-notification-policy-v1g13.js';

import {
  loadProjectRiskNotificationPreferencesV1g14,
} from './domain/project-risk-notification-preferences-v1g14.js';

import type {
  ProjectRiskLevelV1g7,
} from './domain/project-risk-forecast-v1g7.js';

import {
  persistDomainEvent,
} from './project-risk-evaluation-service.js';

export type ProjectRiskHierarchyScopeV1g17 =
  | 'PROGRAM'
  | 'PORTFOLIO';

type HierarchyScopeV1g17 = {
  scopeType:
    ProjectRiskHierarchyScopeV1g17;

  scopeId:
    string;

  title:
    string;

  ownerId:
    string;
};

type HierarchyRecipientV1g17 = {
  targetUserId:
    string;

  scopes:
    Array<{
      scopeType:
        ProjectRiskHierarchyScopeV1g17;

      scopeId:
        string;

      title:
        string;
    }>;
};

const hierarchyNotificationDetailsSchemaV1g17 =
  z.object({
    version:
      z.literal('v1g17'),

    targetUserId:
      z.string().uuid(),

    riskLevel:
      z.enum([
        'INSUFFICIENT_DATA',
        'ON_TRACK',
        'WATCH',
        'HIGH',
        'CRITICAL',
      ]),

    drivers:
      z.array(
        z.enum([
          'COST_OVERRUN',
          'SCHEDULE_DELAY',
          'LOW_SCHEDULE_CONFIDENCE',
          'NO_CONTROL_BUDGET',
        ]),
      ),

    fingerprint:
      z.string().min(1),

    reason:
      z.string().min(1),

    cooldownHours:
      z.number()
        .int()
        .positive(),

    notificationEventId:
      z.string().uuid(),

    notificationCreated:
      z.boolean(),

    hierarchyScopes:
      z.array(
        z.object({
          scopeType:
            z.enum([
              'PROGRAM',
              'PORTFOLIO',
            ]),

          scopeId:
            z.string().uuid(),

          title:
            z.string(),
        }),
      ),
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

export function hierarchyScopeIdsV1g17(
  metadata:
    | Prisma.JsonValue
    | null,
): {
  programId:
    string | null;

  portfolioId:
    string | null;
} {
  const record =
    jsonRecord(metadata);

  return {
    programId:
      typeof record.programId ===
        'string'
        ? record.programId
        : null,

    portfolioId:
      typeof record.portfolioId ===
        'string'
        ? record.portfolioId
        : null,
  };
}

export function shouldEscalateHierarchyRiskV1g17(
  riskLevel:
    ProjectRiskLevelV1g7,
): boolean {
  // Management escalation is intentionally
  // conservative in G17.
  //
  // HIGH stays with the Project owner.
  // CRITICAL reaches Program/Portfolio owners.
  return riskLevel ===
    'CRITICAL';
}

async function validHierarchyOwnerV1g17(
  tx:
    Prisma.TransactionClient,

  input: {
    tenantId:
      string;

    workspaceId:
      string;

    userId:
      string;
  },
): Promise<boolean> {
  const [
    tenantMembership,
    workspaceMembership,
  ] =
    await Promise.all([
      tx.tenantMembership
        .findUnique({
          where: {
            tenantId_userId: {
              tenantId:
                input.tenantId,

              userId:
                input.userId,
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
        }),

      tx.workspaceMember
        .findUnique({
          where: {
            workspaceId_userId: {
              workspaceId:
                input.workspaceId,

              userId:
                input.userId,
            },
          },

          select: {
            tenantId:
              true,
          },
        }),
    ]);

  return Boolean(
    tenantMembership &&
    tenantMembership.status ===
      'ACTIVE' &&
    tenantMembership.user
      .isActive &&
    workspaceMembership &&
    workspaceMembership.tenantId ===
      input.tenantId,
  );
}

async function resolveHierarchyRecipientsV1g17(
  tx:
    Prisma.TransactionClient,

  input: {
    tenantId:
      string;

    project: {
      id:
        string;

      workspaceId:
        string;

      ownerId:
        string;

      metadata:
        Prisma.JsonValue |
        null;
    };
  },
) {
  const ids =
    hierarchyScopeIdsV1g17(
      input.project.metadata,
    );

  const requested =
    [
      ids.programId
        ? {
            scopeType:
              'PROGRAM' as const,

            scopeId:
              ids.programId,
          }
        : null,

      ids.portfolioId
        ? {
            scopeType:
              'PORTFOLIO' as const,

            scopeId:
              ids.portfolioId,
          }
        : null,
    ].filter(
      (
        value,
      ): value is {
        scopeType:
          ProjectRiskHierarchyScopeV1g17;

        scopeId:
          string;
      } =>
        value !== null,
    );

  let invalidScopesSkipped =
    0;

  let invalidOwnersSkipped =
    0;

  let projectOwnerRecipientsSkipped =
    0;

  const scopes:
    HierarchyScopeV1g17[] =
    [];

  for (
    const requestedScope
    of requested
  ) {
    const scope =
      await tx.nexusObject
        .findFirst({
          where: {
            id:
              requestedScope
                .scopeId,

            tenantId:
              input.tenantId,

            workspaceId:
              input.project
                .workspaceId,

            objectTypeKey:
              requestedScope
                .scopeType,

            deletedAt:
              null,
          },

          select: {
            id:
              true,

            title:
              true,

            ownerId:
              true,
          },
        });

    if (!scope) {
      invalidScopesSkipped +=
        1;

      continue;
    }

    if (
      scope.ownerId ===
      input.project.ownerId
    ) {
      projectOwnerRecipientsSkipped +=
        1;

      continue;
    }

    const validOwner =
      await validHierarchyOwnerV1g17(
        tx,
        {
          tenantId:
            input.tenantId,

          workspaceId:
            input.project
              .workspaceId,

          userId:
            scope.ownerId,
        },
      );

    if (!validOwner) {
      invalidOwnersSkipped +=
        1;

      continue;
    }

    scopes.push({
      scopeType:
        requestedScope
          .scopeType,

      scopeId:
        scope.id,

      title:
        scope.title,

      ownerId:
        scope.ownerId,
    });
  }

  const recipientMap =
    new Map<
      string,
      HierarchyRecipientV1g17
    >();

  for (const scope of scopes) {
    const existing =
      recipientMap.get(
        scope.ownerId,
      );

    const scopeReference = {
      scopeType:
        scope.scopeType,

      scopeId:
        scope.scopeId,

      title:
        scope.title,
    };

    if (existing) {
      existing.scopes.push(
        scopeReference,
      );

      continue;
    }

    recipientMap.set(
      scope.ownerId,
      {
        targetUserId:
          scope.ownerId,

        scopes: [
          scopeReference,
        ],
      },
    );
  }

  return {
    recipients:
      [...recipientMap.values()],

    invalidScopesSkipped,
    invalidOwnersSkipped,
    projectOwnerRecipientsSkipped,
  };
}

async function loadLastHierarchyNotificationV1g17(
  tx:
    Prisma.TransactionClient,

  tenantId:
    string,

  projectId:
    string,

  targetUserId:
    string,
):
Promise<
  ProjectRiskPolicyNotificationV1g13 |
  null
> {
  const rows =
    await tx.auditLog
      .findMany({
        where: {
          tenantId,

          resource:
            'PROJECT',

          resourceId:
            projectId,

          action:
            'PROJECT_RISK_HIERARCHY_NOTIFICATION_V1G17',
        },

        orderBy: [
          {
            createdAt:
              'desc',
          },
          {
            id:
              'desc',
          },
        ],

        take:
          100,

        select: {
          id:
            true,

          details:
            true,

          createdAt:
            true,
        },
      });

  for (const row of rows) {
    const parsed =
      hierarchyNotificationDetailsSchemaV1g17
        .safeParse(
          row.details,
        );

    if (
      !parsed.success ||
      parsed.data
        .targetUserId !==
        targetUserId
    ) {
      continue;
    }

    return {
      id:
        row.id,

      riskLevel:
        parsed.data
          .riskLevel,

      drivers:
        parsed.data
          .drivers,

      fingerprint:
        parsed.data
          .fingerprint,

      notifiedAt:
        row.createdAt,
    };
  }

  return null;
}

async function loadPreviousAssessmentForHierarchyV1g17(
  tx:
    Prisma.TransactionClient,

  input: {
    tenantId:
      string;

    projectId:
      string;

    currentFingerprint:
      string;

    currentRisk:
      ProjectRiskAlertInputV1g8[
        'risk'
      ];

    lastNotification:
      ProjectRiskPolicyNotificationV1g13 |
      null;
  },
):
Promise<
  ProjectRiskPolicyAssessmentV1g13 |
  null
> {
  const rows =
    await tx.domainEvent
      .findMany({
        where: {
          tenantId:
            input.tenantId,

          aggregateId:
            input.projectId,

          eventType:
            'bridata.project.risk.assessed',
        },

        orderBy: [
          {
            createdAt:
              'desc',
          },
          {
            id:
              'desc',
          },
        ],

        take:
          50,

        select: {
          id:
            true,

          payload:
            true,

          createdAt:
            true,
        },
      });

  let previousDistinct:
    ProjectRiskPolicyAssessmentV1g13 |
    null = null;

  for (const row of rows) {
    const parsed =
      projectRiskAssessmentPayloadSchemaV1
        .safeParse(
          row.payload,
        );

    if (
      !parsed.success ||
      parsed.data.projectId !==
        input.projectId ||
      parsed.data.fingerprint ===
        input.currentFingerprint
    ) {
      continue;
    }

    previousDistinct = {
      id:
        row.id,

      riskLevel:
        parsed.data
          .riskLevel,

      drivers:
        parsed.data
          .drivers,

      observedAt:
        row.createdAt,
    };

    break;
  }

  // Important for exact-fingerprint re-entry:
  //
  // If the same CRITICAL fingerprint returns after
  // a recovery, G8's immutable assessment event may
  // already exist and therefore is not inserted again.
  //
  // A hierarchy notification newer than the latest
  // distinct assessment means that re-entry has already
  // been notified and subsequent evaluations must honor
  // cooldown instead of repeatedly behaving as re-entry.
  if (
    input.lastNotification &&
    input.lastNotification
      .fingerprint ===
      input.currentFingerprint &&
    (
      !previousDistinct ||
      input.lastNotification
        .notifiedAt
        .getTime() >
      previousDistinct
        .observedAt
        .getTime()
    )
  ) {
    return {
      id:
        input.lastNotification
          .id,

      riskLevel:
        input.currentRisk
          .riskLevel,

      drivers:
        input.currentRisk
          .drivers,

      observedAt:
        input.lastNotification
          .notifiedAt,
    };
  }

  return previousDistinct;
}

function hierarchyAudienceLabelV1g17(
  recipient:
    HierarchyRecipientV1g17,
): string {
  return recipient.scopes
    .map(
      (scope) =>
        scope.scopeType ===
          'PROGRAM'
          ? `Programa "${scope.title}"`
          : `Portafolio "${scope.title}"`,
    )
    .join(' / ');
}

export async function escalateProjectRiskHierarchyV1g17(
  tx:
    Prisma.TransactionClient,

  input: {
    tenantId:
      string;

    project: {
      id:
        string;

      title:
        string;

      workspaceId:
        string;

      ownerId:
        string;

      metadata:
        Prisma.JsonValue |
        null;
    };

    risk:
      ProjectRiskAlertInputV1g8[
        'risk'
      ];

    now?:
      Date;
  },
) {
  if (
    !shouldEscalateHierarchyRiskV1g17(
      input.risk.riskLevel,
    )
  ) {
    return {
      version:
        'v1g17' as const,

      eligible:
        false,

      recipientsConsidered:
        0,

      invalidScopesSkipped:
        0,

      invalidOwnersSkipped:
        0,

      projectOwnerRecipientsSkipped:
        0,

      notificationsQueued:
        0,

      notificationsDeduplicated:
        0,

      notificationsSuppressedByPolicy:
        0,

      decisions:
        [],
    };
  }

  const hierarchy =
    await resolveHierarchyRecipientsV1g17(
      tx,
      {
        tenantId:
          input.tenantId,

        project:
          input.project,
      },
    );

  let notificationsQueued =
    0;

  let notificationsDeduplicated =
    0;

  let notificationsSuppressedByPolicy =
    0;

  const decisions:
    Array<{
      targetUserId:
        string;

      scopes:
        HierarchyRecipientV1g17[
          'scopes'
        ];

      shouldNotify:
        boolean;

      reason:
        string;

      notificationEventId:
        string | null;

      notificationCreated:
        boolean;
    }> = [];

  for (
    const recipient
    of hierarchy.recipients
  ) {
    const alert =
      buildProjectRiskAlertV1g8({
        tenantId:
          input.tenantId,

        projectId:
          input.project.id,

        projectTitle:
          input.project.title,

        workspaceId:
          input.project
            .workspaceId,

        targetUserId:
          recipient
            .targetUserId,

        risk:
          input.risk,
      });

    if (
      !alert.notificationEvent
    ) {
      continue;
    }

    const [
      lastNotification,
      preferences,
    ] =
      await Promise.all([
        loadLastHierarchyNotificationV1g17(
          tx,
          input.tenantId,
          input.project.id,
          recipient.targetUserId,
        ),

        loadProjectRiskNotificationPreferencesV1g14(
          tx,
          input.tenantId,
          recipient.targetUserId,
        ),
      ]);

    const previousAssessment =
      await loadPreviousAssessmentForHierarchyV1g17(
        tx,
        {
          tenantId:
            input.tenantId,

          projectId:
            input.project.id,

          currentFingerprint:
            alert.fingerprint,

          currentRisk:
            input.risk,

          lastNotification,
        },
      );

    const policy =
      buildProjectRiskAutomaticNotificationPolicyV1g13({
        current: {
          riskLevel:
            input.risk
              .riskLevel,

          drivers:
            input.risk
              .drivers,

          fingerprint:
            alert.fingerprint,
        },

        previousAssessment,
        lastNotification,

        enabled:
          preferences.enabled,

        minimumRiskLevel:
          preferences
            .minimumRiskLevel,

        highCooldownHours:
          preferences
            .highCooldownHours,

        criticalCooldownHours:
          preferences
            .criticalCooldownHours,

        notifyOnEscalation:
          preferences
            .notifyOnEscalation,

        notifyOnDriverChange:
          preferences
            .notifyOnDriverChange,

        notifyOnReentry:
          preferences
            .notifyOnReentry,

        notifyOnCooldownReminder:
          preferences
            .notifyOnCooldownReminder,

        ...(input.now
          ? {
              now:
                input.now,
            }
          : {}),
      });

    if (!policy.shouldNotify) {
      notificationsSuppressedByPolicy +=
        1;

      decisions.push({
        targetUserId:
          recipient.targetUserId,

        scopes:
          recipient.scopes,

        shouldNotify:
          false,

        reason:
          policy.reason,

        notificationEventId:
          null,

        notificationCreated:
          false,
      });

      continue;
    }

    const baseKey =
      [
        'project-risk-hierarchy-notification',
        'v1g17',
        input.project.id,
        recipient.targetUserId,
        alert.fingerprint,
      ].join(':');

    const idempotencyKey =
      automaticRiskNotificationIdempotencyKeyV1g13({
        baseKey,

        decision:
          policy,
      });

    const audience =
      hierarchyAudienceLabelV1g17(
        recipient,
      );

    const notificationPayload = {
      ...alert.notificationEvent
        .payload,

      notificationTitle:
        `Escalamiento gerencial: ${alert.notificationEvent.payload.notificationTitle}`,

      notificationBody:
        `${alert.notificationEvent.payload.notificationBody} Escalado automáticamente a ${audience}.`,
    };

    const notification =
      await persistDomainEvent(
        tx,
        {
          tenantId:
            input.tenantId,

          aggregateId:
            input.project.id,

          eventType:
            'bridata.notification.requested',

          payload:
            notificationPayload,

          idempotencyKey,
        },
      );

    if (notification.created) {
      notificationsQueued +=
        1;
    } else {
      notificationsDeduplicated +=
        1;
    }

    await tx.auditLog.create({
      data: {
        tenantId:
          input.tenantId,

        userId:
          null,

        action:
          'PROJECT_RISK_HIERARCHY_NOTIFICATION_V1G17',

        resource:
          'PROJECT',

        resourceId:
          input.project.id,

        details: {
          version:
            'v1g17',

          targetUserId:
            recipient
              .targetUserId,

          riskLevel:
            input.risk
              .riskLevel,

          drivers:
            input.risk
              .drivers,

          fingerprint:
            alert.fingerprint,

          reason:
            policy.reason,

          cooldownHours:
            policy.cooldownHours,

          notificationEventId:
            notification.id,

          notificationCreated:
            notification.created,

          hierarchyScopes:
            recipient.scopes,
        },
      },
    });

    decisions.push({
      targetUserId:
        recipient.targetUserId,

      scopes:
        recipient.scopes,

      shouldNotify:
        true,

      reason:
        policy.reason,

      notificationEventId:
        notification.id,

      notificationCreated:
        notification.created,
    });
  }

  return {
    version:
      'v1g17' as const,

    eligible:
      true,

    recipientsConsidered:
      hierarchy.recipients
        .length,

    invalidScopesSkipped:
      hierarchy
        .invalidScopesSkipped,

    invalidOwnersSkipped:
      hierarchy
        .invalidOwnersSkipped,

    projectOwnerRecipientsSkipped:
      hierarchy
        .projectOwnerRecipientsSkipped,

    notificationsQueued,
    notificationsDeduplicated,
    notificationsSuppressedByPolicy,

    decisions,
  };
}
