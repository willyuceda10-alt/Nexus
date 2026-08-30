import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  FileText,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  Warehouse,
} from 'lucide-react';
import { BridataApiError } from '../../api/client';
import { sapMaterialFlowV1G2Api } from '../../api/sapMaterialFlowV1G2Client';
import type {
  ApiSapMaterialFlowItemV1G2,
  ApiSapMaterialFlowRiskV1G2,
  ApiSapMaterialFlowStateV1G2,
  ApiSapMaterialFlowV1G2,
} from '../../api/sapMaterialFlowV1G2Contracts';

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo consultar el flujo SAP de materiales.';
}

function quantity(value: number, uom?: string): string {
  return `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 }).format(value)}${uom ? ` ${uom}` : ''}`;
}

function dateOnly(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(date).replace('.', '');
}

function dateTime(value?: string | null): string {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date).replace('.', '');
}

function stateLabel(state: ApiSapMaterialFlowStateV1G2): string {
  const labels: Record<ApiSapMaterialFlowStateV1G2, string> = {
    AWAITING_ORDER: 'Pendiente de pedido',
    ORDERED: 'Pedido emitido',
    PARTIAL: 'Entrega parcial',
    RECEIVED: 'Recibido',
    CONSUMED: 'Consumido',
    NO_ACTIVITY: 'Sin movimiento',
  };
  return labels[state];
}

function stateTone(state: ApiSapMaterialFlowStateV1G2): string {
  if (state === 'RECEIVED' || state === 'CONSUMED') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (state === 'PARTIAL') return 'bg-sky-50 text-sky-700 ring-sky-200';
  if (state === 'ORDERED') return 'bg-indigo-50 text-indigo-700 ring-indigo-200';
  if (state === 'AWAITING_ORDER') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-slate-100 text-slate-600 ring-slate-200';
}

function riskLabel(risk: ApiSapMaterialFlowRiskV1G2): string {
  const labels: Record<ApiSapMaterialFlowRiskV1G2, string> = {
    NONE: 'Sin riesgo',
    WATCH: 'Por atender',
    LATE: 'Atrasado',
    UNMAPPED: 'PEP sin mapear',
  };
  return labels[risk];
}

function riskTone(risk: ApiSapMaterialFlowRiskV1G2): string {
  if (risk === 'NONE') return 'text-emerald-700';
  if (risk === 'WATCH') return 'text-amber-700';
  if (risk === 'LATE') return 'text-rose-700';
  return 'text-slate-500';
}

const Metric: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
  attention?: boolean;
}> = ({ icon: Icon, label, value, detail, attention }) => (
  <div className={`rounded-2xl border bg-white p-4 shadow-sm ${attention ? 'border-amber-200' : 'border-slate-200'}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
        <p className={`mt-2 text-2xl font-black tracking-tight ${attention ? 'text-amber-700' : 'text-slate-950'}`}>{value}</p>
      </div>
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${attention ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
        <Icon className="h-4 w-4" />
      </span>
    </div>
    <p className="mt-2 text-[9px] font-medium text-slate-500">{detail}</p>
  </div>
);

const FlowBar: React.FC<{ item: ApiSapMaterialFlowItemV1G2 }> = ({ item }) => {
  const base = Math.max(item.requestedQty, item.orderedQty, item.receivedQty, item.consumedQty, 1);
  const steps = [
    { label: 'SolP', value: item.requestedQty },
    { label: 'Pedido', value: item.orderedQty },
    { label: 'Recibido', value: item.receivedQty },
    { label: 'Consumido', value: item.consumedQty },
  ];
  return (
    <div className="flex min-w-[360px] items-center gap-2">
      {steps.map((step, index) => (
        <React.Fragment key={step.label}>
          <div className="min-w-[72px]">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-green-700" style={{ width: `${Math.min(100, (step.value / base) * 100)}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-1 text-[7px]">
              <span className="font-bold uppercase tracking-[0.08em] text-slate-400">{step.label}</span>
              <span className="font-black text-slate-700">{step.value}</span>
            </div>
          </div>
          {index < steps.length - 1 && <ArrowRight className="h-3 w-3 flex-none text-slate-300" />}
        </React.Fragment>
      ))}
    </div>
  );
};

type Props = {
  workspaceId: string;
  projectId?: string | null;
};

