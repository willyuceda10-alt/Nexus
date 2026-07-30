import React from 'react';
import { Calendar, AlertTriangle, Layers, Clock } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const GanttView: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer } = useNexus();

  const items = objects.filter(
    (o) => (o.projectId === projectId || o.id === projectId) && (o.type === 'TASK' || o.type === 'DELIVERABLE' || o.type === 'MILESTONE')
  );

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center space-x-2">
          <Calendar className="h-4 w-4 text-indigo-600" />
          <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
            Cronograma Gantt de Entregables y Hitos (Ruta Crítica)
          </h3>
        </div>
        <div className="flex items-center space-x-3 text-[11px]">
          <span className="flex items-center space-x-1">
            <span className="h-2.5 w-2.5 rounded bg-indigo-600"></span>
            <span className="text-slate-500">En Progreso</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="h-2.5 w-2.5 rounded bg-rose-600"></span>
            <span className="text-slate-500">Ruta Crítica / Bloqueado</span>
          </span>
          <span className="flex items-center space-x-1">
            <span className="h-2.5 w-2.5 rounded bg-emerald-600"></span>
            <span className="text-slate-500">Completado</span>
          </span>
        </div>
      </div>

      {/* Gantt Timeline Grid */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Month Header Row */}
          <div className="grid grid-cols-12 border-b border-slate-200 py-2 text-center text-[10px] font-bold uppercase text-slate-400 dark:border-slate-800">
            <div className="col-span-3 text-left pl-2">Entregable / Objeto</div>
            {months.slice(0, 9).map((m, idx) => (
              <div key={idx} className="col-span-1 border-l border-slate-100 dark:border-slate-800">
                {m} 2026
              </div>
            ))}
          </div>

          {/* Gantt Bars */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {items.map((item, idx) => {
              // Calculate horizontal position demo mock
              const startCol = (idx % 6) + 1;
              const spanCol = (idx % 3) + 2;
              const isCritical = item.priority === 'CRITICAL' || item.status === 'BLOCKED';
              const isCompleted = item.status === 'COMPLETED';

              return (
                <div
                  key={item.id}
                  onClick={() => openObjectDrawer(item.id)}
                  className="grid cursor-pointer grid-cols-12 items-center py-3 transition hover:bg-indigo-50/30 dark:hover:bg-slate-800/50"
                >
                  {/* Title Col */}
                  <div className="col-span-3 pl-2 pr-2 truncate">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">{item.title}</div>
                    <div className="text-[10px] text-slate-400">{item.type} | #{item.id}</div>
                  </div>

                  {/* Timeline Bar Area */}
                  <div className="col-span-9 relative h-7 flex items-center">
                    <div
                      className={`absolute h-5 rounded-lg text-[10px] font-bold text-white flex items-center px-2 shadow-xs transition hover:scale-102 ${
                        isCompleted
                          ? 'bg-emerald-600'
                          : isCritical
                          ? 'bg-rose-600 animate-pulse'
                          : 'bg-indigo-600'
                      }`}
                      style={{
                        left: `${(startCol / 9) * 100}%`,
                        width: `${(spanCol / 9) * 100}%`,
                      }}
                    >
                      <span className="truncate">{item.progress}% - {item.title}</span>
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
