import React from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Calendar,
  Layers,
  ArrowUpRight,
  TrendingUp,
  Plus,
  ShieldCheck,
  FileCheck2,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

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

  const projects = objects.filter((o) => o.type === 'PROJECT');
  const myTasks = objects.filter(
    (o) => (o.assigneeId === currentUser.id || o.ownerId === currentUser.id) && o.status !== 'COMPLETED'
  );
  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING');
  const criticalRisks = objects.filter((o) => o.type === 'RISK' && (o.riskScore || 0) >= 15);

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between rounded-2xl bg-slate-900 p-6 text-white shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-indigo-300 text-xs font-bold uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Workspace: {currentWorkspace?.name || 'Visión Global'}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Bienvenido, {currentUser.name}
          </h1>
          <p className="text-slate-400 text-xs">
            {currentUser.roleName} • {projects.length} Proyectos Activos • {pendingApprovals.length} Aprobaciones Pendientes
          </p>
        </div>

        <div className="mt-4 md:mt-0 flex items-center gap-3">
          <button
            onClick={() => openCreateModal('TASK')}
            className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-semibold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>+ Nuevo Objeto</span>
          </button>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {/* Widget 1: Focus Today (My Tasks) */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">
                Foco Hoy (Mis Asignaciones)
              </h2>
            </div>
            <span className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full text-[10px] font-bold">
              {myTasks.length} Pendientes
            </span>
          </div>

          <div className="mt-3 space-y-2.5">
            {myTasks.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                ¡Todo al día! No tienes tareas pendientes.
              </div>
            ) : (
              myTasks.slice(0, 4).map((task) => (
                <div
                  key={task.id}
                  onClick={() => openObjectDrawer(task.id)}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:bg-indigo-50/40 hover:border-indigo-200"
                >
                  <div className="flex items-center gap-3">
                    <span className="bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold shadow-2xs">
                      {task.type}
                    </span>
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        {task.title}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Prioridad: {task.priority} | Fin: {task.endDate || 'S/D'}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-indigo-600">{task.progress}%</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Widget 2: Pending Approvals Banner */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Aprobaciones</span>
            <span className="text-amber-600 text-[10px] font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
              {pendingApprovals.length} Pendientes
            </span>
          </div>
          <div className="my-3 space-y-1">
            <span className="text-3xl font-bold text-slate-900">{pendingApprovals.length}</span>
            <p className="text-[10px] text-slate-400">
              Solicitudes de cambio esperando resolución ejecutiva.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('inbox')}
            className="w-full py-2 text-xs font-bold text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5"
          >
            <span>Revisar Inbox</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Widget 3: Critical Risk Radar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Riesgos Críticos</span>
            <span className="text-red-500 text-[10px] font-bold bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
              {criticalRisks.length} Activos
            </span>
          </div>
          <div className="my-3 space-y-1">
            <span className="text-3xl font-bold text-slate-900">{criticalRisks.length}</span>
            <p className="text-[10px] text-slate-400">
              Riesgos activos con alto impacto en tiempo o costo.
            </p>
          </div>
          <button
            onClick={() => setActiveTab('governance')}
            className="w-full py-2 text-xs font-bold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5"
          >
            <span>Ver Gobernanza</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Widget 4: Project Health Gauges */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              <h2 className="text-sm font-bold text-slate-900">
                Salud Digest de Proyectos Activos (Project Health Score)
              </h2>
            </div>
            <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">H=0.35S + 0.25B + 0.2R + 0.2T</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {projects.map((prj) => {
              const metrics = getProjectHealth(prj.id);
              return (
                <div
                  key={prj.id}
                  onClick={() => {
                    setSelectedProjectId(prj.id);
                    setActiveTab('project');
                  }}
                  className="group cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-indigo-400 hover:bg-white hover:shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                      {prj.title}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                        metrics.healthScore >= 80
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                          : 'bg-amber-50 text-amber-600 border-amber-100'
                      }`}
                    >
                      {metrics.healthScore}% Salud
                    </span>
                  </div>

                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between text-slate-500 text-[11px]">
                      <span>Avance Físico:</span>
                      <span className="font-bold text-slate-900">{prj.progress}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-600"
                        style={{ width: `${prj.progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 pt-1">
                      <span>Presupuesto: ${((prj.budgetSpent || 0) / 1000000).toFixed(1)}M / ${((prj.budgetTotal || 1) / 1000000).toFixed(1)}M</span>
                      <span>Riesgos: {metrics.criticalRisksCount}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
