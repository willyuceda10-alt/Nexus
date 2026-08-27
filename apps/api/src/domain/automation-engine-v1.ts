export type AutomationScalarV1 = string | number | boolean | null;

export type AutomationValueV1 =
  | { kind: 'LITERAL'; value: AutomationScalarV1 }
  | { kind: 'EVENT_PATH'; path: string };

export type AutomationPredicateOperatorV1 =
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'IN'
  | 'NOT_IN'
  | 'CONTAINS'
  | 'EXISTS';

export type AutomationConditionV1 =
  | {
      kind: 'GROUP';
      operator: 'AND' | 'OR';
      conditions: AutomationConditionV1[];
    }
  | {
      kind: 'PREDICATE';
      left: AutomationValueV1;
      operator: AutomationPredicateOperatorV1;
      right?: AutomationValueV1;
    };

export type AutomationActionV1 =
  | {
      type: 'EMIT_EVENT';
      eventType: string;
      aggregateId?: AutomationValueV1;
      payload?: Record<string, AutomationValueV1>;
    }
  | {
      type: 'CREATE_TASK';
      title: AutomationValueV1;
      description?: AutomationValueV1;
      projectId?: AutomationValueV1;
      workspaceId?: AutomationValueV1;
      assigneeId?: AutomationValueV1;
      dueDate?: AutomationValueV1;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    }
  | {
      type: 'REQUEST_APPROVAL';
      title: AutomationValueV1;
      description?: AutomationValueV1;
      approverUserId?: AutomationValueV1;
    };

export interface AutomationEventEnvelopeV1 {
  schemaVersion: number;
  eventId: string;
  tenantId: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  occurredAt?: string;
}

export interface AutomationTraceV1 {
  rootEventId: string;
  depth: number;
  visitedAutomationIds: string[];
}

export interface AutomationDefinitionLimitsV1 {
  maxConditionDepth?: number;
  maxPredicates?: number;
  maxActions?: number;
}

export class AutomationValidationErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutomationValidationErrorV1';
  }
}

const PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function eventContextV1(event: AutomationEventEnvelopeV1): Record<string, unknown> {
  return {
    eventId: event.eventId,
    tenantId: event.tenantId,
    aggregateId: event.aggregateId,
    eventType: event.eventType,
    occurredAt: event.occurredAt ?? null,
    payload: event.payload,
  };
}

export function readAutomationPathV1(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  if (
    parts.length === 0 ||
    parts.length > 20 ||
    parts.some((part) => !PATH_SEGMENT.test(part) || FORBIDDEN_PATH_SEGMENTS.has(part))
  ) {
    throw new AutomationValidationErrorV1(`Invalid event path: ${path}`);
  }

  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

export function resolveAutomationValueV1(
  value: AutomationValueV1,
  event: AutomationEventEnvelopeV1,
): unknown {
  if (value.kind === 'LITERAL') return value.value;
  return readAutomationPathV1(eventContextV1(event), value.path);
}

function comparableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function primitiveEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return false;
}

export function evaluateAutomationConditionV1(
  condition: AutomationConditionV1 | null | undefined,
  event: AutomationEventEnvelopeV1,
): boolean {
  if (!condition) return true;

  if (condition.kind === 'GROUP') {
    if (condition.conditions.length === 0) return condition.operator === 'AND';
    return condition.operator === 'AND'
      ? condition.conditions.every((child) => evaluateAutomationConditionV1(child, event))
      : condition.conditions.some((child) => evaluateAutomationConditionV1(child, event));
  }

  const left = resolveAutomationValueV1(condition.left, event);
  if (condition.operator === 'EXISTS') return left !== undefined && left !== null;
  const right = condition.right ? resolveAutomationValueV1(condition.right, event) : undefined;

  switch (condition.operator) {
    case 'EQ': return primitiveEqual(left, right);
    case 'NEQ': return !primitiveEqual(left, right);
    case 'GT': {
      const l = comparableNumber(left); const r = comparableNumber(right);
      return l !== null && r !== null && l > r;
    }
    case 'GTE': {
      const l = comparableNumber(left); const r = comparableNumber(right);
      return l !== null && r !== null && l >= r;
    }
    case 'LT': {
      const l = comparableNumber(left); const r = comparableNumber(right);
      return l !== null && r !== null && l < r;
    }
    case 'LTE': {
      const l = comparableNumber(left); const r = comparableNumber(right);
      return l !== null && r !== null && l <= r;
    }
    case 'IN': return Array.isArray(right) && right.some((candidate) => primitiveEqual(left, candidate));
    case 'NOT_IN': return Array.isArray(right) && !right.some((candidate) => primitiveEqual(left, candidate));
    case 'CONTAINS': {
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      if (Array.isArray(left)) return left.some((candidate) => primitiveEqual(candidate, right));
      return false;
    }
    default: return false;
  }
}

function validateValue(value: AutomationValueV1): void {
  if (value.kind === 'EVENT_PATH') {
    readAutomationPathV1({}, value.path);
  }
}

