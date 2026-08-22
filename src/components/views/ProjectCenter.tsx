import React from 'react';
import {
  CalendarClock,
  CalendarDays,
  FileText,
  Kanban,
  ListTree,
  Plus,
  RefreshCw,
  ShieldAlert,
  Table2,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { TableView } from './TableView';
import { KanbanView } from './KanbanView';
import { GanttView } from './GanttView';
import { ForecastSummary } from './ForecastSummary';
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

export const ProjectCenter: React.FC = () => {
  const {
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
      <div className="mx-auto w-full max-w-[1500px] px-6 py-8 lg:px-8">
        <div className="command-panel flex min-h-[240px] flex-col items-center justify-center text-center">
          <RefreshCw className="h-5 w-5 animate-spin text-green-700" />
          <h2 className="mt-4 text-[13px] font-bold text-slate-900">Cargando el proyecto</h2>
          <p className="mt-1 text-[10px] text-slate-400">Consultando la fuente de datos activa de Bridata Project.</p>
        </div>
      </div>
    );
  }

  if (objectDataStatus === 'error') {
    return (
      <div className="mx-auto w-full max-w-[1500px] px-6 py-8 lg:px-8">
        <div className="command-panel border-rose-200 p-8">
          <p className="text-[13px] font-bold text-rose-700">No se pudieron cargar los proyectos</p>
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
      <div className="mx-auto w-full max-w-[1500px] px-6 py-8 lg:px-8">
        <div className="command-panel flex min-h-[360px] flex-col items-center justify-center border-dashed text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 text-green-700"><ListTree className="h-5 w-5" /></div>
          <h2 className="mt-4 text-[15px] font-bold text-slate-900">Crea el primer proyecto del workspace</h2>
          <p className="mt-2 max-w-lg text-[11px] leading-5 text-slate-500">El proyecto será el punto de entrada para tareas, hitos, riesgos, entregables, decisiones y documentos.</p>
          <button onClick={() => openCreateModal('PROJECT')} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-[11px] font-bold text-white">
            <Plus className="h-3.5 w-3.5" /> Crear proyecto
          </button>
        </div>
      </div>
    );
  }

  const health = getProjectHealth(project.id);
  const children = objects.filter((object) => object.projectId === project.id);
  const tasks = children.filter((object) => object.type === 'TASK');
  const openTasks = tasks.filter((task) => !['COMPLETED', 'CANCELLED', 'APPROVED'].includes(task.status));
  const blocked = children.filter((object) => object.status === 'BLOCKED');
  const risks = children.filter((object) => object.type === 'RISK');
  const criticalRisks = risks.filter((risk) => (risk.riskScore || 0) >= 15 || risk.priority === 'CRITICAL');
  const budgetConfigured = (project.budgetTotal || 0) > 0;

  const tabs = [
    { id: 'table', label: 'Tabla', icon: Table2 },
    { id: 'kanban', label: 'Kanban', icon: Kanban },
    { id: 'gantt', label: 'Gantt', icon: CalendarClock },
    { id: 'timeline', label: 'Timeline', icon: ListTree },
    { id: 'governance', label: 'Riesgos', icon: ShieldAlert },
    { id: 'meetings', label: 'Reuniones', icon: CalendarDays },
    { id: 'documents', label: 'Documentos', icon: FileText },
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold text-slate-400">
            <span className="rounded-md bg-slate-100 px-2 py-1 font-bold text-slate-500">BRI-{project.id.slice(0, 8).toUpperCase()}</span>
            <span>•</span>
            <span>{project.status.replaceAll('_', ' ')}</span>
          </div>
          <button onClick={() => openObjectDrawer(project.id)} className="block max-w-full text-left">
            <h1 className="truncate text-[27px] font-extrabold tracking-[-0.03em] text-slate-950 transition hover:text-green-800">{project.title}</h1>
          </button>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-slate-500">{project.description || 'Proyecto gestionado en Bridata Project.'}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => window.print()} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50">Exportar</button>
          <button onClick={() => openCreateModal('TASK')} className="flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-[11px] font-bold text-white transition hover:bg-slate-800">
            <Plus className="h-3.5 w-3.5" /> Nueva tarea
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="command-kpi-card !min-h-[122px] !p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Salud</p>
          <div className="mt-4 flex items-end justify-between">
            <p className="text-[25px] font-extrabold text-slate-950">{health.healthScore}</p>
            <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${health.healthScore >= 80 ? 'bg-emerald-50 text-emerald-700' : health.healthScore >= 65 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
              {health.healthScore >= 80 ? 'En control' : health.healthScore >= 65 ? 'Atención' : 'Crítico'}
            </span>
          </div>
        </div>

        <div className="command-kpi-card !min-h-[122px] !p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Avance</p>
          <p className="mt-4 text-[25px] font-extrabold text-slate-950">{project.progress}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, project.progress)}%` }} /></div>
        </div>

        <div className="command-kpi-card !min-h-[122px] !p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Trabajo abierto</p>
          <p className="mt-4 text-[25px] font-extrabold text-slate-950">{openTasks.length}</p>
          <p className="mt-1 text-[9px] font-medium text-slate-400">{blocked.length} bloqueados</p>
        </div>

        <div className="command-kpi-card !min-h-[122px] !p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Riesgo</p>
          <p className="mt-4 text-[25px] font-extrabold text-slate-950">{criticalRisks.length}</p>
          <p className="mt-1 text-[9px] font-medium text-slate-400">críticos de {risks.length}</p>
        </div>

        <div className="command-kpi-card !min-h-[122px] !p-4">
          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Fecha objetivo</p>
          <p className="mt-4 text-[16px] font-extrabold text-slate-950">{shortDate(project.endDate)}</p>
          <p className="mt-1 text-[9px] font-medium text-slate-400">{budgetConfigured ? `${health.budgetBurnPercentage}% presupuesto usado` : 'Sin presupuesto cargado'}</p>
        </div>
      </section>

      <section className="command-panel overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-3 py-2.5">
          <div className="flex min-w-max items-center gap-1 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = projectActiveSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setProjectActiveSubTab(tab.id)}
                  className={`flex h-9 items-center gap-2 rounded-xl px-3 text-[10px] font-bold transition ${active ? 'bg-green-700 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
                >
                  <Icon className="h-3.5 w-3.5" /> {tab.label}
                </button>
              );
            })}
          </div>
          <div className="hidden text-[9px] font-medium text-slate-400 xl:block">{children.length} objetos vinculados</div>
        </div>

        <div className="p-4 lg:p-5">
          {projectActiveSubTab === 'table' && <TableView projectId={project.id} />}
          {projectActiveSubTab === 'kanban' && <KanbanView projectId={project.id} />}
          {projectActiveSubTab === 'gantt' && (
            <>
              <ForecastSummary projectId={project.id} />
              <GanttView projectId={project.id} />
            </>
          )}
          {projectActiveSubTab === 'timeline' && <TimelineView projectId={project.id} />}
          {projectActiveSubTab === 'governance' && <GovernanceRiskView projectId={project.id} />}
          {projectActiveSubTab === 'meetings' && <MeetingsDecisionsView projectId={project.id} />}
          {projectActiveSubTab === 'documents' && <DocumentsApprovalsView projectId={project.id} />}
        </div>
      </section>
    </div>
  );
};
