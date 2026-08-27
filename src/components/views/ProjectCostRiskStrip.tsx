import React, { useEffect, useState } from 'react';
import { AlertTriangle, CircleDollarSign, RefreshCw, TrendingUp } from 'lucide-react';
import { bridataApi } from '../../api/client';
import type { ApiProjectCostOverviewV2 } from '../../api/costEngineV2Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

export const ProjectCostRiskStrip: React.FC<{ projectId: string }> = ({ projectId }) => {
  const apiBootstrap = useApiBootstrap();
  const { setProjectActiveSubTab, tenant } = useNexus();
  const [overview, setOverview] = useState<ApiProjectCostOverviewV2 | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (apiBootstrap.dataMode !== 'api' || apiBootstrap.status !== 'ready') return;
    let cancelled = false;
    setLoading(true);
    void bridataApi.projectCostOverviewV2(projectId)
      .then((result) => { if (!cancelled) setOverview(result); })
      .catch(() => { if (!cancelled) setOverview(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBootstrap.dataMode, apiBootstrap.status, projectId]);

  if (apiBootstrap.dataMode !== 'api') return null;
  if (loading && !overview) return <div className="mb-3 flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[9px] text-slate-400"><RefreshCw className="h-3 w-3 animate-spin" /> Calculando impacto de costos...</div>;
  if (!overview || (!overview.profile && overview.lines.length === 0)) return null;

  const summary = overview.summary;
  const risk = summary.health === 'WATCH' || summary.health === 'HIGH' || summary.health === 'CRITICAL';
  const currency = overview.currency || tenant.currency || 'USD';
  const money = (value: number) => {
    try { return new Intl.NumberFormat('es-PE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
    catch { return `${currency} ${Math.round(value).toLocaleString('es-PE')}`; }
  };

  return (
    <section className={`mb-3 flex flex-col gap-2 rounded-xl border px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between ${risk ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/40'}`}>
      <div className="flex min-w-0 items-center gap-2">
        <div className={`grid h-8 w-8 place-items-center rounded-lg ${risk ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {risk ? <AlertTriangle className="h-3.5 w-3.5" /> : <CircleDollarSign className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0">
          <p className={`text-[9px] font-extrabold ${risk ? 'text-rose-800' : 'text-emerald-800'}`}>{risk ? 'Forecast de costo requiere atención' : 'Costo dentro del control presupuestal'}</p>
          <p className="mt-0.5 truncate text-[8px] text-slate-500">EAC {money(summary.estimateAtCompletion)} · Control {money(summary.controlBudget)} · VAC {money(summary.varianceAtCompletion)}</p>
        </div>
      </div>
      <button onClick={() => setProjectActiveSubTab('costs')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[8px] font-extrabold text-slate-700 shadow-sm"><TrendingUp className="h-3 w-3" /> Ver costos</button>
    </section>
  );
};