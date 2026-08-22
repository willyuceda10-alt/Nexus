import React from 'react';
import {
  Table as TableIcon,
  Kanban,
  Calendar,
  Clock,
  ShieldAlert,
  CalendarDays,
  FileCheck2,
  Activity,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { TableView } from './TableView';
import { KanbanView } from './KanbanView';
import { GanttView } from './GanttView';
import { TimelineView } from './TimelineView';
import { GovernanceRiskView } from './GovernanceRiskView';
import { MeetingsDecisionsView } from './MeetingsDecisionsView';
import { DocumentsApprovalsView } from './DocumentsApprovalsView';

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
      <div className="p-8 max-w-7xl mx-auto">
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <RefreshCw className="mx-auto h-5 w-5 animate-spin text-indigo-600" />
          <h2 className="mt-3 text-sm font-bold text-slate-900">Cargando proyectos del workspace</h2>
          <p className="mt-1 text-xs text-slate-500">Bridata Project está consultando la fuente de datos activa.</p>
        </div>
      </div>
    );
  }

  if (objectDataStatus === 'error') {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
          <h2 className="text-sm font-bold text-rose-700">No se pudieron cargar los proyectos</h2>
          <p className="mt-2 text-xs text-slate-600">{objectDataError || 'Error de datos no identificado.'}</p>
          <button
            onClick={() => void reloadObjects()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
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
      <div className="p-8 max-w-7xl mx-auto">
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm">
          <h2 className="text-base font-bold text-slate-900">Este workspace todavía no tiene proyectos</h2>
          <p className="mx-auto mt-2 max-w-xl text-xs text-slate-500">
            Crea el primer proyecto para comenzar a registrar tareas, hitos, riesgos y entregables.
          </p>
          <button
            onClick={() => openCreateModal('PROJECT')}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Crear primer proyecto
          </button>
        </div>
      </div>
    );
  }

  const health = getProjectHealth(project.id);

  const subTabs = [
    { id: 'table', label: 'Tabla Inteligente', icon: TableIcon },
    { id: 'kanban', label: 'Tablero Kanban', icon: Kanban },
    { id: 'gantt', label: 'Cronograma Gantt', icon: Calendar },
    { id: 'timeline', label: 'Timeline / Eventos', icon: Clock },
    { id: 'governance', label: 'Riesgos & Cambios', icon: ShieldAlert },
    { id: 'meetings', label: 'Reuniones & Decisiones', icon: CalendarDays },
    { id: 'documents', label: 'Bóveda Documental', icon: FileCheck2 },
  ];

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1
            onClick={() => openObjectDrawer(project.id)}
            className="text-2xl font-bold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors"
          >
            {project.title}
          </h1>
          <p className="text-slate-500 text-sm">
            {project.description || 'Proyecto gestionado en Bridata Project'} • ID: BRI-{project.id.slice(0, 8)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors"
          >
            Exportar Reporte
          </button>
          <button
            onClick={() => openCreateModal('TASK')}
            className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-semibold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo objeto</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Salud del Proyecto</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${health.healthScore >= 80 ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-600'}`}>
              {health.healthScore >= 80 ? 'Estable' : 'Atención'}
            </span>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-slate-900">{health.healthScore}%</span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full mb-2 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${health.healthScore}%` }} />
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Presupuesto</span>
            <button
              className="text-indigo-600 text-[10px] font-bold uppercase hover:underline"
              onClick={() => setProjectActiveSubTab('table')}
            >
              Ver Detalle
            </button>
          </div>
          <div className="space-y-1">
            <span className="text-2xl font-bold text-slate-900">${((project.budgetSpent || 0) / 1000000).toFixed(1)}M</span>
            <p className="text-[10px] text-slate-400">
              de ${((project.budgetTotal || 0) / 1000000).toFixed(1)}M comprometidos ({health.budgetBurnPercentage}%)
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Riesgos Activos</span>
            <span className="text-red-500 text-[10px] font-bold bg-red-50 px-2 py-0.5 rounded-full">
              {health.criticalRisksCount} Críticos
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-rose-400" />
            <span className="text-2xl font-bold text-slate-900">
              {objects.filter((object) => object.projectId === project.id && object.type === 'RISK').length}
            </span>
            <span className="text-[10px] text-slate-400">registrados</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Avance / Fin</span>
            <span className="text-slate-400 text-xs font-medium">{project.progress}% Físico</span>
          </div>
          <div className="space-y-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">{project.endDate || 'S/D'}</span>
            <p className="text-[10px] text-slate-400">Entrega del proyecto</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-xs flex items-center justify-between overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 min-w-max">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = projectActiveSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setProjectActiveSubTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6">
        {projectActiveSubTab === 'table' && <TableView projectId={project.id} />}
        {projectActiveSubTab === 'kanban' && <KanbanView projectId={project.id} />}
        {projectActiveSubTab === 'gantt' && <GanttView projectId={project.id} />}
        {projectActiveSubTab === 'timeline' && <TimelineView projectId={project.id} />}
        {projectActiveSubTab === 'governance' && <GovernanceRiskView projectId={project.id} />}
        {projectActiveSubTab === 'meetings' && <MeetingsDecisionsView projectId={project.id} />}
        {projectActiveSubTab === 'documents' && <DocumentsApprovalsView projectId={project.id} />}
      </div>
    </div>
  );
};
