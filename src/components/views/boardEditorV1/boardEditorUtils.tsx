import React from 'react';
import type { ApiWorkBoardColumnTypeV1, ApiWorkBoardColumnV1, ApiWorkBoardItemV1 } from '../../../api/workOsBoardV1Contracts';

export const DEFAULT_STATUSES = ['DRAFT', 'PLANNING', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];

export const CUSTOM_TYPES: Array<{ value: ApiWorkBoardColumnTypeV1; label: string }> = [
  { value: 'TEXT', label: 'Texto' },
  { value: 'LONG_TEXT', label: 'Texto largo' },
  { value: 'NUMBER', label: 'Número' },
  { value: 'CURRENCY', label: 'Moneda' },
  { value: 'DATE', label: 'Fecha' },
  { value: 'BOOLEAN', label: 'Sí / No' },
  { value: 'STATUS', label: 'Estado' },
  { value: 'PRIORITY', label: 'Prioridad' },
  { value: 'PROGRESS', label: 'Avance' },
  { value: 'LINK', label: 'Enlace' },
];

export function statusTone(status: string): string {
  const value = status.toUpperCase();
  if (['COMPLETED', 'APPROVED'].includes(value)) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (['BLOCKED', 'CANCELLED', 'REJECTED'].includes(value)) return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (['IN_PROGRESS', 'IN_REVIEW'].includes(value)) return 'bg-green-50 text-green-800 ring-green-200';
  if (value === 'PENDING_APPROVAL') return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

export function formatBoardDate(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function safeBoardFieldKey(label: string): string {
  return label.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

export function rawBoardCellValue(item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1): unknown {
  if (column.source === 'CUSTOM') return item.customFields[column.field_key];
  const object = item.object as unknown as Record<string, unknown>;
  return object[column.field_key];
}

export function boardCellDisplay(item: ApiWorkBoardItemV1, column: ApiWorkBoardColumnV1): React.ReactNode {
  const value = rawBoardCellValue(item, column);
  if (column.field_key === 'assigneeId') return item.object.assignee?.fullName || <span className="text-slate-300">Sin asignar</span>;
  if (column.data_type === 'DATE') return formatBoardDate(value);
  if (column.data_type === 'BOOLEAN') return value === true ? 'Sí' : value === false ? 'No' : '—';
  if (column.data_type === 'STATUS') {
    const text = String(value ?? 'Sin estado').replaceAll('_', ' ');
    return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-black ring-1 ${statusTone(String(value ?? ''))}`}>{text}</span>;
  }
  if (column.data_type === 'PRIORITY') return <span className="text-[10px] font-bold text-slate-600">{String(value ?? '—').replaceAll('_', ' ')}</span>;
  if (column.data_type === 'PROGRESS') {
    const progress = Math.max(0, Math.min(100, Number(value ?? 0)));
    return <div className="flex min-w-[110px] items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${progress}%` }} /></div><span className="w-8 text-right text-[9px] font-bold text-slate-500">{progress}%</span></div>;
  }
  if (value === null || value === undefined || value === '') return <span className="text-slate-300">—</span>;
  return String(value);
}

export function boardCellEditable(column: ApiWorkBoardColumnV1): boolean {
  return column.is_editable
    && !['PERSON', 'FILE', 'FORMULA', 'TAGS'].includes(column.data_type)
    && !['ownerId', 'createdAt', 'updatedAt'].includes(column.field_key);
}
