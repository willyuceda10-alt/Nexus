import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Filter,
  Gauge,
  Plus,
  Search,
  ShieldAlert,
  Target,
  X,
  XCircle,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import {
  buildGovernanceProjection,
  type RiskBand,
  type RiskMatrixCell,
} from '../../domain/governanceRisk';
import type { NexusObject } from '../../types/nexus';

const TERMINAL_RISK_STATUSES = new Set<NexusObject['status']>(['CLOSED', 'COMPLETED', 'CANCELLED']);

type RiskScope = 'OPEN' | 'ALL' | 'REALIZED';

function bandLabel(band: RiskBand): string {
  switch (band) {
    case 'CRITICAL': return 'Crítico';
    case 'HIGH': return 'Alto';
    case 'MEDIUM': return 'Medio';
    case 'LOW': return 'Bajo';
    default: return 'Sin evaluar';
  }
}

function bandTone(band: RiskBand): string {
  switch (band) {
    case 'CRITICAL': return 'bg-rose-50 text-rose-700 ring-rose-200';
    case 'HIGH': return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 'MEDIUM': return 'bg-yellow-50 text-yellow-700 ring-yellow-200';
    case 'LOW': return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    default: return 'bg-slate-100 text-slate-600 ring-slate-200';
  }
}

function matrixTone(cell: RiskMatrixCell): string {
  switch (cell.band) {
    case 'CRITICAL': return cell.count > 0 ? 'border-rose-300 bg-rose-100 text-rose-800' : 'border-rose-100 bg-rose-50/55 text-rose-400';
    case 'HIGH': return cell.count > 0 ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-amber-100 bg-amber-50/55 text-amber-400';
    case 'MEDIUM': return cell.count > 0 ? 'border-yellow-300 bg-yellow-100 text-yellow-800' : 'border-yellow-100 bg-yellow-50/55 text-yellow-500';
    case 'LOW': return cell.count > 0 ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-emerald-100 bg-emerald-50/55 text-emerald-500';
  }
}

function statusLabel(status: NexusObject['status']): string {
  const labels: Partial<Record<NexusObject['status'], string>> = {
    DRAFT: 'Borrador',
    PLANNING: 'Planificación',
    IN_PROGRESS: 'En curso',
    IN_REVIEW: 'En revisión',
    BLOCKED: 'Bloqueado',
    COMPLETED: 'Completado',
    CANCELLED: 'Cancelado',
    IDENTIFIED: 'Identificado',
    MITIGATING: 'Mitigando',
    REALIZED: 'Realizado',
    CLOSED: 'Cerrado',
    PENDING_APPROVAL: 'Pendiente aprobación',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
  };
  return labels[status] ?? status;
}

function shortDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export const GovernanceRiskView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const {
    tenant,
    objects,
    relations,
    openObjectDrawer,
    openCreateModal,
    updateNexusObject,
    decideApproval,
    approvals,
    isObjectMutationPending,
  } = useNexus();

  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState<RiskBand | 'ALL'>('ALL');
  const [scope, setScope] = useState<RiskScope>('OPEN');
  const [projectFilter, setProjectFilter] = useState<string>(projectId ?? 'ALL');
  const [matrixSelection, setMatrixSelection] = useState<{ probability: number; impact: number } | null>(null);

  const projection = useMemo(
    () => buildGovernanceProjection(objects, relations, new Date().toISOString(), projectId),
    [objects, relations, projectId],
  );

  const projects = useMemo(
    () => objects.filter((object) => object.type === 'PROJECT').sort((a, b) => a.title.localeCompare(b.title)),
    [objects],
  );

  const filteredRisks = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return projection.risks.filter((risk) => {
      if (projectFilter !== 'ALL' && risk.projectId !== projectFilter) return false;
      if (bandFilter !== 'ALL' && risk.band !== bandFilter) return false;
      if (scope === 'OPEN' && TERMINAL_RISK_STATUSES.has(risk.status)) return false;
      if (scope === 'REALIZED' && !risk.realized) return false;
      if (matrixSelection && (risk.probability !== matrixSelection.probability || risk.impact !== matrixSelection.impact)) return false;
      if (term && !`${risk.title} ${risk.projectName} ${risk.ownerName} ${risk.mitigationPlan ?? ''}`.toLocaleLowerCase('es').includes(term)) return false;
      return true;
    });
  }, [projection.risks, projectFilter, bandFilter, scope, matrixSelection, search]);

  const filteredChanges = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return projection.changes.filter((change) => {
      if (projectFilter !== 'ALL' && change.projectId !== projectFilter) return false;
      if (term && !`${change.title} ${change.projectName} ${change.ownerName} ${change.reason ?? ''}`.toLocaleLowerCase('es').includes(term)) return false;
      return true;
    });
  }, [projection.changes, projectFilter, search]);

  const currency = useMemo(
    () => new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: tenant.currency || 'USD',
      maximumFractionDigits: 0,
    }),
    [tenant.currency],
  );

  const clearFilters = () => {
    setSearch('');
    setBandFilter('ALL');
    setScope('OPEN');
    setProjectFilter(projectId ?? 'ALL');
    setMatrixSelection(null);
  };

  const hasFilters = Boolean(
    search ||
    bandFilter !== 'ALL' ||
    scope !== 'OPEN' ||
    projectFilter !== (projectId ?? 'ALL') ||
    matrixSelection,
  );

  const quickRiskAction = async (risk: NexusObject) => {
    if (risk.status === 'IDENTIFIED') {
      await updateNexusObject(risk.id, { status: 'MITIGATING' });
      return;
    }
    if (!TERMINAL_RISK_STATUSES.has(risk.status)) {
      await updateNexusObject(risk.id, { status: 'CLOSED', progress: 100 });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1540px] space-y-6 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-green-800 ring-1 ring-green-100">
              Gobierno de ejecución
            </span>
            <span className="text-[11px] font-medium text-slate-400">Riesgos · cambios · exposición</span>
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.035em] text-slate-950">Riesgos y control de cambios</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">
            Controla exposición, mitigaciones y cambios de alcance sin duplicar información. Los indicadores se derivan del Object Engine y solo puntúan riesgos con probabilidad e impacto realmente informados.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openCreateModal('RISK')}
            className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-[11px] font-bold text-green-800 transition hover:bg-green-100"
          >
            <Plus className="h-4 w-4" /> Registrar riesgo
          </button>
          <button
            onClick={() => openCreateModal('CHANGE_REQUEST')}
            className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-3.5 py-2.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-green-800"
          >
            <Plus className="h-4 w-4" /> Nueva solicitud de cambio
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <div className="command-kpi-card">
          <ShieldAlert className="h-4 w-4 text-green-700" />
          <p className="mt-3 text-[26px] font-extrabold text-slate-950">{projection.summary.openRiskCount}</p>
          <p className="text-[10px] text-slate-500">riesgos abiertos</p>
        </div>
        <div className="command-kpi-card">
          <AlertTriangle className="h-4 w-4 text-rose-600" />
          <p className="mt-3 text-[26px] font-extrabold text-slate-950">{projection.summary.criticalRiskCount}</p>
          <p className="text-[10px] text-slate-500">críticos · score ≥15</p>
        </div>
        <div className="command-kpi-card">
          <Gauge className="h-4 w-4 text-amber-600" />
          <p className="mt-3 text-[26px] font-extrabold text-slate-950">{projection.summary.exposureScore}</p>
          <p className="text-[10px] text-slate-500">exposición bruta puntuada</p>
        </div>
        <div className="command-kpi-card">
          <Target className="h-4 w-4 text-emerald-600" />
          <p className="mt-3 text-[26px] font-extrabold text-slate-950">{projection.summary.mitigationCoveragePct}%</p>
          <p className="text-[10px] text-slate-500">con plan de mitigación</p>
        </div>
        <div className="command-kpi-card">
          <Clock3 className="h-4 w-4 text-amber-600" />
          <p className="mt-3 text-[26px] font-extrabold text-slate-950">{projection.summary.mitigationOverdueCount}</p>
          <p className="text-[10px] text-slate-500">mitigaciones vencidas</p>
        </div>
        <div className="command-kpi-card">
          <AlertCircle className="h-4 w-4 text-slate-500" />
          <p className="mt-3 text-[26px] font-extrabold text-slate-950">{projection.summary.unratedRiskCount}</p>
          <p className="text-[10px] text-slate-500">riesgos sin evaluar</p>
        </div>
      </section>

      <section className="command-panel p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative min-w-0 flex-1 xl:max-w-[430px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar riesgo, responsable, proyecto o mitigación…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[11px] font-medium text-slate-800 outline-none transition focus:border-green-400 focus:ring-2 focus:ring-green-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            {!projectId && (
              <select
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
                className="h-9 max-w-[260px] rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 outline-none focus:border-green-400"
              >
                <option value="ALL">Todos los proyectos</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
            )}
            <select
              value={bandFilter}
              onChange={(event) => setBandFilter(event.target.value as RiskBand | 'ALL')}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 outline-none focus:border-green-400"
            >
              <option value="ALL">Todas las severidades</option>
              <option value="CRITICAL">Crítico</option>
              <option value="HIGH">Alto</option>
              <option value="MEDIUM">Medio</option>
              <option value="LOW">Bajo</option>
              <option value="UNRATED">Sin evaluar</option>
            </select>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as RiskScope)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 outline-none focus:border-green-400"
            >
              <option value="OPEN">Solo abiertos</option>
              <option value="REALIZED">Solo realizados</option>
              <option value="ALL">Todos</option>
            </select>
            {hasFilters && (
              <button onClick={clearFilters} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[10px] font-bold text-slate-500 hover:bg-slate-100">
                <X className="h-3.5 w-3.5" /> Limpiar
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div className="command-panel p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-extrabold text-slate-900">Matriz probabilidad × impacto</h2>
              <p className="mt-1 text-[9px] leading-4 text-slate-400">Haz clic en una celda para filtrar el registro. Los riesgos sin evaluar quedan fuera de la matriz.</p>
            </div>
            {matrixSelection && (
              <button onClick={() => setMatrixSelection(null)} className="text-[9px] font-bold text-green-700 hover:text-green-900">Quitar selección</button>
            )}
          </div>

          <div className="space-y-1.5">
            {[5, 4, 3, 2, 1].map((probability) => (
              <div key={probability} className="flex items-center gap-1.5">
                <span className="w-5 text-center text-[9px] font-bold text-slate-400">P{probability}</span>
                <div className="grid flex-1 grid-cols-5 gap-1.5">
                  {projection.matrix
                    .filter((cell) => cell.probability === probability)
                    .map((cell) => {
                      const selected = matrixSelection?.probability === cell.probability && matrixSelection.impact === cell.impact;
                      return (
                        <button
                          key={`${cell.probability}-${cell.impact}`}
                          onClick={() => setMatrixSelection(selected ? null : { probability: cell.probability, impact: cell.impact })}
                          className={`relative h-[58px] rounded-xl border text-center transition hover:-translate-y-0.5 hover:shadow-sm ${matrixTone(cell)} ${selected ? 'ring-2 ring-green-600 ring-offset-1' : ''}`}
                        >
                          <span className="block text-[9px] font-semibold opacity-70">{cell.score}</span>
                          <span className="mt-0.5 block text-[15px] font-extrabold">{cell.count}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-5 gap-1.5 pl-[26px] pt-1 text-center text-[8px] font-bold text-slate-400">
              {[1, 2, 3, 4, 5].map((impact) => <span key={impact}>I{impact}</span>)}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 text-[9px] font-semibold">
            {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((band) => (
              <div key={band} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-slate-500">
                <span className={`h-2.5 w-2.5 rounded-full ${band === 'CRITICAL' ? 'bg-rose-500' : band === 'HIGH' ? 'bg-amber-500' : band === 'MEDIUM' ? 'bg-yellow-400' : 'bg-emerald-500'}`} />
                {bandLabel(band)}
              </div>
            ))}
          </div>
        </div>

        <div className="command-panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-extrabold text-slate-900">Registro de riesgos</h2>
              <p className="mt-0.5 text-[9px] text-slate-400">{filteredRisks.length} resultado(s) según filtros activos</p>
            </div>
            {isObjectMutationPending && <span className="text-[9px] font-semibold text-green-700">Guardando…</span>}
          </div>

          <div className="divide-y divide-slate-100">
            {filteredRisks.map((risk) => (
              <div key={risk.id} className="group px-5 py-4 transition hover:bg-slate-50/70">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <button onClick={() => openObjectDrawer(risk.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ring-1 ${bandTone(risk.band)}`}>
                        {bandLabel(risk.band)}{risk.score !== undefined ? ` · ${risk.score}/25` : ''}
                      </span>
                      {risk.realized && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700 ring-1 ring-rose-100">Realizado</span>}
                      {risk.mitigationOverdue && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-100">Mitigación vencida</span>}
                      <span className="text-[9px] font-semibold text-slate-400">{statusLabel(risk.status)}</span>
                    </div>
                    <h3 className="mt-2 text-[12px] font-extrabold text-slate-900 group-hover:text-green-800">{risk.title}</h3>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-400">
                      <span>{risk.projectName}</span>
                      <span>Responsable: {risk.ownerName}</span>
                      {risk.probability !== undefined && risk.impact !== undefined && <span>P{risk.probability} × I{risk.impact}</span>}
                      {risk.mitigationDueDate && <span>Fecha objetivo: {shortDate(risk.mitigationDueDate)}</span>}
                    </div>
                    {risk.mitigationPlan ? (
                      <p className="mt-2 line-clamp-2 rounded-lg bg-green-50/70 px-3 py-2 text-[10px] leading-4 text-green-900">
                        <strong>Mitigación:</strong> {risk.mitigationPlan}
                      </p>
                    ) : (
                      <p className="mt-2 text-[9px] font-semibold text-amber-600">Sin plan de mitigación documentado</p>
                    )}
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    {!TERMINAL_RISK_STATUSES.has(risk.status) && (
                      <button
                        disabled={isObjectMutationPending}
                        onClick={() => void quickRiskAction(risk.source)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-green-200 hover:text-green-800 disabled:opacity-50"
                      >
                        {risk.status === 'IDENTIFIED' ? 'Iniciar mitigación' : 'Cerrar riesgo'}
                      </button>
                    )}
                    <button onClick={() => openObjectDrawer(risk.id)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white hover:text-green-700">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {filteredRisks.length === 0 && (
              <div className="px-6 py-12 text-center">
                <ShieldAlert className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-3 text-[11px] font-bold text-slate-600">No hay riesgos que coincidan con los filtros.</p>
                <p className="mt-1 text-[9px] text-slate-400">Ajusta los filtros o registra un nuevo riesgo.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {!projectId && projection.projectExposure.length > 0 && (
        <section className="command-panel overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-[13px] font-extrabold text-slate-900">Concentración de exposición por proyecto</h2>
            <p className="mt-0.5 text-[9px] text-slate-400">Exposición bruta = suma de scores informados; no representa riesgo residual después de controles.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left">
              <thead className="bg-slate-50/70 text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">
                <tr>
                  <th className="px-5 py-3">Proyecto</th>
                  <th className="px-3 py-3 text-center">Abiertos</th>
                  <th className="px-3 py-3 text-center">Críticos</th>
                  <th className="px-3 py-3 text-center">Realizados</th>
                  <th className="px-3 py-3 text-center">Cobertura mitigación</th>
                  <th className="px-5 py-3 text-right">Exposición</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projection.projectExposure.map((row) => (
                  <tr key={row.projectId} className="text-[10px] text-slate-600">
                    <td className="px-5 py-3.5">
                      <p className="font-bold text-slate-800">{row.projectName}</p>
                      {row.portfolioName && <p className="mt-0.5 text-[8px] text-slate-400">{row.portfolioName}</p>}
                    </td>
                    <td className="px-3 py-3.5 text-center font-semibold">{row.openRiskCount}</td>
                    <td className="px-3 py-3.5 text-center font-semibold text-rose-600">{row.criticalRiskCount}</td>
                    <td className="px-3 py-3.5 text-center font-semibold">{row.realizedRiskCount}</td>
                    <td className="px-3 py-3.5 text-center">
                      <span className={`rounded-full px-2 py-1 font-bold ${row.mitigationCoveragePct >= 80 ? 'bg-emerald-50 text-emerald-700' : row.mitigationCoveragePct >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
                        {row.mitigationCoveragePct}%
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-[12px] font-extrabold text-slate-900">{row.exposureScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="command-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[13px] font-extrabold text-slate-900">Control de cambios</h2>
            <p className="mt-0.5 text-[9px] text-slate-400">Impactos declarados sobre costo y plazo. La aprobación utiliza el flujo existente cuando hay un paso pendiente.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[9px] font-bold">
            <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-slate-600">Pendientes: {projection.summary.pendingChangeCount}</span>
            <span className="rounded-lg bg-green-50 px-2.5 py-1.5 text-green-700">Aprobados: {projection.summary.approvedChangeCount}</span>
            {projection.summary.unestimatedChangeCount > 0 && <span className="rounded-lg bg-yellow-50 px-2.5 py-1.5 text-yellow-700">Sin estimar: {projection.summary.unestimatedChangeCount}</span>}
            <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-700">Plazo informado: +{projection.summary.changeTimeImpactDays} d</span>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700">Costo informado: {currency.format(projection.summary.changeCostImpact)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-2">
          {filteredChanges.map((change) => {
            const approval = approvals.find((item) => item.objectId === change.id && item.status === 'PENDING');
            return (
              <div key={change.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_20px_rgba(15,23,42,0.04)]">
                <button onClick={() => openObjectDrawer(change.id)} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[8px] font-bold text-slate-600">{statusLabel(change.status)}</span>
                      <h3 className="mt-2 truncate text-[11px] font-extrabold text-slate-900">{change.title}</h3>
                      <p className="mt-1 text-[9px] text-slate-400">{change.projectName} · {change.ownerName}</p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </div>
                  {change.reason && <p className="mt-3 line-clamp-2 text-[9px] leading-4 text-slate-500">{change.reason}</p>}
                </button>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400"><CircleDollarSign className="h-3.5 w-3.5" /> Impacto costo</div>
                    <p className="mt-1 text-[13px] font-extrabold text-slate-800">{change.costImpact !== undefined ? currency.format(change.costImpact) : 'Sin estimar'}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.08em] text-slate-400"><Clock3 className="h-3.5 w-3.5" /> Impacto plazo</div>
                    <p className="mt-1 text-[13px] font-extrabold text-slate-800">{change.timeImpactDays !== undefined ? `+${change.timeImpactDays} días` : 'Sin estimar'}</p>
                  </div>
                </div>

                {approval && (
                  <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                    <button
                      disabled={isObjectMutationPending}
                      onClick={() => void decideApproval(approval.id, 'REJECTED', 'Rechazado por comité')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[9px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Rechazar
                    </button>
                    <button
                      disabled={isObjectMutationPending}
                      onClick={() => void decideApproval(approval.id, 'APPROVED', 'Aprobado oficialmente')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-2.5 py-1.5 text-[9px] font-bold text-white hover:bg-green-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {filteredChanges.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center text-[10px] text-slate-400">
              No hay solicitudes de cambio que coincidan con los filtros actuales.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
