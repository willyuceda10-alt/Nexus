export type BoardTemporalViewTypeV1 = 'CALENDAR' | 'TIMELINE';

export interface BoardTemporalConfigV1 {
  startFieldKey: string;
  endFieldKey?: string | null;
  titleFieldKey?: string;
  colorFieldKey?: string | null;
  allDay?: boolean;
}

export interface BoardTemporalColumnV1 {
  fieldKey: string;
  dataType: string;
}

export class BoardTemporalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardTemporalValidationError';
  }
}

const SAFE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeKey(value: string, label: string): void {
  if (!SAFE_KEY.test(value)) throw new BoardTemporalValidationError(`${label} is invalid.`);
  if (value.split('.').some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new BoardTemporalValidationError(`${label} contains a forbidden path segment.`);
  }
}

export function validateBoardTemporalConfigV1(
  config: BoardTemporalConfigV1,
  columns: BoardTemporalColumnV1[],
): BoardTemporalConfigV1 {
  assertSafeKey(config.startFieldKey, 'startFieldKey');
  if (config.endFieldKey) assertSafeKey(config.endFieldKey, 'endFieldKey');
  if (config.titleFieldKey) assertSafeKey(config.titleFieldKey, 'titleFieldKey');
  if (config.colorFieldKey) assertSafeKey(config.colorFieldKey, 'colorFieldKey');

  const byKey = new Map(columns.map((column) => [column.fieldKey, column]));
  const temporalCore = new Set(['startDate', 'dueDate']);
  const isDateField = (fieldKey: string): boolean => temporalCore.has(fieldKey) || byKey.get(fieldKey)?.dataType === 'DATE';

  if (!isDateField(config.startFieldKey)) {
    throw new BoardTemporalValidationError('Calendar/Timeline start field must be a DATE column or startDate/dueDate.');
  }
  if (config.endFieldKey && !isDateField(config.endFieldKey)) {
    throw new BoardTemporalValidationError('Calendar/Timeline end field must be a DATE column or startDate/dueDate.');
  }
  if (config.endFieldKey && config.endFieldKey === config.startFieldKey) {
    throw new BoardTemporalValidationError('Start and end fields must differ when an end field is configured.');
  }

  return {
    startFieldKey: config.startFieldKey,
    ...(config.endFieldKey !== undefined ? { endFieldKey: config.endFieldKey } : {}),
    titleFieldKey: config.titleFieldKey ?? 'title',
    ...(config.colorFieldKey !== undefined ? { colorFieldKey: config.colorFieldKey } : {}),
    allDay: config.allDay ?? true,
  };
}

export function normalizeTemporalRangeV1(start: Date, end: Date | null): { start: Date; end: Date } {
  const normalizedStart = new Date(start);
  const normalizedEnd = end ? new Date(end) : new Date(start);
  if (Number.isNaN(normalizedStart.getTime()) || Number.isNaN(normalizedEnd.getTime())) {
    throw new BoardTemporalValidationError('Temporal values must be valid dates.');
  }
  if (normalizedEnd.getTime() < normalizedStart.getTime()) {
    return { start: normalizedStart, end: normalizedStart };
  }
  return { start: normalizedStart, end: normalizedEnd };
}
