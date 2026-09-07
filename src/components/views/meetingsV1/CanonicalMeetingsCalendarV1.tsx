import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Repeat2, Video } from 'lucide-react';
import { meetingCalendarProjectionV1Api } from '../../../api/meetingCalendarProjectionV1Api';
import type { ApiMeetingCalendarProjectionItemV1 } from '../../../api/meetingCalendarProjectionV1Contracts';
import { useApiBootstrap } from '../../../context/ApiBootstrapContext';
import { useNexus } from '../../../context/NexusContext';

function startOfMonth(value: Date): Date { return new Date(value.getFullYear(), value.getMonth(), 1); }
function addMonths(value: Date, months: number): Date { return new Date(value.getFullYear(), value.getMonth() + months, 1); }
function dayKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
function timeLabel(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
function itemDayKeys(item: ApiMeetingCalendarProjectionItemV1): string[] {
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const keys: string[] = [];
  let guard = 0;
  while (cursor <= last && guard < 370) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return keys;
}
function itemTone(item: ApiMeetingCalendarProjectionItemV1): string {
  if (item.lifecycleStatus === 'CANCELLED') return 'border-slate-200 bg-slate-100 text-slate-400';
  if (item.lifecycleStatus === 'CANCEL_PENDING') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (item.syncStatus === 'FAILED') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (item.itemType === 'RECURRING_OCCURRENCE') return item.isException
    ? 'border-sky-200 bg-sky-50 text-sky-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  return 'border-slate-200 bg-white text-slate-700';
}

export const CanonicalMeetingsCalendarV1: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, openObjectDrawer } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [items, setItems] = useState<ApiMeetingCalendarProjectionItemV1[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cells = useMemo(() => {
    const first = startOfMonth(month);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [month]);

  const load = async () => {
    if (!apiReady || !currentWorkspace || !cells.length) {
      setItems([]);
      return;
    }
    const rangeStart = new Date(cells[0]!);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(cells[cells.length - 1]!);
    rangeEnd.setDate(rangeEnd.getDate() + 1);
    rangeEnd.setHours(0, 0, 0, 0);
    setLoading(true);
    setError(null);
    try {
      const result = await meetingCalendarProjectionV1Api.list(tenant.id, {
        workspaceId: currentWorkspace.id,
        ...(projectId ? { projectId } : {}),
        startAt: rangeStart.toISOString(),
        endAt: rangeEnd.toISOString(),
      });
      setItems(result.items);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la agenda canónica.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [apiReady, currentWorkspace?.id, projectId, month]);

  const itemsByDay = useMemo(() => {
    const result = new Map<string, ApiMeetingCalendarProjectionItemV1[]>();
    for (const item of items) {
      for (const key of itemDayKeys(item)) {
        const bucket = result.get(key) ?? [];
        bucket.push(item);
        result.set(key, bucket);
      }
    }
    for (const bucket of result.values()) bucket.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return result;
  }, [items]);

  const monthLabel = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(month);
  const today = dayKey(new Date());

  if (!apiReady) {
    return (
      <section className="command-panel px-5 py-4">
        <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-green-700" /><p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Agenda canónica</p></div>
        <p className="mt-2 text-[9px] text-slate-500">La proyección unificada de reuniones simples + ocurrencias recurrentes requiere modo API. El preview mock no fabrica ocurrencias.</p>
      </section>
    );
  }

  return (
    <section className="command-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-green-50 text-green-700 ring-1 ring-green-100"><CalendarDays className="h-4 w-4" /></span>
          <div><p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Agenda canónica · simples + recurrentes</p><h2 className="mt-0.5 text-[13px] font-extrabold capitalize text-slate-900">{monthLabel}</h2></div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void load()} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500" aria-label="Actualizar agenda"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={() => setMonth(addMonths(month, -1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500" aria-label="Mes anterior"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => setMonth(startOfMonth(new Date()))} className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-600">Hoy</button>
          <button type="button" onClick={() => setMonth(addMonths(month, 1))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500" aria-label="Mes siguiente"><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {error && <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-[8px] font-semibold text-rose-700">{error}</div>}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <div key={day} className="px-2 py-2 text-center text-[8px] font-black uppercase tracking-[0.08em] text-slate-400">{day}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px bg-slate-100">
        {cells.map((date) => {
          const key = dayKey(date);
          const inMonth = date.getMonth() === month.getMonth();
          const dayItems = itemsByDay.get(key) ?? [];
          return (
            <div key={key} className={`min-h-[122px] p-2 ${inMonth ? 'bg-white' : 'bg-slate-50/70'}`}>
              {/* slate-300 sobre la celda da 1.49:1 — la fecha era ilegible. El fondo
                  gris ya distingue los días fuera del mes; basta un gris secundario. */}
              <div className="flex items-center justify-between"><span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-micro font-bold ${key === today ? 'bg-green-700 text-white' : inMonth ? 'text-slate-700' : 'text-slate-500'}`}>{date.getDate()}</span>{dayItems.length > 0 && <span className="text-micro font-black text-slate-500">{dayItems.length}</span>}</div>
              <div className="mt-1.5 space-y-1">
                {dayItems.slice(0, 4).map((item) => (
                  <div key={`${key}-${item.id}`} className={`rounded-lg border px-2 py-1.5 ${itemTone(item)}`}>
                    <button type="button" onClick={() => openObjectDrawer(item.meetingObjectId)} className={`block w-full truncate text-left text-[8px] font-bold ${item.lifecycleStatus === 'CANCELLED' ? 'line-through' : ''}`}>
                      {timeLabel(item.startAt)} · {item.title}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[6.5px] font-black uppercase tracking-[0.05em]">
                      {item.itemType === 'RECURRING_OCCURRENCE' && <span className="inline-flex items-center gap-0.5"><Repeat2 className="h-2.5 w-2.5" /> #{item.sequence}</span>}
                      {item.isException && <span>Excepción</span>}
                      {item.lifecycleStatus !== 'SCHEDULED' && <span>{item.lifecycleStatus.replace('_', ' ')}</span>}
                      {item.joinUrl && <button type="button" onClick={() => window.open(item.joinUrl!, '_blank', 'noopener,noreferrer')} className="inline-flex items-center gap-0.5 text-green-700"><Video className="h-2.5 w-2.5" /> Teams</button>}
                    </div>
                  </div>
                ))}
                {dayItems.length > 4 && <p className="px-1 text-[7px] font-bold text-slate-400">+{dayItems.length - 4} más</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
