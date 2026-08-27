import React, { useMemo } from 'react';
import type { ApiBoardTemporalItemV1 } from '../../../api/workOsTemporalV1Contracts';

function dayDiff(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function dateOnly(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`);
}

function barClass(item: ApiBoardTemporalItemV1): string {
  const normalized = (item.colorValue || item.status || item.priority).trim().toUpperCase();
  if (['BLOCKED', 'REJECTED', 'CRITICAL'].includes(normalized)) return 'border-rose-200 bg-rose-100 text-rose-900 hover:bg-rose-200';
  if (['HIGH', 'AT_RISK', 'LATE'].includes(normalized)) return 'border-amber-200 bg-amber-100 text-amber-900 hover:bg-amber-200';
  if (['COMPLETED', 'APPROVED', 'DONE', 'LOW'].includes(normalized)) return 'border-emerald-200 bg-emerald-100 text-emerald-900 hover:bg-emerald-200';
  if (['IN_PROGRESS', 'ACTIVE', 'MEDIUM'].includes(normalized)) return 'border-green-200 bg-green-100 text-green-900 hover:bg-green-200';
  return 'border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200';
}

export function BoardTimelineV1({
  items,
  onOpen,
}: {
  items: ApiBoardTemporalItemV1[];
  onOpen: (objectId: string) => void;
}) {
  const range = useMemo(() => {
    if (!items.length) {
      const start = new Date();
      const end = new Date(start.getTime() + 30 * 86_400_000);
      return { start, end, totalDays: 30 };
    }
    const starts = items.map((item) => dateOnly(item.start).getTime());
    const ends = items.map((item) => dateOnly(item.end).getTime());
    const start = new Date(Math.min(...starts));
    const end = new Date(Math.max(...ends));
    const totalDays = Math.max(1, dayDiff(start, end) + 1);
    return { start, end, totalDays };
  }, [items]);

  const markers = Array.from({ length: Math.min(12, range.totalDays) }, (_, index) => {
    const offset = Math.round((index / Math.max(1, Math.min(11, range.totalDays - 1))) * Math.max(0, range.totalDays - 1));
    const date = new Date(range.start.getTime() + offset * 86_400_000);
    return { offset, label: new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(date) };
  });

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Timeline View</p>
        <p className="mt-1 text-[10px] text-slate-400">{range.start.toISOString().slice(0, 10)} → {range.end.toISOString().slice(0, 10)}</p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[280px_minmax(680px,1fr)] border-b border-slate-200 bg-slate-50/80">
            <div className="border-r border-slate-200 px-4 py-3 text-[9px] font-black uppercase tracking-[0.1em] text-slate-500">Elemento</div>
            <div className="relative h-10">
              {markers.map((marker) => <div key={`${marker.offset}-${marker.label}`} className="absolute top-0 h-full border-l border-slate-200 px-1 pt-3 text-[8px] font-bold text-slate-400" style={{ left: `${(marker.offset / range.totalDays) * 100}%` }}>{marker.label}</div>)}
            </div>
          </div>
          {items.map((item) => {
            const startOffset = dayDiff(range.start, dateOnly(item.start));
            const endOffset = dayDiff(range.start, dateOnly(item.end));
            const left = (startOffset / range.totalDays) * 100;
            const width = (Math.max(1, endOffset - startOffset + 1) / range.totalDays) * 100;
            const label = item.displayTitle || item.title;
            return (
              <div key={item.objectId} className="grid grid-cols-[280px_minmax(680px,1fr)] border-b border-slate-100 hover:bg-green-50/20">
                <button onClick={() => onOpen(item.objectId)} className="min-w-0 border-r border-slate-100 px-4 py-3 text-left">
                  <p className="truncate text-[10px] font-bold text-slate-900">{label}</p>
                  <p className="mt-1 truncate text-[8px] font-semibold text-slate-400">{item.assignee?.fullName ?? 'Sin responsable'} · {item.progress}%</p>
                </button>
                <div className="relative h-12 bg-[linear-gradient(to_right,rgba(226,232,240,0.45)_1px,transparent_1px)] bg-[size:8.333%_100%]">
                  <button
                    onClick={() => onOpen(item.objectId)}
                    className={`absolute top-2 h-8 min-w-[18px] overflow-hidden rounded-lg border px-2 text-left text-[8px] font-bold shadow-sm ${barClass(item)}`}
                    style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}
                    title={`${item.title} · ${item.start.slice(0, 10)} → ${item.end.slice(0, 10)}`}
                  >
                    <span className="block truncate">{label}</span>
                  </button>
                </div>
              </div>
            );
          })}
          {!items.length && <div className="p-10 text-center text-[10px] text-slate-400">No hay elementos con fechas para esta vista.</div>}
        </div>
      </div>
    </section>
  );
}
