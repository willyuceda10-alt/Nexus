import { Prisma } from '@prisma/client';

import {
  calculateBudgetLineForecastV2,
  calculateProjectCostSummaryV2,
} from './domain/cost-engine-v2.js';

import {
  forecastTask,
  summarizeForecast,
} from './domain/forecast.js';

import {
  buildProjectRiskAlertV1g8,
} from './domain/project-risk-alert-v1g8.js';

import {
  projectRiskAssessmentPayloadSchemaV1,
} from './domain/project-risk-assessment-event-v1.js';

import {
  automaticRiskNotificationIdempotencyKeyV1g13,
  buildProjectRiskAutomaticNotificationPolicyV1g13,
  projectRiskAutomaticNotificationDetailsSchemaV1g13,
} from './domain/project-risk-notification-policy-v1g13.js';

import {
  loadProjectRiskNotificationPreferencesV1g14,
} from './domain/project-risk-notification-preferences-v1g14.js';

import {
  buildProjectRiskForecastV1g7,
} from './domain/project-risk-forecast-v1g7.js';

import {
  calendarFromMetadata,
} from './domain/work-calendar.js';

import {
  metadataProjectId,
  tenantCurrency,
} from './routes/cost-engine-v2-utils.js';

type Money =
  | Prisma.Decimal
  | string
  | number;

type ProfileRow = {
  currency: string;
  contingency_amount: Money;
};

type BudgetLineRow = {
  id: string;
  work_item_object_id: string | null;
  cost_code_id: string;
  material_id: string | null;
  planned_amount: Money;
  approved_amount: Money;
  forecast_remaining_uncommitted: Money | null;
};

type CostFactRow = {
  id: string;
  work_item_object_id: string | null;
  cost_code_id: string | null;
  material_id: string | null;
  amount: Money;
  currency: string | null;
};

type Fact = {
  id: string;
  workItemId: string | null;
  costCodeId: string | null;
  materialId: string | null;
  amount: number;
  source:
    | 'MANUAL_ACTUAL'
    | 'MATERIAL_ACTUAL'
    | 'MANUAL_COMMITMENT'
    | 'MATERIAL_COMMITMENT';
};

export type PersistedEvent = {
  id: string;
  created: boolean;
};

function numberOf(
  value: Money | null | undefined,
): number {
  return value == null ? 0 : Number(value);
}

function allocateFact(
  fact: Fact,
  lines: BudgetLineRow[],
): string | null {
  const match = (
    predicate: (line: BudgetLineRow) => boolean,
  ): string | null => {
    const candidates = lines.filter(predicate);
    return candidates.length === 1
      ? candidates[0]!.id
      : null;
  };

  if (fact.materialId && fact.workItemId) {
    const exact = match(
      (line) =>
        line.material_id === fact.materialId &&
        line.work_item_object_id === fact.workItemId,
    );
    if (exact) return exact;
  }

  if (fact.materialId) {
    const material = match(
      (line) =>
        line.material_id === fact.materialId,
    );
    if (material) return material;
  }

  if (fact.costCodeId && fact.workItemId) {
    const exact = match(
      (line) =>
        line.cost_code_id === fact.costCodeId &&
        line.work_item_object_id === fact.workItemId,
    );
    if (exact) return exact;
  }

  if (fact.costCodeId) {
    const code = match(
      (line) =>
        line.cost_code_id === fact.costCodeId,
    );
    if (code) return code;
  }

  return null;
}

export async function persistDomainEvent(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
    idempotencyKey: string;
  },
): Promise<PersistedEvent> {
  const inserted = await tx.$queryRaw<
    Array<{ id: string }>
  >(Prisma.sql`
    INSERT INTO domain_events
      (
        tenant_id,
        aggregate_id,
        event_type,
        payload,
        idempotency_key
      )
    VALUES
      (
        ${input.tenantId}::uuid,
        ${input.aggregateId}::uuid,
        ${input.eventType},
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.idempotencyKey}
      )
    ON CONFLICT (idempotency_key)
    DO NOTHING
    RETURNING id
  `);

  if (inserted[0]) {
    return {
      id: inserted[0].id,
      created: true,
    };
  }

  const existing = await tx.$queryRaw<
    Array<{ id: string }>
  >(Prisma.sql`
    SELECT id
    FROM domain_events
    WHERE tenant_id = ${input.tenantId}::uuid
      AND idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `);

  if (!existing[0]) {
    throw new Error(
      'Risk event idempotency lookup failed.',
    );
  }

  return {
    id: existing[0].id,
    created: false,
  };
}

