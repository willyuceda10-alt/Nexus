import React, { useEffect, useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Columns3,
  Database,
  FolderKanban,
  Layers3,
  PackageSearch,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
} from 'lucide-react';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { workspaceSummaryV1Api, type WorkspaceSummaryV1 } from '../../api/workspaceSummaryV1Client';

function formatDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
}

function displayWorkspaceName(name?: string): string {
  return (name || 'Espacio de trabajo').replace(/\s+Structural$/i, '');
}

function healthTone(score: number): { label: string; cell: string; dot: string } {
  if (score >= 80) return { label: 'En control', cell: 'bg-emerald-500 text-white', dot: 'bg-emerald-500' };
  if (score >= 65) return { label: 'Atención', cell: 'bg-amber-400 text-amber-950', dot: 'bg-amber-400' };
  return { label: 'Crítico', cell: 'bg-rose-500 text-white', dot: 'bg-rose-500' };
}

function priorityTone(priority?: string): string {
  if (priority === 'CRITICAL') return 'bg-rose-100 text-rose-700';
  if (priority === 'HIGH') return 'bg-orange-100 text-orange-700';
  if (priority === 'MEDIUM') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function priorityLabel(priority?: string): string {
  switch (priority) {
    case 'CRITICAL': return 'Crítica';
    case 'HIGH': return 'Alta';
    case 'MEDIUM': return 'Media';
    case 'LOW': return 'Baja';
    default: return 'Normal';
  }
}

function objectTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    TASK: 'Tarea',
    RISK: 'Riesgo',
    DELIVERABLE: 'Entregable',
    MILESTONE: 'Hito',
    DECISION: 'Decisión',
    CHANGE_REQUEST: 'Cambio',
    INCIDENT: 'Incidente',
    DOCUMENT: 'Documento',
    MEETING: 'Reunión',
    PROJECT: 'Proyecto',
  };
  return labels[type] ?? type.replaceAll('_', ' ');
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Borrador',
    PLANNING: 'Planificación',
    IN_PROGRESS: 'En progreso',
    IN_REVIEW: 'En revisión',
    BLOCKED: 'Bloqueado',
    COMPLETED: 'Completado',
    CANCELLED: 'Cancelado',
    IDENTIFIED: 'Identificado',
    MITIGATING: 'Mitigando',
    REALIZED: 'Materializado',
    CLOSED: 'Cerrado',
    PENDING_APPROVAL: 'Pendiente de aprobación',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

type HomeTab = 'overview' | 'content' | 'recent';
type ProjectFilter = 'ALL' | 'CRITICAL' | 'BLOCKED' | 'OVERDUE';

