import {
  Prisma,
} from '@prisma/client';

import type {
  ProjectRiskDriverV1g7,
  ProjectRiskLevelV1g7,
  ScheduleRiskLevelV1g7,
} from './project-risk-forecast-v1g7.js';

export type ProjectRiskCaseStatusV1g15 =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'MITIGATING'
  | 'RESOLVED';

export type ProjectRiskCaseSyncActionV1g15 =
  | 'NONE'
  | 'CREATED'
  | 'UPDATED'
  | 'REOPENED'
  | 'AUTO_RESOLVED'
  | 'UNCHANGED';

export interface ProjectRiskCaseSnapshotV1g15 {
  riskLevel:
    ProjectRiskLevelV1g7;

  drivers:
    ProjectRiskDriverV1g7[];

  fingerprint:
    string;

  financialHealth:
    string;

  scheduleHealth:
    ScheduleRiskLevelV1g7 |
    null;
}

export function projectRiskCaseTransitionV1g15(
  input: {
    riskLevel:
      ProjectRiskLevelV1g7;

    existingStatus:
      ProjectRiskCaseStatusV1g15 |
      null;

    changed:
      boolean;
  },
): {
  action:
    ProjectRiskCaseSyncActionV1g15;

  nextStatus:
    ProjectRiskCaseStatusV1g15 |
    null;
} {
  const actionable =
    input.riskLevel === 'HIGH' ||
    input.riskLevel === 'CRITICAL';

  if (
    !actionable &&
    !input.existingStatus
  ) {
    return {
      action:
        'NONE',

      nextStatus:
        null,
    };
  }

  if (
    !actionable &&
    input.existingStatus ===
      'RESOLVED'
  ) {
    return {
      action:
        'UNCHANGED',

      nextStatus:
        'RESOLVED',
    };
  }

  if (!actionable) {
    return {
      action:
        'AUTO_RESOLVED',

      nextStatus:
        'RESOLVED',
    };
  }

  if (!input.existingStatus) {
    return {
      action:
        'CREATED',

      nextStatus:
        'OPEN',
    };
  }

  if (
    input.existingStatus ===
      'RESOLVED'
  ) {
    return {
      action:
        'REOPENED',

      nextStatus:
        'OPEN',
    };
  }

  if (!input.changed) {
    return {
      action:
        'UNCHANGED',

      nextStatus:
        input.existingStatus,
    };
  }

  return {
    action:
      'UPDATED',

    nextStatus:
      input.existingStatus,
  };
}

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

export function projectIdFromRiskCaseV1g15(
  metadata:
    | Prisma.JsonValue
    | null,
): string | null {
  const value =
    jsonRecord(metadata)
      .projectId;

  return typeof value ===
    'string'
      ? value
      : null;
}

export async function findProjectRiskCaseV1g15(
  tx:
    Prisma.TransactionClient,

  tenantId:
    string,

  projectId:
    string,
) {
  const rows =
    await tx.$queryRaw<
      {
        id: string;
      }[]
    >(Prisma.sql`
      SELECT id
      FROM nexus_objects
      WHERE
        tenant_id =
          ${tenantId}::uuid
        AND object_type_key =
          'RISK'
        AND deleted_at IS NULL
        AND metadata->>'source' =
          'PROJECT_RISK_FORECAST_V1G15'
        AND metadata->>'projectId' =
          ${projectId}
      ORDER BY
        created_at DESC,
        id DESC
      LIMIT 1
    `);

  const id =
    rows[0]?.id;

  if (!id) {
    return null;
  }

  return tx.nexusObject.findUnique({
    where: {
      id,
    },
  });
}

