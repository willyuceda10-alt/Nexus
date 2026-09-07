import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileSearch,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { BridataApiError } from '../../api/client';
import { sapMaterialFlowV1G2Api } from '../../api/sapMaterialFlowV1G2Client';
import type { ApiSapMaterialFlowV1G2 } from '../../api/sapMaterialFlowV1G2Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import {
  buildSapProcurementProjectionV1G3,
  type SapProcurementOrderV1G3,
  type SapProcurementRiskV1G3,
  type SapProcurementOrderStateV1G3,
} from '../../domain/sapProcurementV1G3';

type Tab = 'orders' | 'requisitions';

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo cargar Compras / Por llegar.';
}

function qty(value: number): string {
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(value);
}

function shortDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(date).replace('.', '');
}

function stateLabel(state: SapProcurementOrderStateV1G3): string {
  if (state === 'RECEIVED') return 'Recibido';
  if (state === 'PARTIAL') return 'Entrega parcial';
  return 'En pedido';
}

function riskLabel(risk: SapProcurementRiskV1G3): string {
  if (risk === 'LATE') return 'Atrasado';
  if (risk === 'WATCH') return 'Sin fecha';
  return 'En fecha';
}

function stateClass(state: SapProcurementOrderStateV1G3): string {
  if (state === 'RECEIVED') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (state === 'PARTIAL') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-slate-50 text-slate-700 ring-slate-200';
}

function riskClass(risk: SapProcurementRiskV1G3): string {
  if (risk === 'LATE') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (risk === 'WATCH') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
}

interface SapProcurementV1G3ViewProps {
  /** Se renderiza dentro del hub de Materiales: sin cabecera ni lienzo propios. */
  embedded?: boolean;
}

