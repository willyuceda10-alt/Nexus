import React from 'react';
import { Clock, ShieldAlert, Calendar, FileCheck, CheckCircle2, User, ArrowRight } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const TimelineView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const { activityLogs, objects, openObjectDrawer } = useNexus();

  const filteredLogs = projectId
    ? activityLogs.filter((log) => {
        const target = objects.find((o) => o.id === log.objectId);
        return target?.projectId === projectId || target?.id === projectId;
      })
    : activityLogs;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-2">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center space-x-2">
            <Clock className="h-5 w-5 text-indigo-600" />
            <span>Time Machine: Auditoría e Historial Cronológico</span>
          </h2>
          <p className="text-xs text-slate-500">
            Registro inmutable de decisiones, riesgos realizados, aprobaciones y cambios.
          </p>
        </div>
      </div>

      <div className="relative border-l-2 border-indigo-200 pl-6 space-y-6 dark:border-indigo-900">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            No se registran eventos aún en la línea de tiempo.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const targetObj = objects.find((o) => o.id === log.objectId);

            return (
              <div key={log.id} className="relative group">
                {/* Node Bullet */}
                <div className="absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-indigo-600 shadow-xs dark:border-slate-900" />

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <img src={log.userAvatar} alt="" className="h-5 w-5 rounded-full object-cover" />
                      <span className="font-bold text-slate-800 dark:text-slate-200">{log.userName}</span>
                      <span className="text-slate-400">•</span>
                      <span className="text-slate-500 font-mono">{new Date(log.timestamp).toLocaleString()}</span>
                    </div>

                    {targetObj && (
                      <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        {targetObj.type}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {log.action}
                  </p>

                  {targetObj && (
                    <div
                      onClick={() => openObjectDrawer(targetObj.id)}
                      className="mt-3 flex cursor-pointer items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs transition hover:bg-indigo-50/50 dark:border-slate-800 dark:bg-slate-800/60"
                    >
                      <div>
                        <div className="font-bold text-slate-800 dark:text-slate-200">{targetObj.title}</div>
                        <div className="text-[11px] text-slate-400">ID: #{targetObj.id} | Estado: {targetObj.status}</div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