export async function syncProjectRiskCaseV1g15(
  tx:
    Prisma.TransactionClient,

  input: {
    tenantId:
      string;

    project: {
      id: string;
      title: string;
      workspaceId: string;
      ownerId: string;
    };

    snapshot:
      ProjectRiskCaseSnapshotV1g15;

    observedAt?:
      Date;
  },
) {
  const observedAt =
    input.observedAt ??
    new Date();

  // Serialize automatic/manual synchronization
  // for one project and avoid duplicate
  // system-generated RISK objects.
  await tx.$queryRaw(
    Prisma.sql`
      SELECT id
      FROM nexus_objects
      WHERE
        tenant_id =
          ${input.tenantId}::uuid
        AND id =
          ${input.project.id}::uuid
      FOR UPDATE
    `,
  );

  const existing =
    await findProjectRiskCaseV1g15(
      tx,
      input.tenantId,
      input.project.id,
    );

  const existingMetadata =
    jsonRecord(
      existing?.metadata ??
      null,
    );

  const oldFingerprint =
    typeof existingMetadata
      .fingerprint ===
      'string'
      ? existingMetadata
          .fingerprint
      : null;

  const oldRiskLevel =
    typeof existingMetadata
      .riskLevel ===
      'string'
      ? existingMetadata
          .riskLevel
      : null;

  const oldDrivers =
    Array.isArray(
      existingMetadata.drivers,
    )
      ? existingMetadata
          .drivers
          .filter(
            (
              value,
            ): value is string =>
              typeof value ===
              'string',
          )
          .sort()
      : [];

  const newDrivers =
    [...input.snapshot.drivers]
      .sort();

  const changed =
    oldFingerprint !==
      input.snapshot.fingerprint ||
    oldRiskLevel !==
      input.snapshot.riskLevel ||
    JSON.stringify(
      oldDrivers,
    ) !==
      JSON.stringify(
        newDrivers,
      );

  const currentStatus =
    existing
      ? (
          [
            'OPEN',
            'ACKNOWLEDGED',
            'MITIGATING',
            'RESOLVED',
          ].includes(
            existing.status,
          )
            ? existing.status
            : 'OPEN'
        ) as
          ProjectRiskCaseStatusV1g15
      : null;

  const transition =
    projectRiskCaseTransitionV1g15({
      riskLevel:
        input.snapshot
          .riskLevel,

      existingStatus:
        currentStatus,

      changed,
    });

  if (
    transition.action ===
      'NONE' ||
    transition.action ===
      'UNCHANGED'
  ) {
    return {
      action:
        transition.action,

      riskCase:
        existing,
    };
  }

  if (
    transition.action ===
      'CREATED'
  ) {
    const riskDefinition =
      await tx.objectDefinition
        .findFirst({
          where: {
            tenantId:
              input.tenantId,

            key:
              'RISK',
          },

          select: {
            id: true,
          },
        });

    if (!riskDefinition) {
      throw new Error(
        'RISK object definition is missing.',
      );
    }

    const riskCase =
      await tx.nexusObject.create({
        data: {
          tenantId:
            input.tenantId,

          workspaceId:
            input.project
              .workspaceId,

          objectDefinitionId:
            riskDefinition.id,

          objectTypeKey:
            'RISK',

          title:
            `Riesgo de proyecto — ${input.project.title}`,

          description:
            'Riesgo generado por el motor integrado de costo y plazo de Bridata.',

          status:
            'OPEN',

          priority:
            input.snapshot
              .riskLevel,

          progress:
            0,

          ownerId:
            input.project
              .ownerId,

          assigneeId:
            input.project
              .ownerId,

          metadata: {
            version:
              'v1g15',

            source:
              'PROJECT_RISK_FORECAST_V1G15',

            projectId:
              input.project.id,

            riskLevel:
              input.snapshot
                .riskLevel,

            drivers:
              input.snapshot
                .drivers,

            fingerprint:
              input.snapshot
                .fingerprint,

            financialHealth:
              input.snapshot
                .financialHealth,

            scheduleHealth:
              input.snapshot
                .scheduleHealth,

            firstObservedAt:
              observedAt
                .toISOString(),

            lastObservedAt:
              observedAt
                .toISOString(),
          },
        },
      });

    await tx.objectRelation.create({
      data: {
        tenantId:
          input.tenantId,

        sourceObjectId:
          riskCase.id,

        targetObjectId:
          input.project.id,

        relationType:
          'RELATES_TO',

        notes:
          'System-generated project risk case.',
      },
    });

    await tx.domainEvent.create({
      data: {
        tenantId:
          input.tenantId,

        aggregateId:
          riskCase.id,

        eventType:
          'bridata.project.risk.case.created',

        idempotencyKey:
          `project-risk-case:${riskCase.id}:created`,

        payload: {
          version:
            'v1g15',

          riskCaseId:
            riskCase.id,

          projectId:
            input.project.id,

          riskLevel:
            input.snapshot
              .riskLevel,

          drivers:
            input.snapshot
              .drivers,

          fingerprint:
            input.snapshot
              .fingerprint,
        },
      },
    });

    return {
      action:
        'CREATED' as const,

      riskCase,
    };
  }

  if (!existing) {
    throw new Error(
      'G15 transition requires an existing risk case.',
    );
  }

  const nextMetadata = {
    ...existingMetadata,

    version:
      'v1g15',

    source:
      'PROJECT_RISK_FORECAST_V1G15',

    projectId:
      input.project.id,

    riskLevel:
      input.snapshot
        .riskLevel,

    drivers:
      input.snapshot
        .drivers,

    fingerprint:
      input.snapshot
        .fingerprint,

    financialHealth:
      input.snapshot
        .financialHealth,

    scheduleHealth:
      input.snapshot
        .scheduleHealth,

    lastObservedAt:
      observedAt
        .toISOString(),

    ...(transition.action ===
      'REOPENED'
      ? {
          reopenedAt:
            observedAt
              .toISOString(),

          resolvedAt:
            null,

          resolutionNote:
            null,
        }
      : {}),

    ...(transition.action ===
      'AUTO_RESOLVED'
      ? {
          resolvedAt:
            observedAt
              .toISOString(),

          resolutionMode:
            'AUTO_RECOVERY',

          resolutionNote:
            'Canonical project risk recovered below HIGH.',
        }
      : {}),
  };

  const riskCase =
    await tx.nexusObject.update({
      where: {
        id:
          existing.id,
      },

      data: {
        status:
          transition
            .nextStatus!,

        priority:
          input.snapshot
            .riskLevel,

        progress:
          transition.nextStatus ===
            'RESOLVED'
            ? 100
            : existing.progress,

        metadata:
          nextMetadata as
            Prisma.InputJsonValue,
      },
    });

  const eventType =
    transition.action ===
      'REOPENED'
      ? 'bridata.project.risk.case.reopened'
      : transition.action ===
          'AUTO_RESOLVED'
        ? 'bridata.project.risk.case.auto_resolved'
        : 'bridata.project.risk.case.updated';

  await tx.domainEvent.create({
    data: {
      tenantId:
        input.tenantId,

      aggregateId:
        riskCase.id,

      eventType,

      idempotencyKey:
        [
          'project-risk-case',
          riskCase.id,
          transition.action,
          input.snapshot
            .fingerprint,
        ].join(':'),

      payload: {
        version:
          'v1g15',

        riskCaseId:
          riskCase.id,

        projectId:
          input.project.id,

        action:
          transition.action,

        status:
          riskCase.status,

        riskLevel:
          input.snapshot
            .riskLevel,

        fingerprint:
          input.snapshot
            .fingerprint,
      },
    },
  });

  return {
    action:
      transition.action,

    riskCase,
  };
}
