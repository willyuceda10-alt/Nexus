import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  Filter,
  Plus,
  Search,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { PortfoliosView } from './PortfoliosView';
import { ExecutiveDashboard } from './ExecutiveDashboard';

function formatDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function healthTone(score: number) {
  if (score >= 80) return { label: 'En control', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  if (score >= 65) return { label: 'Atención', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label: 'Crítico', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700 ring-rose-200' };
}

export const ProjectsOverviewView: React.FC = () => {
  const [view, setView] = useState<'list' | 'portfolios' | 'analytics'>('list');
  const {
    tenant,
    currentWorkspace,
    objects,
    setSelectedProjectId,
    setProjectActiveSubTab,
    setActiveTab,
    openCreateModal,
    getProjectHealth,
  } = useNexus();
  const [query, setQuery] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const projects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return objects
      .filter((object) => object.type === 'PROJECT')
      .filter((project) => showClosed || !['COMPLETED', 'CANCELLED'].includes(project.status))
      .filter((project) => !normalized || project.title.toLowerCase().includes(normalized) || project.description?.toLowerCase().includes(normalized))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [objects, query, showClosed]);

  const allProjects = objects.filter((object) => object.type === 'PROJECT');
  const activeCount = allProjects.filter((project) => !['COMPLETED', 'CANCELLED'].includes(project.status)).length;
  const criticalCount = allProjects.filter((project) => getProjectHealth(project.id).healthScore < 65).length;
  const averageProgress = activeCount
    ? Math.round(allProjects.filter((project) => !['COMPLETED', 'CANCELLED'].includes(project.status)).reduce((sum, project) => sum + project.progress, 0) / activeCount)
    : 0;

  const openProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setProjectActiveSubTab('summary');
    setActiveTab('project');
  };

  return (
    <div className="mx-auto w-full max-w-[1580px] space-y-5 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-400"><span>{tenant.name}</span><span>·</span><span className="text-green-700">{currentWorkspace?.name || 'Workspace'}</span></div>
          <p className="mt-4 text-[10px] font-black uppercase tracking-[0.14em] text-green-700">Portafolio de ejecución</p>
          <h1 className="mt-1 text-[29px] font-extrabold tracking-[-0.04em] text-slate-950">Proyectos</h1>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-500">Selecciona un proyecto para entrar a su espacio de trabajo, planificación y control.</p>
        </div>
        <button onClick={() => openCreateModal('PROJECT')} className="flex h-10 items-center gap-2 self-start rounded-xl bg-green-700 px-4 text-[11px] font-bold text-white shadow-[0_8px_20px_rgba(21,128,61,0.18)] hover:bg-green-800 lg:self-auto"><Plus className="h-3.5 w-3.5" /> Nuevo proyecto</button>
      </section>

      {/*
        Portafolios y Analítica eran módulos propios, pero los tres leían exactamente
        las mismas fuentes (objects.filter + getProjectHealth) sin datos propios: eran
        tres renderizados del mismo conjunto de proyectos — lista, jerarquía y
        consolidado. Se eligen aquí como vistas, no desde el menú.
      */}
      <div className="flex w-fit items-center gap-1 rounded-xl bg-slate-100 p-1">
        <button onClick={() => setView('list')} className={`rounded-lg px-3 py-2 text-meta font-bold ${view === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>Lista</button>
        <button onClick={() => setView('portfolios')} className={`rounded-lg px-3 py-2 text-meta font-bold ${view === 'portfolios' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>Portafolios</button>
        <button onClick={() => setView('analytics')} className={`rounded-lg px-3 py-2 text-meta font-bold ${view === 'analytics' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>Analítica</button>
      </div>

      {view === 'portfolios' ? <PortfoliosView embedded /> : view === 'analytics' ? <ExecutiveDashboard embedded /> : (
      <>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-[18px] border border-slate-200 bg-white p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-green-50 text-green-700"><BriefcaseBusiness className="h-4 w-4" /></div><div><p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Activos</p><p className="mt-0.5 text-xl font-extrabold text-slate-950">{activeCount}</p></div></div></div>
        <div className="rounded-[18px] border border-slate-200 bg-white p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-slate-700"><CheckCircle2 className="h-4 w-4" /></div><div><p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Avance promedio</p><p className="mt-0.5 text-xl font-extrabold text-slate-950">{averageProgress}%</p></div></div></div>
        <div className="rounded-[18px] border border-slate-200 bg-white p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-700"><CircleAlert className="h-4 w-4" /></div><div><p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Críticos</p><p className="mt-0.5 text-xl font-extrabold text-slate-950">{criticalCount}</p></div></div></div>
      </section>

      <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_6px_26px_rgba(15,23,42,0.025)]">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="relative max-w-md flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar proyecto..." className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-[10px] font-semibold text-slate-700 outline-none transition focus:border-green-300 focus:bg-white" /></div>
          <button onClick={() => setShowClosed((value) => !value)} className={`flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px] font-bold transition ${showClosed ? 'border-green-200 bg-green-50 text-green-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}><Filter className="h-3.5 w-3.5" /> {showClosed ? 'Incluye cerrados' : 'Solo activos'}</button>
        </div>

        <div className="hidden grid-cols-[minmax(0,1.45fr)_120px_160px_130px_100px_30px] gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-[8px] font-black uppercase tracking-[0.12em] text-slate-400 lg:grid"><span>Proyecto</span><span>Salud</span><span>Avance</span><span>Estado</span><span>Objetivo</span><span /></div>
        <div className="divide-y divide-slate-100">
          {projects.map((project) => {
            const health = getProjectHealth(project.id);
            const tone = healthTone(health.healthScore);
            return (
              <button key={project.id} onClick={() => openProject(project.id)} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-green-50/30 lg:grid-cols-[minmax(0,1.45fr)_120px_160px_130px_100px_30px] lg:items-center lg:gap-4">
                <div className="min-w-0"><div className="flex items-center gap-2"><span className={`h-2 w-2 flex-none rounded-full ${tone.dot}`} /><p className="truncate text-[11px] font-bold text-slate-900">{project.title}</p></div><p className="ml-4 mt-1 truncate text-[9px] text-slate-400">{project.description || 'Sin descripción'}</p></div>
                <span className={`w-fit rounded-full px-2 py-1 text-[8px] font-bold ring-1 ${tone.chip}`}>{health.healthScore} · {tone.label}</span>
                <div><div className="mb-1 flex items-center justify-between text-[8px] font-bold text-slate-400"><span>AVANCE</span><span className="text-slate-700">{project.progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, project.progress)}%` }} /></div></div>
                <span className="w-fit rounded-lg bg-slate-100 px-2 py-1 text-[8px] font-bold text-slate-600">{project.status.replaceAll('_', ' ')}</span>
                <span className="text-[9px] font-semibold text-slate-600">{formatDate(project.endDate)}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-300" />
              </button>
            );
          })}
          {projects.length === 0 && <div className="p-12 text-center"><p className="text-[12px] font-bold text-slate-700">No encontramos proyectos</p><p className="mt-1 text-[10px] text-slate-400">Ajusta la búsqueda o crea un nuevo proyecto.</p></div>}
        </div>
      </section>
      </>
      )}
    </div>
  );
};
