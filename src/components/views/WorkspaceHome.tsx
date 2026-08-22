import React from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ListTodo,
  Plus,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

function formatDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
}

function healthTone(score: number): { label: string; className: string; dot: string } {
  if (score >= 80) return { label: 'En control', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' };
  if (score >= 65) return { label: 'Atención', className: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' };
  return { label: 'Crítico', className: 'bg-rose-50 text-rose-700 ring-rose-200', dot: 'bg-rose-500' };
}

export const WorkspaceHome: React.FC = () => {
  const {
    currentWorkspace,
    currentUser,
    objects,
    approvals,
    openObjectDrawer,
    openCreateModal,
    setSelectedProjectId,
    setActiveTab,
    getProjectHealth,
  } = useNexus();

  const projects = objects.filter((object) => object.type === 'PROJECT');
  const activeProjects = projects.filter((project) => !['COMPLETED', 'CANCELLED'].includes(project.status));
  const tasks = objects.filter((object) => object.type === 'TASK');
  const openTasks = tasks.filter((task) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(task.status));
  const myTasks = openTasks
    .filter((task) => task.assigneeId === currentUser.id || task.ownerId === currentUser.id)
    .sort((a, b) => (a.endDate || '9999-12-31').localeCompare(b.endDate || '9999-12-31'));
  const blockedItems = objects.filter((object) => object.status === 'BLOCKED');
  const criticalRisks = objects.filter(
    (object) => object.type === 'RISK' && ((object.riskScore || 0) >= 15 || object.priority === 'CRITICAL'),
  );
  const attentionItems = objects
    .filter((object) => object.status === 'BLOCKED' || object.priority === 'CRITICAL')
    .filter((object) => object.type !== 'PROJECT')
    .slice(0, 5);
  const pendingApprovals = approvals.filter((approval) => approval.status === 'PENDING');
  const averageProgress = activeProjects.length
    ? Math.round(activeProjects.reduce((sum, project) => sum + project.progress, 0) / activeProjects.length)
    : 0;

  const upcomingItems = objects
    .filter(
      (object) =>
        object.endDate &&
        !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(object.status) &&
        ['TASK', 'MILESTONE', 'DELIVERABLE'].includes(object.type),
    )
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''))
    .slice(0, 5);

  const statusCounts = [
    { label: 'Planificación', value: openTasks.filter((task) => ['DRAFT', 'PLANNING'].includes(task.status)).length, className: 'bg-slate-300' },
    { label: 'En progreso', value: openTasks.filter((task) => task.status === 'IN_PROGRESS').length, className: 'bg-indigo-500' },
    { label: 'En revisión', value: openTasks.filter((task) => ['IN_REVIEW', 'PENDING_APPROVAL'].includes(task.status)).length, className: 'bg-amber-400' },
    { label: 'Bloqueadas', value: openTasks.filter((task) => task.status === 'BLOCKED').length, className: 'bg-rose-500' },
  ];
  const statusTotal = Math.max(1, statusCounts.reduce((sum, item) => sum + item.value, 0));

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setActiveTab('project');
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-700 ring-1 ring-indigo-100">
              {currentWorkspace?.name || 'Workspace'}
            </span>
            <span className="text-[11px] font-medium text-slate-400">Vista ejecutiva</span>
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">Ejecución bajo control.</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-slate-500">
            Prioriza lo que requiere decisión, revisa avance y entra al detalle sin perder el contexto del portafolio.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('projects')}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Ver proyectos
          </button>
          <button
            onClick={() => openCreateModal('PROJECT')}
            className="flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-[11px] font-bold text-white shadow-sm transition hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" /> Nuevo proyecto
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><BriefcaseBusiness className="h-4 w-4" /></div>
            <span className="text-[10px] font-semibold text-slate-400">PORTAFOLIO</span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[28px] font-extrabold tracking-tight text-slate-950">{activeProjects.length}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-500">proyectos activos</p>
            </div>
            <span className="text-[10px] font-semibold text-slate-400">{projects.length} total</span>
          </div>
        </div>

        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><TrendingUp className="h-4 w-4" /></div>
            <span className="text-[10px] font-semibold text-slate-400">AVANCE</span>
          </div>
          <div className="mt-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[28px] font-extrabold tracking-tight text-slate-950">{averageProgress}%</p>
                <p className="mt-1 text-[11px] font-medium text-slate-500">promedio del portafolio</p>
              </div>
              <span className="text-[10px] font-semibold text-emerald-600">Actual</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, averageProgress)}%` }} />
            </div>
          </div>
        </div>

        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600"><ListTodo className="h-4 w-4" /></div>
            <span className="text-[10px] font-semibold text-slate-400">MI TRABAJO</span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[28px] font-extrabold tracking-tight text-slate-950">{myTasks.length}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-500">tareas abiertas</p>
            </div>
            <span className="text-[10px] font-semibold text-slate-400">{pendingApprovals.length} aprob.</span>
          </div>
        </div>

        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-600"><ShieldAlert className="h-4 w-4" /></div>
            <span className="text-[10px] font-semibold text-slate-400">ATENCIÓN</span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-[28px] font-extrabold tracking-tight text-slate-950">{blockedItems.length + criticalRisks.length}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-500">señales críticas</p>
            </div>
            <span className="text-[10px] font-semibold text-rose-600">{blockedItems.length} bloqueos</span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
        <div className="command-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-bold text-slate-950">Portafolio en ejecución</h2>
              <p className="mt-1 text-[10px] text-slate-400">Salud, avance y próxima entrega por proyecto</p>
            </div>
            <button onClick={() => setActiveTab('portfolios')} className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-700">
              Abrir portafolio <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {activeProjects.length === 0 ? (
              <div className="p-10 text-center text-[11px] text-slate-400">Aún no hay proyectos activos en este workspace.</div>
            ) : (
              activeProjects.slice(0, 7).map((project) => {
                const health = getProjectHealth(project.id);
                const tone = healthTone(health.healthScore);
                return (
                  <button
                    key={project.id}
                    onClick={() => openProject(project.id)}
                    className="grid w-full grid-cols-[minmax(0,1.35fr)_110px_150px_100px_24px] items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50/80"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${tone.dot}`} />
                        <p className="truncate text-[12px] font-semibold text-slate-900">{project.title}</p>
                      </div>
                      <p className="ml-4 mt-1 truncate text-[10px] text-slate-400">{project.description || 'Sin descripción del proyecto'}</p>
                    </div>

                    <div>
                      <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold ring-1 ${tone.className}`}>
                        {health.healthScore} · {tone.label}
                      </span>
                    </div>

                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-[9px] font-semibold text-slate-400">
                        <span>AVANCE</span><span className="text-slate-700">{project.progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, project.progress)}%` }} />
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="text-[10px] font-semibold text-slate-700">{formatDate(project.endDate)}</p>
                      <p className="mt-0.5 text-[9px] text-slate-400">fecha objetivo</p>
                    </div>

                    <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="command-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-bold text-slate-950">Atención requerida</h2>
              <p className="mt-1 text-[10px] text-slate-400">Bloqueos y prioridades críticas</p>
            </div>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </div>

          <div className="p-3">
            {attentionItems.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></div>
                <p className="mt-3 text-[11px] font-semibold text-slate-700">Sin alertas críticas</p>
                <p className="mt-1 text-[10px] text-slate-400">No hay bloqueos ni prioridades críticas visibles.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {attentionItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => openObjectDrawer(item.id)}
                    className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-rose-50/60"
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-rose-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-semibold text-slate-900">{item.title}</span>
                        <span className="mt-1 flex items-center gap-2 text-[9px] font-medium text-slate-400">
                          <span>{item.type}</span><span>•</span><span>{item.status}</span><span>•</span><span>{formatDate(item.endDate)}</span>
                        </span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="command-panel xl:col-span-1">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-[13px] font-bold text-slate-950">Flujo de trabajo</h2>
            <p className="mt-1 text-[10px] text-slate-400">Distribución de tareas abiertas</p>
          </div>
          <div className="p-5">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
              {statusCounts.map((item) => (
                <div key={item.label} className={item.className} style={{ width: `${(item.value / statusTotal) * 100}%` }} />
              ))}
            </div>
            <div className="mt-5 space-y-3">
              {statusCounts.map((item) => (
                <div key={item.label} className="flex items-center justify-between text-[10px]">
                  <span className="flex items-center gap-2 font-medium text-slate-500">
                    <span className={`h-2 w-2 rounded-full ${item.className}`} /> {item.label}
                  </span>
                  <span className="font-bold text-slate-800">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="command-panel xl:col-span-1">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-bold text-slate-950">Mi trabajo</h2>
              <p className="mt-1 text-[10px] text-slate-400">Siguientes tareas asignadas</p>
            </div>
            <ListTodo className="h-4 w-4 text-sky-500" />
          </div>
          <div className="p-3">
            {myTasks.slice(0, 5).map((task) => (
              <button key={task.id} onClick={() => openObjectDrawer(task.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${task.priority === 'CRITICAL' ? 'bg-rose-500' : task.priority === 'HIGH' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-slate-900">{task.title}</span>
                  <span className="mt-1 block text-[9px] text-slate-400">{task.progress}% · vence {formatDate(task.endDate)}</span>
                </span>
                <span className="text-[9px] font-semibold text-slate-400">{task.status}</span>
              </button>
            ))}
            {myTasks.length === 0 && <div className="p-8 text-center text-[10px] text-slate-400">No tienes tareas abiertas.</div>}
          </div>
        </div>

        <div className="command-panel xl:col-span-1">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-bold text-slate-950">Próximas fechas</h2>
              <p className="mt-1 text-[10px] text-slate-400">Tareas, hitos y entregables</p>
            </div>
            <CalendarDays className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="p-3">
            {upcomingItems.map((item) => (
              <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50">
                <div className="w-11 flex-shrink-0 rounded-lg bg-slate-50 py-1.5 text-center ring-1 ring-slate-100">
                  <span className="block text-[10px] font-bold text-slate-800">{formatDate(item.endDate).split(' ')[0]}</span>
                  <span className="block text-[8px] font-semibold uppercase text-slate-400">{formatDate(item.endDate).split(' ')[1] || ''}</span>
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-slate-900">{item.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[9px] text-slate-400"><Clock3 className="h-2.5 w-2.5" /> {item.type}</span>
                </span>
              </button>
            ))}
            {upcomingItems.length === 0 && <div className="p-8 text-center text-[10px] text-slate-400">No hay próximas fechas registradas.</div>}
          </div>
        </div>
      </section>
    </div>
  );
};
