import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Diamond,
  GitBranch,
  Link2,
  Milestone,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ApiScheduleAnalysis } from '../../api/contracts';
import { useScheduling } from '../../context/SchedulingContext';
import { useNexus } from '../../context/NexusContext';
import type { DependencyType } from '../../types/nexus';

const DAY_MS = 86_400_000;

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * DAY_MS);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date).replace('.', '');
}

function dependencyLabel(type: DependencyType): string {
  switch (type) {
    case 'FS': return 'Fin → Inicio';
    case 'SS': return 'Inicio → Inicio';
    case 'FF': return 'Fin → Fin';
    case 'SF': return 'Inicio → Fin';
  }
}

export const GanttView: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer } = useNexus();
  const {
    dependencies,
    status: dependencyStatus,
    error: dependencyError,
    isMutationPending,
    createDependency,
    deleteDependency,
    analyzeProject,
  } = useScheduling();

  const items = useMemo(
    () => objects.filter(
      (object) =>
        object.projectId === projectId &&
        ['TASK', 'DELIVERABLE', 'MILESTONE'].includes(object.type),
    ),
    [objects, projectId],
  );
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const projectDependencies = useMemo(
    () => dependencies.filter(
      (dependency) =>
        dependency.relationType === 'DEPENDS_ON' &&
        itemIds.has(dependency.sourceObjectId) &&
        itemIds.has(dependency.targetObjectId),
    ),
    [dependencies, itemIds],
  );

  const [schedule, setSchedule] = useState<ApiScheduleAnalysis | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [predecessorId, setPredecessorId] = useState('');
  const [successorId, setSuccessorId] = useState('');
  const [dependencyType, setDependencyType] = useState<DependencyType>('FS');
  const [lagDays, setLagDays] = useState(0);
  const [showDependencies, setShowDependencies] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setScheduleLoading(true);
    setScheduleError(null);
    void analyzeProject(projectId)
      .then((analysis) => {
        if (!cancelled) setSchedule(analysis);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setSchedule(null);
          setScheduleError(cause instanceof Error ? cause.message : 'No se pudo analizar el cronograma.');
        }
      })
      .finally(() => {
        if (!cancelled) setScheduleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analyzeProject, projectDependencies, projectId]);

  const scheduleTaskById = useMemo(
    () => new Map(schedule?.tasks.map((task) => [task.id, task]) ?? []),
    [schedule],
  );
  const criticalIds = useMemo(() => new Set(schedule?.criticalTaskIds ?? []), [schedule]);

  const scheduledItems = useMemo(
    () => items
      .map((item) => {
        const start = parseDate(item.startDate) ?? parseDate(item.endDate);
        const rawEnd = parseDate(item.endDate) ?? start;
        if (!start || !rawEnd) return null;
        const end = rawEnd.getTime() < start.getTime() ? start : rawEnd;
        return { item, start, end };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime()),
    [items],
  );

  const unscheduledItems = items.filter((item) => !parseDate(item.startDate) && !parseDate(item.endDate));

  const addDependency = async () => {
    if (!predecessorId || !successorId || predecessorId === successorId) return;
    await createDependency({
      predecessorId,
      successorId,
      dependencyType,
      lagDays,
    });
    setPredecessorId('');
    setSuccessorId('');
    setDependencyType('FS');
    setLagDays(0);
  };

  if (items.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-8 text-center">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-green-50 text-green-700"><CalendarDays className="h-5 w-5" /></div>
        <p className="mt-4 text-[12px] font-bold text-slate-800">Todavía no hay actividades para el cronograma</p>
        <p className="mt-1 max-w-md text-[10px] leading-5 text-slate-400">Agrega tareas, entregables o hitos al proyecto para construir el Gantt.</p>
      </div>
    );
  }

  const renderDependencyEditor = () => (
    <section className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-green-50 text-green-700 ring-1 ring-green-100"><GitBranch className="h-3.5 w-3.5" /></div>
          <div>
            <p className="text-[10px] font-bold text-slate-800">Dependencias del cronograma</p>
            <p className="mt-0.5 text-[8px] text-slate-400">FS, SS, FF, SF · lag positivo / lead negativo · ciclos bloqueados por la API</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={predecessorId} onChange={(event) => setPredecessorId(event.target.value)} className="h-8 max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600 outline-none focus:border-green-400">
            <option value="">Predecesora...</option>
            {items.map((item) => <option key={item.id} value={item.id} disabled={item.id === successorId}>{item.title}</option>)}
          </select>
          <span className="text-[9px] font-bold text-slate-300">→</span>
          <select value={successorId} onChange={(event) => setSuccessorId(event.target.value)} className="h-8 max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-semibold text-slate-600 outline-none focus:border-green-400">
            <option value="">Sucesora...</option>
            {items.map((item) => <option key={item.id} value={item.id} disabled={item.id === predecessorId}>{item.title}</option>)}
          </select>
          <select value={dependencyType} onChange={(event) => setDependencyType(event.target.value as DependencyType)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[9px] font-bold text-slate-600 outline-none focus:border-green-400">
            <option value="FS">FS</option><option value="SS">SS</option><option value="FF">FF</option><option value="SF">SF</option>
          </select>
          <label className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[8px] font-semibold text-slate-400">
            Lag
            <input type="number" value={lagDays} onChange={(event) => setLagDays(Number(event.target.value) || 0)} className="w-12 bg-transparent text-right text-[9px] font-bold text-slate-700 outline-none" />d
          </label>
          <button disabled={!predecessorId || !successorId || predecessorId === successorId || isMutationPending} onClick={() => void addDependency()} className="flex h-8 items-center gap-1.5 rounded-lg bg-green-700 px-3 text-[9px] font-bold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3 w-3" />Agregar</button>
          <button onClick={() => setShowDependencies((value) => !value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-[8px] font-bold text-slate-500 hover:bg-slate-50">{showDependencies ? 'Ocultar' : 'Mostrar'} vínculos</button>
        </div>
      </div>

      {(dependencyError || scheduleError) && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[9px] font-semibold text-rose-700 ring-1 ring-rose-100"><AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />{dependencyError || scheduleError}</div>
      )}

      {showDependencies && projectDependencies.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {projectDependencies.map((dependency) => {
            const predecessor = objects.find((object) => object.id === dependency.targetObjectId);
            const successor = objects.find((object) => object.id === dependency.sourceObjectId);
            return (
              <span key={dependency.id} className="flex max-w-full items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[8px] font-semibold text-slate-500 ring-1 ring-slate-200">
                <span className="max-w-[120px] truncate text-slate-700">{predecessor?.title || 'Predecesora'}</span>
                <Link2 className="h-2.5 w-2.5 text-green-600" />
                <span className="rounded bg-green-50 px-1 py-0.5 font-black text-green-800">{dependency.dependencyType ?? 'FS'}</span>
                {(dependency.lagDays ?? 0) !== 0 && <span className="text-slate-400">{(dependency.lagDays ?? 0) > 0 ? '+' : ''}{dependency.lagDays}d</span>}
                <span className="max-w-[120px] truncate text-slate-700">{successor?.title || 'Sucesora'}</span>
                <button onClick={() => void deleteDependency(dependency.id)} className="ml-1 text-slate-300 transition hover:text-rose-600" title="Eliminar dependencia"><Trash2 className="h-3 w-3" /></button>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );

  if (scheduledItems.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {renderDependencyEditor()}
        <div className="bg-amber-50/50 p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700"><Clock3 className="h-4 w-4" /></div>
            <div><p className="text-[12px] font-bold text-slate-900">El proyecto aún no tiene fechas suficientes para dibujar el Gantt</p><p className="mt-1 text-[10px] leading-5 text-slate-500">Define fecha de inicio o fecha fin. Bridata Project no inventará posiciones en el cronograma.</p></div>
          </div>
        </div>
      </div>
    );
  }

  const earliestStart = new Date(Math.min(...scheduledItems.map(({ start }) => start.getTime())));
  const latestEnd = new Date(Math.max(...scheduledItems.map(({ end }) => end.getTime())));
  const rangeStart = startOfMonth(earliestStart);
  const rangeEnd = endOfMonth(latestEnd);
  const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd) + 1);

  const monthSegments: Array<{ date: Date; left: number; width: number }> = [];
  let monthCursor = startOfMonth(rangeStart);
  while (monthCursor.getTime() <= rangeEnd.getTime()) {
    const nextMonth = new Date(Date.UTC(monthCursor.getUTCFullYear(), monthCursor.getUTCMonth() + 1, 1));
    const segmentStart = monthCursor.getTime() < rangeStart.getTime() ? rangeStart : monthCursor;
    const naturalEnd = addDays(nextMonth, -1);
    const segmentEnd = naturalEnd.getTime() > rangeEnd.getTime() ? rangeEnd : naturalEnd;
    monthSegments.push({
      date: monthCursor,
      left: (daysBetween(rangeStart, segmentStart) / totalDays) * 100,
      width: ((daysBetween(segmentStart, segmentEnd) + 1) / totalDays) * 100,
    });
    monthCursor = nextMonth;
  }

  const todayLocal = new Date();
  const today = new Date(Date.UTC(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate()));
  const todayInRange = today.getTime() >= rangeStart.getTime() && today.getTime() <= rangeEnd.getTime();
  const todayLeft = (daysBetween(rangeStart, today) / totalDays) * 100;
  const completedCount = items.filter((item) => ['COMPLETED', 'APPROVED'].includes(item.status)).length;
  const blockedCount = items.filter((item) => item.status === 'BLOCKED').length;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-green-700" /><h3 className="text-[12px] font-bold text-slate-900">Cronograma CPM del proyecto</h3></div>
          <p className="mt-1 text-[9px] text-slate-400">Fechas reales para dibujar; dependencias y holgura para determinar la ruta crítica.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[9px] font-semibold">
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-slate-500 ring-1 ring-slate-200">{scheduledItems.length} programados</span>
          <span className="rounded-full bg-green-50 px-2.5 py-1 text-green-800 ring-1 ring-green-200">{projectDependencies.length} dependencias</span>
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700 ring-1 ring-rose-200">{criticalIds.size} ruta crítica</span>
          {schedule && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700 ring-1 ring-sky-200">{schedule.projectDurationDays}d red CPM</span>}
          {blockedCount > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 ring-1 ring-amber-200">{blockedCount} bloqueados</span>}
          {scheduleLoading && <span className="text-slate-400">calculando…</span>}
        </div>
      </div>

      {renderDependencyEditor()}

      <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-4 text-[9px] font-medium text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green-600" /> En ejecución</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-700" /> Completado</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-600" /> Ruta crítica CPM</span>
          <span className="flex items-center gap-1.5"><Diamond className="h-2.5 w-2.5 fill-amber-500 text-amber-500" /> Hito</span>
        </div>
        <p className="hidden text-[9px] font-medium text-slate-400 sm:block">{formatShortDate(rangeStart)} — {formatShortDate(rangeEnd)}</p>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1120px]">
          <div className="grid grid-cols-[330px_minmax(790px,1fr)] border-b border-slate-100 bg-slate-50/50">
            <div className="border-r border-slate-100 px-4 py-3"><p className="text-[9px] font-bold uppercase tracking-[0.11em] text-slate-400">Actividad / programación</p></div>
            <div className="relative h-10">
              {monthSegments.map((segment) => <div key={`${segment.date.getUTCFullYear()}-${segment.date.getUTCMonth()}`} className="absolute inset-y-0 flex items-center justify-center border-l border-slate-100 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400" style={{ left: `${segment.left}%`, width: `${segment.width}%` }}>{formatMonth(segment.date)}</div>)}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {scheduledItems.map(({ item, start, end }) => {
              const scheduleTask = scheduleTaskById.get(item.id);
              const isCritical = criticalIds.has(item.id);
              const isCompleted = ['COMPLETED', 'APPROVED'].includes(item.status);
              const isBlocked = item.status === 'BLOCKED';
              const isMilestone = item.type === 'MILESTONE';
              const left = Math.max(0, Math.min(100, (daysBetween(rangeStart, start) / totalDays) * 100));
              const rawWidth = ((daysBetween(start, end) + 1) / totalDays) * 100;
              const width = Math.max(0.8, Math.min(100 - left, rawWidth));
              const predecessorCount = projectDependencies.filter((dependency) => dependency.sourceObjectId === item.id).length;

              const trackClass = isCritical
                ? 'bg-rose-100 ring-rose-300'
                : isCompleted
                  ? 'bg-emerald-700 ring-emerald-700'
                  : isBlocked
                    ? 'bg-amber-100 ring-amber-300'
                    : 'bg-green-100 ring-green-200';
              const fillClass = isCritical ? 'bg-rose-600' : isBlocked ? 'bg-amber-500' : 'bg-green-700';

              return (
                <button key={item.id} onClick={() => openObjectDrawer(item.id)} className={`grid w-full grid-cols-[330px_minmax(790px,1fr)] text-left transition ${isCritical ? 'bg-rose-50/20 hover:bg-rose-50/45' : 'hover:bg-green-50/30'}`}>
                  <div className="flex min-w-0 items-center gap-3 border-r border-slate-100 px-4 py-3">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isCritical ? 'bg-rose-600' : isCompleted ? 'bg-emerald-600' : isBlocked ? 'bg-amber-500' : 'bg-green-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><span className="block truncate text-[10px] font-semibold text-slate-800">{item.title}</span>{isCritical && <span className="flex-shrink-0 rounded bg-rose-50 px-1 py-0.5 text-[7px] font-black text-rose-700 ring-1 ring-rose-100">CRÍTICA</span>}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[8px] font-medium text-slate-400">
                        <span>{item.type}</span><span>•</span><span>{item.progress}%</span><span>•</span><span>{formatShortDate(start)} → {formatShortDate(end)}</span>
                        {scheduleTask && <><span>•</span><span className={scheduleTask.totalFloat === 0 ? 'font-bold text-rose-600' : 'text-sky-600'}>Holgura {scheduleTask.totalFloat}d</span></>}
                        {predecessorCount > 0 && <><span>•</span><span>{predecessorCount} pred.</span></>}
                      </span>
                    </span>
                  </div>

                  <div className="relative h-[54px] overflow-hidden">
                    {monthSegments.map((segment) => <span key={`grid-${item.id}-${segment.date.getTime()}`} className="absolute inset-y-0 border-l border-slate-100/80" style={{ left: `${segment.left}%` }} />)}
                    {todayInRange && <span className="absolute inset-y-0 z-10 w-px bg-sky-500/60" style={{ left: `${todayLeft}%` }} title="Hoy" />}
                    {isMilestone ? (
                      <span className={`absolute top-1/2 z-20 h-3.5 w-3.5 -translate-y-1/2 rotate-45 rounded-[2px] shadow-sm ${isCritical ? 'bg-rose-600' : isCompleted ? 'bg-emerald-700' : 'bg-amber-500'}`} style={{ left: `calc(${left}% - 7px)` }} title={`${item.title}: ${formatShortDate(start)}`} />
                    ) : (
                      <span className={`absolute top-1/2 z-20 h-4 -translate-y-1/2 overflow-hidden rounded-md ring-1 ${trackClass}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${item.title}: ${formatShortDate(start)} – ${formatShortDate(end)}${scheduleTask ? ` · Holgura ${scheduleTask.totalFloat}d` : ''}`}>
                        {!isCompleted && <span className={`block h-full ${fillClass}`} style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {unscheduledItems.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/40 px-4 py-3">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" /><div className="min-w-0"><p className="text-[9px] font-bold text-amber-800">Objetos fuera del Gantt por falta de fecha</p><div className="mt-1.5 flex flex-wrap gap-1.5">{unscheduledItems.slice(0, 6).map((item) => <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="rounded-lg bg-white px-2 py-1 text-[8px] font-semibold text-slate-600 ring-1 ring-amber-200 transition hover:text-green-800">{item.title}</button>)}{unscheduledItems.length > 6 && <span className="px-1 py-1 text-[8px] font-semibold text-amber-700">+{unscheduledItems.length - 6} más</span>}</div></div></div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[8px] font-medium text-slate-400">
        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Ruta crítica = holgura total 0; no depende de prioridad</span>
        <span className="flex items-center gap-1.5"><Milestone className="h-3 w-3 text-green-700" /> CPM V1 usa días calendario · Próximo: calendarios laborales y baseline</span>
        <span className="text-slate-300">{dependencyStatus === 'loading' ? 'Sincronizando dependencias…' : dependencyStatus === 'ready' ? 'Dependencias sincronizadas' : 'Preview local'}</span>
      </div>
    </div>
  );
};