export const WorkspaceHome: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const {
    tenant,
    currentWorkspace,
    currentUser,
    objects,
    approvals,
    objectDataStatus,
    openObjectDrawer,
    openCreateModal,
    setSelectedProjectId,
    setActiveTab,
    setProjectActiveSubTab,
    getProjectHealth,
  } = useNexus();

  const [homeTab, setHomeTab] = useState<HomeTab>('overview');
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('ALL');
  const [serverSummary, setServerSummary] = useState<WorkspaceSummaryV1 | null>(null);
  const [workspaceFavorite, setWorkspaceFavorite] = useState(false);

  const workspaceObjects = useMemo(
    () => (currentWorkspace ? objects.filter((object) => object.workspaceId === currentWorkspace.id) : objects),
    [currentWorkspace, objects],
  );

  const workspaceRole = useMemo(() => {
    if (!currentWorkspace || !apiBootstrap.bootstrap) return null;
    return apiBootstrap.bootstrap.workspaces.find((workspace) => workspace.id === currentWorkspace.id)?.role ?? null;
  }, [apiBootstrap.bootstrap, currentWorkspace]);

  const tenantRole = apiBootstrap.bootstrap?.actor.role ?? null;
  const isExecutiveAudience = apiBootstrap.dataMode === 'api'
    ? ['PMO_SENIOR', 'OWNER', 'ADMIN'].includes(workspaceRole ?? '') || ['OWNER', 'TENANT_ADMIN'].includes(tenantRole ?? '')
    : ['SUPER_ADMIN', 'OWNER', 'ADMIN'].includes(currentUser.roleKey);
  const isPmoSenior = workspaceRole === 'PMO_SENIOR';

  const projects = workspaceObjects.filter((object) => object.type === 'PROJECT');
  const activeProjects = projects.filter((project) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(project.status));
  const tasks = workspaceObjects.filter((object) => object.type === 'TASK');
  const openTasks = tasks.filter((task) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(task.status));
  const myTasks = openTasks.filter((task) => task.assigneeId === currentUser.id || task.ownerId === currentUser.id);
  const blockedItems = workspaceObjects.filter((object) => object.status === 'BLOCKED');
  const criticalRisks = workspaceObjects.filter(
    (object) => object.type === 'RISK' && ((object.riskScore || 0) >= 15 || object.priority === 'CRITICAL'),
  );
  const localAttentionCount = new Set([...blockedItems, ...criticalRisks].map((object) => object.id)).size;
  const workspaceObjectIds = new Set(workspaceObjects.map((object) => object.id));
  const pendingApprovals = approvals.filter((approval) => approval.status === 'PENDING' && workspaceObjectIds.has(approval.objectId));
  const averageProgress = activeProjects.length
    ? Math.round(activeProjects.reduce((sum, project) => sum + project.progress, 0) / activeProjects.length)
    : 0;

  useEffect(() => {
    setServerSummary(null);
    if (!currentWorkspace || apiBootstrap.dataMode !== 'api' || apiBootstrap.status !== 'ready') return;
    const controller = new AbortController();
    void workspaceSummaryV1Api.get(currentWorkspace.id, controller.signal)
      .then((summary) => {
        if (!controller.signal.aborted) setServerSummary(summary);
      })
      .catch(() => {
        if (!controller.signal.aborted) setServerSummary(null);
      });
    return () => controller.abort();
  }, [apiBootstrap.dataMode, apiBootstrap.status, currentWorkspace]);

  useEffect(() => {
    if (!currentWorkspace) {
      setWorkspaceFavorite(false);
      return;
    }
    try {
      setWorkspaceFavorite(localStorage.getItem(`bridata.workspace.favorite.${currentUser.id}.${currentWorkspace.id}`) === '1');
    } catch {
      setWorkspaceFavorite(false);
    }
  }, [currentUser.id, currentWorkspace]);

  const toggleWorkspaceFavorite = () => {
    if (!currentWorkspace) return;
    const next = !workspaceFavorite;
    setWorkspaceFavorite(next);
    try {
      const key = `bridata.workspace.favorite.${currentUser.id}.${currentWorkspace.id}`;
      if (next) localStorage.setItem(key, '1'); else localStorage.removeItem(key);
    } catch {
      // Personal UI preference is best-effort and must never block the workspace.
    }
  };

  const upcomingItems = workspaceObjects
    .filter(
      (object) =>
        object.endDate &&
        !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(object.status) &&
        ['TASK', 'MILESTONE', 'DELIVERABLE'].includes(object.type),
    )
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''))
    .slice(0, 6);

  const attentionItems = workspaceObjects
    .filter((object) => object.status === 'BLOCKED' || object.priority === 'CRITICAL')
    .filter((object) => object.type !== 'PROJECT')
    .slice(0, 5);

  const today = new Date().toISOString().slice(0, 10);
  const filteredProjects = activeProjects.filter((project) => {
    const matchesQuery = `${project.title} ${project.description || ''}`.toLowerCase().includes(query.trim().toLowerCase());
    if (!matchesQuery) return false;
    if (projectFilter === 'CRITICAL') return project.priority === 'CRITICAL';
    if (projectFilter === 'BLOCKED') return project.status === 'BLOCKED';
    if (projectFilter === 'OVERDUE') return Boolean(project.endDate && project.endDate < today);
    return true;
  });

  const exactActiveProjects = serverSummary?.projects.active ?? activeProjects.length;
  const exactAverageProgress = serverSummary?.projects.averageProgress ?? averageProgress;
  const exactMyWork = serverSummary?.work.mine ?? myTasks.length;
  const exactAttention = serverSummary?.work.attention ?? localAttentionCount;
  const exactCriticalRisks = serverSummary?.risk.critical ?? criticalRisks.length;
  const exactPendingApprovals = serverSummary?.approvals.pending ?? pendingApprovals.length;
  const browserViewIsPartial = Boolean(
    serverSummary
      && objectDataStatus === 'ready'
      && serverSummary.totalObjects > workspaceObjects.length,
  );

  const openProject = (projectId: string, subTab = 'summary') => {
    setSelectedProjectId(projectId);
    setProjectActiveSubTab(subTab);
    setActiveTab('project');
  };

  const moduleCards = [
    { id: 'projects', label: 'Proyectos', detail: `${exactActiveProjects} activos`, icon: FolderKanban },
    { id: 'boards', label: 'Tableros', detail: 'Gestión visual', icon: Columns3 },
    { id: 'portfolios', label: 'Portafolios', detail: 'Vista ejecutiva', icon: Layers3 },
    { id: 'sap', label: 'Centro SAP', detail: 'Cadena SAP', icon: Database },
    { id: 'materials', label: 'Materiales', detail: 'Stock y demanda', icon: PackageSearch },
  ];

  const summaryMetrics = isExecutiveAudience
    ? [
        { label: 'Proyectos activos', value: exactActiveProjects, hint: 'Portafolio en ejecución' },
        { label: 'Avance portafolio', value: `${exactAverageProgress}%`, hint: 'Promedio de proyectos activos' },
        { label: 'Desviaciones críticas', value: exactAttention, hint: `${exactCriticalRisks} riesgos críticos` },
        { label: 'Decisiones pendientes', value: exactPendingApprovals, hint: 'Aprobaciones por resolver' },
      ]
    : [
        { label: 'Mi trabajo', value: exactMyWork, hint: 'Elementos abiertos' },
        { label: 'Proyectos activos', value: exactActiveProjects, hint: `${exactAverageProgress}% avance promedio` },
        { label: 'Requieren atención', value: exactAttention, hint: `${exactCriticalRisks} riesgos críticos` },
        { label: 'Próximos vencimientos', value: upcomingItems.length, hint: 'Elementos con fecha objetivo' },
      ];

  return (
    <div className="mx-auto w-full max-w-[1640px] px-4 py-4 sm:px-5 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 pb-0 pt-4">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="truncate">{tenant.name}</span>
            <ChevronRight className="h-3 w-3" />
            <span>Workspace</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <h1 className="truncate text-xl font-bold tracking-[-0.025em] text-slate-950">{displayWorkspaceName(currentWorkspace?.name)}</h1>
            <button
              onClick={toggleWorkspaceFavorite}
              className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-slate-100 hover:text-amber-500 ${workspaceFavorite ? 'text-amber-500' : 'text-slate-400'}`}
              aria-label={workspaceFavorite ? 'Quitar workspace de favoritos' : 'Marcar workspace como favorito'}
              aria-pressed={workspaceFavorite}
            >
              <Star className={`h-4 w-4 ${workspaceFavorite ? 'fill-amber-400' : ''}`} />
            </button>
            {isPmoSenior && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">
                <ShieldCheck className="h-3 w-3" /> PMO Senior
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-slate-500">Organiza proyectos, tableros, operación SAP y decisiones desde un solo espacio.</p>
        </div>

        <div className="mt-3 flex items-center gap-1 border-b border-slate-200 px-5" role="tablist" aria-label="Secciones del workspace">
          {([
            ['overview', 'Resumen'],
            ['content', 'Contenido'],
            ['recent', 'Recientes'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={homeTab === id}
              aria-controls={`workspace-home-${id}`}
              id={`workspace-home-tab-${id}`}
              onClick={() => setHomeTab(id)}
              className={`relative px-3 py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 ${homeTab === id ? 'text-[#07883F]' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {label}
              {homeTab === id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#07883F]" />}
            </button>
          ))}
        </div>

        {homeTab === 'overview' && (
          <div className="p-4 sm:p-5" role="tabpanel" id="workspace-home-overview" aria-labelledby="workspace-home-tab-overview">
            {browserViewIsPartial && serverSummary && (
              <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800" role="status">
                <strong>Vista operativa parcial:</strong> el navegador materializó {workspaceObjects.length.toLocaleString('es-PE')} de {serverSummary.totalObjects.toLocaleString('es-PE')} objetos. Los KPIs de esta cabecera siguen siendo exactos porque se calculan en PostgreSQL.
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {summaryMetrics.map((metric) => <SummaryMetric key={metric.label} {...metric} />)}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_360px]">
              <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-1 rounded-full bg-[#07883F]" />
                    <div>
                      <h2 className="text-sm font-bold text-slate-950">Proyectos activos</h2>
                      <p className="text-xs text-slate-500">{filteredProjects.length} visibles · {exactActiveProjects} totales</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex h-9 min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-400 focus-within:border-green-300 sm:w-[220px]">
                      <Search className="h-3.5 w-3.5" />
                      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar proyecto" className="w-full bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400" />
                    </label>
                    <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-500">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span className="sr-only">Filtrar proyectos</span>
                      <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value as ProjectFilter)} className="bg-transparent text-xs font-semibold text-slate-600 outline-none">
                        <option value="ALL">Todos</option>
                        <option value="CRITICAL">Críticos</option>
                        <option value="BLOCKED">Bloqueados</option>
                        <option value="OVERDUE">Vencidos</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[780px]">
                    <div className="grid grid-cols-[minmax(280px,1.4fr)_130px_160px_120px_105px_28px] items-center gap-2 border-b border-slate-200 bg-[#F7F8FA] px-4 py-2 text-xs font-semibold text-slate-500">
                      <span>Proyecto</span>
                      <span className="text-center">Estado</span>
                      <span>Avance</span>
                      <span className="text-center">Prioridad</span>
                      <span className="text-center">Fecha objetivo</span>
                      <span />
                    </div>

                    <div className="divide-y divide-slate-100">
                      {filteredProjects.map((project) => {
                        const health = getProjectHealth(project.id);
                        const tone = healthTone(health.healthScore);
                        return (
                          <button key={project.id} onClick={() => openProject(project.id)} className="grid w-full grid-cols-[minmax(280px,1.4fr)_130px_160px_120px_105px_28px] items-center gap-2 px-4 py-2.5 text-left transition hover:bg-[#F8FBF9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500">
                            <div className="min-w-0 border-l-4 border-[#07883F] pl-3">
                              <p className="truncate text-[13px] font-semibold text-slate-900">{project.title}</p>
                              <p className="mt-0.5 truncate text-xs text-slate-500" title={project.description || 'Sin descripción'}>{project.description || 'Sin descripción'}</p>
                            </div>
                            <div className={`mx-auto w-[108px] rounded-md px-2 py-1.5 text-center text-xs font-semibold ${tone.cell}`}>{tone.label}</div>
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#00A859]" style={{ width: `${Math.min(100, project.progress)}%` }} /></div>
                              <span className="w-8 text-right text-xs font-semibold text-slate-600">{project.progress}%</span>
                            </div>
                            <div className={`mx-auto rounded-md px-2 py-1 text-center text-[11px] font-semibold ${priorityTone(project.priority)}`}>{priorityLabel(project.priority)}</div>
                            <span className="text-center text-xs font-medium text-slate-600">{formatDate(project.endDate)}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                          </button>
                        );
                      })}
                    </div>

                    {filteredProjects.length === 0 && <div className="px-4 py-10 text-center text-xs text-slate-400">No hay proyectos que coincidan con la búsqueda y el filtro.</div>}

                    <button onClick={() => openCreateModal('PROJECT')} className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-[#07883F]">
                      <Plus className="h-3.5 w-3.5" /> Agregar proyecto
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <CompactPanel title="Necesita atención" icon={<CircleAlert className="h-4 w-4 text-amber-500" />} actionLabel="Ver todo" onAction={() => setActiveTab('governance')}>
                  {attentionItems.length === 0 ? (
                    <EmptyState icon={<CheckCircle2 className="h-4 w-4" />} title="Todo bajo control" detail="No hay alertas críticas abiertas en los elementos cargados." />
                  ) : attentionItems.map((item) => (
                    <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-amber-50/60">
                      <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-amber-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-900">{item.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">{objectTypeLabel(item.type)}</span>
                          <span>{statusLabel(item.status)}</span>
                          <span>·</span>
                          <span>{formatDate(item.endDate)}</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </CompactPanel>

                <CompactPanel title="Próximos vencimientos" icon={<CalendarDays className="h-4 w-4 text-[#07883F]" />} actionLabel="Ver todo" onAction={() => setActiveTab('calendar')}>
                  {upcomingItems.slice(0, 5).map((item) => (
                    <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-slate-50">
                      <div className="grid h-7 w-7 flex-none place-items-center rounded-md bg-slate-100 text-slate-500"><Clock3 className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-800">{item.title}</p><p className="mt-0.5 text-xs text-slate-500">{objectTypeLabel(item.type)} · {formatDate(item.endDate)}</p></div>
                    </button>
                  ))}
                  {upcomingItems.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">Sin vencimientos próximos.</p>}
                </CompactPanel>
              </div>
            </div>
          </div>
        )}

        {homeTab === 'content' && (
          <div className="p-5" role="tabpanel" id="workspace-home-content" aria-labelledby="workspace-home-tab-content">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="text-sm font-bold text-slate-950">Contenido del workspace</h2><p className="mt-0.5 text-xs text-slate-500">Accede a las superficies principales de trabajo.</p></div>
              <button onClick={() => openCreateModal('PROJECT')} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Agregar proyecto</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {moduleCards.map((module) => {
                const Icon = module.icon;
                return (
                  <button key={module.id} onClick={() => setActiveTab(module.id)} className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-green-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-green-50 text-[#07883F]"><Icon className="h-4 w-4" /></div>
                    <p className="mt-4 text-sm font-semibold text-slate-900">{module.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{module.detail}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {homeTab === 'recent' && (
          <div className="p-5" role="tabpanel" id="workspace-home-recent" aria-labelledby="workspace-home-tab-recent">
            <div className="mb-4"><h2 className="text-sm font-bold text-slate-950">Recientes</h2><p className="mt-0.5 text-xs text-slate-500">Continúa desde los elementos operativos más relevantes.</p></div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {activeProjects.slice(0, 6).map((project) => (
                <button key={project.id} onClick={() => openProject(project.id)} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500">
                  <div className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-green-50 text-[#07883F]"><BriefcaseBusiness className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-900">{project.title}</p><p className="mt-0.5 text-xs text-slate-500">Proyecto · {project.progress}% completado</p></div>
                  <span className="text-xs text-slate-500">{formatDate(project.endDate)}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

const SummaryMetric: React.FC<{ label: string; value: number | string; hint: string }> = ({ label, value, hint }) => (
  <div className="rounded-lg border border-slate-200 bg-[#FAFBFC] px-4 py-3">
    <div className="flex items-end justify-between gap-3">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-950">{value}</p></div>
      <p className="max-w-[145px] pb-1 text-right text-xs leading-4 text-slate-500">{hint}</p>
    </div>
  </div>
);

const CompactPanel: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, icon, children, actionLabel, onAction }) => (
  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="flex items-center justify-between border-b border-slate-200 bg-[#FAFBFC] px-3.5 py-2.5">
      <div className="flex items-center gap-2"><h3 className="text-xs font-semibold text-slate-900">{title}</h3>{icon}</div>
      {actionLabel && onAction && (
        <button onClick={onAction} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-white hover:text-[#07883F]">
          {actionLabel}<ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
    <div className="p-1.5">{children}</div>
  </div>
);

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; detail: string }> = ({ icon, title, detail }) => (
  <div className="flex flex-col items-center px-4 py-6 text-center">
    <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600">{icon}</div>
    <p className="mt-2 text-xs font-semibold text-slate-700">{title}</p>
    <p className="mt-1 text-xs text-slate-500">{detail}</p>
  </div>
);
