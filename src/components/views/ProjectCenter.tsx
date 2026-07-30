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
  Sparkles,
  TrendingUp,
  DollarSign,
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
  } = useNexus();

  const project = objects.find((o) => o.id === selectedProjectId) || objects.find((o) => o.type === 'PROJECT');

  if (!project) {
    return (
      <div className="p-8 text-center text-xs text-slate-400">
        No hay ningún proyecto seleccionado. Por favor selecciona uno en el menú lateral.
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
      {/* Title & Main Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1
            onClick={() => openObjectDrawer(project.id)}
            className="text-2xl font-bold text-slate-900 cursor-pointer hover:text-indigo-600 transition-colors"
          >
            {project.title}
          </h1>
          <p className="text-slate-500 text-sm">
            {project.description || 'Proyecto SaaS Nexus'} • ID: NEX-{project.id}
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
            <span>+ Nuevo Objeto</span>
          </button>
        </div>
      </div>

      {/* 4 Stat Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Card 1: Health */}
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
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${health.healthScore}%` }}></div>
            </div>
          </div>
        </div>

        {/* Card 2: Budget */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Presupuesto</span>
            <span className="text-indigo-600 text-[10px] font-bold uppercase cursor-pointer hover:underline" onClick={() => setProjectActiveSubTab('table')}>
              Ver Detalle
            </span>
          </div>
          <div className="space-y-1">
            <span className="text-2xl font-bold text-slate-900">${((project.budgetSpent || 0) / 1000000).toFixed(1)}M</span>
            <p className="text-[10px] text-slate-400">
              de ${((project.budgetTotal || 1) / 1000000).toFixed(1)}M comprometidos ({health.budgetBurnPercentage}%)
            </p>
          </div>
        </div>

        {/* Card 3: Risks */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Riesgos Activos</span>
            <span className="text-red-500 text-[10px] font-bold bg-red-50 px-2 py-0.5 rounded-full">
              {health.criticalRisksCount} Críticos
            </span>
          </div>
          <div className="flex -space-x-2 items-center">
            <div className="w-8 h-8 rounded-full bg-orange-400 border-2 border-white flex items-center justify-center text-white text-[10px] font-bold">H</div>
            <div className="w-8 h-8 rounded-full bg-red-400 border-2 border-white flex items-center justify-center text-white text-[10px] font-bold">C</div>
            <div className="w-8 h-8 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-slate-400 text-[10px] font-bold">
              +{objects.filter(o => o.projectId === project.id && o.type === 'RISK').length}
            </div>
          </div>
        </div>

        {/* Card 4: Schedule */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between h-32">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Avance / Fin</span>
            <span className="text-slate-400 text-xs font-medium">{project.progress}% Físico</span>
          </div>
          <div className="space-y-1">
            <span className="text-2xl font-bold text-slate-900 font-mono">{project.endDate || '14 JUN'}</span>
            <p className="text-[10px] text-slate-400">Entrega de Hito Principal</p>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs Pill Navigation */}
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

      {/* Sub-View Component Renderer */}
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
