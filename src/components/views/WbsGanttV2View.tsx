import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Diamond,
  GitBranch,
  Layers3,
  Link2,
  Minus,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type {
  ApiScheduleAnalysisV2,
  ApiScheduleConstraintTypeV2,
  ApiWbsV2Node,
  ApiWbsV2Response,
} from '../../api/projectScheduleV2Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { useScheduling } from '../../context/SchedulingContext';
import {
  indentWbsNode,
  moveWbsNode,
  outdentWbsNode,
  rollupWbsBars,
  visibleWbsNodes,
  wbsIntent,
} from '../../domain/wbsGanttV2';
import type { DependencyType, ObjectType } from '../../types/nexus';
import { GanttView } from './GanttView';

const DAY_MS = 86_400_000;
const LEFT_WIDTH = 790;

/**
 * SCH-03 — Vista de columnas CPM.
 *
 * El motor V2 ya devuelve early/late start y finish y ambas holguras por tarea; hasta
 * ahora la grilla solo pintaba la holgura total. Estas columnas no calculan nada: leen
 * lo que `projectScheduleAnalysisV2` ya trae. No se muestran por defecto porque un
 * planner solo las necesita al analizar la red, no al capturar el plan.
 */
const CPM_LEFT_WIDTH = 856;
const STANDARD_COLUMNS = 'grid-cols-[58px_280px_72px_64px_84px_84px_62px_86px]';
const CPM_COLUMNS = 'grid-cols-[58px_240px_64px_78px_78px_78px_78px_60px_60px_62px]';

/** Umbral por defecto de «casi crítica», en días hábiles. Configurable más adelante. */
const NEAR_CRITICAL_DAYS = 3;
const ROW_HEIGHT = 44;

const constraintLabels: Record<ApiScheduleConstraintTypeV2, string> = {
  AS_SOON_AS_POSSIBLE: 'Lo antes posible',
  AS_LATE_AS_POSSIBLE: 'Lo más tarde posible',
  MUST_START_ON: 'Debe iniciar',
  MUST_FINISH_ON: 'Debe finalizar',
  START_NO_EARLIER_THAN: 'Inicio no antes de',
  START_NO_LATER_THAN: 'Inicio no después de',
  FINISH_NO_EARLIER_THAN: 'Fin no antes de',
  FINISH_NO_LATER_THAN: 'Fin no después de',
};

