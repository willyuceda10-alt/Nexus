import React from 'react';
import { Search, X } from 'lucide-react';
import type { ApiAvailableBoardItemV1 } from '../../../api/workOsBoardEditorV1Api';
import type { ApiWorkBoardColumnTypeV1 } from '../../../api/workOsBoardV1Contracts';
import { CUSTOM_TYPES, safeBoardFieldKey } from './boardEditorUtils';

export function BoardModalV1({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><p className="text-[12px] font-extrabold text-slate-900">{title}</p><p className="mt-1 text-[9px] text-slate-400">Board Editor V1</p></div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function AddBoardItemsDialogV1({
  search,
  onSearch,
  items,
  onAdd,
  onClose,
}: {
  search: string;
  onSearch: (value: string) => void;
  items: ApiAvailableBoardItemV1[];
  onAdd: (item: ApiAvailableBoardItemV1) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <BoardModalV1 title="Añadir elementos existentes" onClose={onClose}>
      <div className="mb-3 flex h-9 items-center gap-2 rounded-xl border border-slate-200 px-3"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por nombre..." className="w-full text-[10px] outline-none" /></div>
      <div className="max-h-[420px] space-y-1 overflow-y-auto">
        {items.map((candidate) => (
          <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 hover:bg-slate-50">
            <div className="min-w-0"><p className="truncate text-[11px] font-bold text-slate-900">{candidate.title}</p><p className="mt-1 text-[9px] text-slate-400">{candidate.status.replaceAll('_', ' ')} · {candidate.progress}%</p></div>
            <button onClick={() => void onAdd(candidate)} className="h-8 rounded-lg bg-green-700 px-3 text-[9px] font-black text-white">Añadir</button>
          </div>
        ))}
        {items.length === 0 && <div className="p-8 text-center text-[10px] text-slate-400">No hay más elementos disponibles para este Board.</div>}
      </div>
    </BoardModalV1>
  );
}

export function NewBoardColumnDialogV1({
  value,
  onChange,
  onCreate,
  onClose,
  saving,
}: {
  value: { label: string; fieldKey: string; dataType: ApiWorkBoardColumnTypeV1 };
  onChange: (value: { label: string; fieldKey: string; dataType: ApiWorkBoardColumnTypeV1 }) => void;
  onCreate: () => Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <BoardModalV1 title="Nueva columna personalizada" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Nombre<input value={value.label} onChange={(event) => onChange({ ...value, label: event.target.value, fieldKey: value.fieldKey || safeBoardFieldKey(event.target.value) })} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-green-500" /></label>
        <label className="block text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Clave técnica<input value={value.fieldKey} onChange={(event) => onChange({ ...value, fieldKey: safeBoardFieldKey(event.target.value) })} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-[10px] text-slate-600 outline-none focus:border-green-500" /></label>
        <label className="block text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Tipo<select value={value.dataType} onChange={(event) => onChange({ ...value, dataType: event.target.value as ApiWorkBoardColumnTypeV1 })} className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-700">{CUSTOM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <button onClick={() => void onCreate()} disabled={!value.label.trim() || saving} className="h-10 w-full rounded-xl bg-green-700 text-[10px] font-black text-white disabled:opacity-40">Crear columna</button>
      </div>
    </BoardModalV1>
  );
}

export function NewBoardGroupDialogV1({ name, onName, onCreate, onClose, saving }: { name: string; onName: (value: string) => void; onCreate: () => Promise<void>; onClose: () => void; saving: boolean }) {
  return (
    <BoardModalV1 title="Nuevo grupo" onClose={onClose}>
      <div className="space-y-3">
        <input value={name} onChange={(event) => onName(event.target.value)} placeholder="Ej. Semana 35, Fase 2, Yakuy Minka..." className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-green-500" />
        <button onClick={() => void onCreate()} disabled={!name.trim() || saving} className="h-10 w-full rounded-xl bg-green-700 text-[10px] font-black text-white disabled:opacity-40">Crear grupo</button>
      </div>
    </BoardModalV1>
  );
}
