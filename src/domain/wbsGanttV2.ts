import type {
  ApiScheduleAnalysisV2Task,
  ApiWbsV2Node,
} from '../api/projectScheduleV2Contracts';

export interface WbsBarV2 {
  objectId: string;
  plannedStart: string;
  plannedFinish: string;
  critical: boolean;
  isSummary: boolean;
}

export function wbsIntent(nodes: ApiWbsV2Node[]) {
  return nodes.map((node) => ({
    objectId: node.objectId,
    parentWorkItemId: node.parentWorkItemId,
  }));
}

export function visibleWbsNodes(
  nodes: ApiWbsV2Node[],
  collapsed: Set<string>,
): ApiWbsV2Node[] {
  const hidden = new Set<string>();
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentWorkItemId) continue;
    const current = children.get(node.parentWorkItemId) ?? [];
    current.push(node.objectId);
    children.set(node.parentWorkItemId, current);
  }

  const hideDescendants = (id: string) => {
    for (const childId of children.get(id) ?? []) {
      hidden.add(childId);
      hideDescendants(childId);
    }
  };
  for (const id of collapsed) hideDescendants(id);
  return nodes.filter((node) => !hidden.has(node.objectId));
}

function reorderBySiblingGroups(nodes: ApiWbsV2Node[], objectId: string, direction: -1 | 1): ApiWbsV2Node[] {
  const node = nodes.find((item) => item.objectId === objectId);
  if (!node) return nodes;

  const siblings = nodes.filter((item) => item.parentWorkItemId === node.parentWorkItemId);
  const index = siblings.findIndex((item) => item.objectId === objectId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return nodes;

  const siblingOrder = siblings.map((item) => item.objectId);
  [siblingOrder[index], siblingOrder[targetIndex]] = [siblingOrder[targetIndex]!, siblingOrder[index]!];
  const rank = new Map(siblingOrder.map((id, rankIndex) => [id, rankIndex]));

  const children = new Map<string | null, ApiWbsV2Node[]>();
  for (const item of nodes) {
    const key = item.parentWorkItemId ?? null;
    const current = children.get(key) ?? [];
    current.push(item);
    children.set(key, current);
  }
  for (const [key, values] of children) {
    values.sort((a, b) => {
      if (key === (node.parentWorkItemId ?? null)) {
        return (rank.get(a.objectId) ?? 0) - (rank.get(b.objectId) ?? 0);
      }
      return a.sortOrder - b.sortOrder;
    });
  }

  const result: ApiWbsV2Node[] = [];
  const visit = (item: ApiWbsV2Node) => {
    result.push(item);
    for (const child of children.get(item.objectId) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
  return result;
}

export function moveWbsNode(nodes: ApiWbsV2Node[], objectId: string, direction: -1 | 1): ApiWbsV2Node[] {
  return reorderBySiblingGroups(nodes, objectId, direction);
}

export function indentWbsNode(nodes: ApiWbsV2Node[], objectId: string): ApiWbsV2Node[] {
  const index = nodes.findIndex((item) => item.objectId === objectId);
  if (index <= 0) return nodes;
  const current = nodes[index]!;

  let candidate: ApiWbsV2Node | undefined;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const item = nodes[cursor]!;
    if (item.objectTypeKey !== 'MILESTONE') {
      candidate = item;
      break;
    }
  }
  if (!candidate || candidate.objectId === current.objectId) return nodes;

  return nodes.map((item) => item.objectId === objectId
    ? { ...item, parentWorkItemId: candidate!.objectId }
    : item);
}

export function outdentWbsNode(nodes: ApiWbsV2Node[], objectId: string): ApiWbsV2Node[] {
  const current = nodes.find((item) => item.objectId === objectId);
  if (!current?.parentWorkItemId) return nodes;
  const parent = nodes.find((item) => item.objectId === current.parentWorkItemId);
  return nodes.map((item) => item.objectId === objectId
    ? { ...item, parentWorkItemId: parent?.parentWorkItemId ?? null }
    : item);
}

export function rollupWbsBars(
  nodes: ApiWbsV2Node[],
  tasks: ApiScheduleAnalysisV2Task[],
): Map<string, WbsBarV2> {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentWorkItemId) continue;
    const current = children.get(node.parentWorkItemId) ?? [];
    current.push(node.objectId);
    children.set(node.parentWorkItemId, current);
  }

  const result = new Map<string, WbsBarV2>();
  const visit = (node: ApiWbsV2Node): WbsBarV2 | null => {
    const childIds = children.get(node.objectId) ?? [];
    if (childIds.length === 0) {
      const task = taskById.get(node.objectId);
      if (!task) return null;
      const bar: WbsBarV2 = {
        objectId: node.objectId,
        plannedStart: task.plannedStart,
        plannedFinish: task.plannedFinish,
        critical: task.critical,
        isSummary: false,
      };
      result.set(node.objectId, bar);
      return bar;
    }

    const childBars = childIds
      .map((id) => nodes.find((item) => item.objectId === id))
      .filter((item): item is ApiWbsV2Node => Boolean(item))
      .map(visit)
      .filter((item): item is WbsBarV2 => Boolean(item));
    if (childBars.length === 0) return null;

    const bar: WbsBarV2 = {
      objectId: node.objectId,
      plannedStart: childBars.reduce((min, child) => child.plannedStart < min ? child.plannedStart : min, childBars[0]!.plannedStart),
      plannedFinish: childBars.reduce((max, child) => child.plannedFinish > max ? child.plannedFinish : max, childBars[0]!.plannedFinish),
      critical: childBars.some((child) => child.critical),
      isSummary: true,
    };
    result.set(node.objectId, bar);
    return bar;
  };

  for (const node of nodes.filter((item) => !item.parentWorkItemId)) visit(node);
  return result;
}
