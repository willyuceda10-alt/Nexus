import React from 'react';
import type { ApiWorkBoardColumnV1 } from '../../../api/workOsBoardV1Contracts';
import { DEFAULT_STATUSES } from './boardEditorUtils';

export function BoardInlineEditorV1({
  column,
  value,
  onChange,
  onSave,
  onCancel,
}: {
  column: ApiWorkBoardColumnV1;
  value: unknown;
  onChange: (value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') onSave();
    if (event.key === 'Escape') onCancel();
  };

  if (column.data_type === 'STATUS') {
    return (
      <select autoFocus value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} onBlur={onSave} onKeyDown={onKeyDown} className="h-8 w-full rounded-lg border border-green-300 bg-white px-2 text-[9px] font-bold outline-none">
        {DEFAULT_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}
      </select>
    );
  }

  if (column.data_type === 'PRIORITY') {
    return (
      <select autoFocus value={String(value ?? 'MEDIUM')} onChange={(event) => onChange(event.target.value)} onBlur={onSave} onKeyDown={onKeyDown} className="h-8 w-full rounded-lg border border-green-300 bg-white px-2 text-[9px] font-bold outline-none">
        {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
      </select>
    );
  }

  if (column.data_type === 'BOOLEAN') {
    return (
      <select autoFocus value={value === true ? 'true' : value === false ? 'false' : ''} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value === 'true')} onBlur={onSave} onKeyDown={onKeyDown} className="h-8 w-full rounded-lg border border-green-300 bg-white px-2 text-[9px] outline-none">
        <option value="">—</option><option value="true">Sí</option><option value="false">No</option>
      </select>
    );
  }

  if (column.data_type === 'DATE') {
    return <input autoFocus type="date" value={value ? String(value).slice(0, 10) : ''} onChange={(event) => onChange(event.target.value)} onBlur={onSave} onKeyDown={onKeyDown} className="h-8 w-full rounded-lg border border-green-300 bg-white px-2 text-[9px] outline-none" />;
  }

  if (['NUMBER', 'CURRENCY', 'PROGRESS'].includes(column.data_type)) {
    return <input autoFocus type="number" min={column.data_type === 'PROGRESS' ? 0 : undefined} max={column.data_type === 'PROGRESS' ? 100 : undefined} value={String(value ?? '')} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} onBlur={onSave} onKeyDown={onKeyDown} className="h-8 w-full rounded-lg border border-green-300 bg-white px-2 text-[9px] outline-none" />;
  }

  return <input autoFocus value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} onBlur={onSave} onKeyDown={onKeyDown} className="h-8 w-full rounded-lg border border-green-300 bg-white px-2 text-[9px] outline-none" />;
}
