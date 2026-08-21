import type { NexusObject, ProjectHealthMetrics } from '../types/nexus';

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const completedStatuses = new Set(['COMPLETED', 'APPROVED', 'CANCELLED', 'CLOSED']);

function parseDate(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function calculateExpectedProgress(project: NexusObject, now: number): number | null {
  const start = parseDate(project.startDate);
  const end = parseDate(project.endDate);
  if (start === null || end === null || end <= start) return null;
  if (now <= start) return 0;
  if (now >= end) return 100;
  return ((now - start) / (end - start)) * 100;
}

export function calculateProjectHealth(
  project: NexusObject | undefined,
  projectObjects: NexusObject[],
  now = Date.now(),
): ProjectHealthMetrics {
  const tasks = projectObjects.filter(
    (object) =>
      object.type === 'TASK' ||
      object.type === 'DELIVERABLE' ||
      object.type === 'MILESTONE',
  );
  const risks = projectObjects.filter((object) => object.type === 'RISK');

  const actualProgress = tasks.length
    ? tasks.reduce((sum, task) => sum + clamp(task.progress), 0) / tasks.length
    : clamp(project?.progress ?? 0);

  const overdueTasks = tasks.filter((task) => {
    const due = parseDate(task.endDate);
    return (
      due !== null &&
      due < now &&
      !completedStatuses.has(task.status)
    );
  });
  const blockedTasks = tasks.filter((task) => task.status === 'BLOCKED');
  const overdueRatio = tasks.length ? overdueTasks.length / tasks.length : 0;
  const blockedRatio = tasks.length ? blockedTasks.length / tasks.length : 0;

  const expectedProgress = project
    ? calculateExpectedProgress(project, now)
    : null;
  const scheduleVariance = expectedProgress === null ? 0 : actualProgress - expectedProgress;
  const scheduleScore = Math.round(
    clamp(100 + scheduleVariance - overdueRatio * 35 - blockedRatio * 20),
  );

  const budgetTotal = project?.budgetTotal ?? 0;
  const budgetSpent = project?.budgetSpent ?? 0;
  const budgetBurnPercentage =
    budgetTotal > 0 ? Math.round((budgetSpent / budgetTotal) * 100) : 0;

  // Compare cost consumption with physical progress. Overspending ahead of earned
  // progress lowers the score; being on/under the earned-value line stays healthy.
  const costVariance = budgetTotal > 0 ? actualProgress - budgetBurnPercentage : 0;
  const budgetScore = Math.round(
    budgetTotal > 0 ? clamp(100 + Math.min(0, costVariance)) : 100,
  );

  const activeRisks = risks.filter(
    (risk) => !risk.isRealized && !completedStatuses.has(risk.status),
  );
  const totalRiskExposure = activeRisks.reduce(
    (sum, risk) => sum + clamp(risk.riskScore ?? 0, 0, 25),
    0,
  );
  const maximumRiskExposure = Math.max(1, activeRisks.length * 25);
  const riskScore = Math.round(
    activeRisks.length
      ? clamp(100 - (totalRiskExposure / maximumRiskExposure) * 100)
      : 100,
  );

  const assignedCount = tasks.filter(
    (task) => Boolean(task.assigneeId || task.ownerId),
  ).length;
  const assignmentCoverage = tasks.length ? assignedCount / tasks.length : 1;
  const teamScore = Math.round(
    clamp(assignmentCoverage * 80 + (1 - blockedRatio) * 20),
  );

  const healthScore = Math.round(
    scheduleScore * 0.35 +
      budgetScore * 0.25 +
      riskScore * 0.25 +
      teamScore * 0.15,
  );

  return {
    healthScore,
    scheduleScore,
    budgetScore,
    riskScore,
    teamScore,
    overdueTasksCount: overdueTasks.length,
    criticalRisksCount: activeRisks.filter((risk) => (risk.riskScore ?? 0) >= 15).length,
    budgetBurnPercentage,
  };
}
