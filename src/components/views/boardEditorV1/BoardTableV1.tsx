import React from 'react';
import type { ApiWorkBoardColumnV1, ApiWorkBoardGroupV1, ApiWorkBoardItemV1 } from '../../../api/workOsBoardV1Contracts';
import { BoardInlineEditorV1 } from './BoardInlineEditorV1';
import { boardCellDisplay, boardCellEditable, rawBoardCellValue } from './boardEditorUtils';

export interface BoardEditingCellV1 {
  objectId: string;
  columnId: string;
  draft: unknown;
}

export function BoardTableV1({
  items,
  groups,
  columns,
  editing,
  setEditing,
  onSaveCell,
  onMoveGroup,
}: {
  items: ApiWorkBoardItemV1[];
  groups: ApiWorkBoardGroupV1[];
  columns: ApiWorkBoardColumnV1[];
  editing: BoardEditingCellV1 | null;
  setEditing: (value: BoardEditingCellV1 | null) => void;
  onSaveCell: (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, value: unknown) => Promise<void>;
  onMoveGroup: (item: ApiWorkBoardItemV1, groupId: string | null) => Promise<void>;
}) {
  const template = `170px ${columns.map((column) => `${column.width ?? 150}px`).join(' ')}`;
  const minWidth = Math.max(920, columns.reduce((sum, column) => sum + (column.width ?? 150), 0) + 190);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          <div className="grid border-b border-slate-200 bg-slate-50/80" style={{ gridTemplateColumns: template }}>
            <div className="border-r border-slate-200 px-3 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-slate-500">Grupo</div>
            {columns.map((column) => (
              <div key={column.id} className="border-r border-slate-200 px-3 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-slate-500 last:border-r-0">
                {column.label}
              </div>
            ))}
          </div>

          {items.map((item) => (
            <div key={item.object.id} className="grid border-b border-slate-100 transition hover:bg-green-50/20" style={{ gridTemplateColumns: template }}>
              <div className="border-r border-slate-100 p-2">
                <select value={item.placement.groupId ?? ''} onChange={(event) => void onMoveGroup(item, event.target.value || null)} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600">
                  <option value="">Sin grupo</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>

              {columns.map((column) => {
                const active = editing?.objectId === item.object.id && editing.columnId === column.id;
                const editable = boardCellEditable(column);
                return (
                  <div
                    key={column.id}
                    onDoubleClick={() => editable && setEditing({ objectId: item.object.id, columnId: column.id, draft: rawBoardCellValue(item, column) ?? '' })}
                    className={`min-w-0 border-r border-slate-100 px-3 py-2.5 text-[10px] text-slate-600 last:border-r-0 ${column.field_key === 'title' ? 'font-bold text-slate-900' : ''} ${editable ? 'cursor-text' : ''}`}
                  >
                    {active ? (
                      <BoardInlineEditorV1
                        column={column}
                        value={editing.draft}
                        onChange={(draft) => setEditing({ ...editing, draft })}
                        onSave={() => void onSaveCell(item, column, editing.draft)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <div className="truncate" title={editable ? 'Doble clic para editar' : undefined}>{boardCellDisplay(item, column)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {items.length === 0 && <div className="p-10 text-center text-[10px] text-slate-400">No hay elementos que coincidan con esta vista.</div>}
        </div>
      </div>
    </div>
  );
}
