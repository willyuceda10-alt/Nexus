import React from 'react';
import { Activity, AlertTriangle, CalendarClock, Gauge, TrendingUp } from 'lucide-react';
import type { ApiProjectForecast } from '../../api/contracts';

function shortDate(value: string | null): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function basisLabel(value: string): string {
  switch (value) {
    case 'PROGRESS_VELOCITY': return 'Ritmo observado';
    case 'NOT_STARTED_PLAN': return 'Aún no inicia';
    case 'NO_PROGRESS_SIGNAL': return 'Sin señal de avance';
    case 'INSUFFICIENT_HISTORY': return 'Historia insuficiente';
    case 'COMPLETED_CURRENT_FINISH': return 'Completada';
    default: return value;
  }
}

interface ForecastSummaryProps {
  forecast: ApiProjectForecast | null;
  loading: boolean;
  error: string | null;
}

export const ForecastSummary: React.FC<ForecastSummaryProps> = ({ forecast, loading, error }) => {
  if (loading && !forecast) {
    return (
      <div className="mb-4 rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-[9px] font-semibold text-sky-700">
        Calculando forecast con progreso observado…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-[9px] font-semibold text-rose-700">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {error}
      </div>
    );
  }

  if (!forecast) return null;

  const variance = forecast.forecastVarianceDays;
  const varianceClass = variance === null
    ? 'text-slate-500'
    : variance > 0
      ? 'text-rose-600'
      : variance < 0
        ? 'text-emerald-700'
        : 'text-slate-600';
  const projected = forecast.tasks
    .filter((task) => task.basis === 'PROGRESS_VELOCITY')
    .sort((a, b) => (b.forecastVarianceDays ?? -999) - (a.forecastVarianceDays ?? -999));

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50/80 via-white to-white">
      <div className="flex flex-col gap-4 px-4 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-xl">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-sky-100 text-sky-700"><TrendingUp className="h-3.5 w-3.5" /></div>
            <div>
              <p className="text-[11px] font-bold text-slate-900">Forecast de término · Progress Velocity V1</p>
              <p className="mt-0.5 text-[8px] leading-4 text-slate-400">
                Proyección determinística al {forecast.asOfDate}; usa progreso acumulado, tiempo transcurrido y el calendario del proyecto. No es una predicción IA.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5">
            <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400"><CalendarClock className="h-3 w-3" /> Plan</div>
            <p className="mt-1 text-[11px] font-extrabold text-slate-800">{shortDate(forecast.plannedFinish)}</p>
          </div>
          <div className="rounded-xl border border-sky-100 bg-white px-3 py-2.5">
            <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.08em] text-sky-500"><TrendingUp className="h-3 w-3" /> Forecast</div>
            <p className="mt-1 text-[11px] font-extrabold text-sky-800">{shortDate(forecast.forecastFinish)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5">
            <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400"><Activity className="h-3 w-3" /> Variación</div>
            <p className={`mt-1 text-[11px] font-extrabold ${varianceClass}`}>{variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance}d${forecast.calendar === 'WORKING_DAYS_V1' ? ' háb.' : ''}`}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-white px-3 py-2.5">
            <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400"><Gauge className="h-3 w-3" /> Señal</div>
            <p className="mt-1 text-[11px] font-extrabold text-slate-800">{forecast.projectedTaskCount}/{forecast.tasks.length}</p>
            <p className="mt-0.5 text-[7px] text-slate-400">tareas con ritmo medible</p>
          </div>
        </div>
      </div>

      {projected.length > 0 && (
        <div className="border-t border-sky-100/80 bg-white/70 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {projected.slice(0, 6).map((task) => (
              <div key={task.id} className="min-w-[190px] flex-1 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-1 text-[9px] font-bold text-slate-700">{task.title}</p>
                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[7px] font-black ${task.confidence === 'MEDIUM' ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>{task.confidence === 'MEDIUM' ? 'MEDIA' : 'BAJA'}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[8px] text-slate-400">
                  <span>{basisLabel(task.basis)}</span>
                  <span className="font-bold text-sky-700">→ {shortDate(task.forecastFinish)}</span>
                </div>
                <div className="mt-1 text-[7px] text-slate-400">
                  {task.elapsedUnits ?? 0}u observadas · {task.remainingUnits ?? 0}u restantes · {task.progress}% avance
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
