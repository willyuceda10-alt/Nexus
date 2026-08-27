import React from 'react';
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Kanban,
  LayoutDashboard,
  ListTree,
  Plus,
  RefreshCw,
  ShieldAlert,
  Table2,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { TableView } from './TableView';
import { KanbanView } from './KanbanView';
import { WbsGanttV2View } from './WbsGanttV2View';
import { ProjectMaterialRiskStrip } from './ProjectMaterialRiskStrip';
import { ProjectCostRiskStrip } from './ProjectCostRiskStrip';
import { ProjectCostsV2View } from './ProjectCostsV2View';
import { TimelineView } from './TimelineView';
import { GovernanceRiskView } from './GovernanceRiskView';
import { MeetingsDecisionsView } from './MeetingsDecisionsView';
import { DocumentsApprovalsView } from './DocumentsApprovalsView';

function shortDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function healthTone(score: number): { label: string; chip: string; bar: string } {
  if (score >= 80) return { label: 'En control', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-500' };
  if (score >= 65) return { label: 'Atención', chip: 'bg-amber-50 text-amber-700 ring-amber-200', bar: 'bg-amber-500' };
  return { label: 'Crítico', chip: 'bg-rose-50 text-rose-700 ring-rose-200', bar: 'bg-rose-500' };
}

type DomainTab = 'summary' | 'work' | 'planning' | 'costs' | 'governance' | 'meetings' | 'documents';

function domainFromLegacyTab(tab: string): DomainTab {
  if (tab === 'table' || tab === 'kanban') return 'work';
  if (tab === 'gantt' || tab === 'timeline') return 'planning';
  if (tab === 'costs') return 'costs';
  if (tab === 'governance') return 'governance';
  if (tab === 'meetings') return 'meetings';
  if (tab === 'documents') return 'documents';
  return 'summary';
}

export const ProjectCenter: React.FC = () => {
  const {
    tenant,
    currentWorkspace,
    selectedProjectId,
    objects,
    projectActiveSubTab,
    setProjectActiveSubTab,
    getProjectHealth,
    openCreateModal,
    openObjectDrawer,
    objectDataStatus,
    objectDataError,
    reloadObjects,
  } = useNexus();

  if (objectDataStatus === 'waiting' || objectDataStatus === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[1580px] px-6 py-8 lg:px-8">
        <div className="command-panel flex min-h-[240px] flex-col items-center justify-center text-center">
          <RefreshCw className="h-5 w-5 animate-spin text-green-700" />
          <h2 className="mt-4 text-[13px] font-bold text-slate-900">Cargando espacio del proyecto</h2>
          <p className="mt-1 text-[10px] text-slate-400">Preparando trabajo, planificación y control.</p>
        </div>
      </div>
    );
  }

  if (objectDataStatus === 'error') {
    return (
      <div className="mx-auto w-full max-w-[1580px] px-6 py-8 lg:px-8">
        <div className="command-panel border-rose-200 p-8">
          <p className="text-[13px] font-bold text-rose-700">No se pudo cargar el proyecto</p>
          <p className="mt-2 text-[11px] text-slate-500">{objectDataError || 'Error de datos no identificado.'}</p>
          <button onClick={() => void reloadObjects()} className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[11px] font-bold text-white hover:bg-green-800">
            <RefreshCw className="h-3.5 w-3.5" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  const project =
    objects.find((object) => object.id === selectedProjectId && object.type === 'PROJECT') ||
    objects.find((object) => object.type === 'PROJECT');

  if (!project) {
    return (
      <div className="mx-auto w-full max-w-[1580px] px-6 py-8 lg:px-8">
        <div className="command-panel flex min-h-[360px] flex-col items-center justify-center border-dashed text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 text-green-700"><ListTree className="h-5 w-5" /></div>
          <h2 className="mt-4 text-[15px] font-bold text-slate-900">Crea el primer proyecto del workspace</h2>
          <p className="mt-2 max-w-lg text-[11px] leading-5 text-slate-500">El proyecto será el contenedor de trabajo, planificación, costos, riesgos, decisiones y documentos.</p>
          <button onClick={() => openCreateModal('PROJECT')} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-green-700 px-4 text-[11px] font-bold text-white hover:bg-green-800">
            <Plus className="h-3.5 w-3.5" /> Crear proyecto
          </button>
        </div>
      </div>
    );
  }

  const health = getProjectHealth(project.id);
  const tone = healthTone(health.healthScore);
  const children = objects.filter((object) => object.projectId === project.id);
  const tasks = children.filter((object) => object.type === 'TASK');
  const openTasks = tasks.filter((task) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(task.status));
  const blocked = children.filter((object) => object.status === 'BLOCKED');
  const risks = children.filter((object) => object.type === 'RISK');
  const criticalRisks = risks.filter((risk) => (risk.riskScore || 0) >= 15 || risk.priority === 'CRITICAL');
  const milestones = children.filter((object) => object.type === 'MILESTONE');
  const nextMilestone = milestones
    .filter((item) => item.endDate && !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(item.status))
    .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''))[0];
  const budgetConfigured = (project.budgetTotal || 0) > 0;
  const domain = domainFromLegacyTab(projectActiveSubTab);

  const domainTabs: Array<{ id: DomainTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'summary', label: 'Resumen', icon: LayoutDashboard },
    { id: 'work', label: 'Trabajo', icon: Table2 },
    { id: 'planning', label: 'Planificación', icon: CalendarClock },
    { id: 'costs', label: 'Costos', icon: CircleDollarSign },
    { id: 'governance', label: 'Riesgos', icon: ShieldAlert },
    { id: 'meetings', label: 'Reuniones', icon: CalendarDays },
    { id: 'documents', label: 'Documentos', icon: FileText },
  ];

  const selectDomain = (next: DomainTab) => {
    if (next === 'summary') setProjectActiveSubTab('summary');
    if (next === 'work') setProjectActiveSubTab(projectActiveSubTab === 'kanban' ? 'kanban' : 'table');
    if (next === 'planning') setProjectActiveSubTab(projectActiveSubTab === 'timeline' ? 'timeline' : 'gantt');
    if (next === 'costs') setProjectActiveSubTab('costs');
    if (next === 'governance') setProjectActiveSubTab('governance');
    if (next === 'meetings') setProjectActiveSubTab('meetings');
    if (next === 'documents') setProjectActiveSubTab('documents');
  };

  return (
    <div className="mx-auto w-full max-w-[1580px] px-6 py-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold text-slate-400">
        <span>{tenant.name}</span><ChevronRight className="h-3 w-3" />
        <span>{currentWorkspace?.name || 'Workspace'}</span><ChevronRight className="h-3 w-3" />
        <span className="text-slate-700">{project.title}</span>
      </div>

      <section className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_10px_35px_rgba(15,23,42,0.035)] lg:px-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 max-w-4xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-[9px] font-black tracking-[0.08em] text-slate-500">BRI-{project.id.slice(0, 8).toUpperCase()}</span>
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-[9px] font-bold text-green-700 ring-1 ring-green-100">{project.status.replaceAll('_', ' ')}</span>
              <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ${tone.chip}`}>{health.healthScore} · {tone.label}</span>
            </div>
            <button onClick={() => openObjectDrawer(project.id)} className="mt-3 block max-w-full text-left">
              <h1 className="truncate text-[28px] font-extrabold tracking-[-0.035em] text-slate-950 transition hover:text-green-800">{project.title}</h1>
            </button>
            <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-slate-500">{project.description || 'Proyecto gestionado en Bridata.'}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => openObjectDrawer(project.id)} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50">Ficha del proyecto</button>
            <button onClick={() => openCreateModal('TASK')} className="flex h-10 items-center gap-2 rounded-xl bg-green-700 px-4 text-[11px] font-bold text-white shadow-[0_7px_18px_rgba(21,128,61,0.18)] transition hover:bg-green-800">
              <Plus className="h-3.5 w-3.5" /> Crear trabajo
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 lg:grid-cols-5">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Avance</p>
            <div className="mt-2 flex items-center gap-3"><span className="text-[22px] font-extrabold text-slate-950">{project.progress}%</span><div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, project.progress)}%` }} /></div></div>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Trabajo abierto</p>
            <p className="mt-2 text-[22px] font-extrabold text-slate-950">{openTasks.length}</p>
            <p className="text-[9px] text-slate-400">{blocked.length} bloqueados</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Riesgo crítico</p>
            <p className="mt-2 text-[22px] font-extrabold text-slate-950">{criticalRisks.length}</p>
            <p className="text-[9px] text-slate-400">de {risks.length} riesgos</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Próximo hito</p>
            <p className="mt-2 truncate text-[12px] font-bold text-slate-800">{nextMilestone?.title || 'Sin hito abierto'}</p>
            <p className="mt-1 text-[9px] text-slate-400">{shortDate(nextMilestone?.endDate)}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Fecha objetivo</p>
            <p className="mt-2 text-[13px] font-extrabold text-slate-950">{shortDate(project.endDate)}</p>
            <p className="mt-1 text-[9px] text-slate-400">{budgetConfigured ? `${health.budgetBurnPercentage}% presupuesto usado` : 'Cost Engine V2'}</p>
          </div>
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.025)]">
        <div className="border-b border-slate-100 px-3 pt-2.5">
          <div className="flex min-w-max items-center gap-1 overflow-x-auto no-scrollbar">
            {domainTabs.map((tab) => {
              const Icon = tab.icon;
              const active = domain === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => selectDomain(tab.id)}
                  className={`relative flex h-11 items-center gap-2 px-3.5 text-[11px] font-bold transition ${active ? 'text-green-800' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? 'text-green-700' : 'text-slate-400'}`} />
                  {tab.label}
                  {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-green-700" />}
                </button>
              );
            })}
          </div>
        </div>

        {(domain === 'work' || domain === 'planning') && (
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {domain === 'work' ? (
                <>
                  <button onClick={() => setProjectActiveSubTab('table')} className={`flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-bold ${projectActiveSubTab === 'table' ? 'bg-green-50 text-green-800' : 'text-slate-500 hover:bg-slate-50'}`}><Table2 className="h-3.5 w-3.5" /> Tabla</button>
                  <button onClick={() => setProjectActiveSubTab('kanban')} className={`flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-bold ${projectActiveSubTab === 'kanban' ? 'bg-green-50 text-green-800' : 'text-slate-500 hover:bg-slate-50'}`}><Kanban className="h-3.5 w-3.5" /> Kanban</button>
                </>
              ) : (
                <>
                  <button onClick={() => setProjectActiveSubTab('gantt')} className={`flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-bold ${projectActiveSubTab === 'gantt' ? 'bg-green-50 text-green-800' : 'text-slate-500 hover:bg-slate-50'}`}><CalendarClock className="h-3.5 w-3.5" /> Gantt / WBS</button>
                  <button onClick={() => setProjectActiveSubTab('timeline')} className={`flex h-8 items-center gap-2 rounded-lg px-3 text-[10px] font-bold ${projectActiveSubTab === 'timeline' ? 'bg-green-50 text-green-800' : 'text-slate-500 hover:bg-slate-50'}`}><ListTree className="h-3.5 w-3.5" /> Timeline</button>
                </>
              )}
            </div>
            <span className="hidden text-[9px] font-semibold text-slate-400 md:block">{children.length} objetos vinculados · una sola fuente de datos</span>
          </div>
        )}

        <div className="p-4 lg:p-5">
          {domain === 'summary' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.7fr)]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Pulso de ejecución</p>
                      <h2 className="mt-1 text-[15px] font-extrabold text-slate-950">Estado integrado del proyecto</h2>
                    </div>
                    <Activity className="h-5 w-5 text-green-700" />
                  </div>
                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <button onClick={() => selectDomain('work')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-green-200 hover:shadow-sm"><p className="text-[10px] font-bold text-slate-400">TRABAJO</p><p className="mt-2 text-lg font-extrabold text-slate-950">{openTasks.length} abiertos</p><p className="mt-1 text-[10px] text-slate-500">{blocked.length} requieren desbloqueo</p></button>
                    <button onClick={() => selectDomain('planning')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-green-200 hover:shadow-sm"><p className="text-[10px] font-bold text-slate-400">PLAN</p><p className="mt-2 text-lg font-extrabold text-slate-950">{project.progress}% avance</p><p className="mt-1 text-[10px] text-slate-500">Objetivo {shortDate(project.endDate)}</p></button>
                    <button onClick={() => selectDomain('governance')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-green-200 hover:shadow-sm"><p className="text-[10px] font-bold text-slate-400">CONTROL</p><p className="mt-2 text-lg font-extrabold text-slate-950">{criticalRisks.length} críticos</p><p className="mt-1 text-[10px] text-slate-500">de {risks.length} riesgos registrados</p></button>
                  </div>
                </div>
                <ProjectMaterialRiskStrip projectId={project.id} />
                <ProjectCostRiskStrip projectId={project.id} />
              </div>

              <aside className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Accesos del proyecto</p>
                <div className="mt-3 space-y-1">
                  {domainTabs.filter((tab) => tab.id !== 'summary').map((tab) => {
                    const Icon = tab.icon;
                    return <button key={tab.id} onClick={() => selectDomain(tab.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"><div className="grid h-8 w-8 place-items-center rounded-xl bg-green-50 text-green-700"><Icon className="h-4 w-4" /></div><span className="flex-1 text-[11px] font-semibold text-slate-700">{tab.label}</span><ArrowUpRight className="h-3.5 w-3.5 text-slate-300" /></button>;
                  })}
                </div>
              </aside>
            </div>
          )}
          {projectActiveSubTab === 'table' && <TableView projectId={project.id} />}
          {projectActiveSubTab === 'kanban' && <KanbanView projectId={project.id} />}
          {projectActiveSubTab === 'gantt' && (
            <>
              <ProjectMaterialRiskStrip projectId={project.id} />
              <ProjectCostRiskStrip projectId={project.id} />
              <WbsGanttV2View projectId={project.id} />
            </>
          )}
          {projectActiveSubTab === 'costs' && <ProjectCostsV2View projectId={project.id} embedded />}
          {projectActiveSubTab === 'timeline' && <TimelineView projectId={project.id} />}
          {projectActiveSubTab === 'governance' && <GovernanceRiskView projectId={project.id} />}
          {projectActiveSubTab === 'meetings' && <MeetingsDecisionsView projectId={project.id} />}
          {projectActiveSubTab === 'documents' && <DocumentsApprovalsView projectId={project.id} />}
        </div>
      </section>
    </div>
  );
};
