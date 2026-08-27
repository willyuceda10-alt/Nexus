import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, PackageSearch, RefreshCw } from 'lucide-react';
import { bridataApi } from '../../api/client';
import type { ApiMaterialOverviewV2 } from '../../api/materialInventoryV2Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

export const ProjectMaterialRiskStrip: React.FC<{ projectId: string }> = ({ projectId }) => {
  const apiBootstrap = useApiBootstrap();
  const { currentWorkspace, setActiveTab, setSelectedProjectId, openObjectDrawer } = useNexus();
  const [data, setData] = useState<ApiMaterialOverviewV2 | null>(null);
  const [loading, setLoading] = useState(false);

  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  useEffect(() => {
    if (!apiReady || !currentWorkspace) return;
    let cancelled = false;
    setLoading(true);
    void bridataApi.materialOverviewV2(currentWorkspace.id, projectId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiReady, currentWorkspace, projectId]);

  const risks = useMemo(
    () => data?.requirements.filter((item) => item.taskAtRisk).slice(0, 4) ?? [],
    [data],
  );

  if (!apiReady) return null;
  if (loading && !data) {
    return <div className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[9px] font-semibold text-slate-500"><RefreshCw className="h-3 w-3 animate-spin" /> Evaluando disponibilidad de materiales...</div>;
  }
  if (!data || data.summary.requirementCount === 0) return null;

  const atRisk = data.summary.atRiskCount > 0;
  return (
    <section className={`mb-3 rounded-xl border px-3 py-2.5 ${atRisk ? 'border-amber-200 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/60'}`}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-xl ${atRisk ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {atRisk ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0">
            <p className={`text-[10px] font-extrabold ${atRisk ? 'text-amber-900' : 'text-emerald-900'}`}>
              Materiales · {atRisk ? `${data.summary.taskAtRiskCount} tarea(s) en riesgo` : 'abastecimiento sin bloqueos detectados'}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[8px] font-semibold text-slate-600">
              <span>{data.summary.requirementCount} requerimientos</span>
              <span>{data.summary.shortageCount} faltantes</span>
              <span>{data.summary.openPurchaseOrderCount} OC abiertas</span>
              {data.summary.totalDeficitQty > 0 && <span className="font-extrabold text-rose-700">Déficit {data.summary.totalDeficitQty}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {risks.map((risk) => (
            <button key={risk.id} disabled={!risk.workItemId} onClick={() => risk.workItemId && openObjectDrawer(risk.workItemId)} className="rounded-lg bg-white px-2 py-1.5 text-[8px] font-bold text-slate-700 ring-1 ring-amber-200 hover:text-green-800 disabled:cursor-default">
              {risk.wbsCode ? `${risk.wbsCode} · ` : ''}{risk.materialCode} · {risk.state === 'SHORTAGE' ? `déficit ${risk.deficitQty}` : `+${risk.lateByDays}d`}
            </button>
          ))}
          <button onClick={() => { setSelectedProjectId(projectId); setActiveTab('materials'); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-[8px] font-bold text-white">
            <PackageSearch className="h-3 w-3" /> Abrir materiales
          </button>
        </div>
      </div>
    </section>
  );
};
