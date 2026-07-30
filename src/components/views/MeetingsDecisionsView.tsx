import React from 'react';
import { CalendarDays, Plus, CheckCircle2, User, ArrowRight, MessageSquare, Layers } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const MeetingsDecisionsView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer, openCreateModal, createNexusObject, addRelation } = useNexus();

  const meetings = objects.filter((o) => o.type === 'MEETING' && (!projectId || o.projectId === projectId));
  const decisions = objects.filter((o) => o.type === 'DECISION' && (!projectId || o.projectId === projectId));

  const handleCreateTaskFromMeeting = (meetingId: string, title: string) => {
    const newTaskId = `tsk-${Date.now().toString().slice(-4)}`;
    createNexusObject({
      type: 'TASK',
      title: `[Acción] ${title}`,
      description: `Tarea derivada de la minuta de reunión #${meetingId}`,
      status: 'IN_PROGRESS',
      priority: 'HIGH',
    });
    addRelation(meetingId, newTaskId, 'DERIVED_FROM');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between rounded-2xl bg-gradient-to-r from-sky-900 via-indigo-950 to-slate-900 p-5 text-white shadow-xl">
        <div>
          <div className="flex items-center space-x-2 text-sky-300 text-xs font-bold uppercase tracking-wider">
            <CalendarDays className="h-4 w-4" />
            <span>Centro de Reuniones, Minutas & Registro de Decisiones</span>
          </div>
          <h1 className="mt-1 text-xl font-extrabold">Gobierno de Minutas & Acuerdos Ejecutivos</h1>
          <p className="mt-1 text-xs text-sky-100/80">
            {meetings.length} Reuniones Registradas • {decisions.length} Decisiones Formales
          </p>
        </div>

        <div className="mt-4 md:mt-0 flex space-x-2">
          <button
            onClick={() => openCreateModal('MEETING')}
            className="flex items-center space-x-1.5 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-md hover:bg-sky-400"
          >
            <Plus className="h-4 w-4" />
            <span>Agendar Reunión</span>
          </button>
          <button
            onClick={() => openCreateModal('DECISION')}
            className="flex items-center space-x-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white shadow-md hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" />
            <span>Registrar Decisión</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Meetings Section */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            Minutas de Reuniones & Compromisos
          </h3>

          <div className="space-y-3">
            {meetings.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">Sin reuniones registradas.</div>
            ) : (
              meetings.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-sky-300 dark:border-slate-800 dark:bg-slate-800/60"
                >
                  <div className="flex items-center justify-between">
                    <span
                      onClick={() => openObjectDrawer(m.id)}
                      className="text-xs font-bold text-slate-900 cursor-pointer hover:text-sky-600 dark:text-slate-100"
                    >
                      {m.title}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">{m.startDate}</span>
                  </div>

                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                    {m.description || 'Sin minuta registrada.'}
                  </p>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2 text-xs dark:border-slate-700">
                    <div className="flex items-center space-x-1.5 text-slate-500">
                      <User className="h-3.5 w-3.5" />
                      <span>Organizador: {m.ownerName}</span>
                    </div>

                    <button
                      onClick={() => handleCreateTaskFromMeeting(m.id, m.title)}
                      className="flex items-center space-x-1 rounded bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300"
                    >
                      <span>+ Derivar Tarea</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Decision Log Section */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
            Log de Decisiones Ejecutivas Inmutables
          </h3>

          <div className="space-y-3">
            {decisions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">Sin decisiones registradas.</div>
            ) : (
              decisions.map((d) => (
                <div
                  key={d.id}
                  onClick={() => openObjectDrawer(d.id)}
                  className="cursor-pointer rounded-xl border border-purple-200 bg-purple-50/50 p-4 transition hover:border-purple-400 dark:border-purple-900/50 dark:bg-purple-950/20"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-950 dark:text-purple-200">{d.title}</span>
                    <span className="rounded bg-purple-200 px-2 py-0.5 text-[10px] font-extrabold text-purple-900 dark:bg-purple-900 dark:text-purple-100">
                      Aprobado
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-purple-900/80 dark:text-purple-300/80 line-clamp-2">
                    {d.description || 'Justificación no especificada.'}
                  </p>

                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-purple-700 dark:text-purple-300">
                    <span>Autorizador: {d.ownerName}</span>
                    <span>Fecha: {d.startDate || 'Inmediata'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
