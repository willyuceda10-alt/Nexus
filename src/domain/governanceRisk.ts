import type { NexusObject, ObjectRelation } from '../types/nexus';

export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNRATED';

export interface GovernanceRiskRow {
  id: string;
  title: string;
  projectId?: string;
  projectName: string;
  portfolioId?: string;
  portfolioName?: string;
  ownerName: string;
  status: NexusObject['status'];
  probability?: number;
  impact?: number;
  score?: number;
  band: RiskBand;
  realized: boolean;
  mitigationPlan?: string;
  mitigationDueDate?: string;
  mitigationOverdue: boolean;
  relatedChangeRequestIds: string[];
  source: NexusObject;
}

export interface GovernanceChangeRow {
  id: string;
  title: string;
  projectId?: string;
  projectName: string;
  status: NexusObject['status'];
  ownerName: string;
  costImpact?: number;
  timeImpactDays?: number;
  reason?: string;
  source: NexusObject;
}

export interface RiskMatrixCell {
  probability: number;
  impact: number;
  score: number;
  band: Exclude<RiskBand, 'UNRATED'>;
  count: number;
  riskIds: string[];
}

export interface ProjectRiskExposure {
  projectId: string;
  projectName: string;
  portfolioName?: string;
  openRiskCount: number;
  ratedRiskCount: number;
  criticalRiskCount: number;
  realizedRiskCount: number;
  exposureScore: number;
  mitigationCoveragePct: number;
}

export interface PortfolioRiskExposure {
  portfolioId: string;
  portfolioName: string;
  projectCount: number;
  openRiskCount: number;
  ratedRiskCount: number;
  criticalRiskCount: number;
  realizedRiskCount: number;
  exposureScore: number;
  mitigationCoveragePct: number;
}

export interface GovernanceProjection {
  risks: GovernanceRiskRow[];
  changes: GovernanceChangeRow[];
  matrix: RiskMatrixCell[];
  projectExposure: ProjectRiskExposure[];
  portfolioExposure: PortfolioRiskExposure[];
  summary: {
    openRiskCount: number;
    ratedRiskCount: number;
    unratedRiskCount: number;
    criticalRiskCount: number;
    realizedRiskCount: number;
    mitigationOverdueCount: number;
    mitigationCoveragePct: number;
    exposureScore: number;
    pendingChangeCount: number;
    approvedChangeCount: number;
    unestimatedChangeCount: number;
    changeCostImpact: number;
    changeTimeImpactDays: number;
  };
}

