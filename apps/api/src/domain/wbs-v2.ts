export interface WbsIntentItem {
  objectId: string;
  parentWorkItemId?: string | null;
}

export interface CanonicalWbsItem {
  objectId: string;
  parentWorkItemId: string | null;
  outlineLevel: number;
  sortOrder: number;
  wbsCode: string;
  isSummary: boolean;
}

export class WbsV2ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WbsV2ValidationError';
  }
}

export function canonicalizeWbsV2(items: WbsIntentItem[]): CanonicalWbsItem[] {
  const byId = new Map<string, WbsIntentItem>();
  const order = new Map<string, number>();

  items.forEach((item, index) => {
    if (!item.objectId) throw new WbsV2ValidationError('Every WBS item requires objectId.');
    if (byId.has(item.objectId)) {
      throw new WbsV2ValidationError(`Duplicate WBS object: ${item.objectId}`);
    }
    byId.set(item.objectId, item);
    order.set(item.objectId, index);
  });

  for (const item of items) {
    const parentId = item.parentWorkItemId ?? null;
    if (!parentId) continue;
    if (parentId === item.objectId) {
      throw new WbsV2ValidationError(`WBS item ${item.objectId} cannot be its own parent.`);
    }
    if (!byId.has(parentId)) {
      throw new WbsV2ValidationError(`WBS parent ${parentId} does not exist for ${item.objectId}.`);
    }
  }

  for (const item of items) {
    const visited = new Set<string>();
    let cursor: WbsIntentItem | undefined = item;
    while (cursor?.parentWorkItemId) {
      if (visited.has(cursor.objectId)) {
        throw new WbsV2ValidationError(`WBS hierarchy contains a cycle involving ${cursor.objectId}.`);
      }
      visited.add(cursor.objectId);
      cursor = byId.get(cursor.parentWorkItemId);
    }
  }

  const children = new Map<string | null, string[]>();
  const pushChild = (parentId: string | null, objectId: string) => {
    const current = children.get(parentId) ?? [];
    current.push(objectId);
    children.set(parentId, current);
  };

  for (const item of items) pushChild(item.parentWorkItemId ?? null, item.objectId);
  for (const values of children.values()) {
    values.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  const result: CanonicalWbsItem[] = [];
  const visit = (objectId: string, parentId: string | null, level: number, code: string) => {
    const childIds = children.get(objectId) ?? [];
    result.push({
      objectId,
      parentWorkItemId: parentId,
      outlineLevel: level,
      sortOrder: result.length,
      wbsCode: code,
      isSummary: childIds.length > 0,
    });

    childIds.forEach((childId, index) => {
      visit(childId, objectId, level + 1, `${code}.${index + 1}`);
    });
  };

  const rootIds = children.get(null) ?? [];
  rootIds.forEach((rootId, index) => visit(rootId, null, 0, String(index + 1)));

  if (result.length !== items.length) {
    throw new WbsV2ValidationError('WBS hierarchy could not be fully canonicalized.');
  }

  return result;
}
