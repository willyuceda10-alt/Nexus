import React from 'react';
import type { BoardConfigV1, BoardOptionSetV1, BoardRelationTargetV1 } from '../../../api/workOsBoardConfigV1Api';
import type { ApiWorkBoardColumnV1, ApiWorkBoardGroupV1, ApiWorkBoardItemV1 } from '../../../api/workOsBoardV1Contracts';
import { BoardInlineEditorV1 } from '../boardEditorV1/BoardInlineEditorV1';
import type { BoardEditingCellV1 } from '../boardEditorV1/BoardTableV1';
import { boardCellDisplay, rawBoardCellValue } from '../boardEditorV1/boardEditorUtils';

function optionSetFor(column: ApiWorkBoardColumnV1, config: BoardConfigV1): BoardOptionSetV1 | undefined {
  return config.optionSets.find((set) => set.columnId === column.id);
}

function relationItems(value: unknown): Array<{ id: string; title: string }> {
  return Array.isArray(value)
    ? value.filter((item): item is { id: string; title: string } => typeof item === 'object' && item !== null && 'id' in item && 'title' in item)
    : [];
}

export function BoardGovernedTableV1({
  items,
  groups,
  columns,
  configuration,
  relationCandidates,
  editing,
  setEditing,
  onSaveCell,
  onSavePerson,
  onSaveRelation,
  onMoveGroup,
}: {
  items: ApiWorkBoardItemV1[];
  groups: ApiWorkBoardGroupV1[];
  columns: ApiWorkBoardColumnV1[];
  configuration: BoardConfigV1;
  relationCandidates: Record<string, BoardRelationTargetV1[]>;
  editing: BoardEditingCellV1 | null;
  setEditing: (value: BoardEditingCellV1 | null) => void;
  onSaveCell: (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, value: unknown) => Promise<void>;
  onSavePerson: (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, userId: string | null) => Promise<void>;
  onSaveRelation: (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1, targetObjectIds: string[]) => Promise<void>;
  onMoveGroup: (item: ApiWorkBoardItemV1, groupId: string | null) => Promise<void>;
}) {
  const template = `170px ${columns.map((column) => `${column.width ?? 150}px`).join(' ')}`;
  const minWidth = Math.max(920, columns.reduce((sum, column) => sum + (column.width ?? 150), 0) + 190);

  const renderManagedCell = (item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1) => {
    const value = rawBoardCellValue(item, column);
    const optionSet = optionSetFor(column, configuration);

    if (column.data_type === 'PERSON') {
      return (
        <select
          value={String(value ?? '')}
          onChange={(event) => void onSavePerson(item, column, event.target.value || null)}
          className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-700"
        >
          <option value="">Sin asignar</option>
          {configuration.people.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}
        </select>
      );
    }

    if (column.data_type === 'RELATION') {
      const current = relationItems(value);
      const multiple = Boolean(column.config?.multiple);
      const candidates = relationCandidates[column.id] ?? [];
      return (
        <select
          multiple={multiple}
          value={current.map((target) => target.id)}
          onChange={(event) => {
            const targetIds = multiple
              ? Array.from(event.currentTarget.selectedOptions).map((option) => option.value)
              : event.currentTarget.value ? [event.currentTarget.value] : [];
            void onSaveRelation(item, column, targetIds);
          }}
          className={`w-full rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-700 ${multiple ? 'min-h-12 py-1' : 'h-8'}`}
        >
          {!multiple && <option value="">Sin relación</option>}
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
        </select>
      );
    }

    if (column.data_type === 'TAGS' && optionSet) {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <select
          multiple
          value={selected}
          onChange={(event) => void onSaveCell(item, column, Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}
          className="min-h-12 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold text-slate-700"
        >
          {optionSet.options.filter((option) => option.isActive !== false).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      );
    }

    if (column.data_type === 'FORMULA') {
      const number = value === null || value === undefined ? null : Number(value);
      const format = String(column.config?.format ?? 'NUMBER');
      const currency = String(column.config?.currency ?? 'PEN');
      if (number === null || !Number.isFinite(number)) return <span className="text-slate-300">—</span>;
      if (format === 'CURRENCY') return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(number);
      if (format === 'PERCENT') return `${number.toLocaleString('es-PE')}%`;
      return number.toLocaleString('es-PE');
    }

    const active = editing?.objectId === item.object.id && editing.columnId === column.id;
    const editable = column.is_editable && !['FILE', 'FORMULA'].includes(column.data_type) && !['ownerId', 'createdAt', 'updatedAt'].includes(column.field_key);

    if (active) {
      if ((column.data_type === 'STATUS' || column.data_type === 'PRIORITY') && optionSet) {
        return (
          <select
            autoFocus
            value={String(editing.draft ?? '')}
            onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
            onBlur={() => void onSaveCell(item, column, editing.draft)}
            className="h-8 w-full rounded-lg border border-green-300 bg-white px-2 text-[9px] font-bold outline-none"
          >
            {optionSet.options.filter((option) => option.isActive !== false).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        );
      }
      return <BoardInlineEditorV1 column={column} value={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} onSave={() => void onSaveCell(item, column, editing.draft)} onCancel={() => setEditing(null)} />;
    }

    return (
      <div
        onDoubleClick={() => editable && setEditing({ objectId: item.object.id, columnId: column.id, draft: value ?? '' })}
        className={editable ? 'cursor-text' : ''}
        title={editable ? 'Doble clic para editar' : undefined}
      >
        {boardCellDisplay(item, column)}
      </div>
    );
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          <div className="grid border-b border-slate-200 bg-slate-50/80" style={{ gridTemplateColumns: template }}>
            <div className="border-r border-slate-200 px-3 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-slate-500">Grupo</div>
            {columns.map((column) => <div key={column.id} className="border-r border-slate-200 px-3 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-slate-500 last:border-r-0">{column.label}</div>)}
          </div>

          {items.map((item) => (
            <div key={item.object.id} className="grid border-b border-slate-100 transition hover:bg-green-50/20" style={{ gridTemplateColumns: template }}>
              <div className="border-r border-slate-100 p-2">
                <select value={item.placement.groupId ?? ''} onChange={(event) => void onMoveGroup(item, event.target.value || null)} className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600">
                  <option value="">Sin grupo</option>
                  {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </div>
              {columns.map((column) => <div key={column.id} className={`min-w-0 border-r border-slate-100 px-3 py-2.5 text-[10px] text-slate-600 last:border-r-0 ${column.field_key === 'title' ? 'font-bold text-slate-900' : ''}`}>{renderManagedCell(item, column)}</div>)}
            </div>
          ))}
          {items.length === 0 && <div className="p-10 text-center text-[10px] text-slate-400">No hay elementos que coincidan con esta vista.</div>}
        </div>
      </div>
    </div>
  );
}