export const SapMaterialFlowV1G2: React.FC<Props> = ({ workspaceId, projectId }) => {
  const [data, setData] = useState<ApiSapMaterialFlowV1G2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await sapMaterialFlowV1G2Api.flow(workspaceId, projectId ?? null));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es-PE');
    return (data?.materials ?? []).filter((item) => {
      if (attentionOnly && item.risk === 'NONE') return false;
      if (!term) return true;
      return [
        item.materialCode,
        item.materialTitle,
        item.projectTitle ?? '',
        ...item.requisitions.map((line) => line.number),
        ...item.purchaseOrders.map((line) => line.number),
        ...item.purchaseOrders.map((line) => line.supplierName),
      ].some((value) => value.toLocaleLowerCase('es-PE').includes(term));
    });
  }, [data, search, attentionOnly]);

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <div className="text-center">
          <RefreshCw className="mx-auto h-5 w-5 animate-spin text-green-700" />
          <p className="mt-3 text-[11px] font-bold text-slate-600">Construyendo flujo SAP desde PostgreSQL Bridata…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
        <AlertTriangle className="mx-auto h-5 w-5 text-rose-600" />
        <p className="mt-2 text-[11px] font-bold text-rose-700">{error}</p>
        <button onClick={() => void reload()} className="mt-4 rounded-xl bg-white px-4 py-2 text-[9px] font-bold text-rose-700 ring-1 ring-rose-200">Reintentar</button>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-2xl border border-green-100 bg-gradient-to-r from-green-950 via-green-900 to-green-800 p-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-green-200">
              <Database className="h-3.5 w-3.5" /> Flujo SAP · PostgreSQL Bridata
            </div>
            <h2 className="mt-2 text-xl font-black tracking-tight">SolP → Pedido → Recibido → Por llegar → Consumido → Stock</h2>
            <p className="mt-1 max-w-4xl text-[10px] leading-5 text-green-100/80">
              Trazabilidad construida sobre entidades canónicas y ledger de inventario. El Excel no participa en la ejecución de esta pantalla.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-white/10 px-3 py-2 text-[9px] font-bold ring-1 ring-white/15">{data?.projectTitle ?? 'Todos los proyectos'}</span>
            <button disabled={loading} onClick={() => void reload()} className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[9px] font-semibold text-amber-800">{error}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <Metric icon={Boxes} label="Materiales" value={String(summary?.materialCount ?? 0)} detail={`${summary?.rowCount ?? 0} material/proyecto`} />
        <Metric icon={FileText} label="Solicitado" value={quantity(summary?.requestedQty ?? 0)} detail="SolP SAP" />
        <Metric icon={ShoppingCart} label="Pedido" value={quantity(summary?.orderedQty ?? 0)} detail="Cantidad ordenada" />
        <Metric icon={PackageCheck} label="Recibido" value={quantity(summary?.receivedQty ?? 0)} detail="101 neto 102" />
        <Metric icon={Truck} label="Por llegar" value={quantity(summary?.outstandingQty ?? 0)} detail="Pedido − recibido" attention={(summary?.outstandingQty ?? 0) > 0} />
        <Metric icon={Warehouse} label="Consumido" value={quantity(summary?.consumedQty ?? 0)} detail="221 neto 222" />
        <Metric icon={Database} label="Stock actual" value={quantity(summary?.stockQty ?? 0)} detail="Ledger canónico" />
        <Metric icon={AlertTriangle} label="Atención" value={String(summary?.attentionCount ?? 0)} detail={`${summary?.lateCount ?? 0} atrasados`} attention={(summary?.attentionCount ?? 0) > 0} />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-black text-slate-900">Trazabilidad de abastecimiento</p>
            <p className="mt-1 text-[9px] text-slate-500">Documento y posición SAP se conservan como identidad externa; las cantidades provienen del modelo operacional.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Material, SolP, Pedido, proveedor…" className="h-9 w-[260px] rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-[9px] font-semibold text-slate-700 outline-none focus:border-green-300 focus:bg-white" />
            </label>
            <button onClick={() => setAttentionOnly((value) => !value)} className={`h-9 rounded-xl px-3 text-[9px] font-bold ring-1 ${attentionOnly ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-white text-slate-600 ring-slate-200'}`}>
              Solo atención
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left text-[9px]">
            <thead className="bg-slate-50 text-[8px] font-black uppercase tracking-[0.09em] text-slate-400">
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-3 py-3">Material / proyecto</th>
                <th className="px-3 py-3">Flujo</th>
                <th className="px-3 py-3 text-right">Solicitado</th>
                <th className="px-3 py-3 text-right">Pedido</th>
                <th className="px-3 py-3 text-right">Recibido</th>
                <th className="px-3 py-3 text-right">Por llegar</th>
                <th className="px-3 py-3 text-right">Consumido</th>
                <th className="px-3 py-3 text-right">Stock</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Riesgo</th>
                <th className="px-4 py-3">Próxima entrega</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item) => {
                const isOpen = expanded.has(item.key);
                return (
                  <React.Fragment key={item.key}>
                    <tr className={`${item.risk === 'LATE' ? 'bg-rose-50/25' : item.risk === 'WATCH' ? 'bg-amber-50/20' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-3 py-3">
                        <button onClick={() => toggle(item.key)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-black text-slate-900">{item.materialTitle}</div>
                        <div className="mt-1 text-[8px] font-semibold text-slate-400">{item.materialCode} · {item.uomCode}</div>
                        <div className="mt-1 text-[8px] text-green-700">{item.projectTitle ?? 'PEP sin proyecto mapeado'}</div>
                      </td>
                      <td className="px-3 py-3"><FlowBar item={item} /></td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">{quantity(item.requestedQty)}</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">{quantity(item.orderedQty)}</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">{quantity(item.receivedQty)}</td>
                      <td className={`px-3 py-3 text-right font-black ${item.outstandingQty > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{quantity(item.outstandingQty)}</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">{quantity(item.consumedQty)}</td>
                      <td className="px-3 py-3 text-right font-black text-green-700">{quantity(item.stockQty)}</td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[8px] font-black ring-1 ${stateTone(item.state)}`}>{stateLabel(item.state)}</span></td>
                      <td className="px-3 py-3"><div className={`flex items-center gap-1.5 font-black ${riskTone(item.risk)}`}>{item.risk === 'NONE' ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{riskLabel(item.risk)}</div></td>
                      <td className="px-4 py-3"><div className="font-bold text-slate-700">{dateOnly(item.nextExpectedDate)}</div><div className="mt-1 flex items-center gap-1 text-[8px] text-slate-400"><Clock3 className="h-3 w-3" /> SAP {dateTime(item.lastSapActivityAt)}</div></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={12} className="px-5 py-4">
                          <div className="grid gap-3 xl:grid-cols-2">
                            <DocumentList
                              title="Solicitudes de pedido (SolP)"
                              empty="No hay SolP SAP vinculada a este material/proyecto."
                              rows={item.requisitions.map((line) => ({
                                key: line.lineId,
                                primary: `${line.number}${line.position ? ` / ${line.position}` : ''}`,
                                secondary: line.status,
                                value: quantity(line.quantity, item.uomCode),
                              }))}
                            />
                            <DocumentList
                              title="Pedidos SAP"
                              empty="No hay Pedido SAP vinculado a este material/proyecto."
                              rows={item.purchaseOrders.map((line) => ({
                                key: line.lineId,
                                primary: `${line.number}${line.position ? ` / ${line.position}` : ''}`,
                                secondary: `${line.supplierName} · ${line.status} · entrega ${dateOnly(line.expectedDate)}`,
                                value: `${quantity(line.receivedQty, item.uomCode)} / ${quantity(line.quantity, item.uomCode)}`,
                              }))}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={12} className="px-6 py-16 text-center"><Boxes className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-3 text-[10px] font-bold text-slate-500">No hay flujo SAP que coincida con los filtros.</p><p className="mt-1 text-[9px] text-slate-400">Los materiales aparecerán después de una sincronización D1/D2 con identidad SAP válida.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[8px] text-slate-500">
        <span><strong className="text-slate-700">Por llegar</strong> = cantidad Pedido − recibido neto.</span>
        <span><strong className="text-slate-700">Consumido</strong> = movimiento 221 neto de 222.</span>
        <span><strong className="text-slate-700">Stock</strong> = ledger canónico completo del workspace.</span>
        <span className="font-bold text-green-700">Excel runtime: NO</span>
      </div>
    </div>
  );
};

const DocumentList: React.FC<{
  title: string;
  empty: string;
  rows: Array<{ key: string; primary: string; secondary: string; value: string }>;
}> = ({ title, empty, rows }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-3">
    <p className="text-[8px] font-black uppercase tracking-[0.11em] text-slate-400">{title}</p>
    <div className="mt-2 space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2">
          <div className="min-w-0">
            <p className="font-black text-slate-800">{row.primary}</p>
            <p className="mt-0.5 truncate text-[8px] text-slate-500">{row.secondary}</p>
          </div>
          <span className="flex-none text-[9px] font-black text-green-700">{row.value}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-[8px] text-slate-400">{empty}</p>}
    </div>
  </div>
);
