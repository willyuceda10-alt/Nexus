import React, { useMemo } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  CircleDollarSign,
  Layers3,
  Network,
  Plus,
  ShieldAlert,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { buildPortfolioHierarchy } from '../../domain/portfolioHierarchy';
import type { NexusObject } from '../../types/nexus';

function shortDate(value?: string): string {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function healthTone(score: number): { label: string; className: string } {
  if (score >= 80) return { label: 'En control', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  if (score >= 65) return { label: 'Atención', className: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label: 'Crítico', className: 'bg-rose-50 text-rose-700 ring-rose-200' };
}

function budgetOf(projects: NexusObject[]) {
  return projects.reduce(
    (acc, project) => ({
      total: acc.total + (project.budgetTotal ?? 0),
      spent: acc.spent + (project.budgetSpent ?? 0),
    }),
    { total: 0, spent: 0 },
  );
}

export const PortfoliosView: React.FC = () => {
  const {
    portfolios: legacyPortfolios,
    objects,
    tenant,
    getProjectHealth,
    setSelectedProjectId,
    setActiveTab,
    openCreateModal,
    openObjectDrawer,
  } = useNexus();

  const hierarchy = useMemo(
    () => buildPortfolioHierarchy(objects, legacyPortfolios),
    [objects, legacyPortfolios],
  );
  const projects = useMemo(
    () => objects.filter((object) => object.type === 'PROJECT'),
    [objects],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const linkedProjectIds = new Set(hierarchy.flatMap((portfolio) => portfolio.projectIds));
  const linkedProjects = projects.filter((project) => linkedProjectIds.has(project.id));
  const totalBudget = hierarchy.reduce((sum, portfolio) => sum + portfolio.budgetAllocated, 0);
  const totalSpent = hierarchy.reduce((sum, portfolio) => sum + portfolio.budgetSpent, 0);
  const portfolioBurn = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const averageProgress = linkedProjects.length > 0
    ? Math.round(linkedProjects.reduce((sum, project) => sum + project.progress, 0) / linkedProjects.length)
    : 0;
  const attentionProjects = linkedProjects.filter(
    (project) => getProjectHealth(project.id).healthScore < 65 || project.status === 'BLOCKED',
  );
  const programCount = hierarchy.reduce((sum, portfolio) => sum + portfolio.programs.length, 0);

  const currency = tenant.currency || 'USD';
  const money = (value: number) => new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency,
    notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 1 : 0,
  }).format(value);

  const openProject = (project: NexusObject) => {
    setSelectedProjectId(project.id);
    setActiveTab('project');
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-green-800 ring-1 ring-green-100">
              Gobierno de portafolio
            </span>
            <span className="text-[11px] font-medium text-slate-400">Object Engine persistente</span>
          </div>
          <h1 className="text-[27px] font-extrabold tracking-[-0.03em] text-slate-950">Portafolios y programas</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">
            Jerarquía Portafolio → Programa → Proyecto con inversión, avance y salud calculados desde los proyectos vinculados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openCreateModal('PROGRAM')}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-slate-700 transition hover:bg-slate-50"
          >
            <Network className="h-3.5 w-3.5" /> Nuevo programa
          </button>
          <button
            onClick={() => openCreateModal('PORTFOLIO')}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-bold text-white transition hover:bg-green-800"
          >
            <Plus className="h-3.5 w-3.5" /> Nuevo portafolio
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-green-50 text-green-700"><Layers3 className="h-4 w-4" /></div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Portafolios</span>
          </div>
          <p className="mt-4 text-[27px] font-extrabold tracking-tight text-slate-950">{hierarchy.length}</p>
          <p className="mt-1 text-[10px] font-medium text-slate-500">estructuras estratégicas</p>
        </div>

        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600"><Network className="h-4 w-4" /></div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Programas</span>
          </div>
          <p className="mt-4 text-[27px] font-extrabold tracking-tight text-slate-950">{programCount}</p>
          <p className="mt-1 text-[10px] font-medium text-slate-500">agrupadores operativos</p>
        </div>

        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><TrendingUp className="h-4 w-4" /></div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Avance</span>
          </div>
          <p className="mt-4 text-[27px] font-extrabold tracking-tight text-slate-950">{averageProgress}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, averageProgress)}%` }} />
          </div>
        </div>

        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600"><CircleDollarSign className="h-4 w-4" /></div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Inversión</span>
          </div>
          <p className="mt-4 text-[20px] font-extrabold tracking-tight text-slate-950">{money(totalBudget)}</p>
          <p className="mt-1 text-[9px] font-medium text-slate-400">{money(totalSpent)} ejecutado · {portfolioBurn}%</p>
        </div>

        <div className="command-kpi-card">
          <div className="flex items-start justify-between">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-600"><ShieldAlert className="h-4 w-4" /></div>
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">Atención</span>
          </div>
          <p className="mt-4 text-[27px] font-extrabold tracking-tight text-slate-950">{attentionProjects.length}</p>
          <p className="mt-1 text-[10px] font-medium text-slate-500">proyectos críticos o bloqueados</p>
        </div>
      </section>

      {hierarchy.length === 0 ? (
        <section className="command-panel flex min-h-[340px] flex-col items-center justify-center border-dashed px-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-green-50 text-green-700"><Layers3 className="h-5 w-5" /></div>
          <h2 className="mt-4 text-[14px] font-bold text-slate-900">Crea el primer portafolio</h2>
          <p className="mt-2 max-w-xl text-[10px] leading-5 text-slate-500">
            El portafolio se guardará como un NexusObject real y podrá contener programas y proyectos persistentes.
          </p>
          <button onClick={() => openCreateModal('PORTFOLIO')} className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-bold text-white">
            <Plus className="h-3.5 w-3.5" /> Crear portafolio
          </button>
        </section>
      ) : (
        <section className="space-y-4">
          {hierarchy.map((portfolio) => {
            const portfolioProjects = portfolio.projectIds
              .map((projectId) => projectById.get(projectId))
              .filter((project): project is NexusObject => Boolean(project));
            const executionPercentage = portfolio.budgetAllocated > 0
              ? Math.round((portfolio.budgetSpent / portfolio.budgetAllocated) * 100)
              : 0;
            const healthScores = portfolioProjects.map((project) => getProjectHealth(project.id).healthScore);
            const health = healthScores.length > 0
              ? Math.round(healthScores.reduce((sum, score) => sum + score, 0) / healthScores.length)
              : 0;
            const tone = healthTone(health);
            const criticalProjects = portfolioProjects.filter(
              (project) => getProjectHealth(project.id).healthScore < 65 || project.status === 'BLOCKED',
            );
            const nextDeadline = portfolioProjects
              .filter((project) => project.endDate && !['COMPLETED', 'CANCELLED'].includes(project.status))
              .sort((a, b) => (a.endDate || '').localeCompare(b.endDate || ''))[0];

            return (
              <article key={portfolio.id} className="command-panel overflow-hidden">
                <div className="grid gap-5 border-b border-slate-100 px-5 py-5 xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(120px,0.42fr))] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => portfolio.object && openObjectDrawer(portfolio.object.id)}
                        disabled={!portfolio.object}
                        className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-500 disabled:cursor-default"
                      >
                        {portfolio.code}
                      </button>
                      <span className={`rounded-full px-2 py-1 text-[9px] font-bold ring-1 ${tone.className}`}>
                        {health || 0} · {health ? tone.label : 'Sin datos'}
                      </span>
                    </div>
                    <h2 className="mt-2 truncate text-[16px] font-extrabold tracking-tight text-slate-950">{portfolio.name}</h2>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{portfolio.description}</p>
                    {portfolio.strategicObjective && (
                      <div className="mt-3 flex items-start gap-2 text-[9px] font-medium text-slate-500">
                        <Target className="mt-0.5 h-3 w-3 flex-shrink-0 text-green-700" />
                        <span className="line-clamp-2"><strong className="font-bold text-slate-700">Objetivo:</strong> {portfolio.strategicObjective}</span>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Programas</p>
                    <p className="mt-1 text-[20px] font-extrabold text-slate-950">{portfolio.programs.length}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">estructura persistente</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Proyectos</p>
                    <p className="mt-1 text-[20px] font-extrabold text-slate-950">{portfolioProjects.length}</p>
                    <p className="mt-0.5 text-[9px] text-rose-600">{criticalProjects.length} en atención</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Presupuesto</p>
                    <p className="mt-1 text-[13px] font-extrabold text-slate-950">{money(portfolio.budgetAllocated)}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">{executionPercentage}% ejecutado</p>
                  </div>
                  <div>
                    <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Próxima fecha</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-800">{shortDate(nextDeadline?.endDate)}</p>
                    <p className="mt-0.5 truncate text-[9px] text-slate-400">{nextDeadline?.title || 'Sin proyectos con fecha'}</p>
                  </div>
                </div>

                {portfolio.programs.length > 0 && (
                  <div className="border-b border-slate-100 bg-slate-50/45 px-5 py-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold text-slate-800">Programas del portafolio</p>
                        <p className="mt-0.5 text-[9px] text-slate-400">Los indicadores se derivan de sus proyectos vinculados.</p>
                      </div>
                      <button onClick={() => openCreateModal('PROGRAM')} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[8px] font-bold text-green-800 ring-1 ring-green-200 hover:bg-green-50">
                        <Plus className="h-3 w-3" /> Programa
                      </button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {portfolio.programs.map((program) => {
                        const programProjects = program.projectIds
                          .map((projectId) => projectById.get(projectId))
                          .filter((project): project is NexusObject => Boolean(project));
                        const programHealthValues = programProjects.map((project) => getProjectHealth(project.id).healthScore);
                        const programHealth = programHealthValues.length > 0
                          ? Math.round(programHealthValues.reduce((sum, score) => sum + score, 0) / programHealthValues.length)
                          : 0;
                        const programBudgetBurn = program.budgetTotal > 0
                          ? Math.round((program.budgetSpent / program.budgetTotal) * 100)
                          : 0;
                        return (
                          <button
                            key={program.object.id}
                            onClick={() => openObjectDrawer(program.object.id)}
                            className="rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-green-200 hover:shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-green-700">{program.object.code || 'PROGRAMA'}</p>
                                <p className="mt-1 truncate text-[10px] font-bold text-slate-900">{program.object.title}</p>
                              </div>
                              <Network className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />
                            </div>
                            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-[8px]">
                              <div><p className="text-slate-400">Proyectos</p><p className="mt-0.5 font-bold text-slate-800">{programProjects.length}</p></div>
                              <div><p className="text-slate-400">Avance</p><p className="mt-0.5 font-bold text-slate-800">{program.averageProgress}%</p></div>
                              <div><p className="text-slate-400">Salud</p><p className="mt-0.5 font-bold text-slate-800">{programHealth || '—'}</p></div>
                            </div>
                            <p className="mt-2 text-[8px] text-slate-400">{money(program.budgetSpent)} / {money(program.budgetTotal)} · {programBudgetBurn}%</p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-slate-800">Proyectos del portafolio</p>
                      <p className="mt-0.5 text-[9px] text-slate-400">Programa, salud, avance, presupuesto y fecha objetivo</p>
                    </div>
                    <span className="text-[9px] font-semibold text-slate-400">{portfolioProjects.length} vinculados</span>
                  </div>

                  {portfolioProjects.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-[10px] text-slate-400">Este portafolio todavía no tiene proyectos vinculados.</div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[940px] border-collapse text-left">
                        <thead className="border-b border-slate-100 bg-slate-50/70">
                          <tr className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">
                            <th className="px-4 py-2.5">Proyecto</th>
                            <th className="px-4 py-2.5">Programa</th>
                            <th className="px-4 py-2.5">Salud</th>
                            <th className="px-4 py-2.5">Avance</th>
                            <th className="px-4 py-2.5">Presupuesto</th>
                            <th className="px-4 py-2.5">Fecha objetivo</th>
                            <th className="w-10 px-4 py-2.5" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {portfolioProjects.map((project) => {
                            const projectHealth = getProjectHealth(project.id);
                            const projectTone = healthTone(projectHealth.healthScore);
                            const projectBudget = budgetOf([project]);
                            const programName = portfolio.programs.find((program) => program.object.id === project.programId)?.object.title;
                            return (
                              <tr key={project.id} className="transition hover:bg-green-50/35">
                                <td className="max-w-[300px] px-4 py-3">
                                  <button onClick={() => openProject(project)} className="block w-full truncate text-left text-[10px] font-bold text-slate-900 transition hover:text-green-800">
                                    {project.title}
                                  </button>
                                  <p className="mt-0.5 truncate text-[8px] text-slate-400">{project.status.replaceAll('_', ' ')}</p>
                                </td>
                                <td className="px-4 py-3 text-[9px] font-medium text-slate-500">{programName || 'Directo al portafolio'}</td>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex rounded-full px-2 py-1 text-[8px] font-bold ring-1 ${projectTone.className}`}>{projectHealth.healthScore} · {projectTone.label}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2"><span className="w-8 text-[9px] font-bold text-slate-700">{project.progress}%</span><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, project.progress)}%` }} /></div></div>
                                </td>
                                <td className="px-4 py-3 text-[9px] font-semibold text-slate-600">{money(projectBudget.spent)} / {money(projectBudget.total)}</td>
                                <td className="px-4 py-3 text-[9px] font-semibold text-slate-600">{shortDate(project.endDate)}</td>
                                <td className="px-4 py-3"><button onClick={() => openProject(project)} className="rounded-lg p-1.5 text-slate-300 transition hover:bg-green-50 hover:text-green-700"><ArrowRight className="h-3.5 w-3.5" /></button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-green-700"><BriefcaseBusiness className="h-4 w-4" /><p className="text-[10px] font-bold">Persistencia única</p></div>
          <p className="mt-2 text-[9px] leading-4 text-slate-500">Portafolios, programas y proyectos comparten NexusObject, versionado y auditoría.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sky-700"><Network className="h-4 w-4" /><p className="text-[10px] font-bold">Jerarquía explícita</p></div>
          <p className="mt-2 text-[9px] leading-4 text-slate-500">El programa referencia su portafolio y el proyecto puede referenciar programa y portafolio.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-violet-700"><CircleDollarSign className="h-4 w-4" /><p className="text-[10px] font-bold">Sin doble contabilización</p></div>
          <p className="mt-2 text-[9px] leading-4 text-slate-500">Presupuesto y ejecución se agregan desde los proyectos, evitando cifras duplicadas en la jerarquía.</p>
        </div>
      </section>
    </div>
  );
};