function conditionStats(
  condition: AutomationConditionV1,
  depth = 1,
): { depth: number; predicates: number } {
  if (condition.kind === 'PREDICATE') {
    validateValue(condition.left);
    if (condition.operator !== 'EXISTS' && !condition.right) {
      throw new AutomationValidationErrorV1(`${condition.operator} requires a right operand.`);
    }
    if (condition.right) validateValue(condition.right);
    return { depth, predicates: 1 };
  }

  if (condition.conditions.length === 0) {
    throw new AutomationValidationErrorV1('Condition groups must contain at least one condition.');
  }
  const children = condition.conditions.map((child) => conditionStats(child, depth + 1));
  return {
    depth: Math.max(depth, ...children.map((child) => child.depth)),
    predicates: children.reduce((sum, child) => sum + child.predicates, 0),
  };
}

function validateAction(action: AutomationActionV1): void {
  if (action.type === 'EMIT_EVENT') {
    if (!/^bridata\.[a-z0-9._-]{1,130}$/i.test(action.eventType)) {
      throw new AutomationValidationErrorV1('EMIT_EVENT eventType must use the bridata.* namespace.');
    }
    if (action.aggregateId) validateValue(action.aggregateId);
    for (const value of Object.values(action.payload ?? {})) validateValue(value);
    return;
  }
  if (action.type === 'CREATE_TASK') {
    validateValue(action.title);
    if (action.description) validateValue(action.description);
    if (action.projectId) validateValue(action.projectId);
    if (action.workspaceId) validateValue(action.workspaceId);
    if (action.assigneeId) validateValue(action.assigneeId);
    if (action.dueDate) validateValue(action.dueDate);
    return;
  }
  validateValue(action.title);
  if (action.description) validateValue(action.description);
  if (action.approverUserId) validateValue(action.approverUserId);
}

export function validateAutomationVersionV1(options: {
  triggerEventType: string;
  condition?: AutomationConditionV1 | null;
  actions: AutomationActionV1[];
  limits?: AutomationDefinitionLimitsV1;
}): void {
  if (!/^bridata\.[a-z0-9._-]{1,130}$/i.test(options.triggerEventType)) {
    throw new AutomationValidationErrorV1('Trigger event type must use the bridata.* namespace.');
  }

  const maxDepth = options.limits?.maxConditionDepth ?? 5;
  const maxPredicates = options.limits?.maxPredicates ?? 20;
  const maxActions = options.limits?.maxActions ?? 10;

  if (options.condition) {
    const stats = conditionStats(options.condition);
    if (stats.depth > maxDepth) {
      throw new AutomationValidationErrorV1(`Condition depth exceeds ${maxDepth}.`);
    }
    if (stats.predicates > maxPredicates) {
      throw new AutomationValidationErrorV1(`Condition predicate count exceeds ${maxPredicates}.`);
    }
  }

  if (options.actions.length === 0 || options.actions.length > maxActions) {
    throw new AutomationValidationErrorV1(`Automation must contain 1-${maxActions} actions.`);
  }
  options.actions.forEach(validateAction);
}

export function automationTraceFromEventV1(event: AutomationEventEnvelopeV1): AutomationTraceV1 {
  const payload = isRecord(event.payload) ? event.payload : {};
  const raw = isRecord(payload._automation) ? payload._automation : {};
  const depth = typeof raw.depth === 'number' && Number.isInteger(raw.depth) && raw.depth >= 0 ? raw.depth : 0;
  const rootEventId = typeof raw.rootEventId === 'string' ? raw.rootEventId : event.eventId;
  const visitedAutomationIds = Array.isArray(raw.visitedAutomationIds)
    ? raw.visitedAutomationIds.filter((value): value is string => typeof value === 'string').slice(0, 50)
    : [];
  return { rootEventId, depth, visitedAutomationIds };
}

export function nextAutomationTraceV1(
  trace: AutomationTraceV1,
  automationDefinitionId: string,
): AutomationTraceV1 {
  return {
    rootEventId: trace.rootEventId,
    depth: trace.depth + 1,
    visitedAutomationIds: [...trace.visitedAutomationIds, automationDefinitionId].slice(-50),
  };
}

export function automationRecursionBlockedV1(options: {
  trace: AutomationTraceV1;
  automationDefinitionId: string;
  maxDepth: number;
}): boolean {
  return options.trace.depth >= options.maxDepth || options.trace.visitedAutomationIds.includes(options.automationDefinitionId);
}

export function resolvedActionScalarV1(
  value: AutomationValueV1 | undefined,
  event: AutomationEventEnvelopeV1,
): AutomationScalarV1 | undefined {
  if (!value) return undefined;
  const resolved = resolveAutomationValueV1(value, event);
  return resolved === null || ['string', 'number', 'boolean'].includes(typeof resolved)
    ? resolved as AutomationScalarV1
    : undefined;
}
