import React from 'react';
import { Plus, MoreHorizontal, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { NexusObject, ObjectStatus } from '../../types/nexus';

export const KanbanView: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer, openCreateModal, updateNexusObject } = useNexus();

  const projectObjects = objects.filter((o) => o.projectId === projectId || o.id === projectId);

  const columns: { id: string; title: string; color: string; statuses: ObjectStatus[] }[] = [
    {
      id: 'backlog',
      title: 'Planificación & Borrador',
      color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      statuses: ['DRAFT', 'PLANNING', 'IDENTIFIED'],
    },
    {
      id: 'progress',
      title: 'En Progreso',
      color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
      statuses: ['IN_PROGRESS'],
    },
    {
      id: 'review',
      title: 'En Revisión / Firma',
      color: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
      statuses: ['IN_REVIEW', 'PENDING_APPROVAL'],
    },
    {
      id: 'blocked',
      title: 'Bloqueado / Riesgo',
      color: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
      statuses: ['BLOCKED'],
    },
    {
      id: 'done',
      title: 'Completado & Aprobado',
      color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
      statuses: ['COMPLETED', 'APPROVED'],
    },
  ];

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => {
        const colObjects = projectObjects.filter((o) => col.statuses.includes(o.status));

        return (
          <div
            key={col.id}
            className="flex h-[calc(100vh-14rem)] w-72 flex-col rounded-2xl border border-slate-200 bg-slate-50/70 p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900/40"
          >
            {/* Column Header */}
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center space-x-2">
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${col.color}`}>
                  {col.title}
                </span>
                <span className="text-xs font-mono font-bold text-slate-400">{colObjects.length}</span>
              </div>
              <button
                onClick={() => openCreateModal('TASK')}
                className="rounded p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {/* Column Cards */}
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {colObjects.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400 dark:border-slate-800">
                  Sin items aquí
                </div>
              ) : (
                colObjects.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => openObjectDrawer(item.id)}
                    className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs transition hover:border-indigo-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-800"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-slate-400 uppercase">{item.type}</span>
                      <span
                        className={`rounded px-1.5 py-0.2 font-extrabold ${
                          item.priority === 'CRITICAL'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {item.priority}
                      </span>
                    </div>

                    <h4 className="mt-2 text-xs font-bold text-slate-900 group-hover:text-indigo-600 dark:text-slate-100">
                      {item.title}
                    </h4>

                    {item.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                        {item.description}
                      </p>
                    )}

                    {/* Footer */}
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400 dark:border-slate-700">
                      <div className="flex items-center space-x-1">
                        <img src={item.ownerAvatar} alt="" className="h-4 w-4 rounded-full" />
                        <span className="truncate max-w-[80px]">{item.ownerName.split(' ')[0]}</span>
                      </div>
                      <span className="font-mono font-bold text-indigo-600">{item.progress}%</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
