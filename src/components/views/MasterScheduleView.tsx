import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GitBranch,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type { ApiScheduleAnalysisV2 } from '../../api/projectScheduleV2Contracts';
import { useNexus } from '../../context/NexusContext';
import {
  buildMasterScheduleRowsV1,
  masterSchedulePositionV1,
  masterScheduleRangeV1,
  summarizeMasterScheduleV1,
  type MasterScheduleHealthV1,
} from '../../domain/masterScheduleV1';

const DAY_MS = 86_400_000;

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function dateAtPercent(start: string, totalDays: number, percent: number): string {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setTime(date.getTime() + Math.round(totalDays * percent) * DAY_MS);
  return date.toISOString().slice(0, 10);
}

function healthPresentation(health: MasterScheduleHealthV1): {
  label: string;
  chip: string;
  bar: string;
} {
  switch (health) {
    case 'ON_TRACK':
      return {
        label: 'En fecha',
        chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        bar: 'bg-emerald-600',
      };
    case 'AT_RISK':
      return {
        label: 'Atención',
        chip: 'bg-amber-50 text-amber-700 ring-amber-200',
        bar: 'bg-amber-500',
      };
    case 'CRITICAL':
      return {
        label: 'Crítico',
        chip: 'bg-rose-50 text-rose-700 ring-rose-200',
        bar: 'bg-rose-600',
      };
    case 'UNSCHEDULED':
      return {
        label: 'Sin programar',
        chip: 'bg-slate-100 text-slate-600 ring-slate-200',
        bar: 'bg-slate-400',
      };
  }
}

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    if (cause.code === 'schedule_anchor_missing') return 'Sin ancla de programación';
    if (cause.code === 'dependency_cycle') return 'Ciclo en dependencias';
    return cause.message;
  }
  return cause instanceof Error ? cause.message : 'No se pudo calcular el cronograma.';
}

