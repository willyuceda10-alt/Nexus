import { describe, expect, it } from 'vitest';
import {
  AutomationValidationErrorV1,
  automationRecursionBlockedV1,
  automationTraceFromEventV1,
  evaluateAutomationConditionV1,
  nextAutomationTraceV1,
  resolveAutomationValueV1,
  validateAutomationVersionV1,
  type AutomationEventEnvelopeV1,
} from './automation-engine-v1.js';

const event: AutomationEventEnvelopeV1 = {
  schemaVersion: 1,
  eventId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  aggregateId: '00000000-0000-0000-0000-000000000003',
  eventType: 'bridata.material.requirement.risk-changed',
  payload: {
    projectId: '00000000-0000-0000-0000-000000000004',
    riskLevel: 'CRITICAL',
    deficitQty: 15,
    tags: ['material', 'critical'],
  },
};

describe('Automation Engine V1 DSL', () => {
  it('resolves event paths without eval', () => {
    expect(resolveAutomationValueV1({ kind: 'EVENT_PATH', path: 'payload.riskLevel' }, event)).toBe('CRITICAL');
  });

  it('evaluates nested AND/OR conditions', () => {
    expect(evaluateAutomationConditionV1({
      kind: 'GROUP',
      operator: 'AND',
      conditions: [
        {
          kind: 'PREDICATE',
          left: { kind: 'EVENT_PATH', path: 'payload.riskLevel' },
          operator: 'EQ',
          right: { kind: 'LITERAL', value: 'CRITICAL' },
        },
        {
          kind: 'GROUP',
          operator: 'OR',
          conditions: [
            {
              kind: 'PREDICATE',
              left: { kind: 'EVENT_PATH', path: 'payload.deficitQty' },
              operator: 'GT',
              right: { kind: 'LITERAL', value: 10 },
            },
            {
              kind: 'PREDICATE',
              left: { kind: 'EVENT_PATH', path: 'payload.riskLevel' },
              operator: 'EQ',
              right: { kind: 'LITERAL', value: 'HIGH' },
            },
          ],
        },
      ],
    }, event)).toBe(true);
  });

  it('supports contains for event arrays', () => {
    expect(evaluateAutomationConditionV1({
      kind: 'PREDICATE',
      left: { kind: 'EVENT_PATH', path: 'payload.tags' },
      operator: 'CONTAINS',
      right: { kind: 'LITERAL', value: 'critical' },
    }, event)).toBe(true);
  });

  it('rejects executable-looking paths rather than evaluating them', () => {
    expect(() => resolveAutomationValueV1({ kind: 'EVENT_PATH', path: 'payload.__proto__.polluted' }, event))
      .toThrow(AutomationValidationErrorV1);
  });

  it('enforces action and trigger limits', () => {
    expect(() => validateAutomationVersionV1({
      triggerEventType: 'not-namespaced',
      actions: [{ type: 'EMIT_EVENT', eventType: 'bridata.test', payload: {} }],
    })).toThrow(AutomationValidationErrorV1);

    expect(() => validateAutomationVersionV1({
      triggerEventType: 'bridata.test',
      actions: [],
    })).toThrow(AutomationValidationErrorV1);
  });

  it('blocks cycles and excessive automation depth', () => {
    const trace = automationTraceFromEventV1(event);
    const next = nextAutomationTraceV1(trace, 'automation-a');
    expect(automationRecursionBlockedV1({ trace: next, automationDefinitionId: 'automation-a', maxDepth: 5 })).toBe(true);
    expect(automationRecursionBlockedV1({ trace: { ...next, visitedAutomationIds: [] }, automationDefinitionId: 'automation-b', maxDepth: 1 })).toBe(true);
  });
});
