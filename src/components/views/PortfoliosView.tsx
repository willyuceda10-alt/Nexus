import React from 'react';
import { Layers } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const PortfoliosView: React.FC = () => {
  const { portfolios, objects, setSelectedProjectId, setActiveTab } = useNexus();

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 flex items-center space-x-2">
            <Layers className="h-5 w-5 text-indigo-600" />
            <span>Portafolios & Programas Estratégicos</span>
          </h1>
          <p className="text-xs text-slate-500">Agrupación corporativa de proyectos para gobernanza financiera.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {portfolios.map((p) => {
          const portfolioProjects = objects.filter((o) => p.projectIds.includes(o.id));
          const executionPercentage = p.budgetAllocated
            ? Math.round((p.budgetSpent / p.budgetAllocated) * 100)
            : 0;

          return (
            <div
              key={p.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400">{p.code}</span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{p.name}</h3>
                </div>
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                  {p.projectIds.length} Proyectos
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-500 line-clamp-2">{p.description}</p>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl dark:bg-slate-800/50">
                <div>
                  <span className="text-slate-400 font-medium">Presupuesto Asignado:</span>
                  <div className="font-extrabold text-slate-900 dark:text-slate-100">
                    ${(p.budgetAllocated / 1000000).toFixed(1)}M USD
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Ejecutado a la Fecha:</span>
                  <div className="font-extrabold text-indigo-600">
                    ${(p.budgetSpent / 1000000).toFixed(1)}M USD · {executionPercentage}%
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Proyectos Asociados:</div>
                {portfolioProjects.map((prj) => (
                  <button
                    type="button"
                    key={prj.id}
                    onClick={() => {
                      setSelectedProjectId(prj.id);
                      setActiveTab('project');
                    }}
                    className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-left text-xs transition hover:bg-indigo-50/50 dark:border-slate-800 dark:bg-slate-800/60"
                  >
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{prj.title}</span>
                    <span className="font-mono text-indigo-600 font-bold">{prj.progress}%</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
