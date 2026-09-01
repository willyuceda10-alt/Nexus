import { createHash } from 'node:crypto';
import type { CostHealthV2 } from './cost-engine-v2.js';
import type {
  ProjectRiskDriverV1g7,
  ProjectRiskLevelV1g7,
  ScheduleRiskLevelV1g7,
} from './project-risk-forecast-v1g7.js';

export type ProjectRiskAlertPriorityV1g8 = 'HIGH' | 'CRITICAL';

export interface ProjectRiskAlertInputV1g8 {
  tenantId: string;
  projectId: string;
  projectTitle: string;
  workspaceId: string;
  targetUserId: string;

  risk: {
    riskLevel: ProjectRiskLevelV1g7;
    drivers: ProjectRiskDriverV1g7[];
    requiresAttention: boolean;

    financial: {
      health: CostHealthV2;
      controlBudget: number;
      estimateAtCompletion: number;
      varianceAtCompletion: number;
      forecastVariancePercent: number | null;
    };

    schedule: {
      health: ScheduleRiskLevelV1g7 | null;
      plannedFinish: string | null;
      forecastFinish: string | null;
      forecastVarianceDays: number | null;
    };
  };
}

function normalizedFingerprintSource(
  input: ProjectRiskAlertInputV1g8,
): string {
  return JSON.stringify({
    projectId: input.projectId,
    riskLevel: input.risk.riskLevel,
    drivers: [...input.risk.drivers].sort(),
    financial: {
      health: input.risk.financial.health,
      controlBudget: input.risk.financial.controlBudget,
      estimateAtCompletion:
        input.risk.financial.estimateAtCompletion,
      varianceAtCompletion:
        input.risk.financial.varianceAtCompletion,
      forecastVariancePercent:
        input.risk.financial.forecastVariancePercent,
    },
    schedule: {
      health: input.risk.schedule.health,
      plannedFinish: input.risk.schedule.plannedFinish,
      forecastFinish: input.risk.schedule.forecastFinish,
      forecastVarianceDays:
        input.risk.schedule.forecastVarianceDays,
    },
  });
}

export function projectRiskFingerprintV1g8(
  input: ProjectRiskAlertInputV1g8,
): string {
  return createHash('sha256')
    .update(normalizedFingerprintSource(input))
    .digest('hex')
    .slice(0, 32);
}

function alertPriority(
  riskLevel: ProjectRiskLevelV1g7,
): ProjectRiskAlertPriorityV1g8 | null {
  if (riskLevel === 'CRITICAL') return 'CRITICAL';
  if (riskLevel === 'HIGH') return 'HIGH';
  return null;
}

function notificationTitle(
  input: ProjectRiskAlertInputV1g8,
  priority: ProjectRiskAlertPriorityV1g8,
): string {
  return priority === 'CRITICAL'
    ? `Riesgo crítico: ${input.projectTitle}`
    : `Riesgo alto: ${input.projectTitle}`;
}

function notificationBody(
  input: ProjectRiskAlertInputV1g8,
): string {
  const parts: string[] = [];

  parts.push(`Riesgo general: ${input.risk.riskLevel}.`);
  parts.push(
    `Riesgo financiero: ${input.risk.financial.health}.`,
  );

  if (input.risk.schedule.health) {
    parts.push(
      `Riesgo de plazo: ${input.risk.schedule.health}.`,
    );
  }

  if (
    input.risk.financial.forecastVariancePercent !== null
  ) {
    parts.push(
      `Desviación financiera proyectada: ${input.risk.financial.forecastVariancePercent}%.`,
    );
  }

  if (input.risk.schedule.forecastVarianceDays !== null) {
    parts.push(
      `Desviación de plazo proyectada: ${input.risk.schedule.forecastVarianceDays} días.`,
    );
  }

  if (input.risk.drivers.length > 0) {
    parts.push(
      `Factores: ${input.risk.drivers.join(', ')}.`,
    );
  }

  return parts.join(' ');
}

export function buildProjectRiskAlertV1g8(
  input: ProjectRiskAlertInputV1g8,
) {
  const fingerprint = projectRiskFingerprintV1g8(input);
  const priority = alertPriority(input.risk.riskLevel);

  const assessmentEvent = {
    eventType: 'bridata.project.risk.assessed' as const,
    aggregateId: input.projectId,
    idempotencyKey:
      `project-risk-assessed:v1g8:${input.projectId}:${fingerprint}`,
    payload: {
      version: 'v1g8' as const,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      riskLevel: input.risk.riskLevel,
      drivers: input.risk.drivers,
      financialHealth: input.risk.financial.health,

      controlBudget:
        input.risk.financial.controlBudget,

      estimateAtCompletion:
        input.risk.financial.estimateAtCompletion,

      varianceAtCompletion:
        input.risk.financial.varianceAtCompletion,

      scheduleHealth: input.risk.schedule.health,

      plannedFinish:
        input.risk.schedule.plannedFinish,

      forecastFinish:
        input.risk.schedule.forecastFinish,

      forecastVariancePercent:
        input.risk.financial.forecastVariancePercent,
      forecastVarianceDays:
        input.risk.schedule.forecastVarianceDays,
      requiresAttention: input.risk.requiresAttention,
      fingerprint,
    },
  };

  if (!priority) {
    return {
      version: 'v1g8' as const,
      fingerprint,
      shouldNotify: false,
      priority: null,
      assessmentEvent,
      notificationEvent: null,
    };
  }

  const notificationEvent = {
    eventType: 'bridata.notification.requested' as const,
    aggregateId: input.projectId,
    idempotencyKey:
      `project-risk-notification:v1g8:${input.projectId}:${input.targetUserId}:${fingerprint}`,
    payload: {
      targetUserId: input.targetUserId,
      notificationTitle: notificationTitle(input, priority),
      notificationBody: notificationBody(input),
      priority,
      requiresAction: true,
      scopeWorkspaceId: input.workspaceId,
      scopeProjectId: input.projectId,
    },
  };

  return {
    version: 'v1g8' as const,
    fingerprint,
    shouldNotify: true,
    priority,
    assessmentEvent,
    notificationEvent,
  };
}