export async function calculateCurrentRisk(
  tx: Prisma.TransactionClient,
  tenantId: string,
  project: {
    id: string;
    workspaceId: string;
    metadata: Prisma.JsonValue | null;
  },
) {
  const [profiles, tenant, lines] = await Promise.all([
    tx.$queryRaw<ProfileRow[]>(Prisma.sql`
      SELECT currency, contingency_amount
      FROM project_cost_profiles
      WHERE tenant_id = ${tenantId}::uuid
        AND project_object_id = ${project.id}::uuid
      LIMIT 1
    `),

    tx.tenant.findUnique({
      where: { id: tenantId },
      select: { metadata: true },
    }),

    tx.$queryRaw<BudgetLineRow[]>(Prisma.sql`
      SELECT
        id,
        work_item_object_id,
        cost_code_id,
        material_id,
        planned_amount,
        approved_amount,
        forecast_remaining_uncommitted
      FROM project_budget_lines
      WHERE tenant_id = ${tenantId}::uuid
        AND project_object_id = ${project.id}::uuid
    `),
  ]);

  const profile = profiles[0] ?? null;

  const currency =
    profile?.currency ??
    tenantCurrency(tenant?.metadata ?? null);

  const authorityRows =
    await tx.$queryRaw<
      Array<{ enabled: boolean }>
    >(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM integration_entity_links authority
        WHERE authority.tenant_id = ${tenantId}::uuid
          AND authority.external_entity_type =
            'SAP_ACTUAL_COST_AUTHORITY'
          AND authority.canonical_entity_type =
            'PROJECT_OBJECT'
          AND authority.canonical_entity_id =
            ${project.id}::uuid
          AND authority.metadata->>'authority' =
            'SAP_DATA_PEP'
      ) AS enabled
    `);

  const sapDataPepAuthority =
    Boolean(authorityRows[0]?.enabled);

  const [
    manualActualRows,
    manualCommitmentRows,
    materialActualRows,
    materialCommitmentRows,
  ] = await Promise.all([
    tx.$queryRaw<CostFactRow[]>(Prisma.sql`
      SELECT
        id,
        work_item_object_id,
        cost_code_id,
        material_id,
        amount,
        currency
      FROM project_actual_costs
      WHERE tenant_id = ${tenantId}::uuid
        AND project_object_id = ${project.id}::uuid
    `),

    tx.$queryRaw<CostFactRow[]>(Prisma.sql`
      SELECT
        id,
        work_item_object_id,
        cost_code_id,
        NULL::uuid AS material_id,
        GREATEST(
          amount - released_amount,
          0
        ) AS amount,
        currency
      FROM project_commitments
      WHERE tenant_id = ${tenantId}::uuid
        AND project_object_id = ${project.id}::uuid
        AND status = 'OPEN'
        AND amount > released_amount
    `),

    tx.$queryRaw<CostFactRow[]>(Prisma.sql`
      SELECT
        grl.id,
        mr.work_item_object_id,
        NULL::uuid AS cost_code_id,
        grl.material_id,
        (
          grl.quantity * grl.unit_cost
        ) AS amount,
        po.currency
      FROM goods_receipt_lines grl
      JOIN goods_receipts gr
        ON gr.id = grl.goods_receipt_id
      LEFT JOIN purchase_order_lines pol
        ON pol.id = grl.purchase_order_line_id
      LEFT JOIN purchase_orders po_line
        ON po_line.id = pol.purchase_order_id
      LEFT JOIN purchase_orders po_header
        ON po_header.id = gr.purchase_order_id
      LEFT JOIN material_requirements mr
        ON mr.id = grl.requirement_id
      LEFT JOIN purchase_orders po
        ON po.id = COALESCE(
          po_line.id,
          po_header.id
        )
      WHERE grl.tenant_id = ${tenantId}::uuid
        AND COALESCE(
          po.project_object_id,
          mr.project_object_id
        ) = ${project.id}::uuid
        AND gr.status = 'POSTED'
        AND ${!sapDataPepAuthority}
    `),

    tx.$queryRaw<CostFactRow[]>(Prisma.sql`
      SELECT
        pol.id,
        mr.work_item_object_id,
        NULL::uuid AS cost_code_id,
        pol.material_id,
        (
          GREATEST(
            pol.quantity - pol.received_qty,
            0
          ) * pol.unit_cost
        ) AS amount,
        po.currency
      FROM purchase_order_lines pol
      JOIN purchase_orders po
        ON po.id = pol.purchase_order_id
      LEFT JOIN material_requirements mr
        ON mr.id = pol.requirement_id
      WHERE pol.tenant_id = ${tenantId}::uuid
        AND COALESCE(
          po.project_object_id,
          mr.project_object_id
        ) = ${project.id}::uuid
        AND po.status <> 'CANCELLED'
        AND pol.quantity > pol.received_qty
    `),
  ]);

  const toFacts = (
    rows: CostFactRow[],
    source: Fact['source'],
  ): Fact[] =>
    rows.flatMap((row) => {
      if (
        !row.currency ||
        row.currency !== currency
      ) {
        return [];
      }

      return [{
        id: row.id,
        workItemId: row.work_item_object_id,
        costCodeId: row.cost_code_id,
        materialId: row.material_id,
        amount: numberOf(row.amount),
        source,
      }];
    });

  const manualActual = toFacts(
    manualActualRows,
    'MANUAL_ACTUAL',
  );

  const materialActual = toFacts(
    materialActualRows,
    'MATERIAL_ACTUAL',
  );

  const manualCommitment = toFacts(
    manualCommitmentRows,
    'MANUAL_COMMITMENT',
  );

  const materialCommitment = toFacts(
    materialCommitmentRows,
    'MATERIAL_COMMITMENT',
  );

  const allFacts = [
    ...manualActual,
    ...materialActual,
    ...manualCommitment,
    ...materialCommitment,
  ];

  const actualByLine =
    new Map<string, number>();

  const commitmentByLine =
    new Map<string, number>();

  for (const fact of allFacts) {
    const lineId =
      allocateFact(fact, lines);

    if (!lineId) continue;

    const isActual =
      fact.source === 'MANUAL_ACTUAL' ||
      fact.source === 'MATERIAL_ACTUAL';

    const target =
      isActual
        ? actualByLine
        : commitmentByLine;

    target.set(
      lineId,
      (target.get(lineId) ?? 0) +
        fact.amount,
    );
  }

  const lineForecasts =
    lines.map((line) =>
      calculateBudgetLineForecastV2({
        approvedAmount:
          numberOf(
            line.approved_amount,
          ),

        actualAmount:
          actualByLine.get(line.id) ??
          0,

        commitmentAmount:
          commitmentByLine.get(
            line.id,
          ) ?? 0,

        forecastRemainingUncommitted:
          line
            .forecast_remaining_uncommitted ==
          null
            ? null
            : numberOf(
                line
                  .forecast_remaining_uncommitted,
              ),
      }),
    );

  const plannedBudget =
    lines.reduce(
      (sum, line) =>
        sum +
        numberOf(
          line.planned_amount,
        ),
      0,
    );

  const approvedBudget =
    lines.reduce(
      (sum, line) =>
        sum +
        numberOf(
          line.approved_amount,
        ),
      0,
    );

  const forecastRemainingUncommitted =
    lineForecasts.reduce(
      (sum, line) =>
        sum +
        line.forecastRemainingUncommitted,
      0,
    );

  const summary =
    calculateProjectCostSummaryV2({
      plannedBudget,
      approvedBudget,

      contingencyAmount:
        numberOf(
          profile?.contingency_amount,
        ),

      manualActual:
        manualActual.reduce(
          (sum, fact) =>
            sum + fact.amount,
          0,
        ),

      materialActual:
        materialActual.reduce(
          (sum, fact) =>
            sum + fact.amount,
          0,
        ),

      manualOpenCommitment:
        manualCommitment.reduce(
          (sum, fact) =>
            sum + fact.amount,
          0,
        ),

      materialOpenCommitment:
        materialCommitment.reduce(
          (sum, fact) =>
            sum + fact.amount,
          0,
        ),

      forecastRemainingUncommitted,
    });

  const now = new Date();

  const asOfDate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ),
  );

  const calendar =
    calendarFromMetadata(
      project.metadata,
    );

  const scheduleObjects =
    await tx.nexusObject.findMany({
      where: {
        tenantId,
        workspaceId:
          project.workspaceId,
        deletedAt: null,
        objectTypeKey: {
          in: [
            'TASK',
            'DELIVERABLE',
            'MILESTONE',
          ],
        },
      },

      select: {
        id: true,
        objectTypeKey: true,
        title: true,
        status: true,
        progress: true,
        startDate: true,
        dueDate: true,
        metadata: true,
      },
    });

  const scheduleTasks =
    scheduleObjects
      .filter(
        (object) =>
          metadataProjectId(
            object.metadata,
          ) === project.id,
      )
      .map((object) =>
        forecastTask(
          {
            id: object.id,
            title: object.title,
            objectTypeKey:
              object.objectTypeKey,
            status: object.status,
            progress:
              object.progress,
            startDate:
              object.startDate,
            dueDate:
              object.dueDate,
          },
          asOfDate,
          calendar,
        ),
      );

  const scheduleSummary =
    summarizeForecast(
      scheduleTasks,
      calendar,
    );

  return {
    currency,
    summary,

    risk:
      buildProjectRiskForecastV1g7({
        financial: {
          health:
            summary.health,

          controlBudget:
            summary.controlBudget,

          estimateAtCompletion:
            summary.estimateAtCompletion,

          varianceAtCompletion:
            summary.varianceAtCompletion,

          forecastVariancePercent:
            summary.forecastVariancePercent,
        },

        schedule:
          scheduleSummary,
      }),
  };
}

export async function evaluateProjectRiskAlert(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    project: {
      id: string;
      title: string;
      workspaceId: string;
      metadata: Prisma.JsonValue | null;
    };
    targetUserId: string;
  },
) {
  const current = await calculateCurrentRisk(
    tx,
    input.tenantId,
    input.project,
  );

  const alert = buildProjectRiskAlertV1g8({
    tenantId: input.tenantId,
    projectId: input.project.id,
    projectTitle: input.project.title,
    workspaceId: input.project.workspaceId,
    targetUserId: input.targetUserId,
    risk: current.risk,
  });

  const assessment = await persistDomainEvent(
    tx,
    {
      tenantId: input.tenantId,
      aggregateId:
        alert.assessmentEvent.aggregateId,
      eventType:
        alert.assessmentEvent.eventType,
      payload:
        alert.assessmentEvent.payload,
      idempotencyKey:
        alert.assessmentEvent.idempotencyKey,
    },
  );

  let notification:
    | PersistedEvent
    | null = null;

  if (alert.notificationEvent) {
    notification = await persistDomainEvent(
      tx,
      {
        tenantId: input.tenantId,
        aggregateId:
          alert.notificationEvent.aggregateId,
        eventType:
          alert.notificationEvent.eventType,
        payload:
          alert.notificationEvent.payload,
        idempotencyKey:
          alert.notificationEvent.idempotencyKey,
      },
    );
  }

  return {
    current,
    alert,
    assessment,
    notification,
  };
}

type PreviousRiskAssessmentRowV1g13 = {
  id: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
};

async function
loadPreviousRiskAssessmentV1g13(
  tx: Prisma.TransactionClient,
  tenantId: string,
  projectId: string,
) {
  const rows =
    await tx.domainEvent.findMany({
      where: {
        tenantId,
        aggregateId:
          projectId,

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

      take: 50,

      select: {
        id: true,
        payload: true,
        createdAt: true,
      },
    });

  for (const row of rows) {
    const parsed =
      projectRiskAssessmentPayloadSchemaV1
        .safeParse(
          row.payload,
        );

    if (
      !parsed.success ||
      parsed.data.projectId !==
        projectId
    ) {
      continue;
    }

    return {
      id:
        row.id,

      riskLevel:
        parsed.data.riskLevel,

      drivers:
        parsed.data.drivers,

      observedAt:
        row.createdAt,
    };
  }

  return null;
}

async function
loadLastAutomaticRiskNotificationV1g13(
  tx: Prisma.TransactionClient,
  tenantId: string,
  projectId: string,
  targetUserId: string,
) {
  const rows =
    await tx.auditLog.findMany({
      where: {
        tenantId,

        resource:
          'PROJECT',

        resourceId:
          projectId,

        action:
          'PROJECT_RISK_AUTO_NOTIFICATION_V1G13',
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

      take: 50,

      select: {
        id: true,
        details: true,
        createdAt: true,
      },
    });

  for (const row of rows) {
    const parsed =
      projectRiskAutomaticNotificationDetailsSchemaV1g13
        .safeParse(
          row.details,
        );

    if (
      !parsed.success ||
      parsed.data.targetUserId !==
        targetUserId
    ) {
      continue;
    }

    return {
      id:
        row.id,

      riskLevel:
        parsed.data.riskLevel,

      drivers:
        parsed.data.drivers,

      fingerprint:
        parsed.data.fingerprint,

      notifiedAt:
        row.createdAt,
    };
  }

  return null;
}

export async function
evaluateProjectRiskAlertAutomaticV1g13(
  tx: Prisma.TransactionClient,

  input: {
    tenantId: string;

    project: {
      id: string;
      title: string;
      workspaceId: string;
      metadata:
        Prisma.JsonValue |
        null;
    };

    targetUserId: string;

    now?: Date;
  },
) {
  const current =
    await calculateCurrentRisk(
      tx,
      input.tenantId,
      input.project,
    );

  const alert =
    buildProjectRiskAlertV1g8({
      tenantId:
        input.tenantId,

      projectId:
        input.project.id,

      projectTitle:
        input.project.title,

      workspaceId:
        input.project.workspaceId,

      targetUserId:
        input.targetUserId,

      risk:
        current.risk,
    });

  const [
    previousAssessment,
    lastNotification,
    preferences,
  ] =
    await Promise.all([
      loadPreviousRiskAssessmentV1g13(
        tx,
        input.tenantId,
        input.project.id,
      ),

      loadLastAutomaticRiskNotificationV1g13(
        tx,
        input.tenantId,
        input.project.id,
        input.targetUserId,
      ),

      loadProjectRiskNotificationPreferencesV1g14(
        tx,
        input.tenantId,
        input.targetUserId,
      ),
    ]);

  const policy =
    buildProjectRiskAutomaticNotificationPolicyV1g13({
      current: {
        riskLevel:
          current.risk.riskLevel,

        drivers:
          current.risk.drivers,

        fingerprint:
          alert.fingerprint,
      },

      previousAssessment,
      lastNotification,

      enabled:
        preferences.enabled,

      minimumRiskLevel:
        preferences.minimumRiskLevel,

      highCooldownHours:
        preferences.highCooldownHours,

      criticalCooldownHours:
        preferences.criticalCooldownHours,

      notifyOnEscalation:
        preferences.notifyOnEscalation,

      notifyOnDriverChange:
        preferences.notifyOnDriverChange,

      notifyOnReentry:
        preferences.notifyOnReentry,

      notifyOnCooldownReminder:
        preferences.notifyOnCooldownReminder,

      ...(input.now
        ? {
            now:
              input.now,
          }
        : {}),
    });

  const assessment =
    await persistDomainEvent(
      tx,
      {
        tenantId:
          input.tenantId,

        aggregateId:
          alert.assessmentEvent
            .aggregateId,

        eventType:
          alert.assessmentEvent
            .eventType,

        payload:
          alert.assessmentEvent
            .payload,

        idempotencyKey:
          alert.assessmentEvent
            .idempotencyKey,
      },
    );

  let notification:
    | PersistedEvent
    | null = null;

  if (
    alert.notificationEvent &&
    policy.shouldNotify
  ) {
    const notificationKey =
      automaticRiskNotificationIdempotencyKeyV1g13({
        baseKey:
          alert.notificationEvent
            .idempotencyKey,

        decision:
          policy,
      });

    notification =
      await persistDomainEvent(
        tx,
        {
          tenantId:
            input.tenantId,

          aggregateId:
            alert.notificationEvent
              .aggregateId,

          eventType:
            alert.notificationEvent
              .eventType,

          payload:
            alert.notificationEvent
              .payload,

          idempotencyKey:
            notificationKey,
        },
      );

    await tx.auditLog.create({
      data: {
        tenantId:
          input.tenantId,

        userId:
          null,

        action:
          'PROJECT_RISK_AUTO_NOTIFICATION_V1G13',

        resource:
          'PROJECT',

        resourceId:
          input.project.id,

        details: {
          version:
            'v1g13',

          targetUserId:
            input.targetUserId,

          riskLevel:
            current.risk
              .riskLevel,

          drivers:
            current.risk
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
        },
      },
    });
  }

  return {
    current,
    alert,
    assessment,
    notification,
    policy,

    preferences:
      preferences,
  };
}
