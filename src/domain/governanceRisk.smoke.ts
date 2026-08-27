import assert from 'node:assert/strict';
import { buildGovernanceProjection } from './governanceRisk';
import type { NexusObject, ObjectRelation } from '../types/nexus';

const base = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  description: '',
  ownerId: 'user-1',
  ownerName: 'Owner',
  ownerAvatar: '',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  progress: 0,
} as const;

const objects: NexusObject[] = [
  {
    ...base,
    id: 'portfolio-1',
    type: 'PORTFOLIO',
    title: 'Portfolio Alpha',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
  },
  {
    ...base,
    id: 'project-1',
    type: 'PROJECT',
    title: 'Project Alpha',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    portfolioId: 'portfolio-1',
  },
  {
    ...base,
    id: 'risk-critical',
    type: 'RISK',
    projectId: 'project-1',
    title: 'Critical risk',
    status: 'IDENTIFIED',
    priority: 'CRITICAL',
    probability: 5,
    impact: 4,
    mitigationPlan: 'Mitigate now',
    endDate: '2026-08-20',
  },
  {
    ...base,
    id: 'risk-unrated',
    type: 'RISK',
    projectId: 'project-1',
    title: 'Unrated risk',
    status: 'MITIGATING',
    priority: 'HIGH',
  },
  {
    ...base,
    id: 'risk-realized',
    type: 'RISK',
    projectId: 'project-1',
    title: 'Realized risk',
    status: 'REALIZED',
    priority: 'HIGH',
    probability: 3,
    impact: 4,
    isRealized: true,
  },
  {
    ...base,
    id: 'risk-closed',
    type: 'RISK',
    projectId: 'project-1',
    title: 'Closed risk',
    status: 'CLOSED',
    priority: 'LOW',
    probability: 5,
    impact: 5,
  },
  {
    ...base,
    id: 'change-1',
    type: 'CHANGE_REQUEST',
    projectId: 'project-1',
    title: 'Change one',
    status: 'PENDING_APPROVAL',
    priority: 'HIGH',
    costImpact: 12000,
    timeImpactDays: 5,
  },
  {
    ...base,
    id: 'change-2',
    type: 'CHANGE_REQUEST',
    projectId: 'project-1',
    title: 'Change two',
    status: 'APPROVED',
    priority: 'MEDIUM',
    costImpact: 3000,
    timeImpactDays: 2,
  },
];

const relations: ObjectRelation[] = [
  {
    id: 'rel-1',
    sourceObjectId: 'risk-critical',
    targetObjectId: 'change-1',
    relationType: 'RELATES_TO',
  },
];

const result = buildGovernanceProjection(objects, relations, '2026-08-26T12:00:00.000Z');

assert.equal(result.summary.openRiskCount, 3);
assert.equal(result.summary.ratedRiskCount, 2);
assert.equal(result.summary.unratedRiskCount, 1);
assert.equal(result.summary.criticalRiskCount, 1);
assert.equal(result.summary.realizedRiskCount, 1);
assert.equal(result.summary.mitigationOverdueCount, 1);
assert.equal(result.summary.mitigationCoveragePct, 33);
assert.equal(result.summary.exposureScore, 32);
assert.equal(result.summary.pendingChangeCount, 1);
assert.equal(result.summary.approvedChangeCount, 1);
assert.equal(result.summary.changeCostImpact, 15000);
assert.equal(result.summary.changeTimeImpactDays, 7);

const critical = result.risks.find((risk) => risk.id === 'risk-critical');
assert.ok(critical);
assert.equal(critical.band, 'CRITICAL');
assert.equal(critical.score, 20);
assert.equal(critical.mitigationOverdue, true);
assert.deepEqual(critical.relatedChangeRequestIds, ['change-1']);

const unrated = result.risks.find((risk) => risk.id === 'risk-unrated');
assert.ok(unrated);
assert.equal(unrated.band, 'UNRATED');
assert.equal(unrated.score, undefined);

const matrixCell = result.matrix.find((cell) => cell.probability === 5 && cell.impact === 4);
assert.ok(matrixCell);
assert.equal(matrixCell.count, 1);
assert.deepEqual(matrixCell.riskIds, ['risk-critical']);

assert.equal(result.projectExposure.length, 1);
assert.equal(result.projectExposure[0]?.projectName, 'Project Alpha');
assert.equal(result.projectExposure[0]?.portfolioName, 'Portfolio Alpha');
assert.equal(result.projectExposure[0]?.exposureScore, 32);
assert.equal(result.projectExposure[0]?.criticalRiskCount, 1);

console.info('Governance & Risks V2 projection smoke: PASS');
