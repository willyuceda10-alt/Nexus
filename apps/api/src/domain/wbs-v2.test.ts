import { describe, expect, it } from 'vitest';
import { canonicalizeWbsV2, WbsV2ValidationError } from './wbs-v2.js';

describe('canonicalizeWbsV2', () => {
  it('generates depth-first order, outline levels and WBS codes', () => {
    const result = canonicalizeWbsV2([
      { objectId: 'phase-a' },
      { objectId: 'task-a1', parentWorkItemId: 'phase-a' },
      { objectId: 'task-a2', parentWorkItemId: 'phase-a' },
      { objectId: 'sub-a21', parentWorkItemId: 'task-a2' },
      { objectId: 'phase-b' },
    ]);

    expect(result.map((item) => [item.objectId, item.wbsCode, item.outlineLevel])).toEqual([
      ['phase-a', '1', 0],
      ['task-a1', '1.1', 1],
      ['task-a2', '1.2', 1],
      ['sub-a21', '1.2.1', 2],
      ['phase-b', '2', 0],
    ]);
    expect(result.find((item) => item.objectId === 'phase-a')?.isSummary).toBe(true);
    expect(result.find((item) => item.objectId === 'task-a1')?.isSummary).toBe(false);
  });

  it('canonicalizes children even when the requested list is not depth-first', () => {
    const result = canonicalizeWbsV2([
      { objectId: 'root-1' },
      { objectId: 'root-2' },
      { objectId: 'child-1', parentWorkItemId: 'root-1' },
    ]);

    expect(result.map((item) => item.objectId)).toEqual(['root-1', 'child-1', 'root-2']);
    expect(result.map((item) => item.wbsCode)).toEqual(['1', '1.1', '2']);
  });

  it('rejects missing parents and cycles', () => {
    expect(() => canonicalizeWbsV2([
      { objectId: 'a', parentWorkItemId: 'missing' },
    ])).toThrow(WbsV2ValidationError);

    expect(() => canonicalizeWbsV2([
      { objectId: 'a', parentWorkItemId: 'b' },
      { objectId: 'b', parentWorkItemId: 'a' },
    ])).toThrow(WbsV2ValidationError);
  });
});
