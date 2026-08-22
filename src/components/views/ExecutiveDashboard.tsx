import React, { useMemo } from 'react';
import { BarChart3, CircleDollarSign, Layers3, Network, ShieldAlert, TrendingUp } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { buildPortfolioHierarchy } from '../../domain/portfolioHierarchy';

export const ExecutiveDashboard: React.FC = () => {
  const { objects, portfolios: legacyPortfolios, getProjectHealth, tenant } = useNexus();
  const hierarchy = useMemo(
    () => buildPortfolioHierarchy(objects, legacyPortfolios),
    [objects, legacyPortfolios],
  );
  const projects = objects.filter((object) => object.type === 'PROJECT');
  const totalBudget = projects.reduce((sum, project) => sum + (project.budgetTotal ?? 0), 0);
  const totalSpent = projects.reduce((sum, project) => sum + (project.budgetSpent ?? 0), 0);
  const burnPercentage = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const projectHealth = projects.map((project) => ({ id: project.id, metrics: getProjectHealth(project.id) }));
  const averageHealth = projectHealth.length > 0
    ? Math.round(projectHealth.reduce((sum, item) => sum + item.metrics.healthScore, 0) / projectHealth.length)
    : 0;
  const onTrackCount = projectHealth.filter((item) => item.metrics.healthScore >= 80).length;
  const criticalRiskCount = objects.filter(
    (object) => object.type === 'RISK' && (object.riskScore ?? 0) >= 15 && !object.isRealized,
  ).length;
  const programCount = hierarchy.reduce((sum, portfolio) => sum + portfolio.programs.length, 0);
  const currency = tenant.currency || 'USD';
  const money = (value: number) => new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency,
    notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-green-700">
          <BarChart3 className="h-4 w-4" />
          <span className="text-[10px] font-bold uppercase tracking-[0.12em]">Tablero ejecutivo</span>
        </div>
        <h1 className="mt-2 text-[24px] font-extrabold tracking-[-0.03em] text-slate-950">Portafolio, inversión y salud</h1>
        <p className="mt-1 text-[11px] text-slate-500">Consolidado calculado desde NexusObject; no mantiene totales duplicados en Portafolio o Programa.</p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<CircleDollarSign className="h-4 w-4" />} label="Presupuesto" value={money(totalBudget)} note={`${money(totalSpent)} ejecutado · ${burnPercentage}%`} />
        <Kpi icon={<Layers3 className="h-4 w-4" />} label="Portafolios" value={String(hierarchy.length)} note="objetos estratégicos persistentes" />
        <Kpi icon={<Network className="h-4 w-4" />} label="Programas" value={String(programCount)} note={`${projects.length} proyectos vinculables`} />
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Salud promedio" value={`${averageHealth}%`} note={`${onTrackCount} proyectos ≥ 80`} />
        <Kpi icon={<ShieldAlert className="h-4 w-4" />} label="Riesgos críticos" value={String(criticalRiskCount)} note="score ≥ 15 activos" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-[12px] font-bold text-slate-900">Consolidado por Portafolio y Programa</h2>
          <p className="mt-1 text-[9px] text-slate-400">Presupuesto y avance provienen de los proyectos pertenecientes a cada nivel.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[10px]">
            <thead className="border-b border-slate-100 bg-slate-50/70 text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">
              <tr><th className="px-4 py-3">Estructura</th><th className="px-4 py-3">Código</th><th className="px-4 py-3">Proyectos</th><th className="px-4 py-3">Presupuesto</th><th className="px-4 py-3">Ejecutado</th><th className="px-4 py-3">Avance</th><th className="px-4 py-3">Salud</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hierarchy.flatMap((portfolio) => {
                const portfolioProjects = projects.filter((project) => portfolio.projectIds.includes(project.id));
                const portfolioHealth = portfolioProjects.length > 0
                  ? Math.round(portfolioProjects.reduce((sum, project) => sum + getProjectHealth(project.id).healthScore, 0) / portfolioProjects.length)
                  : 0;
                const rows: React.ReactNode[] = [
                  <tr key={`portfolio-${portfolio.id}`} className="bg-green-50/20">
                    <td className="px-4 py-3 font-bold text-slate-900">{portfolio.name}<span className="ml-2 rounded bg-green-50 px-1.5 py-0.5 text-[7px] font-black text-green-700">PORTAFOLIO</span></td>
                    <td className="px-4 py-3 font-mono text-slate-500">{portfolio.code}</td>
                    <td className="px-4 py-3 font-bold text-slate-700">{portfolio.projectIds.length}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{money(portfolio.budgetAllocated)}</td>
                    <td className="px-4 py-3 text-slate-600">{money(portfolio.budgetSpent)}</td>
                    <td className="px-4 py-3 font-bold text-slate-700">{portfolio.averageProgress}%</td>
                    <td className="px-4 py-3"><Health value={portfolioHealth} /></td>
                  </tr>,
                ];
                for (const program of portfolio.programs) {
                  const programProjects = projects.filter((project) => program.projectIds.includes(project.id));
                  const programHealth = programProjects.length > 0
                    ? Math.round(programProjects.reduce((sum, project) => sum + getProjectHealth(project.id).healthScore, 0) / programProjects.length)
                    : 0;
                  rows.push(
                    <tr key={`program-${program.object.id}`} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 pl-8 font-semibold text-slate-700">↳ {program.object.title}<span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[7px] font-black text-sky-700">PROGRAMA</span></td>
                      <td className="px-4 py-3 font-mono text-slate-400">{program.object.code || '—'}</td>
                      <td className="px-4 py-3 font-semibold text-slate-600">{program.projectIds.length}</td>
                      <td className="px-4 py-3 text-slate-600">{money(program.budgetTotal)}</td>
                      <td className="px-4 py-3 text-slate-600">{money(program.budgetSpent)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-600">{program.averageProgress}%</td>
                      <td className="px-4 py-3"><Health value={programHealth} /></td>
                    </tr>,
                  );
                }
                return rows;
              })}
              {hierarchy.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-[10px] text-slate-400">No hay portafolios persistidos en este workspace.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: string; note: string }> = ({ icon, label, value, note }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between text-green-700">{icon}<span className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</span></div>
    <p className="mt-4 text-[22px] font-extrabold tracking-tight text-slate-950">{value}</p>
    <p className="mt-1 text-[9px] text-slate-400">{note}</p>
  </div>
);

const Health: React.FC<{ value: number }> = ({ value }) => {
  const className = value >= 80 ? 'bg-emerald-50 text-emerald-700' : value >= 65 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700';
  return <span className={`rounded-full px-2 py-1 text-[8px] font-bold ${className}`}>{value || 0}%</span>;
};
