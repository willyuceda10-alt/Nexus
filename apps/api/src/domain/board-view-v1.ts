export type WorkBoardColumnSourceV1 = 'CORE' | 'CUSTOM';
export type WorkBoardColumnTypeV1 =
  | 'TEXT' | 'LONG_TEXT' | 'NUMBER' | 'CURRENCY' | 'DATE' | 'BOOLEAN'
  | 'STATUS' | 'PRIORITY' | 'PROGRESS' | 'PERSON' | 'TAGS' | 'LINK' | 'FILE' | 'FORMULA';
export type WorkViewTypeV1 = 'TABLE' | 'KANBAN' | 'CALENDAR' | 'GANTT' | 'TIMELINE';

const CORE_FIELD_TYPES: Record<string, WorkBoardColumnTypeV1> = {
  title: 'TEXT',
  description: 'LONG_TEXT',
  status: 'STATUS',
  priority: 'PRIORITY',
  progress: 'PROGRESS',
  ownerId: 'PERSON',
  assigneeId: 'PERSON',
  startDate: 'DATE',
  dueDate: 'DATE',
  createdAt: 'DATE',
  updatedAt: 'DATE',
};

const RESERVED_CUSTOM_KEYS = new Set([
  '__proto__', 'prototype', 'constructor',
  ...Object.keys(CORE_FIELD_TYPES),
]);

export class WorkBoardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkBoardValidationError';
  }
}

export function normalizeBoardKeyV1(value: string): string {
  const normalized = value.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  if (!normalized) throw new WorkBoardValidationError('Board key cannot be empty after normalization.');
  return normalized;
}

export function validateBoardColumnV1(input: {
  source: WorkBoardColumnSourceV1;
  dataType: WorkBoardColumnTypeV1;
  fieldKey: string;
}): void {
  const fieldKey = input.fieldKey.trim();
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(fieldKey)) {
    throw new WorkBoardValidationError('fieldKey must start with a letter and contain only safe field-key characters.');
  }

  if (input.source === 'CORE') {
    const expected = CORE_FIELD_TYPES[fieldKey];
    if (!expected) throw new WorkBoardValidationError(`Unsupported core field: ${fieldKey}`);
    if (expected !== input.dataType) {
      throw new WorkBoardValidationError(`Core field ${fieldKey} requires column type ${expected}.`);
    }
    return;
  }

  if (RESERVED_CUSTOM_KEYS.has(fieldKey)) {
    throw new WorkBoardValidationError(`Custom field key ${fieldKey} is reserved.`);
  }
  if (input.dataType === 'FORMULA') {
    throw new WorkBoardValidationError('Formula columns are read-only definitions and cannot be created as raw custom values in V1.');
  }
}

export function validateViewConfigV1(viewType: WorkViewTypeV1, config: Record<string, unknown>): void {
  const allowed = new Set([
    'groupBy', 'kanbanColumnKey', 'dateFieldKey', 'startFieldKey', 'endFieldKey',
    'filters', 'sort', 'hiddenColumnKeys', 'columnOrder', 'density',
  ]);
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) throw new WorkBoardValidationError(`Unsupported view config key: ${key}`);
  }
  if (config.hiddenColumnKeys !== undefined && (!Array.isArray(config.hiddenColumnKeys) || !config.hiddenColumnKeys.every((item) => typeof item === 'string'))) {
    throw new WorkBoardValidationError('hiddenColumnKeys must be an array of column keys.');
  }
  if (config.columnOrder !== undefined && (!Array.isArray(config.columnOrder) || !config.columnOrder.every((item) => typeof item === 'string'))) {
    throw new WorkBoardValidationError('columnOrder must be an array of column keys.');
  }
  if (viewType === 'KANBAN' && typeof config.kanbanColumnKey !== 'string') {
    throw new WorkBoardValidationError('KANBAN views require kanbanColumnKey.');
  }
  if (viewType === 'CALENDAR' && typeof config.dateFieldKey !== 'string') {
    throw new WorkBoardValidationError('CALENDAR views require dateFieldKey.');
  }
  if ((viewType === 'GANTT' || viewType === 'TIMELINE')
      && (typeof config.startFieldKey !== 'string' || typeof config.endFieldKey !== 'string')) {
    throw new WorkBoardValidationError(`${viewType} views require startFieldKey and endFieldKey.`);
  }
}

export function coreFieldValueV1(object: Record<string, unknown>, fieldKey: string): unknown {
  if (!(fieldKey in CORE_FIELD_TYPES)) return undefined;
  return object[fieldKey];
}
