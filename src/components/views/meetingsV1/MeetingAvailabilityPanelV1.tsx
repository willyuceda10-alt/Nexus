import React from 'react';
import { CalendarSearch, CheckCircle2, Clock3, UsersRound } from 'lucide-react';
import type { ApiMeetingAvailabilityV1 } from '../../../api/meetingsV1Contracts';

function slotLabel(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const time = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' });
  return `${formatter.format(new Date(start))} – ${time.format(new Date(end))}`;
}

export const MeetingAvailabilityPanelV1: React.FC<{
  availability: ApiMeetingAvailabilityV1 | null;
  loading: boolean;
  disabled: boolean;
  onSearch: () => void;
  onSelect: (slot: { start: string; end: string }) => void;
}> = ({ availability, loading, disabled, onSearch, onSelect }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">
          <CalendarSearch className="h-3.5 w-3.5 text-green-700" /> Disponibilidad M365
        </div>
        <p className="mt-1 text-[9px] text-slate-500">Consulta solo libre/ocupado y propone horarios comunes.</p>
      </div>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onSearch}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 text-[8px] font-black text-green-800 disabled:opacity-40"
      >
        <Clock3 className={`h-3.5 w-3.5 ${loading ? 'animate-pulse' : ''}`} />
        {loading ? 'Consultando...' : 'Buscar horario'}
      </button>
    </div>

    {availability && (
      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-3 text-[8px] font-semibold text-slate-500">
          <span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" /> {availability.participants.length} calendarios</span>
          <span>{availability.durationMinutes} min por reunión</span>
          <span>{availability.suggestions.length} opciones</span>
        </div>

        {availability.participants.some((participant) => !participant.resolved) && (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[8px] font-semibold text-amber-700">
            Algunos calendarios no pudieron resolverse; las sugerencias se mantienen conservadoras.
          </p>
        )}

        <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {availability.suggestions.slice(0, 8).map((slot) => (
            <button
              key={`${slot.start}-${slot.end}`}
              type="button"
              onClick={() => onSelect(slot)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:border-green-300 hover:bg-green-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-700" />
              <span className="text-[8px] font-bold text-slate-700">{slotLabel(slot.start, slot.end)}</span>
            </button>
          ))}
        </div>

        {!availability.suggestions.length && (
          <p className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[8px] text-slate-400">
            No se encontró una franja común en el rango consultado.
          </p>
        )}
      </div>
    )}
  </div>
);
