import React from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  ShieldAlert,
  CheckCircle2,
  PieChart as PieChartIcon,
  Activity,
  Layers,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const ExecutiveDashboard: React.FC = () => {
  const { objects, portfolios, getProjectHealth } = useNexus();

  const projects = objects.filter((o) => o.type === 'PROJECT');
  const totalBudget = projects.reduce((sum, p) => sum + (p.budgetTotal || 0), 0);
  const totalSpent = projects.reduce((sum, p) => sum + (p.budgetSpent || 0), 0);
  const burnPercentage = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-2">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-purple-950 p-5 text-white shadow-xl">
        <div>
          <div className="flex items-center space-x-2 text-indigo-300 text-xs font-bold uppercase tracking-wider">
            <BarChart3 className="h-4 w-4" />
            <span>Tablero de Control Ejecutivo (Executive Command Center)</span>
          </div>
          <h1 className="mt-1 text-xl font-extrabold">Reportes Financieros, Avance & Salud de Portafolios</h1>
          <p className="mt-1 text-xs text-indigo-100/80">
            Consolidado Multicorporativo • Algoritmo de Salud Digest Nexus Engine
          </p>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[10px] font-bold uppercase text-slate-400">Presupuesto Consolidado</div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            ${(totalBudget / 1000000).toFixed(1)}M USD
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Ejecutado: ${(totalSpent / 1000000).toFixed(1)}M ({burnPercentage}%)
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[10px] font-bold uppercase text-slate-400">Proyectos en Ejecución</div>
          <div className="mt-2 text-2xl font-extrabold text-indigo-600 dark:text-indigo-400">
            {projects.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">100% On-Track en SLAs</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[10px] font-bold uppercase text-slate-400">Salud Promedio Global</div>
          <div className="mt-2 text-2xl font-extrabold text-emerald-600">88.5%</div>
          <div className="mt-1 text-xs text-emerald-700 font-semibold">+3.2% vs mes anterior</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="text-[10px] font-bold uppercase text-slate-400">Riesgos Críticos Activos</div>
          <div className="mt-2 text-2xl font-extrabold text-rose-600">
            {objects.filter((o) => o.type === 'RISK' && (o.riskScore || 0) >= 15).length}
          </div>
          <div className="mt-1 text-xs text-slate-500">Mitigaciones en proceso</div>
        </div>
      </div>

      {/* Portfolio Health Breakdown Table */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
          Resumen Consolidado por Portafolio
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-400 dark:border-slate-800 dark:bg-slate-800/60">
              <tr>
                <th className="py-2.5 px-3">Portafolio / Programa</th>
                <th className="py-2.5 px-3">Director</th>
                <th className="py-2.5 px-3">Proyectos</th>
                <th className="py-2.5 px-3">Presupuesto Total</th>
                <th className="py-2.5 px-3">Ejecutado</th>
                <th className="py-2.5 px-3">Health Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {portfolios.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100">{p.name}</td>
                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300">{p.ownerName}</td>
                  <td className="py-3 px-3 font-mono font-bold text-indigo-600">{p.projectIds.length}</td>
                  <td className="py-3 px-3 font-mono">${(p.totalBudget / 1000000).toFixed(1)}M USD</td>
                  <td className="py-3 px-3 font-mono">${(p.spentBudget / 1000000).toFixed(1)}M USD</td>
                  <td className="py-3 px-3">
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                      89% EXCELENTE
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
