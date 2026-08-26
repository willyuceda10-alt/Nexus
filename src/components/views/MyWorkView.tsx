import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  FolderKanban,
  Gauge,
  ListTodo,
  Play,
  Search,
  ShieldAlert,
  Target,
} from 'lucide-react';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { useScheduling } from '../../context/SchedulingContext';
import {
  buildMyWorkProjection,
  type MyWorkBucket,
  type MyWorkItem,
} from '../../domain/myWork';
import type { ObjectStatus, Priority } from '../../types/nexus';

type WorkFilter = 'ALL' | MyWorkBucket | 'BLOCKED';

const FILTERS: Array<{ id: WorkFilter; label: string }> = [
  { id: 'ALL', label: 'Todo' },
  { id: 'OVERDUE', label: 'Vencido' },
  { id: 'TODAY', label: 'Hoy' },
  { id: 'NEXT_7_DAYS', label: 'Próximos 7 días' },
  { id: 'BLOCKED', label: 'Bloqueado' },
  { id: 'UNSCHEDULED', label: 'Sin fecha' },
  { id: 'LATER', label: 'Más adelante' },
];

const BUCKET_META: Record<MyWorkBucket, { label: string; description: string; className: string }> = {
  OVERDUE: {
    label: 'Vencido',
    description: 'Requiere atención inmediata',
    className: 'bg-rose-50 text-rose-700 ring-rose-200',
  },
  TODAY: {
    label: 'Hoy',
    description: 'Compromisos con vencimiento hoy',
    className: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  NEXT_7_DAYS: {
    label: 'Próximos 7 días',
    description: 'Trabajo que vence durante la siguiente semana',
    className: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  LATER: {
    label: 'Más adelante',
    description: 'Trabajo planificado fuera de la ventana inmediata',
    className: 'bg-slate-100 text-slate-600 ring-slate-200',
  },
  UNSCHEDULED: {
    label: 'Sin fecha',
    description: 'Trabajo pendiente de calendarización',
    className: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
};

const STATUS_LABEL: Partial<Record<ObjectStatus, string>> = {
  DRAFT: 'Borrador',
  PLANNING: 'Planificación',
  IN_PROGRESS: 'En progreso',
  IN_REVIEW: 'En revisión',
  BLOCKED: 'Bloqueado',
  PENDING_APPROVAL: 'Pendiente aprobación',
};

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shortDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
}

function priorityTone(priority: Priority): string {
  if (priority === 'CRITICAL') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (priority === 'HIGH') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (priority === 'MEDIUM') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

function priorityLabel(priority: Priority): string {
  return priority === 'CRITICAL' ? 'Crítica' : priority === 'HIGH' ? 'Alta' : priority === 'MEDIUM' ? 'Media' : 'Baja';
}

function typeLabel(type: MyWorkItem['type']): string {
  if (type === 'DELIVERABLE') return 'Entregable';
  if (type === 'MILESTONE') return 'Hito';
  return 'Tarea';
}

function daysLabel(item: MyWorkItem): string {
  if (item.daysUntilDue === null) return 'Sin fecha';
  if (item.daysUntilDue < 0) return `${Math.abs(item.daysUntilDue)} d vencido`;
  if (item.daysUntilDue === 0) return 'Vence hoy';
  if (item.daysUntilDue === 1) return 'Vence mañana';
  return `Vence en ${item.daysUntilDue} d`;
}

export const MyWorkView: React.FC = () => {
  const { dataMode } = useApiBootstrap();
  const {
    objects,
    currentUser,
    currentWorkspace,
    objectDataStatus,
    objectDataError,
    isObjectMutationPending,
    openObjectDrawer,
    openCreateModal,
    updateNexusObject,
    setSelectedProjectId,
    setActiveTab,
  } = useNexus();
  const { dependencies, status: schedulingStatus, error: schedulingError } = useScheduling();
  const [filter, setFilter] = useState<WorkFilter>('ALL');
  const [query, setQuery] = useState('');
  const [pendingObjectId, setPendingObjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const today = localDateKey();
  const workspaceObjects = useMemo(
    () => currentWorkspace ? objects.filter((object) => object.workspaceId === currentWorkspace.id) : objects,
    [currentWorkspace, objects],
  );
  const workspaceDependencies = useMemo(() => {
    const ids = new Set(workspaceObjects.map((object) => object.id));
    return dependencies.filter(
      (dependency) => ids.has(dependency.sourceObjectId) && ids.has(dependency.targetObjectId),
    );
  }, [dependencies, workspaceObjects]);

  const projection = useMemo(
    () => buildMyWorkProjection(workspaceObjects, workspaceDependencies, currentUser.id, today),
    [currentUser.id, today, workspaceDependencies, workspaceObjects],
  );

  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  const visibleItems = useMemo(
    () => projection.items.filter((item) => {
      if (filter === 'BLOCKED' && !item.blocked) return false;
      if (filter !== 'ALL' && filter !== 'BLOCKED' && item.bucket !== filter) return false;
      if (!normalizedQuery) return true;
      return [item.title, item.projectTitle, item.status, item.priority]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('es').includes(normalizedQuery));
    }),
    [filter, normalizedQuery, projection.items],
  );

  const visibleByBucket = useMemo(() => {
    const groups: Record<MyWorkBucket, MyWorkItem[]> = {
      OVERDUE: [], TODAY: [], NEXT_7_DAYS: [], LATER: [], UNSCHEDULED: [],
    };
    for (const item of visibleItems) groups[item.bucket].push(item);
    return groups;
  }, [visibleItems]);

  const changeStatus = async (item: MyWorkItem, status: ObjectStatus, progress: number) => {
    if (item.blocked) return;
    setPendingObjectId(item.objectId);
    setActionError(null);
    try {
      await updateNexusObject(item.objectId, { status, progress });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo actualizar la actividad.');
    } finally {
      setPendingObjectId(null);
    }
  };

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveTab('project');
  };

  const loading = objectDataStatus === 'loading' || schedulingStatus === 'loading';
  const error = actionError || objectDataError || schedulingError;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-green-800 ring-1 ring-green-100">
              Ejecución personal
            </span>
            <span className="text-[11px] font-medium text-slate-400">
              {dataMode === 'mock' ? 'Preview demo' : 'Datos API'} · {currentWorkspace?.name ?? 'Workspace'}
            </span>
          </div>
          <h1 className="text-[27px] font-extrabold tracking-[-0.03em] text-slate-950">Mi trabajo</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">
            Prioriza tus compromisos por vencimiento, dependencia y esfuerzo. La vista deriva los datos de proyectos y actividades existentes; no mantiene una lista paralela.
          </p>
        </div>

        <button
          onClick={() => openCreateModal('TASK')}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-green-800"
        >
          <ListTodo className="h-4 w-4" /> Nueva tarea
        </button>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] font-semibold text-rose-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="command-kpi-card">
          <ListTodo className="h-4 w-4 text-green-700" />
          <p className="mt-3 text-[27px] font-extrabold text-slate-950">{projection.summary.total}</p>
          <p className="text-[10px] text-slate-500">actividades personales abiertas</p>
        </div>
        <div className="command-kpi-card">
          <Clock3 className="h-4 w-4 text-rose-600" />
          <p className="mt-3 text-[27px] font-extrabold text-slate-950">{projection.summary.overdue}</p>
          <p className="text-[10px] text-slate-500">vencidas · {projection.summary.today} vencen hoy</p>
        </div>
        <div className="command-kpi-card">
          <CalendarDays className="h-4 w-4 text-sky-600" />
          <p className="mt-3 text-[27px] font-extrabold text-slate-950">{projection.summary.next7Days}</p>
          <p className="text-[10px] text-slate-500">vencen en los próximos 7 días</p>
        </div>
        <div className="command-kpi-card">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <p className="mt-3 text-[27px] font-extrabold text-slate-950">{projection.summary.blocked}</p>
          <p className="text-[10px] text-slate-500">bloqueadas por predecesores abiertos</p>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <div className="command-panel px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Carga próxima declarada</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-[24px] font-extrabold text-slate-950">{projection.summary.effortDueSoonHours}h</span>
                <span className="text-[10px] text-slate-400">con vencimiento hoy / 7 días</span>
              </div>
            </div>
            <Gauge className="h-5 w-5 text-green-700" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px]">
            <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-semibold text-slate-600 ring-1 ring-slate-200">
              Capacidad base: {projection.summary.capacityHoursPerDay === null ? 'sin perfil' : `${projection.summary.capacityHoursPerDay}h/día`}
            </span>
            <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-semibold text-slate-600 ring-1 ring-slate-200">
              {projection.summary.unsized} sin esfuerzo estimado
            </span>
            <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-semibold text-slate-600 ring-1 ring-slate-200">
              {projection.summary.unscheduled} sin fecha
            </span>
          </div>
        </div>

        <div className="command-panel px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Criterio de foco</p>
              <p className="mt-2 text-[13px] font-extrabold text-slate-900">Vencimiento → bloqueo → prioridad</p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">
                Bridata ordena primero lo vencido y urgente, y marca dependencias abiertas antes de permitir el cierre rápido.
              </p>
            </div>
            <Target className="h-5 w-5 text-sky-600" />
          </div>
        </div>
      </section>

      {projection.ownedProjects.length > 0 && (
        <section className="command-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-extrabold text-slate-900">Proyectos que lidero</h2>
              <p className="mt-0.5 text-[9px] text-slate-400">Seguimiento ejecutivo, separado de tus actividades asignadas</p>
            </div>
            <FolderKanban className="h-4 w-4 text-green-700" />
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {projection.ownedProjects.slice(0, 6).map((project) => (
              <button
                key={project.id}
                onClick={() => openProject(project.id)}
                className="group rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-green-200 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className={`inline-flex rounded-md px-2 py-1 text-[8px] font-bold uppercase ring-1 ${priorityTone(project.priority)}`}>
                      {priorityLabel(project.priority)}
                    </span>
                    <p className="mt-2 line-clamp-2 text-[12px] font-bold leading-5 text-slate-900">{project.title}</p>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5" />
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.max(0, Math.min(100, project.progress))}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[9px] font-medium text-slate-400">
                  <span>{project.progress}% completado</span>
                  <span>{shortDate(project.endDate)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="command-panel overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-[13px] font-extrabold text-slate-900">Prioridad de ejecución</h2>
              <p className="mt-0.5 text-[9px] text-slate-400">{visibleItems.length} de {projection.summary.total} actividades visibles</p>
            </div>
            <div className="relative w-full lg:w-[280px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar tarea o proyecto..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-[11px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-green-300 focus:ring-2 focus:ring-green-100"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                onClick={() => setFilter(item.id)}
                className={`rounded-lg px-2.5 py-1.5 text-[9px] font-bold transition-colors ${
                  filter === item.id
                    ? 'bg-green-700 text-white'
                    : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="border-b border-slate-100 px-5 py-3 text-[10px] font-medium text-slate-400">Actualizando trabajo y dependencias…</div>
        )}

        <div className="divide-y divide-slate-100">
          {(Object.keys(BUCKET_META) as MyWorkBucket[]).map((bucket) => {
            const items = visibleByBucket[bucket];
            if (items.length === 0) return null;
            const meta = BUCKET_META[bucket];
            return (
              <div key={bucket}>
                <div className="flex items-center justify-between bg-slate-50/70 px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase ring-1 ${meta.className}`}>{meta.label}</span>
                    <span className="text-[9px] text-slate-400">{meta.description}</span>
                  </div>
                  <span className="text-[9px] font-bold text-slate-400">{items.length}</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const pending = pendingObjectId === item.objectId;
                    const canStart = ['DRAFT', 'PLANNING'].includes(item.status) && !item.blocked;
                    const canComplete = !item.blocked;
                    return (
                      <div key={item.objectId} className="grid gap-3 px-5 py-4 transition-colors hover:bg-slate-50/60 lg:grid-cols-[minmax(0,1.8fr)_140px_120px_170px] lg:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-md px-2 py-1 text-[8px] font-bold uppercase ring-1 ${priorityTone(item.priority)}`}>{priorityLabel(item.priority)}</span>
                            <span className="text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400">{typeLabel(item.type)}</span>
                            {item.blocked && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[8px] font-bold text-rose-700 ring-1 ring-rose-200">
                                <ShieldAlert className="h-3 w-3" /> Bloqueada
                              </span>
                            )}
                          </div>
                          <button onClick={() => openObjectDrawer(item.objectId)} className="mt-2 block max-w-full text-left text-[12px] font-bold leading-5 text-slate-900 hover:text-green-800">
                            {item.title}
                          </button>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-slate-400">
                            {item.projectTitle && item.projectId ? (
                              <button onClick={() => openProject(item.projectId!)} className="font-semibold text-slate-500 hover:text-green-700">{item.projectTitle}</button>
                            ) : <span>Sin proyecto</span>}
                            {item.blocked && <span className="text-rose-600">Espera: {item.blockerTitles.join(', ')}</span>}
                          </div>
                        </div>

                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400">Estado</p>
                          <p className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                            <CircleDot className="h-3 w-3 text-green-600" /> {STATUS_LABEL[item.status] ?? item.status}
                          </p>
                          <div className="mt-2 h-1 w-full max-w-[110px] overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} />
                          </div>
                        </div>

                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400">Vencimiento</p>
                          <p className={`mt-1 text-[10px] font-bold ${item.bucket === 'OVERDUE' ? 'text-rose-700' : item.bucket === 'TODAY' ? 'text-amber-700' : 'text-slate-700'}`}>
                            {daysLabel(item)}
                          </p>
                          <p className="mt-0.5 text-[9px] text-slate-400">{shortDate(item.endDate)} · {item.effortHours === undefined ? 'sin esfuerzo' : `${item.effortHours}h`}</p>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                          {canStart && (
                            <button
                              disabled={pending || isObjectMutationPending}
                              onClick={() => void changeStatus(item, 'IN_PROGRESS', Math.max(item.progress, 1))}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[9px] font-bold text-slate-600 transition-colors hover:border-green-200 hover:text-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Play className="h-3 w-3" /> Iniciar
                            </button>
                          )}
                          <button
                            disabled={!canComplete || pending || isObjectMutationPending}
                            title={item.blocked ? 'Resuelve primero las dependencias abiertas.' : 'Marcar como completada'}
                            onClick={() => void changeStatus(item, 'COMPLETED', 100)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-2.5 py-2 text-[9px] font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Completar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {visibleItems.length === 0 && (
            <div className="grid min-h-[260px] place-items-center px-6 py-12 text-center">
              <div>
                <CheckCircle2 className="mx-auto h-8 w-8 text-green-600" />
                <h3 className="mt-3 text-[13px] font-extrabold text-slate-900">Sin trabajo en este filtro</h3>
                <p className="mx-auto mt-1 max-w-md text-[10px] leading-5 text-slate-500">
                  {projection.summary.total === 0
                    ? 'No tienes tareas, entregables o hitos abiertos asignados en este workspace.'
                    : 'Cambia el filtro o la búsqueda para ver otras actividades.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
