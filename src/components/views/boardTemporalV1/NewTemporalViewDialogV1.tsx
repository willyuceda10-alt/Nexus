import React, { useMemo, useState } from 'react';
import { CalendarDays, GanttChartSquare, X } from 'lucide-react';
import type { ApiBoardTemporalConfigV1 } from '../../../api/workOsTemporalV1Contracts';
import type { ApiWorkBoardColumnV1 } from '../../../api/workOsBoardV1Contracts';

export function NewTemporalViewDialogV1({
  columns,
  saving,
  onClose,
  onCreate,
}: {
  columns: ApiWorkBoardColumnV1[];
  saving: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; viewType: 'CALENDAR' | 'TIMELINE'; config: ApiBoardTemporalConfigV1 }) => Promise<void>;
}) {
  const dateFields = useMemo(() => {
    const values = columns.filter((column) => column.data_type === 'DATE').map((column) => ({ key: column.field_key, label: column.label }));
    if (!values.some((item) => item.key === 'startDate')) values.unshift({ key: 'startDate', label: 'Fecha inicio' });
    if (!values.some((item) => item.key === 'dueDate')) values.push({ key: 'dueDate', label: 'Fecha fin / objetivo' });
    return Array.from(new Map(values.map((item) => [item.key, item])).values());
  }, [columns]);

  const titleFields = useMemo(() => {
    const compatible = columns
      .filter((column) => ['TEXT', 'LONG_TEXT', 'STATUS', 'PRIORITY'].includes(column.data_type))
      .map((column) => ({ key: column.field_key, label: column.label }));
    const values = [{ key: 'title', label: 'Título del elemento' }, ...compatible];
    return Array.from(new Map(values.map((item) => [item.key, item])).values());
  }, [columns]);

  const colorFields = useMemo(() => {
    const compatible = columns
      .filter((column) => ['STATUS', 'PRIORITY', 'TEXT'].includes(column.data_type))
      .map((column) => ({ key: column.field_key, label: column.label }));
    const values = [
      { key: '', label: 'Color neutro' },
      { key: 'status', label: 'Estado' },
      { key: 'priority', label: 'Prioridad' },
      ...compatible,
    ];
    return Array.from(new Map(values.map((item) => [item.key, item])).values());
  }, [columns]);

  const [viewType, setViewType] = useState<'CALENDAR' | 'TIMELINE'>('CALENDAR');
  const [name, setName] = useState('Calendario');
  const [startFieldKey, setStartFieldKey] = useState(dateFields[0]?.key ?? 'startDate');
  const [endFieldKey, setEndFieldKey] = useState(dateFields.find((item) => item.key !== startFieldKey)?.key ?? 'dueDate');
  const [titleFieldKey, setTitleFieldKey] = useState('title');
  const [colorFieldKey, setColorFieldKey] = useState('status');

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">View Engine</p>
            <h3 className="mt-1 text-[17px] font-extrabold text-slate-950">Nueva vista temporal</h3>
            <p className="mt-1 text-[9px] text-slate-400">Usa los mismos objetos del Board; solo cambia su representación.</p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={() => { setViewType('CALENDAR'); setName('Calendario'); }} className={`rounded-xl border p-3 text-left ${viewType === 'CALENDAR' ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
            <CalendarDays className="h-4 w-4 text-green-700" /><p className="mt-2 text-[10px] font-extrabold text-slate-900">Calendario</p><p className="mt-1 text-[8px] text-slate-400">Mes · hitos · reuniones · vencimientos</p>
          </button>
          <button onClick={() => { setViewType('TIMELINE'); setName('Timeline'); }} className={`rounded-xl border p-3 text-left ${viewType === 'TIMELINE' ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
            <GanttChartSquare className="h-4 w-4 text-green-700" /><p className="mt-2 text-[10px] font-extrabold text-slate-900">Timeline</p><p className="mt-1 text-[8px] text-slate-400">Rangos visuales sin lógica CPM</p>
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block"><span className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold outline-none focus:border-green-500" /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block"><span className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Campo inicio</span><select value={startFieldKey} onChange={(event) => { const next = event.target.value; setStartFieldKey(next); if (endFieldKey === next) setEndFieldKey(''); }} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold">{dateFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
            <label className="block"><span className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Campo fin</span><select value={endFieldKey} onChange={(event) => setEndFieldKey(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold"><option value="">Sin campo fin</option>{dateFields.filter((field) => field.key !== startFieldKey).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block"><span className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Texto mostrado</span><select value={titleFieldKey} onChange={(event) => setTitleFieldKey(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold">{titleFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
            <label className="block"><span className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">Color por</span><select value={colorFieldKey} onChange={(event) => setColorFieldKey(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold">{colorFields.map((field) => <option key={field.key || 'neutral'} value={field.key}>{field.label}</option>)}</select></label>
          </div>
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-[8px] leading-4 text-slate-500">“Color por” usa una paleta segura de estado/prioridad; un valor textual desconocido permanece neutro. No se inyectan colores o estilos desde datos del usuario.</p>
        </div>

        <button disabled={saving || !name.trim() || !startFieldKey} onClick={() => void onCreate({ name: name.trim(), viewType, config: { startFieldKey, endFieldKey: endFieldKey || null, titleFieldKey, colorFieldKey: colorFieldKey || null, allDay: true } })} className="mt-5 h-10 w-full rounded-xl bg-green-700 text-[10px] font-black text-white disabled:opacity-40">Crear vista</button>
      </div>
    </div>
  );
}