const dateConstraintTypes = new Set<ApiScheduleConstraintTypeV2>([
  'MUST_START_ON',
  'MUST_FINISH_ON',
  'START_NO_EARLIER_THAN',
  'START_NO_LATER_THAN',
  'FINISH_NO_EARLIER_THAN',
  'FINISH_NO_LATER_THAN',
]);

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const result = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(result.getTime()) ? null : result;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function dayDistance(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * SCH-03 — El motor entrega early/late start y finish en minutos desde el ancla del
 * proyecto. Convertirlos a fecha de calendario exigiría recorrer el calendario saltando
 * días no laborables, es decir recalcular el cronograma en el cliente. Se muestran como
 * día hábil del proyecto, que es una conversión de unidad y no una regla de negocio.
 *
 * Exponerlos como fecha requiere que el backend los serialice; queda anotado como el
 * único cambio de API que SCH-03 justifica.
 */
function cpmDay(minutes: number | undefined, minutesPerDay: number): string {
  if (minutes === undefined || minutesPerDay <= 0) return '—';
  return `d${Math.round(minutes / minutesPerDay)}`;
}

/** Rojo si es crítica, ámbar si entra en el umbral de casi crítica. */
function floatTone(days: number | undefined, critical: boolean | undefined): string {
  if (critical) return 'text-rose-600';
  if (days !== undefined && days <= NEAR_CRITICAL_DAYS) return 'text-amber-600';
  return 'text-slate-400';
}

function shortDate(value?: string | null): string {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(date).replace('.', '');
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('es-PE', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(date).replace('.', '');
}

function typeLabel(node: ApiWbsV2Node): string {
  if (node.isSummary) return 'Fase';
  if (node.objectTypeKey === 'MILESTONE') return 'Hito';
  if (node.objectTypeKey === 'DELIVERABLE') return 'Entregable';
  return 'Tarea';
}

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo completar la operación del cronograma.';
}

export const WbsGanttV2View: React.FC<{ projectId: string }> = ({ projectId }) => {
  const apiBootstrap = useApiBootstrap();
  const {
    createNexusObject,
    updateNexusObject,
    openObjectDrawer,
    isObjectMutationPending,
  } = useNexus();
  const {
    dependencies,
    createDependency,
    deleteDependency,
    isMutationPending,
    saveProjectBaseline,
  } = useScheduling();

  const isApiMode = apiBootstrap.dataMode === 'api';
  const apiReady = isApiMode && apiBootstrap.status === 'ready';

  const [wbs, setWbs] = useState<ApiWbsV2Response | null>(null);
  const [analysis, setAnalysis] = useState<ApiScheduleAnalysisV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisWarning, setAnalysisWarning] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dayWidth, setDayWidth] = useState(28);
  const [predecessorId, setPredecessorId] = useState('');
  const [dependencyType, setDependencyType] = useState<DependencyType>('FS');
  const [lagDays, setLagDays] = useState(0);
  // SCH-03: la vista CPM se activa a demanda; la estándar queda limpia para capturar.
  const [cpmView, setCpmView] = useState(false);
  const [onlyCritical, setOnlyCritical] = useState(false);

  const leftWidth = cpmView ? CPM_LEFT_WIDTH : LEFT_WIDTH;
  const columnTemplate = cpmView ? CPM_COLUMNS : STANDARD_COLUMNS;

  const reload = useCallback(async () => {
    if (!apiReady) return;
    setLoading(true);
    setError(null);
    setAnalysisWarning(null);
    try {
      const wbsResult = await bridataApi.projectWbsV2(projectId);
      setWbs(wbsResult);
      const analysisResult = await bridataApi.projectScheduleAnalysisV2(projectId)
        .catch((cause: unknown) => {
          setAnalysisWarning(messageOf(cause));
          return null;
        });
      setAnalysis(analysisResult);
      setSelectedId((current) => {
        if (current && wbsResult.nodes.some((node) => node.objectId === current)) return current;
        return wbsResult.nodes[0]?.objectId ?? null;
      });
    } catch (cause) {
      setWbs(null);
      setAnalysis(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [apiReady, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const nodes = wbs?.nodes ?? [];
  const nodeIds = useMemo(() => new Set(nodes.map((node) => node.objectId)), [nodes]);
  const selected = nodes.find((node) => node.objectId === selectedId) ?? null;
  const allVisibleNodes = useMemo(() => visibleWbsNodes(nodes, collapsed), [nodes, collapsed]);
  // SCH-03: el filtro de ruta crítica usa criticalTaskIds del motor, sin recalcular nada.
  const criticalIds = useMemo(
    () => new Set(analysis?.criticalTaskIds ?? []),
    [analysis],
  );
  const visibleNodes = useMemo(
    () => (onlyCritical ? allVisibleNodes.filter((node) => criticalIds.has(node.objectId)) : allVisibleNodes),
    [allVisibleNodes, criticalIds, onlyCritical],
  );
  const analysisTaskById = useMemo(
    () => new Map(analysis?.tasks.map((task) => [task.id, task]) ?? []),
    [analysis],
  );
  const bars = useMemo(
    () => rollupWbsBars(nodes, analysis?.tasks ?? []),
    [analysis?.tasks, nodes],
  );

  const projectRelations = useMemo(
    () => dependencies.filter(
      (dependency) =>
        dependency.relationType === 'DEPENDS_ON' &&
        nodeIds.has(dependency.sourceObjectId) &&
        nodeIds.has(dependency.targetObjectId),
    ),
    [dependencies, nodeIds],
  );
  const incomingForSelected = useMemo(
    () => selectedId
      ? projectRelations.filter((dependency) => dependency.sourceObjectId === selectedId)
      : [],
    [projectRelations, selectedId],
  );

  const timeline = useMemo(() => {
    const dates: Date[] = [];
    for (const bar of bars.values()) {
      const start = parseDate(bar.plannedStart);
      const finish = parseDate(bar.plannedFinish);
      if (start) dates.push(start);
      if (finish) dates.push(finish);
    }
    const target = parseDate(wbs?.project.targetFinish);
    if (target) dates.push(target);
    const plannedStart = parseDate(wbs?.project.plannedStart);
    if (plannedStart) dates.push(plannedStart);

    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const min = dates.length > 0
      ? new Date(Math.min(...dates.map((date) => date.getTime())))
      : todayUtc;
    const max = dates.length > 0
      ? new Date(Math.max(...dates.map((date) => date.getTime())))
      : addDays(todayUtc, 30);
    const start = addDays(min, -3);
    const end = addDays(max, 7);
    const count = Math.max(14, dayDistance(start, end) + 1);
    const effectiveDayWidth = count > 540 ? Math.min(dayWidth, 10) : count > 365 ? Math.min(dayWidth, 14) : dayWidth;
    return {
      start,
      end,
      count,
      dayWidth: effectiveDayWidth,
      width: count * effectiveDayWidth,
      days: Array.from({ length: count }, (_, index) => addDays(start, index)),
    };
  }, [bars, dayWidth, wbs?.project.plannedStart, wbs?.project.targetFinish]);

  const persistHierarchy = async (nextNodes: ApiWbsV2Node[], successMessage: string) => {
    if (!wbs) return;
    setBusy(true);
    setFeedback(null);
    try {
      await bridataApi.updateProjectWbsV2(projectId, { items: wbsIntent(nextNodes) });
      await reload();
      setFeedback(successMessage);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const createRow = async (type: ObjectType, label: string, zeroDuration = false) => {
    if (!wbs) return;
    setBusy(true);
    setFeedback(null);
    try {
      const startDate = wbs.project.plannedStart ?? dateOnly(new Date());
      const created = await createNexusObject({
        type,
        title: label,
        description: '',
        status: 'PLANNING',
        priority: 'MEDIUM',
        progress: 0,
        projectId,
        startDate,
        endDate: startDate,
      });
      const synthetic: ApiWbsV2Node = {
        objectId: created.id,
        title: created.title,
        objectTypeKey: type === 'MILESTONE' ? 'MILESTONE' : type === 'DELIVERABLE' ? 'DELIVERABLE' : 'TASK',
        status: created.status,
        priority: created.priority,
        progress: created.progress,
        assigneeId: created.assigneeId ?? null,
        assigneeName: created.assigneeName ?? null,
        parentWorkItemId: null,
        outlineLevel: 0,
        sortOrder: nodes.length,
        wbsCode: String(nodes.length + 1),
        isSummary: false,
        source: 'V1_FALLBACK',
        schedulingMode: 'AUTO',
        durationMinutes: zeroDuration ? 0 : wbs.minutesPerDay,
        remainingDurationMinutes: zeroDuration ? 0 : wbs.minutesPerDay,
        constraintType: 'AS_SOON_AS_POSSIBLE',
        constraintDate: null,
        actualStart: null,
        actualFinish: null,
        physicalPercentComplete: null,
        legacyStart: startDate,
        legacyFinish: startDate,
      };
      await bridataApi.updateProjectWbsV2(projectId, {
        items: wbsIntent([...nodes, synthetic]),
      });
      if (zeroDuration) {
        await bridataApi.updateWorkItemScheduleV2(created.id, {
          durationMinutes: 0,
          remainingDurationMinutes: 0,
        });
      }
      await reload();
      setSelectedId(created.id);
      setFeedback(`${label} creada en la WBS.`);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const mutateSchedule = async (
    node: ApiWbsV2Node,
    input: Parameters<typeof bridataApi.updateWorkItemScheduleV2>[1],
    message: string,
  ) => {
    setBusy(true);
    setFeedback(null);
    try {
      await bridataApi.updateWorkItemScheduleV2(node.objectId, input);
      await reload();
      setFeedback(message);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeDuration = async (node: ApiWbsV2Node, raw: string) => {
    if (!wbs || node.isSummary || node.objectTypeKey === 'MILESTONE') return;
    const days = Number(raw.replace(',', '.'));
    if (!Number.isFinite(days) || days < 0) return;
    const durationMinutes = Math.max(0, Math.round(days * wbs.minutesPerDay));
    const remainingDurationMinutes = Math.max(
      0,
      Math.round(durationMinutes * (100 - Math.max(0, Math.min(100, node.progress))) / 100),
    );
    await mutateSchedule(
      node,
      { durationMinutes, remainingDurationMinutes },
      `Duración actualizada a ${days} días laborales.`,
    );
  };

  const changeProgress = async (node: ApiWbsV2Node, raw: string) => {
    const progress = Math.max(0, Math.min(100, Math.round(Number(raw))));
    if (!Number.isFinite(progress)) return;
    setBusy(true);
    setFeedback(null);
    try {
      await updateNexusObject(node.objectId, { progress });
      if (!node.isSummary) {
        await bridataApi.updateWorkItemScheduleV2(node.objectId, {
          remainingDurationMinutes: Math.max(0, Math.round(node.durationMinutes * (100 - progress) / 100)),
        });
      }
      await reload();
      setFeedback(`Avance actualizado a ${progress}%.`);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeConstraint = async (node: ApiWbsV2Node, constraintType: ApiScheduleConstraintTypeV2) => {
    const needsDate = dateConstraintTypes.has(constraintType);
    const fallbackDate = analysisTaskById.get(node.objectId)?.plannedStart
      ?? wbs?.project.plannedStart
      ?? dateOnly(new Date());
    await mutateSchedule(
      node,
      {
        constraintType,
        constraintDate: needsDate ? (node.constraintDate ?? fallbackDate) : null,
      },
      `Restricción: ${constraintLabels[constraintType]}.`,
    );
  };

  const addPredecessor = async () => {
    if (!selected || !predecessorId || selected.isSummary) return;
    const predecessor = nodes.find((node) => node.objectId === predecessorId);
    if (!predecessor || predecessor.isSummary) return;
    setBusy(true);
    setFeedback(null);
    try {
      await createDependency({
        predecessorId,
        successorId: selected.objectId,
        dependencyType,
        lagDays,
      });
      setPredecessorId('');
      setLagDays(0);
      await reload();
      setFeedback('Predecesora agregada y sincronizada con Project Engine V2.');
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const removePredecessor = async (relationId: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await deleteDependency(relationId);
      await reload();
      setFeedback('Predecesora eliminada.');
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const completeMigration = async () => {
    if (!window.confirm('¿Completar la migración V2 de este proyecto? La operación es tenant-scoped e idempotente.')) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await bridataApi.backfillProjectEngineV2(projectId, false);
      await reload();
      const summary = result.projects[0];
      setFeedback(summary
        ? `Migración V2 completada: ${summary.workItemsCreated} actividades y ${summary.dependenciesCreated} dependencias creadas.`
        : 'Migración V2 completada.');
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const captureBaseline = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await saveProjectBaseline(projectId, true);
      setFeedback(`Línea base v${result.baselineVersion} capturada · ${result.scheduledCount} objetos.`);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!isApiMode) return <GanttView projectId={projectId} />;

  if (!apiReady || loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
        <div className="text-center">
          <RefreshCw className="mx-auto h-5 w-5 animate-spin text-green-700" />
          <p className="mt-3 text-[11px] font-bold text-slate-700">Cargando WBS + Gantt V2</p>
          <p className="mt-1 text-[9px] text-slate-400">Leyendo jerarquía, calendario y camino crítico.</p>
        </div>
      </div>
    );
  }

  if (!wbs || error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-6">
        <p className="text-[12px] font-bold text-rose-700">No se pudo cargar Project Engine V2</p>
        <p className="mt-2 text-[10px] text-slate-500">{error}</p>
        <button onClick={() => void reload()} className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-[10px] font-bold text-white">
          Reintentar
        </button>
      </div>
    );
  }

  const selectedIncoming = incomingForSelected.map((dependency) => ({
    dependency,
    predecessor: nodes.find((node) => node.objectId === dependency.targetObjectId),
  }));
  const mutating = busy || isMutationPending || isObjectMutationPending;
  const criticalCount = analysis?.criticalTaskIds.length ?? 0;
  const violationCount = analysis?.violations.length ?? 0;
  const fallbackCount = Math.max(wbs.migration.fallback, analysis?.migration.fallbackWorkItems ?? 0);

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-2xl bg-green-50 text-green-700 ring-1 ring-green-100">
              <Layers3 className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-extrabold text-slate-900">WBS + Gantt · Project Engine V2</h3>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.08em] text-emerald-700">Motor propio</span>
              </div>
              <p className="mt-0.5 text-[9px] text-slate-400">Jerarquía, CPM, calendarios laborales, constraints, lead/lag y línea base en un solo editor.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button disabled={mutating} onClick={() => void createRow('TASK', 'Nueva fase', true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[9px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <Layers3 className="h-3 w-3" /> Fase
            </button>
            <button disabled={mutating} onClick={() => void createRow('TASK', 'Nueva tarea')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[9px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <Plus className="h-3 w-3" /> Tarea
            </button>
            <button disabled={mutating} onClick={() => void createRow('MILESTONE', 'Nuevo hito', true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[9px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <Diamond className="h-3 w-3" /> Hito
            </button>
            <span className="mx-0.5 h-5 w-px bg-slate-200" />
            <button disabled={!selected || mutating} onClick={() => selected && void persistHierarchy(indentWbsNode(nodes, selected.objectId), 'Actividad indentada.')} title="Indentar" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ArrowRight className="h-3.5 w-3.5" /></button>
            <button disabled={!selected?.parentWorkItemId || mutating} onClick={() => selected && void persistHierarchy(outdentWbsNode(nodes, selected.objectId), 'Actividad desindentada.')} title="Desindentar" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ArrowLeft className="h-3.5 w-3.5" /></button>
            <button disabled={!selected || mutating} onClick={() => selected && void persistHierarchy(moveWbsNode(nodes, selected.objectId, -1), 'Actividad movida hacia arriba.')} title="Mover arriba" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button disabled={!selected || mutating} onClick={() => selected && void persistHierarchy(moveWbsNode(nodes, selected.objectId, 1), 'Actividad movida hacia abajo.')} title="Mover abajo" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
            <span className="mx-0.5 h-5 w-px bg-slate-200" />
            {/* SCH-03 · vista de columnas y filtro de red, ambos sobre datos del motor. */}
            <button
              onClick={() => setCpmView((value) => !value)}
              aria-pressed={cpmView}
              title="Columnas de análisis CPM: inicio y fin temprano y tardío, holguras"
              className={`h-8 rounded-lg border px-2.5 text-[9px] font-bold transition ${cpmView ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              CPM
            </button>
            <button
              onClick={() => setOnlyCritical((value) => !value)}
              aria-pressed={onlyCritical}
              disabled={criticalCount === 0}
              title={criticalCount === 0 ? 'Sin ruta crítica calculada' : 'Mostrar solo la ruta crítica'}
              className={`h-8 rounded-lg border px-2.5 text-[9px] font-bold transition disabled:opacity-40 ${onlyCritical ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Ruta crítica
            </button>
            <button disabled={mutating} onClick={() => setDayWidth((value) => Math.max(14, value - 4))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ZoomOut className="h-3.5 w-3.5" /></button>
            <button disabled={mutating} onClick={() => setDayWidth((value) => Math.min(52, value + 4))} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ZoomIn className="h-3.5 w-3.5" /></button>
            <button disabled={mutating} onClick={() => void reload()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-[9px] font-bold text-white hover:bg-slate-800 disabled:opacity-40"><RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Recalcular</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ['Duración', analysis ? `${analysis.projectDurationWorkingDays} d háb.` : 'Pendiente'],
            ['Camino crítico', `${criticalCount} actividades`],
            ['WBS', `${nodes.length} filas`],
            ['Fases', `${nodes.filter((node) => node.isSummary).length}`],
            ['Objetivo', shortDate(wbs.project.targetFinish)],
            ['Estado', analysis ? (analysis.feasible ? 'Factible' : `${violationCount} conflictos`) : 'Sin cálculo'],
          ].map(([label, value]) => (
            <div key={label} className="bg-white px-3 py-2.5">
              <p className="text-[7px] font-extrabold uppercase tracking-[0.13em] text-slate-400">{label}</p>
              <p className="mt-1 text-[11px] font-extrabold text-slate-800">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {(fallbackCount > 0 || analysisWarning || violationCount > 0 || feedback) && (
        <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            {fallbackCount > 0 && <p className="text-[9px] font-bold text-amber-700">{fallbackCount} elementos todavía usan fallback V1.</p>}
            {analysisWarning && <p className="text-[9px] font-semibold text-amber-700">{analysisWarning}</p>}
            {violationCount > 0 && <p className="text-[9px] font-semibold text-rose-700">El motor detectó {violationCount} conflicto(s) de programación.</p>}
            {feedback && <p className="text-[9px] font-semibold text-slate-600">{feedback}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {fallbackCount > 0 && (
              <button disabled={mutating} onClick={() => void completeMigration()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-50 px-3 text-[9px] font-bold text-amber-800 ring-1 ring-amber-200 disabled:opacity-40">
                <Sparkles className="h-3 w-3" /> Completar V2
              </button>
            )}
            <button disabled={mutating} onClick={() => void captureBaseline()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-700 disabled:opacity-40">
              <Save className="h-3 w-3" /> Nueva línea base
            </button>
          </div>
        </section>
      )}

      {selected && (
        <section className="rounded-xl border border-slate-200 bg-white px-3 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-green-50 px-2 py-1 text-[8px] font-extrabold text-green-700">WBS {selected.wbsCode}</span>
                <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400">{typeLabel(selected)}</span>
              </div>
              <button onClick={() => openObjectDrawer(selected.objectId)} className="mt-1 max-w-full truncate text-left text-[12px] font-extrabold text-slate-900 hover:text-green-800">{selected.title}</button>
            </div>

            <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
              <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 ring-1 ring-slate-100">
                <GitBranch className="h-3 w-3 text-slate-400" />
                {selectedIncoming.length === 0 && <span className="text-[8px] font-semibold text-slate-400">Sin predecesoras</span>}
                {selectedIncoming.map(({ dependency, predecessor }) => (
                  <span key={dependency.id} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[8px] font-bold text-slate-600 ring-1 ring-slate-200">
                    {predecessor?.wbsCode ?? '?'} · {dependency.dependencyType ?? 'FS'} {dependency.lagDays ? `${dependency.lagDays > 0 ? '+' : ''}${dependency.lagDays}d` : ''}
                    <button disabled={mutating} onClick={() => void removePredecessor(dependency.id)} className="text-slate-300 hover:text-rose-600"><Trash2 className="h-2.5 w-2.5" /></button>
                  </span>
                ))}
              </div>

              {!selected.isSummary && (
                <>
                  <select value={predecessorId} onChange={(event) => setPredecessorId(event.target.value)} className="h-8 max-w-[180px] rounded-lg border border-slate-200 bg-white px-2 text-[8px] font-semibold text-slate-600 outline-none">
                    <option value="">Agregar predecesora...</option>
                    {nodes.filter((node) => node.objectId !== selected.objectId && !node.isSummary).map((node) => <option key={node.objectId} value={node.objectId}>{node.wbsCode} · {node.title}</option>)}
                  </select>
                  <select value={dependencyType} onChange={(event) => setDependencyType(event.target.value as DependencyType)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[8px] font-bold text-slate-600 outline-none">
                    <option value="FS">FS</option><option value="SS">SS</option><option value="FF">FF</option><option value="SF">SF</option>
                  </select>
                  <div className="flex h-8 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
                    <input type="number" value={lagDays} onChange={(event) => setLagDays(Number(event.target.value))} className="h-full w-14 px-2 text-[8px] font-semibold outline-none" />
                    <span className="pr-2 text-[7px] font-bold text-slate-400">lag d</span>
                  </div>
                  <button disabled={!predecessorId || mutating} onClick={() => void addPredecessor()} className="grid h-8 w-8 place-items-center rounded-lg bg-green-700 text-white disabled:opacity-40"><Link2 className="h-3 w-3" /></button>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[660px] overflow-auto">
          <div style={{ width: LEFT_WIDTH + timeline.width }} className="min-w-max">
            <div className="sticky top-0 z-30 flex h-12 border-b border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04)]">
              <div style={{ width: leftWidth }} className={`sticky left-0 z-40 grid flex-shrink-0 ${columnTemplate} items-center border-r border-slate-200 bg-slate-50 px-2 text-[7px] font-extrabold uppercase tracking-[0.1em] text-slate-400`}>
                {cpmView ? (
                  <>
                    <span>WBS</span><span>Actividad</span><span>Duración</span>
                    <span title="Inicio temprano">ES</span>
                    <span title="Fin temprano">EF</span>
                    <span title="Inicio tardío">LS</span>
                    <span title="Fin tardío">LF</span>
                    <span title="Holgura total">TF</span>
                    <span title="Holgura libre">FF</span>
                    <span>Crítica</span>
                  </>
                ) : (
                  <>
                    <span>WBS</span><span>Actividad</span><span>Duración</span><span>Avance</span><span>Inicio</span><span>Fin</span><span>Holg.</span><span>Restricción</span>
                  </>
                )}
              </div>
              <div style={{ width: timeline.width }} className="relative flex-shrink-0 bg-slate-50">
                {timeline.days.map((day, index) => {
                  const monthStart = index === 0 || day.getUTCDate() === 1;
                  return (
                    <div key={day.toISOString()} style={{ left: index * timeline.dayWidth, width: timeline.dayWidth }} className="absolute inset-y-0 border-r border-slate-100 text-center">
                      {monthStart && <span className="absolute left-1 top-0 whitespace-nowrap text-[7px] font-extrabold uppercase text-slate-500">{monthLabel(day)}</span>}
                      <span className="absolute bottom-1 left-0 right-0 text-[7px] font-semibold text-slate-400">{day.getUTCDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {visibleNodes.length === 0 && (
              <div className="flex h-40 items-center justify-center text-[10px] text-slate-400">Crea la primera tarea para comenzar la WBS.</div>
            )}

            {visibleNodes.map((node) => {
              const bar = bars.get(node.objectId);
              const task = analysisTaskById.get(node.objectId);
              const selectedRow = selectedId === node.objectId;
              const isCollapsed = collapsed.has(node.objectId);
              const workingDays = wbs.minutesPerDay > 0 ? node.durationMinutes / wbs.minutesPerDay : 0;
              const incoming = projectRelations.filter((dependency) => dependency.sourceObjectId === node.objectId);
              const constraintNeedsDate = dateConstraintTypes.has(node.constraintType);
              const start = bar ? parseDate(bar.plannedStart) : null;
              const finish = bar ? parseDate(bar.plannedFinish) : null;
              const left = start ? Math.max(0, dayDistance(timeline.start, start) * timeline.dayWidth) : 0;
              const width = start && finish
                ? Math.max(8, (dayDistance(start, finish) + 1) * timeline.dayWidth)
                : 0;

              return (
                <div key={node.objectId} className={`flex border-b border-slate-100 ${selectedRow ? 'bg-green-50/30' : 'bg-white'}`} style={{ height: ROW_HEIGHT }}>
                  <div style={{ width: leftWidth }} onClick={() => setSelectedId(node.objectId)} className={`sticky left-0 z-20 grid flex-shrink-0 ${columnTemplate} items-center border-r border-slate-200 px-2 text-[8px] ${selectedRow ? 'bg-green-50' : 'bg-white'}`}>
                    <span className="font-extrabold text-slate-500">{node.wbsCode}</span>
                    <div className="flex min-w-0 items-center" style={{ paddingLeft: node.outlineLevel * 16 }}>
                      {node.isSummary ? (
                        <button onClick={(event) => { event.stopPropagation(); setCollapsed((previous) => { const next = new Set(previous); if (next.has(node.objectId)) next.delete(node.objectId); else next.add(node.objectId); return next; }); }} className="mr-1 grid h-5 w-5 flex-shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-100">
                          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      ) : node.objectTypeKey === 'MILESTONE' ? <Diamond className="mr-1.5 h-3 w-3 flex-shrink-0 text-sky-600" /> : <CircleDot className="mr-1.5 h-3 w-3 flex-shrink-0 text-slate-300" />}
                      <div className="min-w-0 flex-1">
                        <input
                          key={`${node.objectId}-${node.title}`}
                          defaultValue={node.title}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={(event) => {
                            const title = event.target.value.trim();
                            if (title && title !== node.title) void updateNexusObject(node.objectId, { title });
                          }}
                          className={`w-full truncate border-0 bg-transparent p-0 text-[9px] outline-none ${node.isSummary ? 'font-extrabold text-slate-900' : 'font-semibold text-slate-700'}`}
                        />
                        <p className="truncate text-[6.5px] font-bold uppercase tracking-[0.08em] text-slate-300">{typeLabel(node)} {incoming.length > 0 ? `· ${incoming.length} pred.` : ''}</p>
                      </div>
                    </div>
                    <div>
                      {node.isSummary ? <span className="font-bold text-slate-400">roll-up</span> : node.objectTypeKey === 'MILESTONE' ? <span className="font-bold text-sky-600">0d</span> : (
                        <input key={`${node.objectId}-${node.durationMinutes}`} defaultValue={Number(workingDays.toFixed(2))} onClick={(event) => event.stopPropagation()} onBlur={(event) => void changeDuration(node, event.target.value)} className="h-7 w-14 rounded-md border border-transparent bg-transparent px-1 text-[8px] font-bold text-slate-600 outline-none hover:border-slate-200 focus:border-green-300 focus:bg-white" />
                      )}
                    </div>
                    {cpmView ? (
                      /* SCH-03: sin cálculo en cliente — todo sale del análisis V2 del backend. */
                      <>
                        <span className="font-semibold text-slate-500">{cpmDay(task?.earlyStartMinutes, wbs.minutesPerDay)}</span>
                        <span className="font-semibold text-slate-500">{cpmDay(task?.earlyFinishMinutes, wbs.minutesPerDay)}</span>
                        <span className="font-semibold text-slate-500">{cpmDay(task?.lateStartMinutes, wbs.minutesPerDay)}</span>
                        <span className="font-semibold text-slate-500">{cpmDay(task?.lateFinishMinutes, wbs.minutesPerDay)}</span>
                        <span className={`font-bold ${floatTone(task?.totalFloatWorkingDays, task?.critical)}`}>{node.isSummary || !task ? '—' : `${task.totalFloatWorkingDays}d`}</span>
                        <span className="font-bold text-slate-400">{node.isSummary || !task ? '—' : `${task.freeFloatWorkingDays}d`}</span>
                        <span>
                          {node.isSummary || !task ? <span className="text-slate-300">—</span>
                            : task.critical ? <span className="rounded bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700">Crítica</span>
                            : task.totalFloatWorkingDays <= NEAR_CRITICAL_DAYS ? <span className="rounded bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">Casi</span>
                            : <span className="text-slate-300">—</span>}
                        </span>
                      </>
                    ) : (
                      <>
                        <div><input key={`${node.objectId}-${node.progress}`} defaultValue={node.progress} type="number" min={0} max={100} onClick={(event) => event.stopPropagation()} onBlur={(event) => void changeProgress(node, event.target.value)} className="h-7 w-12 rounded-md border border-transparent bg-transparent px-1 text-[8px] font-bold text-slate-600 outline-none hover:border-slate-200 focus:border-green-300 focus:bg-white" /></div>
                        <span className="font-semibold text-slate-500">{shortDate(bar?.plannedStart)}</span>
                        <span className="font-semibold text-slate-500">{shortDate(bar?.plannedFinish)}</span>
                        <span className={`font-bold ${task?.critical ? 'text-rose-600' : 'text-slate-400'}`}>{node.isSummary ? '—' : task ? `${task.totalFloatWorkingDays}d` : '—'}</span>
                        <div className="flex min-w-0 flex-col gap-0.5 pr-1">
                          <select value={node.constraintType} disabled={node.isSummary || mutating} onClick={(event) => event.stopPropagation()} onChange={(event) => void changeConstraint(node, event.target.value as ApiScheduleConstraintTypeV2)} className="h-6 w-full rounded-md border border-transparent bg-transparent text-[7px] font-semibold text-slate-500 outline-none hover:border-slate-200 disabled:opacity-50">
                            {Object.entries(constraintLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                          {constraintNeedsDate && !node.isSummary && (
                            <input type="date" value={node.constraintDate ?? ''} onClick={(event) => event.stopPropagation()} onChange={(event) => void mutateSchedule(node, { constraintDate: event.target.value || null }, 'Fecha de restricción actualizada.')} className="h-5 w-full border-0 bg-transparent text-[6.5px] text-slate-400 outline-none" />
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ width: timeline.width }} className="relative flex-shrink-0 bg-white">
                    {timeline.days.map((day, index) => {
                      const isWorking = analysis?.calendar.workingWeekdays.includes(day.getUTCDay()) ?? true;
                      return <div key={index} style={{ left: index * timeline.dayWidth, width: timeline.dayWidth }} className={`absolute inset-y-0 border-r border-slate-50 ${isWorking ? '' : 'bg-slate-50/70'}`} />;
                    })}
                    {bar && start && finish && node.objectTypeKey === 'MILESTONE' && !node.isSummary ? (
                      <div style={{ left: left + Math.max(0, timeline.dayWidth / 2 - 5), top: 17 }} className={`absolute h-2.5 w-2.5 rotate-45 rounded-[1px] ${bar.critical ? 'bg-rose-600' : 'bg-sky-600'}`} />
                    ) : bar && start && finish ? (
                      <div style={{ left, width, top: node.isSummary ? 16 : 13, height: node.isSummary ? 12 : 18 }} className={`absolute overflow-hidden rounded-md ${node.isSummary ? 'bg-slate-800' : bar.critical ? 'bg-rose-500' : 'bg-green-600'} shadow-sm`} title={`${node.title} · ${bar.plannedStart} → ${bar.plannedFinish}`}>
                        {!node.isSummary && <div className="h-full bg-white/20" style={{ width: `${Math.max(0, Math.min(100, node.progress))}%` }} />}
                        {node.isSummary && <><span className="absolute left-0 top-0 h-full w-1 bg-slate-950" /><span className="absolute right-0 top-0 h-full w-1 bg-slate-950" /></>}
                      </div>
                    ) : null}
                    {wbs.project.targetFinish && parseDate(wbs.project.targetFinish) && (
                      <div style={{ left: dayDistance(timeline.start, parseDate(wbs.project.targetFinish)!) * timeline.dayWidth }} className="absolute inset-y-0 w-px bg-amber-400/70" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2 text-[7.5px] font-semibold text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-green-600" /> Programado</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-rose-500" /> Camino crítico</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-slate-800" /> Fase / resumen</span>
            <span className="inline-flex items-center gap-1"><Diamond className="h-2.5 w-2.5 text-sky-600" /> Hito</span>
          </div>
          <span>Resolución: minutos laborales agrupados por fecha · {analysis?.calendar.timezone ?? 'UTC'}</span>
        </div>
      </section>

      {analysis && analysis.violations.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
          <div className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-rose-600" /><p className="text-[9px] font-extrabold text-rose-700">Conflictos detectados por Project Engine V2</p></div>
          <div className="mt-2 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
            {analysis.violations.map((violation, index) => (
              <div key={`${violation.type}-${index}`} className="rounded-lg bg-white px-2 py-1.5 text-[8px] font-semibold text-slate-600 ring-1 ring-rose-100">{violation.type}{violation.taskId ? ` · WBS ${nodes.find((node) => node.objectId === violation.taskId)?.wbsCode ?? violation.taskId}` : ''}</div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