export const SapProcurementV1G3View: React.FC<SapProcurementV1G3ViewProps> = ({ embedded = false }) => {
  const apiBootstrap = useApiBootstrap();
  const { currentWorkspace, objects, selectedProjectId } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const projects = useMemo(() => objects.filter((item) => item.type === 'PROJECT'), [objects]);

  const [projectFilter, setProjectFilter] = useState(selectedProjectId ?? 'ALL');
  const [tab, setTab] = useState<Tab>('orders');
  const [flow, setFlow] = useState<ApiSapMaterialFlowV1G2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    if (!apiReady || !currentWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const projectId = projectFilter === 'ALL' ? null : projectFilter;
      setFlow(await sapMaterialFlowV1G2Api.flow(currentWorkspace.id, projectId));
    } catch (cause) {
      setFlow(null);
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [apiReady, currentWorkspace, projectFilter]);

  useEffect(() => { void reload(); }, [reload]);

  const projection = useMemo(
    () => flow ? buildSapProcurementProjectionV1G3(flow) : null,
    [flow],
  );

  const filteredOrders = useMemo(() => {
    if (!projection) return [];
    const needle = search.trim().toLocaleLowerCase('es-PE');
    return projection.orders.filter((order) => {
      if (openOnly && order.state === 'RECEIVED') return false;
      if (!needle) return true;
      return [order.number, order.supplierName, order.projectTitle ?? '', ...order.lines.flatMap((line) => [line.materialCode, line.materialTitle])]
        .some((value) => value.toLocaleLowerCase('es-PE').includes(needle));
    });
  }, [projection, search, openOnly]);

  const filteredRequisitions = useMemo(() => {
    if (!projection) return [];
    const needle = search.trim().toLocaleLowerCase('es-PE');
    if (!needle) return projection.requisitionsWithoutOrder;
    return projection.requisitionsWithoutOrder.filter((item) =>
      [item.number, item.materialCode, item.materialTitle, item.projectTitle ?? '']
        .some((value) => value.toLocaleLowerCase('es-PE').includes(needle)),
    );
  }, [projection, search]);

  const toggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  if (apiBootstrap.dataMode !== 'api') {
    return (
      <div className="min-h-full bg-[#F8FAFC] p-8">
        <div className="mx-auto max-w-4xl rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <ShoppingCart className="mx-auto h-8 w-8 text-slate-300" />
          <h1 className="mt-4 text-xl font-extrabold text-slate-900">Compras / Por llegar</h1>
          <p className="mt-2 text-sm text-slate-500">Esta vista requiere el runtime API de Bridata y datos canónicos SAP.</p>
        </div>
      </div>
    );
  }

  if (!apiReady || !currentWorkspace || (loading && !flow)) {
    return (
      <div className="flex min-h-[520px] items-center justify-center bg-[#F8FAFC]">
        <div className="text-center">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-green-700" />
          <p className="mt-3 text-sm font-bold text-slate-800">Cargando compras SAP</p>
        </div>
      </div>
    );
  }

  const summary = projection?.summary;

  return (
    <div className={embedded ? '' : 'min-h-full bg-[#F8FAFC] px-6 py-6 lg:px-8'}>
      <div className={embedded ? 'space-y-4' : 'mx-auto max-w-[1700px] space-y-4'}>
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            {!embedded && (
              <>
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-green-700">
                  <ShoppingCart className="h-4 w-4" /> Abastecimiento SAP · V1-G3
                </div>
                <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Compras y por llegar</h1>
              </>
            )}
            <p className={`max-w-3xl text-[12px] leading-5 text-slate-500 ${embedded ? '' : 'mt-1'}`}>
              Seguimiento por Pedido SAP, proveedor y proyecto. El saldo por llegar se deriva del Pedido menos la recepción canónica registrada en PostgreSQL Bridata.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 outline-none">
              <option value="ALL">Todos los proyectos</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
            <button disabled={loading} onClick={() => void reload()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-slate-700 shadow-sm disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
            </button>
          </div>
        </header>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          <Kpi icon={ShoppingCart} label="Pedidos" value={String(summary?.orderCount ?? 0)} />
          <Kpi icon={Truck} label="Abiertos" value={String(summary?.openOrderCount ?? 0)} />
          <Kpi icon={PackageCheck} label="Parciales" value={String(summary?.partialOrderCount ?? 0)} />
          <Kpi icon={AlertTriangle} label="Atrasados" value={String(summary?.lateOrderCount ?? 0)} attention={(summary?.lateOrderCount ?? 0) > 0} />
          <Kpi icon={CheckCircle2} label="Recibidos" value={String(summary?.receivedOrderCount ?? 0)} />
          <Kpi icon={Truck} label="Por llegar" value={qty(summary?.outstandingQty ?? 0)} emphasize />
          <Kpi icon={FileSearch} label="SolP sin Pedido" value={String(summary?.requisitionsWithoutOrderCount ?? 0)} attention={(summary?.requisitionsWithoutOrderCount ?? 0) > 0} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-1 rounded-xl bg-slate-50 p-1">
              <button onClick={() => setTab('orders')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'orders' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>
                Pedidos / Por llegar
              </button>
              <button onClick={() => setTab('requisitions')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'requisitions' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>
                SolP sin Pedido
              </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {tab === 'orders' && (
                <label className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-600">
                  <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} className="accent-green-700" /> Solo abiertos
                </label>
              )}
              <div className="flex h-9 min-w-[280px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pedido, proveedor, material..." className="w-full bg-transparent text-[10px] font-semibold text-slate-700 outline-none placeholder:text-slate-400" />
              </div>
            </div>
          </div>

          {tab === 'orders' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] text-left text-[10px]">
                <thead className="bg-slate-50 text-[8px] font-extrabold uppercase tracking-[0.1em] text-slate-400">
                  <tr>
                    <th className="w-10 px-3 py-3" />
                    <th className="px-3 py-3">Pedido SAP</th>
                    <th className="px-3 py-3">Proveedor</th>
                    <th className="px-3 py-3">Proyecto</th>
                    <th className="px-3 py-3 text-right">Pedido</th>
                    <th className="px-3 py-3 text-right">Recibido</th>
                    <th className="px-3 py-3 text-right">Por llegar</th>
                    <th className="px-3 py-3">Próxima entrega</th>
                    <th className="px-3 py-3">Avance</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="px-4 py-3">Riesgo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredOrders.map((order) => (
                    <React.Fragment key={order.key}>
                      <OrderRow order={order} expanded={expanded.has(order.key)} onToggle={() => toggle(order.key)} />
                      {expanded.has(order.key) && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={11} className="px-12 py-3">
                            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                              <div className="grid grid-cols-[110px_minmax(250px,1fr)_90px_120px_120px_120px_120px] gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[8px] font-extrabold uppercase tracking-[0.08em] text-slate-400">
                                <span>Posición</span><span>Material</span><span>UM</span><span className="text-right">Pedido</span><span className="text-right">Recibido</span><span className="text-right">Por llegar</span><span>Fecha</span>
                              </div>
                              {order.lines.map((line) => (
                                <div key={line.key} className="grid grid-cols-[110px_minmax(250px,1fr)_90px_120px_120px_120px_120px] gap-2 border-b border-slate-50 px-3 py-2.5 text-[9px] last:border-0">
                                  <span className="font-bold text-green-800">{line.position ?? '—'}</span>
                                  <span><strong className="text-slate-800">{line.materialCode}</strong><span className="ml-2 text-slate-500">{line.materialTitle}</span></span>
                                  <span className="text-slate-500">{line.uomCode}</span>
                                  <span className="text-right font-bold text-slate-700">{qty(line.orderedQty)}</span>
                                  <span className="text-right text-slate-600">{qty(line.receivedQty)}</span>
                                  <span className="text-right font-extrabold text-green-800">{qty(line.outstandingQty)}</span>
                                  <span className="text-slate-500">{shortDate(line.expectedDate)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {filteredOrders.length === 0 && (
                    <tr><td colSpan={11} className="px-6 py-16 text-center text-[10px] text-slate-400">No hay Pedidos que coincidan con los filtros.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-[10px]">
                <thead className="bg-slate-50 text-[8px] font-extrabold uppercase tracking-[0.1em] text-slate-400">
                  <tr><th className="px-4 py-3">SolP</th><th className="px-3 py-3">Posición</th><th className="px-3 py-3">Material</th><th className="px-3 py-3">Proyecto</th><th className="px-3 py-3 text-right">Cantidad</th><th className="px-4 py-3">Situación</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequisitions.map((item) => (
                    <tr key={item.key} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-extrabold text-slate-900">{item.number}</td>
                      <td className="px-3 py-3 font-bold text-green-800">{item.position ?? '—'}</td>
                      <td className="px-3 py-3"><div className="font-bold text-slate-800">{item.materialCode}</div><div className="mt-1 text-[8px] text-slate-400">{item.materialTitle}</div></td>
                      <td className="px-3 py-3 text-slate-600">{item.projectTitle ?? 'PEP sin mapear'}</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">{qty(item.quantity)} {item.uomCode}</td>
                      <td className="px-4 py-3"><span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[8px] font-extrabold text-amber-800 ring-1 ring-amber-200">Pendiente de Pedido</span></td>
                    </tr>
                  ))}
                  {filteredRequisitions.length === 0 && <tr><td colSpan={6} className="px-6 py-16 text-center text-[10px] text-slate-400">No hay SolP pendientes de conversión para este filtro.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[9px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Fuente operacional: <strong className="text-slate-700">PostgreSQL Bridata</strong>. Excel no participa en esta pantalla.</span>
          <span className="font-semibold">Por llegar = Pedido canónico − recibido neto 101/102</span>
        </div>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; attention?: boolean; emphasize?: boolean }> = ({ icon: Icon, label, value, attention, emphasize }) => (
  <div className={`rounded-2xl border bg-white p-4 shadow-sm ${attention ? 'border-amber-200' : emphasize ? 'border-green-200' : 'border-slate-200'}`}>
    <div className="flex items-center justify-between"><p className="text-[8px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{label}</p><Icon className={`h-3.5 w-3.5 ${attention ? 'text-amber-600' : emphasize ? 'text-green-700' : 'text-slate-400'}`} /></div>
    <p className={`mt-3 text-2xl font-extrabold ${emphasize ? 'text-green-800' : 'text-slate-950'}`}>{value}</p>
  </div>
);

const OrderRow: React.FC<{ order: SapProcurementOrderV1G3; expanded: boolean; onToggle: () => void }> = ({ order, expanded, onToggle }) => (
  <tr className={order.risk === 'LATE' ? 'bg-rose-50/20' : 'hover:bg-slate-50/60'}>
    <td className="px-3 py-3"><button onClick={onToggle} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button></td>
    <td className="px-3 py-3"><div className="font-extrabold text-slate-950">{order.number}</div><div className="mt-1 text-[8px] text-slate-400">{order.lines.length} posición{order.lines.length === 1 ? '' : 'es'}</div></td>
    <td className="px-3 py-3 font-semibold text-slate-700">{order.supplierName}</td>
    <td className="px-3 py-3 text-slate-600">{order.projectTitle ?? 'PEP sin mapear'}</td>
    <td className="px-3 py-3 text-right font-bold text-slate-700">{qty(order.orderedQty)}</td>
    <td className="px-3 py-3 text-right text-slate-600">{qty(order.receivedQty)}</td>
    <td className="px-3 py-3 text-right font-extrabold text-green-800">{qty(order.outstandingQty)}</td>
    <td className="px-3 py-3"><div className="flex items-center gap-1.5 font-semibold text-slate-600"><CalendarClock className="h-3 w-3 text-slate-400" />{shortDate(order.nextExpectedDate)}</div></td>
    <td className="px-3 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-600" style={{ width: `${order.progressPct}%` }} /></div><span className="text-[8px] font-extrabold text-slate-500">{order.progressPct}%</span></div></td>
    <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[8px] font-extrabold ring-1 ${stateClass(order.state)}`}>{stateLabel(order.state)}</span></td>
    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-extrabold ring-1 ${riskClass(order.risk)}`}>{order.risk === 'LATE' ? <AlertTriangle className="h-3 w-3" /> : order.risk === 'WATCH' ? <Clock3 className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{riskLabel(order.risk)}</span></td>
  </tr>
);
