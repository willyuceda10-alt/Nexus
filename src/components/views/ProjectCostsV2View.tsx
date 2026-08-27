import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  Banknote,
  Baseline,
  CircleDollarSign,
  ClipboardList,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type {
  ApiCostCatalogV2,
  ApiProjectCostOverviewV2,
} from '../../api/costEngineV2Contracts';
import type { ApiMaterialSetupV2 } from '../../api/materialInventoryV2Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

type Panel = 'profile' | 'code' | 'budget' | 'actual' | 'commitment' | null;

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo completar la operación de costos.';
}

function healthLabel(value: ApiProjectCostOverviewV2['summary']['health']): string {
  if (value === 'ON_TRACK') return 'En control';
  if (value === 'WATCH') return 'Vigilancia';
  if (value === 'HIGH') return 'Alto';
  if (value === 'CRITICAL') return 'Crítico';
  return 'Sin presupuesto';
}

function healthClass(value: ApiProjectCostOverviewV2['summary']['health']): string {
  if (value === 'ON_TRACK') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (value === 'WATCH') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (value === 'HIGH') return 'bg-orange-50 text-orange-700 ring-orange-200';
  if (value === 'CRITICAL') return 'bg-rose-50 text-rose-700 ring-rose-200';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}

export const ProjectCostsV2View: React.FC<{ projectId: string; embedded?: boolean }> = ({ projectId, embedded = false }) => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, objects } = useNexus();
  const isApiMode = apiBootstrap.dataMode === 'api';
  const project = objects.find((item) => item.id === projectId && item.type === 'PROJECT');
  const workItems = useMemo(
    () => objects.filter((item) => item.projectId === projectId && ['TASK', 'DELIVERABLE', 'MILESTONE'].includes(item.type)),
    [objects, projectId],
  );

  const [overview, setOverview] = useState<ApiProjectCostOverviewV2 | null>(null);
  const [catalog, setCatalog] = useState<ApiCostCatalogV2 | null>(null);
  const [materialSetup, setMaterialSetup] = useState<ApiMaterialSetupV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [forecastEdits, setForecastEdits] = useState<Record<string, string>>({});

  const [profileDraft, setProfileDraft] = useState({ currency: tenant.currency || 'USD', contingencyAmount: 0 });
  const [codeDraft, setCodeDraft] = useState({ code: '', name: '', category: 'OTHER' as const });
  const [budgetDraft, setBudgetDraft] = useState({
    costCodeId: '', workItemId: '', materialId: '', description: '', plannedAmount: 0, approvedAmount: 0, forecast: '',
  });
  const [actualDraft, setActualDraft] = useState({
    costCodeId: '', workItemId: '', materialId: '', description: '', amount: 0,
  });
  const [commitmentDraft, setCommitmentDraft] = useState({
    costCodeId: '', workItemId: '', supplierId: '', description: '', amount: 0,
  });

  const reload = useCallback(async () => {
    if (!isApiMode || !currentWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewResult, catalogResult, materialResult] = await Promise.all([
        bridataApi.projectCostOverviewV2(projectId),
        bridataApi.costCatalogV2(currentWorkspace.id),
        bridataApi.materialSetupV2(currentWorkspace.id).catch(() => null),
      ]);
      setOverview(overviewResult);
      setCatalog(catalogResult);
      setMaterialSetup(materialResult);
      setProfileDraft({
        currency: overviewResult.profile?.currency ?? overviewResult.currency ?? tenant.currency ?? 'USD',
        contingencyAmount: overviewResult.profile?.contingencyAmount ?? 0,
      });
      setForecastEdits(Object.fromEntries(
        overviewResult.lines.map((line) => [line.id, line.forecastRemainingUncommitted.toString()]),
      ));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, isApiMode, projectId, tenant.currency]);

  useEffect(() => { void reload(); }, [reload]);

  const money = useCallback((value: number) => {
    const currency = overview?.currency ?? tenant.currency ?? 'USD';
    try {
      return new Intl.NumberFormat('es-PE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
    } catch {
      return `${currency} ${value.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
    }
  }, [overview?.currency, tenant.currency]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      await reload();
      setPanel(null);
      setFeedback(success);
    } catch (cause) {
      setFeedback(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!isApiMode) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <p className="text-[13px] font-extrabold text-slate-900">Cost Engine V2</p>
        <p className="mt-2 text-[11px] text-slate-500">El controlador de costos tipado se activa en modo API. El presupuesto legado del objeto permanece visible en las vistas antiguas.</p>
      </div>
    );
  }

  if (loading && !overview) {
    return <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-slate-200 bg-white"><RefreshCw className="h-5 w-5 animate-spin text-green-700" /></div>;
  }

  if (!overview || error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-6">
        <p className="text-[12px] font-bold text-rose-700">No se pudo cargar Cost Engine V2</p>
        <p className="mt-2 text-[10px] text-slate-500">{error}</p>
        <button onClick={() => void reload()} className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-[10px] font-bold text-white">Reintentar</button>
      </div>
    );
  }

  const summary = overview.summary;
  const costCodes = catalog?.costCodes ?? [];
  const suppliers = catalog?.suppliers ?? [];
  const materials = materialSetup?.materials ?? [];
  const unallocated = overview.unallocated.actual + overview.unallocated.commitment;

  const initializeFromLegacy = async () => {
    const dry = await bridataApi.backfillCostEngineV2(projectId, true);
    if (!dry.createProfile && !dry.createBudgetLine && !dry.createLegacyActual) {
      setFeedback('El proyecto no tiene datos legados pendientes de migración.');
      return;
    }
    if (!window.confirm(`Migrar Cost Engine V2: presupuesto ${money(dry.legacyBudget)} y costo histórico ${money(dry.legacySpent)}?`)) return;
    await run(() => bridataApi.backfillCostEngineV2(projectId, false), 'Datos legados migrados a Cost Engine V2.');
  };

  return (
    <div className={embedded ? 'space-y-3' : 'space-y-5'}>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CircleDollarSign className="h-4 w-4 text-green-700" />
              <h3 className="text-[13px] font-extrabold text-slate-900">Control de costos · Project Controlling V2</h3>
              <span className={`rounded-full px-2 py-1 text-[8px] font-extrabold ring-1 ${healthClass(summary.health)}`}>{healthLabel(summary.health)}</span>
            </div>
            <p className="mt-1 text-[9px] text-slate-400">Presupuesto, reales, compromisos, EAC, VAC y línea base. Moneda de control: {overview.currency}.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {!overview.profile && <button disabled={busy} onClick={() => setPanel('profile')} className="h-8 rounded-lg bg-green-700 px-3 text-[9px] font-bold text-white">Configurar</button>}
            <button disabled={busy} onClick={() => setPanel('budget')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[9px] font-bold text-slate-700"><Plus className="h-3 w-3" /> Presupuesto</button>
            <button disabled={busy} onClick={() => setPanel('actual')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[9px] font-bold text-slate-700"><Banknote className="h-3 w-3" /> Costo real</button>
            <button disabled={busy} onClick={() => setPanel('commitment')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[9px] font-bold text-slate-700"><ClipboardList className="h-3 w-3" /> Compromiso</button>
            <button disabled={busy} onClick={() => void run(() => bridataApi.captureCostBaselineV2(projectId, `Baseline costo ${(overview.baseline?.version ?? 0) + 1}`), 'Nueva línea base de costo capturada.')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[9px] font-bold text-slate-700"><Baseline className="h-3 w-3" /> Baseline</button>
            <button disabled={busy || loading} onClick={() => void reload()} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-950 text-white"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-3 xl:grid-cols-6">
          <CostKpi label="Presupuesto control" value={money(summary.controlBudget)} detail={`Aprobado ${money(summary.approvedBudget)}`} />
          <CostKpi label="Costo real" value={money(summary.actualCost)} detail={`Material ${money(summary.materialActual)}`} />
          <CostKpi label="Comprometido" value={money(summary.openCommitment)} detail={`OC ${money(summary.materialOpenCommitment)}`} />
          <CostKpi label="ETC" value={money(summary.estimateToComplete)} detail="Costo por completar" />
          <CostKpi label="EAC" value={money(summary.estimateAtCompletion)} detail="Estimado al cierre" attention={summary.varianceAtCompletion < 0} />
          <CostKpi label="VAC" value={money(summary.varianceAtCompletion)} detail={summary.forecastVariancePercent == null ? 'Sin base' : `${summary.forecastVariancePercent > 0 ? '+' : ''}${summary.forecastVariancePercent}% vs control`} attention={summary.varianceAtCompletion < 0} />
        </div>
      </section>

      {(feedback || unallocated > 0 || overview.currencyIssues.length > 0 || !overview.profile) && (
        <section className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              {feedback && <p className="text-[9px] font-semibold text-slate-600">{feedback}</p>}
              {!overview.profile && <p className="text-[9px] font-bold text-amber-700">El proyecto todavía no tiene perfil monetario V2.</p>}
              {unallocated > 0 && <p className="text-[9px] font-bold text-amber-700">{money(unallocated)} de reales/compromisos no pudieron asignarse de forma unívoca a una línea presupuestal.</p>}
              {overview.currencyIssues.length > 0 && <p className="text-[9px] font-bold text-rose-700">{overview.currencyIssues.length} movimiento(s) están en otra moneda o sin moneda y no se incluyen en los totales.</p>}
            </div>
            {!overview.profile && <button disabled={busy} onClick={() => void initializeFromLegacy()} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-50 px-3 text-[9px] font-bold text-amber-800 ring-1 ring-amber-200"><Sparkles className="h-3 w-3" /> Migrar legado</button>}
          </div>
        </section>
      )}

      {overview.baseline && (
        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">Última línea base</p>
            <p className="mt-1 text-[12px] font-extrabold text-slate-900">Baseline v{overview.baseline.version}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">Aprobado baseline</p>
            <p className="mt-1 text-[12px] font-extrabold text-slate-900">{money(overview.baseline.approvedBudget)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">Cambio de presupuesto</p>
            <p className={`mt-1 text-[12px] font-extrabold ${overview.baseline.approvedVariance > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{money(overview.baseline.approvedVariance)}</p>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-[11px] font-extrabold text-slate-900">Presupuesto y forecast por línea</p>
            <p className="mt-0.5 text-[8px] text-slate-400">El forecast editable representa costo futuro todavía no comprometido.</p>
          </div>
          <button onClick={() => setPanel('code')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-[9px] font-bold text-slate-600"><Plus className="h-3 w-3" /> Código de costo</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left">
            <thead className="bg-slate-50 text-[8px] font-extrabold uppercase tracking-[0.1em] text-slate-400">
              <tr><th className="px-4 py-3">Código / línea</th><th className="px-3 py-3">Tarea / material</th><th className="px-3 py-3 text-right">Aprobado</th><th className="px-3 py-3 text-right">Real</th><th className="px-3 py-3 text-right">Compromiso</th><th className="px-3 py-3 text-right">Forecast libre</th><th className="px-3 py-3 text-right">EAC</th><th className="px-4 py-3 text-right">VAC</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.lines.map((line) => (
                <tr key={line.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3"><p className="text-[10px] font-extrabold text-slate-900">{line.costCode} · {line.description}</p><p className="mt-0.5 text-[8px] text-slate-400">{line.costCodeName}</p></td>
                  <td className="px-3 py-3"><p className="text-[9px] font-semibold text-slate-600">{line.workItemTitle ?? 'Proyecto'}</p><p className="text-[8px] text-slate-400">{line.materialName ?? 'Sin material específico'}</p></td>
                  <td className="px-3 py-3 text-right text-[9px] font-bold text-slate-700">{money(line.approvedAmount)}</td>
                  <td className="px-3 py-3 text-right text-[9px] font-bold text-slate-700">{money(line.actualAmount)}</td>
                  <td className="px-3 py-3 text-right text-[9px] font-bold text-slate-700">{money(line.commitmentAmount)}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="ml-auto flex w-[130px] items-center gap-1">
                      <input value={forecastEdits[line.id] ?? ''} onChange={(event) => setForecastEdits((current) => ({ ...current, [line.id]: event.target.value }))} type="number" min="0" className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-right text-[9px] font-bold outline-none focus:border-green-500" />
                      <button disabled={busy} onClick={() => {
                        const value = Number(forecastEdits[line.id]);
                        if (!Number.isFinite(value) || value < 0) return;
                        void run(() => bridataApi.updateBudgetLineV2(line.id, { forecastRemainingUncommitted: value }), 'Forecast actualizado.');
                      }} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-green-700"><Save className="h-3 w-3" /></button>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right text-[9px] font-extrabold text-slate-900">{money(line.estimateAtCompletion)}</td>
                  <td className={`px-4 py-3 text-right text-[9px] font-extrabold ${line.varianceAtCompletion < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(line.varianceAtCompletion)}</td>
                </tr>
              ))}
              {overview.lines.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-[10px] text-slate-400">Aún no existen líneas presupuestales V2.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {panel && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/20 backdrop-blur-[1px]">
          <div className="h-full w-full max-w-[480px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
              <div><p className="text-[12px] font-extrabold text-slate-900">{panel === 'profile' ? 'Perfil monetario' : panel === 'code' ? 'Código de costo' : panel === 'budget' ? 'Línea presupuestal' : panel === 'actual' ? 'Registrar costo real' : 'Registrar compromiso'}</p><p className="mt-0.5 text-[8px] text-slate-400">{project?.title ?? 'Proyecto'}</p></div>
              <button disabled={busy} onClick={() => setPanel(null)} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              {panel === 'profile' && <>
                <Field label="Moneda"><input value={profileDraft.currency} maxLength={3} onChange={(e) => setProfileDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} className="form-control mt-0" /></Field>
                <Field label="Contingencia"><input type="number" min="0" value={profileDraft.contingencyAmount} onChange={(e) => setProfileDraft((d) => ({ ...d, contingencyAmount: Number(e.target.value) }))} className="form-control mt-0" /></Field>
                <ActionButton busy={busy} label="Guardar perfil" onClick={() => void run(() => bridataApi.updateProjectCostProfileV2(projectId, profileDraft), 'Perfil de costo actualizado.')} />
              </>}
              {panel === 'code' && <>
                <Field label="Código"><input value={codeDraft.code} onChange={(e) => setCodeDraft((d) => ({ ...d, code: e.target.value }))} className="form-control mt-0" /></Field>
                <Field label="Nombre"><input value={codeDraft.name} onChange={(e) => setCodeDraft((d) => ({ ...d, name: e.target.value }))} className="form-control mt-0" /></Field>
                <Field label="Categoría"><select value={codeDraft.category} onChange={(e) => setCodeDraft((d) => ({ ...d, category: e.target.value as typeof d.category }))} className="form-control mt-0"><option value="MATERIAL">Material</option><option value="LABOR">Mano de obra</option><option value="EQUIPMENT">Equipo</option><option value="SERVICE">Servicio</option><option value="SUBCONTRACT">Subcontrato</option><option value="OTHER">Otro</option></select></Field>
                <ActionButton busy={busy} label="Crear código" onClick={() => currentWorkspace && void run(() => bridataApi.createCostCodeV2({ workspaceId: currentWorkspace.id, ...codeDraft }), 'Código de costo creado.')} />
              </>}
              {panel === 'budget' && <>
                <CostSelectors codes={costCodes} workItems={workItems} materials={materials} costCodeId={budgetDraft.costCodeId} workItemId={budgetDraft.workItemId} materialId={budgetDraft.materialId} onCode={(v) => setBudgetDraft((d) => ({ ...d, costCodeId: v }))} onWorkItem={(v) => setBudgetDraft((d) => ({ ...d, workItemId: v }))} onMaterial={(v) => setBudgetDraft((d) => ({ ...d, materialId: v }))} />
                <Field label="Descripción"><input value={budgetDraft.description} onChange={(e) => setBudgetDraft((d) => ({ ...d, description: e.target.value }))} className="form-control mt-0" /></Field>
                <div className="grid grid-cols-2 gap-3"><Field label="Planificado"><input type="number" min="0" value={budgetDraft.plannedAmount} onChange={(e) => setBudgetDraft((d) => ({ ...d, plannedAmount: Number(e.target.value) }))} className="form-control mt-0" /></Field><Field label="Aprobado"><input type="number" min="0" value={budgetDraft.approvedAmount} onChange={(e) => setBudgetDraft((d) => ({ ...d, approvedAmount: Number(e.target.value) }))} className="form-control mt-0" /></Field></div>
                <Field label="Forecast libre (opcional)"><input type="number" min="0" value={budgetDraft.forecast} onChange={(e) => setBudgetDraft((d) => ({ ...d, forecast: e.target.value }))} className="form-control mt-0" /></Field>
                <ActionButton busy={busy} label="Crear línea" onClick={() => void run(() => bridataApi.createBudgetLineV2(projectId, { costCodeId: budgetDraft.costCodeId, workItemId: budgetDraft.workItemId || null, materialId: budgetDraft.materialId || null, description: budgetDraft.description, plannedAmount: budgetDraft.plannedAmount, approvedAmount: budgetDraft.approvedAmount, ...(budgetDraft.forecast !== '' ? { forecastRemainingUncommitted: Number(budgetDraft.forecast) } : {}) }), 'Línea presupuestal creada.')} />
              </>}
              {panel === 'actual' && <>
                <CostSelectors codes={costCodes} workItems={workItems} materials={materials} costCodeId={actualDraft.costCodeId} workItemId={actualDraft.workItemId} materialId={actualDraft.materialId} onCode={(v) => setActualDraft((d) => ({ ...d, costCodeId: v }))} onWorkItem={(v) => setActualDraft((d) => ({ ...d, workItemId: v }))} onMaterial={(v) => setActualDraft((d) => ({ ...d, materialId: v }))} allowEmptyCode />
                <Field label="Descripción"><input value={actualDraft.description} onChange={(e) => setActualDraft((d) => ({ ...d, description: e.target.value }))} className="form-control mt-0" /></Field>
                <Field label={`Importe (${overview.currency})`}><input type="number" min="0" value={actualDraft.amount} onChange={(e) => setActualDraft((d) => ({ ...d, amount: Number(e.target.value) }))} className="form-control mt-0" /></Field>
                <ActionButton busy={busy} label="Registrar real" onClick={() => void run(() => bridataApi.createActualCostV2(projectId, { workItemId: actualDraft.workItemId || null, costCodeId: actualDraft.costCodeId || null, materialId: actualDraft.materialId || null, description: actualDraft.description, amount: actualDraft.amount, currency: overview.currency }), 'Costo real registrado.')} />
              </>}
              {panel === 'commitment' && <>
                <Field label="Código de costo"><select value={commitmentDraft.costCodeId} onChange={(e) => setCommitmentDraft((d) => ({ ...d, costCodeId: e.target.value }))} className="form-control mt-0"><option value="">Sin código</option>{costCodes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
                <Field label="Tarea"><select value={commitmentDraft.workItemId} onChange={(e) => setCommitmentDraft((d) => ({ ...d, workItemId: e.target.value }))} className="form-control mt-0"><option value="">Proyecto</option>{workItems.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</select></Field>
                <Field label="Proveedor"><select value={commitmentDraft.supplierId} onChange={(e) => setCommitmentDraft((d) => ({ ...d, supplierId: e.target.value }))} className="form-control mt-0"><option value="">Sin proveedor</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
                <Field label="Descripción"><input value={commitmentDraft.description} onChange={(e) => setCommitmentDraft((d) => ({ ...d, description: e.target.value }))} className="form-control mt-0" /></Field>
                <Field label={`Importe (${overview.currency})`}><input type="number" min="0" value={commitmentDraft.amount} onChange={(e) => setCommitmentDraft((d) => ({ ...d, amount: Number(e.target.value) }))} className="form-control mt-0" /></Field>
                <ActionButton busy={busy} label="Registrar compromiso" onClick={() => void run(() => bridataApi.createCommitmentV2(projectId, { workItemId: commitmentDraft.workItemId || null, costCodeId: commitmentDraft.costCodeId || null, supplierId: commitmentDraft.supplierId || null, description: commitmentDraft.description, amount: commitmentDraft.amount, currency: overview.currency }), 'Compromiso registrado.')} />
              </>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const CostKpi: React.FC<{ label: string; value: string; detail: string; attention?: boolean }> = ({ label, value, detail, attention }) => (
  <div className="bg-white px-3 py-3"><p className="text-[7px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{label}</p><p className={`mt-1 text-[13px] font-extrabold ${attention ? 'text-rose-700' : 'text-slate-900'}`}>{value}</p><p className="mt-0.5 text-[8px] text-slate-400">{detail}</p></div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="block"><span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</span>{children}</label>;

const ActionButton: React.FC<{ busy: boolean; label: string; onClick: () => void }> = ({ busy, label, onClick }) => <button disabled={busy} onClick={onClick} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-green-700 text-[10px] font-extrabold text-white disabled:opacity-40">{busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}{label}</button>;

const CostSelectors: React.FC<{
  codes: ApiCostCatalogV2['costCodes'];
  workItems: Array<{ id: string; title: string }>;
  materials: ApiMaterialSetupV2['materials'];
  costCodeId: string;
  workItemId: string;
  materialId: string;
  onCode: (value: string) => void;
  onWorkItem: (value: string) => void;
  onMaterial: (value: string) => void;
  allowEmptyCode?: boolean;
}> = ({ codes, workItems, materials, costCodeId, workItemId, materialId, onCode, onWorkItem, onMaterial, allowEmptyCode }) => <>
  <Field label="Código de costo"><select value={costCodeId} onChange={(e) => onCode(e.target.value)} className="form-control mt-0">{allowEmptyCode && <option value="">Sin código</option>} {!allowEmptyCode && <option value="">Selecciona código</option>}{codes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
  <Field label="Tarea / WBS"><select value={workItemId} onChange={(e) => onWorkItem(e.target.value)} className="form-control mt-0"><option value="">Proyecto</option>{workItems.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</select></Field>
  <Field label="Material"><select value={materialId} onChange={(e) => onMaterial(e.target.value)} className="form-control mt-0"><option value="">Sin material específico</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}</select></Field>
</>;
