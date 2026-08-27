import React from 'react';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import type { ApiWorkBoardColumnV1 } from '../../../api/workOsBoardV1Contracts';
import { DEFAULT_STATUSES } from './boardEditorUtils';

export function BoardViewSettingsV1({
  statusFilter,
  sortField,
  sortDirection,
  columns,
  hiddenColumnKeys,
  statuses,
  onFilterChange,
  onSortChange,
  onToggleColumn,
  onMoveColumn,
  onNewGroup,
}: {
  statusFilter: string;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  columns: ApiWorkBoardColumnV1[];
  hiddenColumnKeys: string[];
  statuses: string[];
  onFilterChange: (status: string) => Promise<void>;
  onSortChange: (fieldKey: string, direction: 'asc' | 'desc') => Promise<void>;
  onToggleColumn: (column: ApiWorkBoardColumnV1) => Promise<void>;
  onMoveColumn: (column: ApiWorkBoardColumnV1, direction: -1 | 1) => Promise<void>;
  onNewGroup: () => void;
}) {
  const allStatuses = Array.from(new Set([...statuses, ...DEFAULT_STATUSES]));
  return (
    <div className="grid gap-4 border-b border-slate-100 bg-slate-50/60 p-4 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
      <label className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">
        Filtro por estado
        <select value={statusFilter} onChange={(event) => void onFilterChange(event.target.value)} className="mt-2 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-700">
          <option value="">Todos</option>
          {allStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
        </select>
      </label>

      <label className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">
        Orden
        <select value={`${sortField}:${sortDirection}`} onChange={(event) => { const [fieldKey, direction] = event.target.value.split(':'); void onSortChange(fieldKey!, direction as 'asc' | 'desc'); }} className="mt-2 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-700">
          <option value="title:asc">Título A–Z</option>
          <option value="title:desc">Título Z–A</option>
          <option value="progress:desc">Mayor avance</option>
          <option value="progress:asc">Menor avance</option>
          <option value="dueDate:asc">Fecha más próxima</option>
          <option value="dueDate:desc">Fecha más lejana</option>
        </select>
      </label>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Columnas de esta vista</p>
          <button onClick={onNewGroup} className="text-[9px] font-black text-green-700">+ Grupo</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {columns.map((column, index) => {
            const hidden = hiddenColumnKeys.includes(column.key);
            return (
              <div key={column.id} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                <button onClick={() => void onToggleColumn(column)} disabled={column.field_key === 'title'} title={hidden ? 'Mostrar' : 'Ocultar'} className="text-slate-400 disabled:opacity-30">
                  {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
                <span className="max-w-[100px] truncate text-[9px] font-bold text-slate-600">{column.label}</span>
                <button onClick={() => void onMoveColumn(column, -1)} disabled={index === 0} className="text-slate-300 disabled:opacity-20"><ArrowLeft className="h-3 w-3" /></button>
                <button onClick={() => void onMoveColumn(column, 1)} disabled={index === columns.length - 1} className="text-slate-300 disabled:opacity-20"><ArrowRight className="h-3 w-3" /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
