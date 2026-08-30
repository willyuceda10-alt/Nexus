import React, { useEffect, useState } from 'react';
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

  const projects = objects.filter((object) => object.type === 'PROJECT');
  const activeProjects = projects.filter((project) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(project.status));
  const tasks = objects.filter((object) => object.type === 'TASK');
  const openTasks = tasks.filter((task) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(task.status));
  const myTasks = openTasks.filter((task) => task.assigneeId === currentUser.id || task.ownerId === currentUser.id);
  const blockedItems = objects.filter((object) => object.status === 'BLOCKED');
  const criticalRisks = objects.filter(
    (object) => object.type === 'RISK' && ((object.riskScore || 0) >= 15 || object.priority === 'CRITICAL'),
  );
  const localAttentionCount = new Set([...blockedItems, ...criticalRisks].map((object) => object.id)).size;
  const pendingApprovals = approvals.filter((approval) => approval.status === 'PENDING');
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

  const upcomingItems = objects
    .filter(
      (object) =>
        object.endDate &&
        !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(object.status) &&
        ['TASK', 'MILESTONE', 'DELIVERABLE'].includes(object.type),
    )
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''))
    .slice(0, 6);

  const attentionItems = objects
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
      && serverSummary.totalObjects > objects.length,
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

  return (
    <div className="mx-auto w-full max-w-[1640px] px-4 py-4 sm:px-5 lg:px-6">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-5 pb-0 pt-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="truncate">{tenant.name}</span>
              <ChevronRight className="h-3 w-3" />
              <span>Workspace</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-[-0.025em] text-slate-950">{currentWorkspace?.name || 'Espacio de trabajo'}</h1>
              <button
                onClick={toggleWorkspaceFavorite}
                className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-slate-100 hover:text-amber-500 ${workspaceFavorite ? 'text-amber-500' : 'text-slate-400'}`}
                aria-label={workspaceFavorite ? 'Quitar workspace de favoritos' : 'Marcar workspace como favorito'}
                aria-pressed={workspaceFavorite}
              >
                <Star className={`h-4 w-4 ${workspaceFavorite ? 'fill-amber-400' : ''}`} />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">Organiza proyectos, tableros, operación SAP y decisiones desde un solo espacio.</p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => setActiveTab('inbox')} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50">Mi trabajo</button>
            <button onClick={() => openCreateModal('PROJECT')} className="flex h-9 items-center gap-1.5 rounded-lg bg-[#07883F] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#067535]"><Plus className="h-3.5 w-3.5" /> Nuevo proyecto</button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1 border-b border-slate-200 px-5" role="tablist" aria-label="Secciones del workspace">
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
              className={`relative px-3 py-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 ${homeTab === id ? 'text-[#07883F]' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {label}
              {homeTab === id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#07883F]" />}
            </button>
          ))}
        </div>

        {homeTab === 'overview' && (
          <div className="p-5" role="tabpanel" id="workspace-home-overview" aria-labelledby="workspace-home-tab-overview">
            {browserViewIsPartial && serverSummary && (
              <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800" role="status">
                <strong>Vista operativa parcial:</strong> el navegador materializó {objects.length.toLocaleString('es-PE')} de {serverSummary.totalObjects.toLocaleString('es-PE')} objetos. Los KPIs de esta cabecera siguen siendo exactos porque se calculan en PostgreSQL.
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryMetric label="Proyectos activos" value={exactActiveProjects} hint={`${exactAverageProgress}% avance promedio`} />
              <SummaryMetric label="Mi trabajo" value={exactMyWork} hint="Elementos abiertos" />
              <SummaryMetric label="Requieren atención" value={exactAttention} hint={`${exactCriticalRisks} riesgos críticos`} />
              <SummaryMetric label="Decisiones pendientes" value={exactPendingApprovals} hint="Aprobaciones por resolver" />
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_360px]">
              <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-1 rounded-full bg-[#07883F]" />
                    <div>
                      <h2 className="text-sm font-bold text-slate-950">Proyectos activos</h2>
                      <p className="text-[11px] text-slate-400">{filteredProjects.length} visibles · {exactActiveProjects} totales</p>
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
                    <div className="grid grid-cols-[minmax(280px,1.4fr)_130px_160px_120px_105px_28px] items-center gap-2 border-b border-slate-200 bg-[#F7F8FA] px-4 py-2 text-[11px] font-semibold text-slate-500">
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
                              <p className="truncate text-xs font-semibold text-slate-900">{project.title}</p>
                              <p className="mt-0.5 truncate text-[11px] text-slate-400">{project.description || 'Sin descripción'}</p>
                            </div>
                            <div className={`mx-auto w-[108px] rounded-md px-2 py-1.5 text-center text-[11px] font-semibold ${tone.cell}`}>{tone.label}</div>
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#00A859]" style={{ width: `${Math.min(100, project.progress)}%` }} /></div>
                              <span className="w-8 text-right text-[11px] font-semibold text-slate-600">{project.progress}%</span>
                            </div>
                            <div className={`mx-auto rounded-md px-2 py-1 text-center text-[11px] font-semibold ${priorityTone(project.priority)}`}>{project.priority || 'NORMAL'}</div>
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
                <CompactPanel title="Necesita atención" icon={<CircleAlert className="h-4 w-4 text-amber-500" />}>
                  {attentionItems.length === 0 ? (
                    <EmptyState icon={<CheckCircle2 className="h-4 w-4" />} title="Todo bajo control" detail="No hay alertas críticas abiertas en los elementos cargados." />
                  ) : attentionItems.map((item) => (
                    <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-amber-50/60">
                      <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-amber-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-slate-900">{item.title}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">{item.type} · {item.status} · {formatDate(item.endDate)}</span>
                      </span>
                    </button>
                  ))}
                </CompactPanel>

                <CompactPanel title="Próximos vencimientos" icon={<CalendarDays className="h-4 w-4 text-[#07883F]" />}>
                  {upcomingItems.slice(0, 5).map((item) => (
                    <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition hover:bg-slate-50">
                      <div className="grid h-7 w-7 flex-none place-items-center rounded-md bg-slate-100 text-slate-500"><Clock3 className="h-3.5 w-3.5" /></div>
                      <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{item.title}</p><p className="mt-0.5 text-[11px] text-slate-400">{item.type} · {formatDate(item.endDate)}</p></div>
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
              <div><h2 className="text-sm font-bold text-slate-950">Contenido del workspace</h2><p className="mt-0.5 text-xs text-slate-400">Accede a las superficies principales de trabajo.</p></div>
              <button onClick={() => openCreateModal('PROJECT')} className="flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><Plus className="h-3.5 w-3.5" /> Agregar</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {moduleCards.map((module) => {
                const Icon = module.icon;
                return (
                  <button key={module.id} onClick={() => setActiveTab(module.id)} className="rounded-lg border border-slate-200 bg-white p-4 text-left transition hover:border-green-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-green-50 text-[#07883F]"><Icon className="h-4 w-4" /></div>
                    <p className="mt-4 text-sm font-semibold text-slate-900">{module.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{module.detail}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {homeTab === 'recent' && (
          <div className="p-5" role="tabpanel" id="workspace-home-recent" aria-labelledby="workspace-home-tab-recent">
            <div className="mb-4"><h2 className="text-sm font-bold text-slate-950">Recientes</h2><p className="mt-0.5 text-xs text-slate-400">Continúa desde los elementos operativos más relevantes.</p></div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {activeProjects.slice(0, 6).map((project) => (
                <button key={project.id} onClick={() => openProject(project.id)} className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500">
                  <div className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-green-50 text-[#07883F]"><BriefcaseBusiness className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-900">{project.title}</p><p className="mt-0.5 text-[11px] text-slate-400">Proyecto · {project.progress}% completado</p></div>
                  <span className="text-[11px] text-slate-400">{formatDate(project.endDate)}</span>
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

const SummaryMetric: React.FC<{ label: string; value: number; hint: string }> = ({ label, value, hint }) => (
  <div className="rounded-lg border border-slate-200 bg-[#FAFBFC] px-4 py-3">
    <div className="flex items-end justify-between gap-3">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p><p className="mt-1 text-xl font-bold text-slate-950">{value}</p></div>
      <p className="pb-1 text-right text-[11px] text-slate-400">{hint}</p>
    </div>
  </div>
);

const CompactPanel: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="flex items-center justify-between border-b border-slate-200 bg-[#FAFBFC] px-3.5 py-3">
      <h3 className="text-xs font-semibold text-slate-900">{title}</h3>
      {icon}
    </div>
    <div className="p-1.5">{children}</div>
  </div>
);

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; detail: string }> = ({ icon, title, detail }) => (
  <div className="flex flex-col items-center px-4 py-6 text-center">
    <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600">{icon}</div>
    <p className="mt-2 text-xs font-semibold text-slate-700">{title}</p>
    <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
  </div>
);
