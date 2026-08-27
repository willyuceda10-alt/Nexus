import { describe, expect, it } from 'vitest';
import type { ApiWbsV2Node } from '../api/projectScheduleV2Contracts';
import { indentWbsNode, moveWbsNode, outdentWbsNode, visibleWbsNodes } from './wbsGanttV2';

function node(id: string, parent: string | null, sortOrder: number): ApiWbsV2Node {
  return {
    objectId: id,
    title: id,
    objectTypeKey: 'TASK',
    status: 'DRAFT',
    priority: 'MEDIUM',
    progress: 0,
    assigneeId: null,
    assigneeName: null,
    parentWorkItemId: parent,
    outlineLevel: parent ? 1 : 0,
    sortOrder,
    wbsCode: String(sortOrder + 1),
    isSummary: false,
    source: 'V2',
    schedulingMode: 'AUTO',
    durationMinutes: 480,
    remainingDurationMinutes: 480,
    constraintType: 'AS_SOON_AS_POSSIBLE',
    constraintDate: null,
    actualStart: null,
    actualFinish: null,
    physicalPercentComplete: null,
    legacyStart: null,
    legacyFinish: null,
  };
}

describe('WBS editor helpers', () => {
  it('indents and outdents a row', () => {
    const nodes = [node('a', null, 0), node('b', null, 1)];
    const indented = indentWbsNode(nodes, 'b');
    expect(indented.find((item) => item.objectId === 'b')?.parentWorkItemId).toBe('a');
    const outdented = outdentWbsNode(indented, 'b');
    expect(outdented.find((item) => item.objectId === 'b')?.parentWorkItemId).toBeNull();
  });

  it('moves root siblings as hierarchy blocks', () => {
    const nodes = [node('a', null, 0), node('a1', 'a', 1), node('b', null, 2)];
    const moved = moveWbsNode(nodes, 'b', -1);
    expect(moved.map((item) => item.objectId)).toEqual(['b', 'a', 'a1']);
  });

  it('hides descendants of collapsed nodes', () => {
    const nodes = [node('a', null, 0), node('a1', 'a', 1), node('b', null, 2)];
    expect(visibleWbsNodes(nodes, new Set(['a'])).map((item) => item.objectId)).toEqual(['a', 'b']);
  });
});
