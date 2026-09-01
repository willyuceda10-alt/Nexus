import { z } from 'zod';

import type {
  ProjectRiskHistoryPointV1g10,
} from './project-risk-history-v1g10.js';

export const projectRiskAssessmentPayloadSchemaV1 =
  z.object({
    projectId:
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

    financialHealth:
      z.enum([
        'NO_BUDGET',
        'ON_TRACK',
        'WATCH',
        'HIGH',
        'CRITICAL',
      ]),

    scheduleHealth:
      z.enum([
        'ON_TRACK',
        'WATCH',
        'HIGH',
        'CRITICAL',
      ]).nullable(),

    forecastVariancePercent:
      z.number().nullable(),

    forecastVarianceDays:
      z.number().nullable(),

    requiresAttention:
      z.boolean(),

    fingerprint:
      z.string().min(1),
  })
  .passthrough();

export function
projectRiskHistoryPointFromAssessmentEventV1(
  event: {
    id: string;
    payload: unknown;
    createdAt: Date;
  },
  expectedProjectId: string,
): ProjectRiskHistoryPointV1g10 | null {
  const parsed =
    projectRiskAssessmentPayloadSchemaV1
      .safeParse(event.payload);

  if (
    !parsed.success ||
    parsed.data.projectId !==
      expectedProjectId
  ) {
    return null;
  }

  return {
    id:
      event.id,

    observedAt:
      event.createdAt
        .toISOString(),

    riskLevel:
      parsed.data.riskLevel,

    drivers:
      parsed.data.drivers,

    financialHealth:
      parsed.data.financialHealth,

    scheduleHealth:
      parsed.data.scheduleHealth,

    forecastVariancePercent:
      parsed.data
        .forecastVariancePercent,

    forecastVarianceDays:
      parsed.data
        .forecastVarianceDays,

    requiresAttention:
      parsed.data.requiresAttention,

    fingerprint:
      parsed.data.fingerprint,
  };
}
