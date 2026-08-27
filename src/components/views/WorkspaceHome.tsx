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
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

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

  const attentionItems = objects
    .filter((object) => object.status === 'BLOCKED' || object.priority === 'CRITICAL')
    .filter((object) => object.type !== 'PROJECT')
    .slice(0, 5);

  const firstName = currentUser.name.split(' ').filter(Boolean)[0] || currentUser.name;

  const openProject = (projectId: string, subTab = 'summary') => {
    setSelectedProjectId(projectId);
    setProjectActiveSubTab(subTab);
    setActiveTab('project');
  };

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-5 px-6 py-6 lg:px-8">
      <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.04)]">
        <div className="grid lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)]">
          <div className="p-6 lg:p-7">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-400">
              <span>{tenant.name}</span><ChevronRight className="h-3 w-3" />
              <span className="text-green-700">{currentWorkspace?.name || 'Workspace'}</span>
            </div>
            <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-green-700">Centro de mando</p>
                <h1 className="mt-2 text-[30px] font-extrabold tracking-[-0.04em] text-slate-950">Lo importante de tu operación, en una sola vista.</h1>
                <p className="mt-2 max-w-2xl text-[12px] leading-5 text-slate-500">
                  {firstName}, aquí convergen ejecución, decisiones y señales de control del workspace. Entra al detalle sin perder el contexto.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setActiveTab('inbox')} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50">Mi trabajo</button>
                <button onClick={() => openCreateModal('PROJECT')} className="flex h-10 items-center gap-2 rounded-xl bg-green-700 px-4 text-[11px] font-bold text-white shadow-[0_8px_20px_rgba(21,128,61,0.2)] transition hover:bg-green-800"><Plus className="h-3.5 w-3.5" /> Nuevo proyecto</button>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 p-6 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-green-100 text-green-700"><Sparkles className="h-4.5 w-4.5" /></div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Pulso del workspace</p>
                <p className="mt-0.5 text-[13px] font-extrabold text-slate-900">{activeProjects.length} proyectos en marcha</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold text-slate-400">AVANCE</p><p className="mt-1 text-lg font-extrabold text-slate-950">{averageProgress}%</p></div>
              <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold text-slate-400">BLOQUEOS</p><p className="mt-1 text-lg font-extrabold text-slate-950">{blockedItems.length}</p></div>
              <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[9px] font-bold text-slate-400">RIESGOS</p><p className="mt-1 text-lg font-extrabold text-slate-950">{criticalRisks.length}</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button onClick={() => setActiveTab('projects')} className="group rounded-[20px] border border-slate-200 bg-white p-4 text-left shadow-[0_4px_20px_rgba(15,23,42,0.025)] transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
          <div className="flex items-start justify-between"><div className="grid h-9 w-9 place-items-center rounded-xl bg-green-50 text-green-700"><BriefcaseBusiness className="h-4 w-4" /></div><ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5" /></div>
          <p className="mt-4 text-[25px] font-extrabold text-slate-950">{activeProjects.length}</p><p className="mt-1 text-[10px] font-semibold text-slate-500">Proyectos activos</p>
        </button>
        <button onClick={() => setActiveTab('inbox')} className="group rounded-[20px] border border-slate-200 bg-white p-4 text-left shadow-[0_4px_20px_rgba(15,23,42,0.025)] transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
          <div className="flex items-start justify-between"><div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-700"><ListTodo className="h-4 w-4" /></div><ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5" /></div>
          <p className="mt-4 text-[25px] font-extrabold text-slate-950">{myTasks.length}</p><p className="mt-1 text-[10px] font-semibold text-slate-500">Trabajo abierto asignado</p>
        </button>
        <button onClick={() => setActiveTab('governance')} className="group rounded-[20px] border border-slate-200 bg-white p-4 text-left shadow-[0_4px_20px_rgba(15,23,42,0.025)] transition hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-md">
          <div className="flex items-start justify-between"><div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-700"><ShieldAlert className="h-4 w-4" /></div><ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5" /></div>
          <p className="mt-4 text-[25px] font-extrabold text-slate-950">{blockedItems.length + criticalRisks.length}</p><p className="mt-1 text-[10px] font-semibold text-slate-500">Señales que requieren control</p>
        </button>
        <button onClick={() => setActiveTab('inbox')} className="group rounded-[20px] border border-slate-200 bg-white p-4 text-left shadow-[0_4px_20px_rgba(15,23,42,0.025)] transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
          <div className="flex items-start justify-between"><div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><CheckCircle2 className="h-4 w-4" /></div><ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5" /></div>
          <p className="mt-4 text-[25px] font-extrabold text-slate-950">{pendingApprovals.length}</p><p className="mt-1 text-[10px] font-semibold text-slate-500">Decisiones pendientes</p>
        </button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.72fr)]">
        <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_26px_rgba(15,23,42,0.025)]">
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
              return (
                <button key={project.id} onClick={() => openProject(project.id)} className="grid w-full grid-cols-[minmax(0,1.3fr)_108px_150px_94px_18px] items-center gap-4 px-5 py-4 text-left transition hover:bg-green-50/30">
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 flex-none rounded-full ${tone.dot}`} /><p className="truncate text-[11px] font-bold text-slate-900">{project.title}</p></div><p className="ml-4 mt-1 truncate text-[9px] text-slate-400">{project.description || 'Sin descripción'}</p></div>
                  <span className={`inline-flex w-fit rounded-full px-2 py-1 text-[8px] font-bold ring-1 ${tone.chip}`}>{tone.label}</span>
                  <div><div className="mb-1 flex items-center justify-between text-[8px] font-bold text-slate-400"><span>AVANCE</span><span className="text-slate-700">{project.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, project.progress)}%` }} /></div></div>
                  <div className="text-right"><p className="text-[10px] font-bold text-slate-700">{formatDate(project.endDate)}</p><p className="mt-0.5 text-[8px] text-slate-400">objetivo</p></div>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_26px_rgba(15,23,42,0.025)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Atención</p><h2 className="mt-1 text-[13px] font-extrabold text-slate-950">Qué necesita intervención</h2></div><CircleAlert className="h-4 w-4 text-amber-600" /></div>
            <div className="p-2.5">
              {attentionItems.length === 0 ? <div className="flex flex-col items-center px-4 py-8 text-center"><div className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></div><p className="mt-3 text-[11px] font-bold text-slate-700">Sin alertas críticas</p></div> : attentionItems.map((item) => (
                <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-amber-50/50"><div className="flex items-start gap-3"><span className="mt-1 h-2 w-2 flex-none rounded-full bg-amber-500" /><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-slate-900">{item.title}</p><p className="mt-1 text-[9px] text-slate-400">{item.type} · {item.status} · {formatDate(item.endDate)}</p></div></div></button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_26px_rgba(15,23,42,0.025)]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Agenda</p><h2 className="mt-1 text-[13px] font-extrabold text-slate-950">Próximos vencimientos</h2></div><CalendarDays className="h-4 w-4 text-green-700" /></div>
            <div className="p-2.5">
              {upcomingItems.slice(0, 5).map((item) => (
                <button key={item.id} onClick={() => openObjectDrawer(item.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"><div className="grid h-8 w-8 flex-none place-items-center rounded-xl bg-slate-100 text-slate-600"><Clock3 className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-[9px] text-slate-400">{item.type} · {formatDate(item.endDate)}</p></div></button>
              ))}
              {upcomingItems.length === 0 && <p className="px-4 py-8 text-center text-[10px] text-slate-400">Sin vencimientos próximos.</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-slate-200 bg-slate-950 px-5 py-5 text-white shadow-[0_10px_30px_rgba(15,23,42,0.12)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-300">Bridata Execution OS</p><h2 className="mt-1 text-[15px] font-extrabold">Una sola estructura. Múltiples formas de trabajar.</h2><p className="mt-1 text-[10px] text-slate-400">Los módulos comparten contexto, objetos y trazabilidad; las vistas cambian la representación, no la fuente.</p></div>
          <div className="flex flex-wrap gap-2"><button onClick={() => setActiveTab('projects')} className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-bold text-white hover:bg-white/15">Proyectos</button><button onClick={() => setActiveTab('materials')} className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-bold text-white hover:bg-white/15">Materiales</button><button onClick={() => setActiveTab('costs')} className="rounded-xl bg-white/10 px-3 py-2 text-[10px] font-bold text-white hover:bg-white/15">Costos</button><button onClick={() => setActiveTab('automations')} className="rounded-xl bg-green-600 px-3 py-2 text-[10px] font-bold text-white hover:bg-green-500">Automatizaciones</button></div>
        </div>
      </section>
    </div>
  );
};
