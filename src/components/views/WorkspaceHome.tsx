import React from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ListTodo,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { objectStatusLabel, objectTypeLabel } from '../../domain/objectLabels';

function formatDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
}

function healthTone(score: number): { label: string; dot: string; chip: string } {
  if (score >= 80) return { label: 'En control', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  if (score >= 65) return { label: 'Atención', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label: 'Crítico', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200' };
}

export const WorkspaceHome: React.FC = () => {
  const {
    tenant,
    currentWorkspace,
    currentUser,
    objects,
    approvals,
    openObjectDrawer,
    openCreateModal,
    setSelectedProjectId,
    setActiveTab,
    setProjectActiveSubTab,
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
    .slice(0, 6);

  // Un elemento ya resuelto no necesita intervención, por muy crítico que fuese:
  // sin este filtro una decisión APPROVED seguía apareciendo como pendiente.
  const RESOLVED_STATUSES = ['COMPLETED', 'CANCELLED', 'APPROVED', 'REJECTED', 'MITIGATED'];
  const attentionItems = objects
    .filter((object) => object.status === 'BLOCKED' || object.priority === 'CRITICAL')
    .filter((object) => object.type !== 'PROJECT')
    .filter((object) => !RESOLVED_STATUSES.includes(object.status))
    .slice(0, 5);

  const openProject = (projectId: string, subTab = 'summary') => {
    setSelectedProjectId(projectId);
    setProjectActiveSubTab(subTab);
    setActiveTab('project');
  };

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-5 px-6 py-6 lg:px-8">
      {/*
        Cabecera funcional. Antes esto era un titular publicitario de 30px que
        ocupaba la primera pantalla completa en móvil antes de mostrar un dato.
        El nombre del workspace ya identifica dónde estás; el resto son acciones.
      */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-meta font-semibold text-slate-600">{tenant.name}</p>
          <h1 className="mt-0.5 truncate text-title font-extrabold tracking-[-0.02em] text-slate-950">
            {currentWorkspace?.name || 'Workspace'}
          </h1>
        </div>
        <div className="flex flex-none items-center gap-2">
          <button onClick={() => setActiveTab('inbox')} className="h-9 rounded-lg border border-slate-200 bg-white px-3.5 text-meta font-bold text-slate-700 transition hover:bg-slate-50">Mi trabajo</button>
          <button onClick={() => openCreateModal('PROJECT')} className="flex h-9 items-center gap-1.5 rounded-lg bg-green-700 px-3.5 text-meta font-bold text-white transition hover:bg-green-800"><Plus className="h-3.5 w-3.5" /> Nuevo proyecto</button>
        </div>
      </header>

      {/*
        Una sola fila de métricas. Antes había dos: "Pulso del workspace"
        (avance/bloqueos/riesgos) y otra de cuatro tarjetas, donde "Riesgos" y
        "Señales que requieren control" mostraban el mismo número con nombres
        distintos. Cada métrica aparece una vez y navega a donde se resuelve.
      */}
      <section aria-label="Resumen del workspace" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Proyectos activos', value: activeProjects.length, hint: `${averageProgress}% de avance promedio`, tab: 'projects', Icon: BriefcaseBusiness, tone: 'bg-green-50 text-green-700' },
          { label: 'Trabajo asignado', value: myTasks.length, hint: 'Abierto y a tu nombre', tab: 'inbox', Icon: ListTodo, tone: 'bg-sky-50 text-sky-700' },
          { label: 'Requiere control', value: blockedItems.length + criticalRisks.length, hint: `${blockedItems.length} bloqueos · ${criticalRisks.length} riesgos`, tab: 'governance', Icon: ShieldAlert, tone: 'bg-amber-50 text-amber-700' },
          { label: 'Decisiones pendientes', value: pendingApprovals.length, hint: 'Esperando aprobación', tab: 'inbox', Icon: CheckCircle2, tone: 'bg-slate-100 text-slate-700' },
        ].map(({ label, value, hint, tab, Icon, tone }) => (
          <button
            key={label}
            onClick={() => setActiveTab(tab)}
            className="group rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-green-300 hover:bg-green-50/30"
          >
            <div className="flex items-start justify-between">
              <div className={`grid h-8 w-8 place-items-center rounded-lg ${tone}`}><Icon className="h-4 w-4" /></div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5" />
            </div>
            <p className="mt-3 text-display font-extrabold leading-none text-slate-950">{value}</p>
            <p className="mt-1.5 text-meta font-semibold text-slate-700">{label}</p>
            <p className="mt-0.5 truncate text-micro text-slate-500">{hint}</p>
          </button>
        ))}
      </section>

      {/*
        grid-cols-1 + min-w-0: sin columna declarada la grilla se dimensionaba por el
        contenido mínimo de las filas y las tarjetas sobresalían ~82px del viewport en
        móvil. El documento no scrolleaba, así que el exceso quedaba recortado y sin
        forma de alcanzarlo — "Ver portafolios" era invisible e inaccesible.
      */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.72fr)]">
        <div className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_26px_rgba(15,23,42,0.025)]">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Ejecución</p><h2 className="mt-1 text-[14px] font-extrabold text-slate-950">Portafolio activo</h2></div>
            <button onClick={() => setActiveTab('portfolios')} className="flex items-center gap-1.5 text-[10px] font-bold text-green-700 hover:text-green-800">Ver portafolios <ArrowRight className="h-3 w-3" /></button>
          </div>
          <div className="divide-y divide-slate-100">
            {activeProjects.length === 0 ? (
              <div className="p-10 text-center text-[11px] text-slate-400">Aún no hay proyectos activos.</div>
            ) : activeProjects.slice(0, 7).map((project) => {
              const health = getProjectHealth(project.id);
              const tone = healthTone(health.healthScore);
              // Apilado en móvil: con columnas fijas la primera se colapsaba a cero y el
              // nombre del proyecto —el dato que identifica la fila— desaparecía, dejando
              // sólo el chip de estado y la barra de avance.
              return (
                <button key={project.id} onClick={() => openProject(project.id)} className="flex w-full flex-col gap-2.5 px-5 py-4 text-left transition hover:bg-green-50/30 sm:grid sm:grid-cols-[minmax(0,1.3fr)_108px_150px_94px_18px] sm:items-center sm:gap-4">
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 flex-none rounded-full ${tone.dot}`} /><p className="truncate text-meta font-bold text-slate-900">{project.title}</p></div><p className="ml-4 mt-1 truncate text-micro text-slate-500">{project.description || 'Sin descripción'}</p></div>
                  <span className={`inline-flex w-fit rounded-full px-2 py-1 text-micro font-bold ring-1 ${tone.chip}`}>{tone.label}</span>
                  <div><div className="mb-1 flex items-center justify-between text-micro font-bold text-slate-500"><span>AVANCE</span><span className="text-slate-700">{project.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, project.progress)}%` }} /></div></div>
                  <div className="flex items-baseline gap-1.5 sm:block sm:text-right"><p className="text-meta font-bold text-slate-700">{formatDate(project.endDate)}</p><p className="text-micro text-slate-500 sm:mt-0.5">objetivo</p></div>
                  <ChevronRight className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_26px_rgba(15,23,42,0.025)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Atención</p><h2 className="mt-1 text-[13px] font-extrabold text-slate-950">Qué necesita intervención</h2></div><CircleAlert className="h-4 w-4 text-amber-600" /></div>
            <div className="p-2.5">
              {attentionItems.length === 0 ? <div className="flex flex-col items-center px-4 py-8 text-center"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></div><p className="mt-3 text-[11px] font-bold text-slate-700">Sin alertas críticas</p></div> : attentionItems.map((item) => (
                <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-amber-50/50"><div className="flex items-start gap-3"><span className="mt-1 h-2 w-2 flex-none rounded-full bg-amber-500" /><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-slate-900">{item.title}</p><p className="mt-1 text-micro text-slate-500">{objectTypeLabel(item.type)} · {objectStatusLabel(item.status)} · {formatDate(item.endDate)}</p></div></div></button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_26px_rgba(15,23,42,0.025)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Agenda</p><h2 className="mt-1 text-[13px] font-extrabold text-slate-950">Próximos vencimientos</h2></div><CalendarDays className="h-4 w-4 text-green-700" /></div>
            <div className="p-2.5">
              {upcomingItems.slice(0, 5).map((item) => (
                <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"><div className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-slate-100 text-slate-600"><Clock3 className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-micro text-slate-500">{objectTypeLabel(item.type)} · {formatDate(item.endDate)}</p></div></button>
              ))}
              {upcomingItems.length === 0 && <p className="px-4 py-8 text-center text-[10px] text-slate-400">Sin vencimientos próximos.</p>}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};
