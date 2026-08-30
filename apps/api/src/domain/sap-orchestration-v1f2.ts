export const SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2 = [
  'SAP_PROCUREMENT_COMMITMENTS',
  'SAP_PROJECT_PROCUREMENT',
  'SAP_OPEN_PURCHASE_ORDERS',
  'SAP_MATERIAL_MOVEMENTS',
  'SAP_PROJECT_ACTUAL_COSTS',
] as const;

export type SapOrchestrationSourceKeyV1f2 = typeof SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2[number];

export const SAP_ORCHESTRATION_STEPS_V1F2 = [
  'CANONICAL_PROCUREMENT_V1D1',
  'INVENTORY_V1D2',
  'FINANCIAL_GUARD_V1D3',
  'ACTUAL_COST_V1D4',
] as const;

export type SapOrchestrationStepV1f2 = typeof SAP_ORCHESTRATION_STEPS_V1F2[number];

export type SapAutomationProfileV1f2 = {
  enabled: boolean;
  workspaceId: string;
  ownerUserId: string;
  requiredSourceKeys: SapOrchestrationSourceKeyV1f2[];
};

export type SapSourceReadinessV1f2 = {
  sourceKey: string;
  latestStatus: string | null;
};

export function normalizeRequiredSourceKeysV1f2(values: readonly string[]): SapOrchestrationSourceKeyV1f2[] {
  const allowed = new Set<string>(SAP_ORCHESTRATION_REQUIRED_SOURCES_V1F2);
  const normalized = [...new Set(values.map((value) => value.trim().toUpperCase()))]
    .filter((value): value is SapOrchestrationSourceKeyV1f2 => allowed.has(value));
  return normalized.sort((a, b) => a.localeCompare(b));
}

export function servicePrincipalCoversProfileV1f2(
  allowedSourceKeys: readonly string[],
  requiredSourceKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedSourceKeys.map((value) => value.trim().toUpperCase()));
  return requiredSourceKeys.every((sourceKey) => allowed.has(sourceKey.trim().toUpperCase()));
}

export function notReadySourcesV1f2(
  requiredSourceKeys: readonly string[],
  readiness: readonly SapSourceReadinessV1f2[],
): Array<{ sourceKey: string; status: string }> {
  const byKey = new Map(readiness.map((row) => [row.sourceKey.trim().toUpperCase(), row.latestStatus]));
  return requiredSourceKeys.flatMap((raw) => {
    const sourceKey = raw.trim().toUpperCase();
    const status = byKey.get(sourceKey) ?? null;
    return status === 'SUCCEEDED' || status === 'PARTIAL'
      ? []
      : [{ sourceKey, status: status ?? 'NEVER' }];
  });
}

export function readSapAutomationProfileV1f2(config: unknown): SapAutomationProfileV1f2 | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const root = config as Record<string, unknown>;
  const raw = root.sapAutomationV1f2;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const profile = raw as Record<string, unknown>;
  if (typeof profile.enabled !== 'boolean') return null;
  if (typeof profile.workspaceId !== 'string' || typeof profile.ownerUserId !== 'string') return null;
  if (!Array.isArray(profile.requiredSourceKeys)) return null;
  const requiredSourceKeys = normalizeRequiredSourceKeysV1f2(
    profile.requiredSourceKeys.filter((value): value is string => typeof value === 'string'),
  );
  if (requiredSourceKeys.length === 0) return null;
  return {
    enabled: profile.enabled,
    workspaceId: profile.workspaceId,
    ownerUserId: profile.ownerUserId,
    requiredSourceKeys,
  };
}

export function mergeSapAutomationProfileV1f2(
  config: unknown,
  profile: SapAutomationProfileV1f2,
): Record<string, unknown> {
  const base = config && typeof config === 'object' && !Array.isArray(config)
    ? { ...(config as Record<string, unknown>) }
    : {};
  return {
    ...base,
    sapAutomationV1f2: {
      enabled: profile.enabled,
      workspaceId: profile.workspaceId,
      ownerUserId: profile.ownerUserId,
      requiredSourceKeys: normalizeRequiredSourceKeysV1f2(profile.requiredSourceKeys),
      version: 'v1f2',
    },
  };
}