export const MasterScheduleView: React.FC = () => {
  const {
    objects,
    currentWorkspace,
    objectDataStatus,
    objectDataError,
    reloadObjects,
    setSelectedProjectId,
    setProjectActiveSubTab,
    setActiveTab,
  } = useNexus();

  const projects = useMemo(
    () => objects.filter(
      (object) =>
        object.type === 'PROJECT'
        && (!currentWorkspace || object.workspaceId === currentWorkspace.id)
        && !['COMPLETED', 'CANCELLED'].includes(object.status),
    ),
    [currentWorkspace, objects],
  );
  const apiMode = objectDataStatus !== 'mock';
  const [analyses, setAnalyses] = useState<Record<string, ApiScheduleAnalysisV2 | null>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!apiMode) {
      setAnalyses({});
      setAnalysisErrors({});
      setLoading(false);
      return;
    }
    if (objectDataStatus !== 'ready' || !currentWorkspace) return;

    let cancelled = false;
    setLoading(true);
    void Promise.all(
      projects.map(async (project) => {
        try {
          const analysis = await bridataApi.projectScheduleAnalysisV2(project.id);
          return { projectId: project.id, analysis, error: null as string | null };
        } catch (cause) {
          return { projectId: project.id, analysis: null, error: messageOf(cause) };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setAnalyses(Object.fromEntries(results.map((result) => [result.projectId, result.analysis])));
      setAnalysisErrors(Object.fromEntries(results.map((result) => [result.projectId, result.error])));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [apiMode, currentWorkspace, objectDataStatus, projects, refreshVersion]);

  const rows = useMemo(
    () => buildMasterScheduleRowsV1(
      projects.map((project) => ({
        project,
        analysis: analyses[project.id] ?? null,
        analysisError: analysisErrors[project.id] ?? null,
      })),
    ),
    [analyses, analysisErrors, projects],
  );
  const summary = useMemo(() => summarizeMasterScheduleV1(rows), [rows]);
  const range = useMemo(() => masterScheduleRangeV1(rows), [rows]);
  const axisTicks = [0, 0.25, 0.5, 0.75, 1].map((percent) => ({
    percent: percent * 100,
    label: formatDate(dateAtPercent(range.startDate, range.totalDays, percent)),
  }));

  const openProjectPlanning = (projectId: string) => {
    setSelectedProjectId(projectId);
    setProjectActiveSubTab('gantt');
    setActiveTab('project');
  };

  if (objectDataStatus === 'waiting' || objectDataStatus === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[1580px] px-6 py-8 lg:px-8">
        <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[24px] border border-slate-200 bg-white text-center">
          <Loader2 className="h-5 w-5 animate-spin text-green-700" />
          <p className="mt-4 text-[12px] font-bold text-slate-800">Cargando plan maestro</p>
          <p className="mt-1 text-[10px] text-slate-400">Preparando la cartera activa del workspace.</p>
        </div>
      </div>
    );
  }

  if (objectDataStatus === 'error') {
    return (
      <div className="mx-auto w-full max-w-[1580px] px-6 py-8 lg:px-8">
        <div className="rounded-[24px] border border-rose-200 bg-white p-8">
          <div className="flex items-center gap-2 text-rose-700"><AlertCircle className="h-4 w-4" /><span className="text-[12px] font-bold">No se pudo cargar el plan maestro</span></div>
          <p className="mt-2 text-[11px] text-slate-500">{objectDataError || 'Error de datos no identificado.'}</p>
          <button onClick={() => void reloadObjects()} className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[11px] font-bold text-white hover:bg-green-800"><RefreshCw className="h-3.5 w-3.5" /> Reintentar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-5 px-6 py-6 lg:px-8">
      <section className="rounded-[26px] border border-slate-200 bg-white px-5 py-5 shadow-[0_10px_35px_rgba(15,23,42,0.035)] lg:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.13em] text-green-700"><CalendarClock className="h-4 w-4" /> Planificación multi-proyecto</div>
            <h1 className="mt-2 text-[26px] font-extrabold tracking-[-0.035em] text-slate-950">Plan maestro</h1>
            <p className="mt-1.5 max-w-3xl text-[11px] leading-5 text-slate-500">
              Consolidado del PROJECT_ENGINE_V2 por proyecto: fechas calculadas, objetivo, ruta crítica, trabajo sin programar y avance en una sola vista.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshVersion((value) => value + 1)}
            disabled={loading || !apiMode}
            className="inline-flex h-9 items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Recalcular
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-2xl bg-slate-50 p-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Proyectos activos</p><p className="mt-2 text-[23px] font-extrabold text-slate-950">{summary.totalProjects}</p></div>
          <div className="rounded-2xl bg-emerald-50/70 p-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-emerald-600">En fecha</p><p className="mt-2 text-[23px] font-extrabold text-emerald-800">{summary.onTrackProjects}</p></div>
          <div className="rounded-2xl bg-amber-50/70 p-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-amber-600">Atención</p><p className="mt-2 text-[23px] font-extrabold text-amber-800">{summary.atRiskProjects + summary.criticalProjects}</p></div>
          <div className="rounded-2xl bg-rose-50/70 p-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-rose-600">Tareas críticas</p><p className="mt-2 text-[23px] font-extrabold text-rose-800">{summary.criticalTaskCount}</p></div>
          <div className="rounded-2xl bg-slate-50 p-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Sin programar</p><p className="mt-2 text-[23px] font-extrabold text-slate-950">{summary.unscheduledWorkItemCount}</p></div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.025)]">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Ventana consolidada</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-700">{formatDate(range.startDate)} → {formatDate(range.finishDate)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[9px] font-semibold text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-emerald-600" /> En fecha</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-amber-500" /> Atención</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-rose-600" /> Crítico</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded bg-slate-300" /> Línea base</span>
          </div>
        </div>

        {loading && apiMode && (
          <div className="flex items-center gap-2 border-b border-slate-100 bg-green-50/50 px-5 py-2.5 text-[10px] font-semibold text-green-700"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Recalculando cronogramas V2…</div>
        )}

        {rows.length === 0 ? (
          <div className="p-14 text-center">
            <CalendarClock className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-3 text-[12px] font-bold text-slate-700">No hay proyectos activos</p>
            <p className="mt-1 text-[10px] text-slate-400">El plan maestro aparecerá cuando el workspace tenga proyectos en ejecución o planificación.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-[330px_minmax(720px,1fr)] border-b border-slate-100 bg-slate-50/70">
                <div className="px-5 py-3 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Proyecto</div>
                <div className="relative h-11 border-l border-slate-100">
                  {axisTicks.map((tick) => (
                    <div key={tick.percent} className="absolute top-0 h-full border-l border-slate-200/80" style={{ left: `${tick.percent}%` }}>
                      <span className="absolute left-1 top-3 whitespace-nowrap text-[8px] font-semibold text-slate-400">{tick.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {rows.map((row) => {
                const tone = healthPresentation(row.health);
                const position = masterSchedulePositionV1(row.startDate, row.finishDate, range);
                const baselinePosition = masterSchedulePositionV1(row.baselineStart, row.baselineFinish, range);
                const targetPosition = row.targetFinish
                  ? masterSchedulePositionV1(row.targetFinish, row.targetFinish, range)
                  : null;

                return (
                  <button
                    type="button"
                    key={row.projectId}
                    onClick={() => openProjectPlanning(row.projectId)}
                    className="group grid w-full grid-cols-[330px_minmax(720px,1fr)] border-b border-slate-100 text-left transition last:border-b-0 hover:bg-green-50/30"
                  >
                    <div className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[11px] font-extrabold text-slate-900 group-hover:text-green-800">{row.title}</span>
                            <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-300" />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[8px] font-black ring-1 ${tone.chip}`}>{tone.label}</span>
                            <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[8px] font-bold text-slate-500 ring-1 ring-slate-200">{row.progress}%</span>
                            {row.engineSource === 'PROJECT_ENGINE_V2' && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[8px] font-bold text-blue-700 ring-1 ring-blue-100">Engine V2</span>}
                          </div>
                          <div className="mt-2 flex items-center gap-3 text-[8px] text-slate-400">
                            <span>{formatDate(row.startDate)} → {formatDate(row.finishDate)}</span>
                            {row.criticalTaskCount > 0 && <span className="inline-flex items-center gap-1 text-rose-500"><GitBranch className="h-3 w-3" /> {row.criticalTaskCount} críticas</span>}
                          </div>
                          {(row.analysisError || row.fallbackWorkItemCount > 0) && (
                            <div className="mt-2 flex items-center gap-1 text-[8px] font-semibold text-amber-600"><TriangleAlert className="h-3 w-3" /> {row.analysisError || `${row.fallbackWorkItemCount} actividades aún en compatibilidad V1`}</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="relative min-h-[92px] border-l border-slate-100">
                      {axisTicks.map((tick) => <div key={tick.percent} className="absolute inset-y-0 border-l border-slate-100" style={{ left: `${tick.percent}%` }} />)}
                      {baselinePosition && (
                        <div className="absolute top-[58px] h-1.5 rounded-full bg-slate-300" style={{ left: `${baselinePosition.leftPercent}%`, width: `${baselinePosition.widthPercent}%` }} />
                      )}
                      {position ? (
                        <div className={`absolute top-[27px] h-7 rounded-lg ${tone.bar} shadow-sm`} style={{ left: `${position.leftPercent}%`, width: `${position.widthPercent}%` }}>
                          <div className="absolute inset-y-0 left-0 rounded-l-lg bg-slate-950/15" style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }} />
                          <span className="absolute inset-0 flex items-center px-2 text-[8px] font-black text-white">{row.durationWorkingDays !== null ? `${row.durationWorkingDays} d háb.` : `${row.progress}%`}</span>
                        </div>
                      ) : (
                        <div className="absolute left-4 top-[31px] inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1.5 text-[9px] font-semibold text-slate-400"><Clock3 className="h-3 w-3" /> Sin programación calculable</div>
                      )}
                      {targetPosition && (
                        <div className="absolute top-4 h-11 border-l-2 border-slate-700/60" style={{ left: `${targetPosition.leftPercent}%` }} title={`Objetivo: ${formatDate(row.targetFinish)}`} />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-emerald-700"><CheckCircle2 className="h-4 w-4" /><span className="text-[10px] font-black uppercase tracking-[0.1em]">Fuente real</span></div><p className="mt-2 text-[10px] leading-5 text-slate-500">En modo API, cada barra proviene del Project Engine V2. No se infieren fechas cuando el motor no puede calcularlas.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-amber-700"><TriangleAlert className="h-4 w-4" /><span className="text-[10px] font-black uppercase tracking-[0.1em]">Cobertura</span></div><p className="mt-2 text-[10px] leading-5 text-slate-500">La vista consolida cronogramas por proyecto. Las dependencias entre proyectos se incorporarán como una capa gobernada separada.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-blue-700"><GitBranch className="h-4 w-4" /><span className="text-[10px] font-black uppercase tracking-[0.1em]">Ruta crítica</span></div><p className="mt-2 text-[10px] leading-5 text-slate-500">Las tareas críticas, violaciones y actividades sin programar se acumulan desde cada análisis V2 y quedan visibles a nivel workspace.</p></div>
      </section>
    </div>
  );
};
