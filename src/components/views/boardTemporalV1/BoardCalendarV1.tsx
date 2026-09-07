import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ApiBoardTemporalItemV1 } from '../../../api/workOsTemporalV1Contracts';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfCalendarGrid(month: Date): Date {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const mondayIndex = (first.getUTCDay() + 6) % 7;
  return addDays(first, -mondayIndex);
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function semanticClass(value: string | null, fallbackStatus: string, priority: string): string {
  const normalized = (value || fallbackStatus || priority).trim().toUpperCase();
  if (['COMPLETED', 'APPROVED', 'DONE', 'LOW'].includes(normalized)) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (['BLOCKED', 'REJECTED', 'CRITICAL'].includes(normalized)) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (['HIGH', 'AT_RISK', 'LATE'].includes(normalized)) return 'border-amber-200 bg-amber-50 text-amber-800';
  if (['IN_PROGRESS', 'ACTIVE', 'MEDIUM'].includes(normalized)) return 'border-green-200 bg-green-50 text-green-800';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function BoardCalendarV1({
  items,
  onOpen,
}: {
  items: ApiBoardTemporalItemV1[];
  onOpen: (objectId: string) => void;
}) {
  const initial = items[0]?.start ? new Date(`${items[0].start.slice(0, 7)}-01T00:00:00Z`) : new Date();
  const [month, setMonth] = useState(new Date(Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth(), 1)));
  const gridStart = startOfCalendarGrid(month);
  const days = useMemo(() => Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)), [gridStart.toISOString()]);
  const today = new Date().toISOString().slice(0, 10);

  const itemsForDate = (key: string) => items.filter((item) => item.start.slice(0, 10) <= key && item.end.slice(0, 10) >= key);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Calendar View</p>
          <h3 className="mt-1 text-[15px] font-extrabold capitalize text-slate-950">{monthLabel(month)}</h3>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Mes anterior"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => setMonth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)))} className="h-8 rounded-lg border border-slate-200 px-3 text-[9px] font-bold text-slate-600 hover:bg-slate-50">Hoy</button>
          <button onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Mes siguiente"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/80">
        {WEEKDAYS.map((day) => <div key={day} className="px-2 py-2 text-center text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">{day}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dateKey(day);
          const dayItems = itemsForDate(key);
          const inMonth = day.getUTCMonth() === month.getUTCMonth();
          return (
            <div key={key} className={`min-h-[118px] border-b border-r border-slate-100 p-2 ${inMonth ? 'bg-white' : 'bg-slate-50/50'}`}>
              <div className="flex items-center justify-between">
                {/*
                  Los días fuera del mes se atenuaban con slate-300, que da 1.49:1 sobre
                  la celda: la fecha quedaba ilegible. El fondo gris de la celda ya los
                  distingue del mes actual, así que basta un tono secundario legible.
                */}
                <span className={`grid h-6 w-6 place-items-center rounded-full text-micro font-bold ${key === today ? 'bg-green-700 text-white' : inMonth ? 'text-slate-700' : 'text-slate-500'}`}>{day.getUTCDate()}</span>
                {dayItems.length > 3 && <span className="text-[8px] font-bold text-slate-400">+{dayItems.length - 3}</span>}
              </div>
              <div className="mt-1.5 space-y-1">
                {dayItems.slice(0, 3).map((item) => (
                  <button key={`${key}-${item.objectId}`} onClick={() => onOpen(item.objectId)} className={`block w-full truncate rounded-md border px-2 py-1 text-left text-[8px] font-bold ${semanticClass(item.colorValue, item.status, item.priority)}`} title={item.title}>
                    {item.displayTitle || item.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