const TERMINAL_RISK_STATUSES = new Set<NexusObject['status']>(['CLOSED', 'COMPLETED', 'CANCELLED']);
const PENDING_CHANGE_STATUSES = new Set<NexusObject['status']>(['DRAFT', 'PLANNING', 'IN_PROGRESS', 'IN_REVIEW', 'PENDING_APPROVAL']);
const EXCLUDED_CHANGE_IMPACT_STATUSES = new Set<NexusObject['status']>(['REJECTED', 'CANCELLED']);

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function validScale(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function riskBand(score: number | undefined): RiskBand {
  if (score === undefined) return 'UNRATED';
  if (score >= 15) return 'CRITICAL';
  if (score >= 10) return 'HIGH';
  if (score >= 5) return 'MEDIUM';
  return 'LOW';
}

function ratedScore(risk: NexusObject): number | undefined {
  if (!validScale(risk.probability) || !validScale(risk.impact)) return undefined;
  return risk.probability * risk.impact;
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function explicitRiskChangeLinks(
  relations: ObjectRelation[],
  riskIds: Set<string>,
  changeIds: Set<string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const relation of relations) {
    const sourceIsRisk = riskIds.has(relation.sourceObjectId);
    const targetIsRisk = riskIds.has(relation.targetObjectId);
    const sourceIsChange = changeIds.has(relation.sourceObjectId);
    const targetIsChange = changeIds.has(relation.targetObjectId);

    let riskId: string | undefined;
    let changeId: string | undefined;
    if (sourceIsRisk && targetIsChange) {
      riskId = relation.sourceObjectId;
      changeId = relation.targetObjectId;
    } else if (targetIsRisk && sourceIsChange) {
      riskId = relation.targetObjectId;
      changeId = relation.sourceObjectId;
    }

    if (!riskId || !changeId) continue;
    const current = result.get(riskId) ?? [];
    if (!current.includes(changeId)) current.push(changeId);
    result.set(riskId, current);
  }

  return result;
}

export function buildGovernanceProjection(
  objects: NexusObject[],
  relations: ObjectRelation[],
  todayIso: string,
  scopedProjectId?: string,
): GovernanceProjection {
  const today = dateOnly(todayIso);
  const projects = objects.filter((object) => object.type === 'PROJECT');
  const portfolios = objects.filter((object) => object.type === 'PORTFOLIO');
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const portfolioById = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio]));

  const riskObjects = objects.filter(
    (object) => object.type === 'RISK' && (!scopedProjectId || object.projectId === scopedProjectId),
  );
  const changeObjects = objects.filter(
    (object) => object.type === 'CHANGE_REQUEST' && (!scopedProjectId || object.projectId === scopedProjectId),
  );

  const explicitLinks = explicitRiskChangeLinks(
    relations,
    new Set(riskObjects.map((risk) => risk.id)),
    new Set(changeObjects.map((change) => change.id)),
  );

  const risks: GovernanceRiskRow[] = riskObjects.map((risk) => {
    const score = ratedScore(risk);
    const project = risk.projectId ? projectById.get(risk.projectId) : undefined;
    const portfolioId = project?.portfolioId;
    const portfolio = portfolioId ? portfolioById.get(portfolioId) : undefined;
    const mitigationDueDate = risk.endDate ? dateOnly(risk.endDate) : undefined;
    const realized = risk.isRealized === true || risk.status === 'REALIZED';
    const mitigationOverdue = Boolean(
      mitigationDueDate &&
      mitigationDueDate < today &&
      !TERMINAL_RISK_STATUSES.has(risk.status),
    );

    return {
      id: risk.id,
      title: risk.title,
      ...(risk.projectId ? { projectId: risk.projectId } : {}),
      projectName: project?.title ?? 'Sin proyecto',
      ...(portfolioId ? { portfolioId } : {}),
      ...(portfolio?.title ? { portfolioName: portfolio.title } : {}),
      ownerName: risk.assigneeName ?? risk.ownerName,
      status: risk.status,
      ...(risk.probability !== undefined ? { probability: risk.probability } : {}),
      ...(risk.impact !== undefined ? { impact: risk.impact } : {}),
      ...(score !== undefined ? { score } : {}),
      band: riskBand(score),
      realized,
      ...(risk.mitigationPlan ? { mitigationPlan: risk.mitigationPlan } : {}),
      ...(mitigationDueDate ? { mitigationDueDate } : {}),
      mitigationOverdue,
      relatedChangeRequestIds: explicitLinks.get(risk.id) ?? [],
      source: risk,
    };
  });

  const changes: GovernanceChangeRow[] = changeObjects.map((change) => {
    const project = change.projectId ? projectById.get(change.projectId) : undefined;
    return {
      id: change.id,
      title: change.title,
      ...(change.projectId ? { projectId: change.projectId } : {}),
      projectName: project?.title ?? 'Sin proyecto',
      status: change.status,
      ownerName: change.assigneeName ?? change.ownerName,
      ...(change.costImpact !== undefined ? { costImpact: Math.max(0, change.costImpact) } : {}),
      ...(change.timeImpactDays !== undefined ? { timeImpactDays: Math.max(0, change.timeImpactDays) } : {}),
      ...(change.changeReason ? { reason: change.changeReason } : {}),
      source: change,
    };
  });

  const openRisks = risks.filter((risk) => !TERMINAL_RISK_STATUSES.has(risk.status));
  const ratedOpenRisks = openRisks.filter((risk) => risk.score !== undefined);
  const mitigatedOpenRisks = openRisks.filter((risk) => Boolean(risk.mitigationPlan?.trim()));

  const matrix: RiskMatrixCell[] = [];
  for (let probability = 5; probability >= 1; probability -= 1) {
    for (let impact = 1; impact <= 5; impact += 1) {
      const score = probability * impact;
      const cellRisks = openRisks.filter(
        (risk) => risk.probability === probability && risk.impact === impact,
      );
      matrix.push({
        probability,
        impact,
        score,
        band: riskBand(score) as Exclude<RiskBand, 'UNRATED'>,
        count: cellRisks.length,
        riskIds: cellRisks.map((risk) => risk.id),
      });
    }
  }

  const groupedByProject = new Map<string, GovernanceRiskRow[]>();
  for (const risk of openRisks) {
    const key = risk.projectId ?? '__unassigned__';
    const current = groupedByProject.get(key) ?? [];
    current.push(risk);
    groupedByProject.set(key, current);
  }

  const projectExposure: ProjectRiskExposure[] = [...groupedByProject.entries()]
    .map(([key, projectRisks]) => {
      const project = key === '__unassigned__' ? undefined : projectById.get(key);
      const rated = projectRisks.filter((risk) => risk.score !== undefined);
      const mitigated = projectRisks.filter((risk) => Boolean(risk.mitigationPlan?.trim()));
      const portfolio = project?.portfolioId ? portfolioById.get(project.portfolioId) : undefined;
      return {
        projectId: key,
        projectName: project?.title ?? 'Sin proyecto',
        ...(portfolio?.title ? { portfolioName: portfolio.title } : {}),
        openRiskCount: projectRisks.length,
        ratedRiskCount: rated.length,
        criticalRiskCount: projectRisks.filter((risk) => risk.band === 'CRITICAL').length,
        realizedRiskCount: projectRisks.filter((risk) => risk.realized).length,
        exposureScore: rated.reduce((sum, risk) => sum + (risk.score ?? 0), 0),
        mitigationCoveragePct: pct(mitigated.length, projectRisks.length),
      };
    })
    .sort((a, b) => b.exposureScore - a.exposureScore || b.criticalRiskCount - a.criticalRiskCount);

  const groupedByPortfolio = new Map<string, GovernanceRiskRow[]>();
  for (const risk of openRisks) {
    const key = risk.portfolioId ?? '__unassigned__';
    const current = groupedByPortfolio.get(key) ?? [];
    current.push(risk);
    groupedByPortfolio.set(key, current);
  }

  const portfolioExposure: PortfolioRiskExposure[] = [...groupedByPortfolio.entries()]
    .map(([key, portfolioRisks]) => {
      const portfolio = key === '__unassigned__' ? undefined : portfolioById.get(key);
      const rated = portfolioRisks.filter((risk) => risk.score !== undefined);
      const mitigated = portfolioRisks.filter((risk) => Boolean(risk.mitigationPlan?.trim()));
      const projectIds = new Set(portfolioRisks.map((risk) => risk.projectId).filter((value): value is string => Boolean(value)));
      return {
        portfolioId: key,
        portfolioName: portfolio?.title ?? 'Sin portafolio',
        projectCount: projectIds.size,
        openRiskCount: portfolioRisks.length,
        ratedRiskCount: rated.length,
        criticalRiskCount: portfolioRisks.filter((risk) => risk.band === 'CRITICAL').length,
        realizedRiskCount: portfolioRisks.filter((risk) => risk.realized).length,
        exposureScore: rated.reduce((sum, risk) => sum + (risk.score ?? 0), 0),
        mitigationCoveragePct: pct(mitigated.length, portfolioRisks.length),
      };
    })
    .sort((a, b) => b.exposureScore - a.exposureScore || b.criticalRiskCount - a.criticalRiskCount);

  const pendingChanges = changes.filter((change) => PENDING_CHANGE_STATUSES.has(change.status));
  const approvedChanges = changes.filter((change) => change.status === 'APPROVED');
  const currentImpactChanges = changes.filter((change) => !EXCLUDED_CHANGE_IMPACT_STATUSES.has(change.status));
  const unestimatedChangeCount = currentImpactChanges.filter(
    (change) => change.costImpact === undefined || change.timeImpactDays === undefined,
  ).length;

  return {
    risks: [...risks].sort((a, b) => {
      if (a.score === undefined && b.score !== undefined) return 1;
      if (a.score !== undefined && b.score === undefined) return -1;
      return (b.score ?? 0) - (a.score ?? 0) || a.title.localeCompare(b.title);
    }),
    changes,
    matrix,
    projectExposure,
    portfolioExposure,
    summary: {
      openRiskCount: openRisks.length,
      ratedRiskCount: ratedOpenRisks.length,
      unratedRiskCount: openRisks.length - ratedOpenRisks.length,
      criticalRiskCount: openRisks.filter((risk) => risk.band === 'CRITICAL').length,
      realizedRiskCount: openRisks.filter((risk) => risk.realized).length,
      mitigationOverdueCount: openRisks.filter((risk) => risk.mitigationOverdue).length,
      mitigationCoveragePct: pct(mitigatedOpenRisks.length, openRisks.length),
      exposureScore: ratedOpenRisks.reduce((sum, risk) => sum + (risk.score ?? 0), 0),
      pendingChangeCount: pendingChanges.length,
      approvedChangeCount: approvedChanges.length,
      unestimatedChangeCount,
      changeCostImpact: currentImpactChanges.reduce((sum, change) => sum + (change.costImpact ?? 0), 0),
      changeTimeImpactDays: currentImpactChanges.reduce((sum, change) => sum + (change.timeImpactDays ?? 0), 0),
    },
  };
}
