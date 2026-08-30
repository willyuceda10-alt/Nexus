import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Database,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  Warehouse,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type { ApiMaterialOverviewV2 } from '../../api/materialInventoryV2Contracts';
import { sapInventoryV1G4Api } from '../../api/sapInventoryV1G4Client';
import type {
  ApiSapInventoryMovementTypeV1G4,
  ApiSapInventoryV1G4,
} from '../../api/sapInventoryV1G4Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

type Tab = 'stock' | 'movements';

function errorMessage(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo cargar el inventario SAP.';
}

function quantity(value: number): string {
  return new Intl.NumberFormat('es-PE', { maximumFractionDigits: 3 }).format(value);
}

function dateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace('.', '');
}

function movementTone(type: string | null): string {
  if (type === '101') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (type === '102') return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (type === '221') return 'bg-sky-50 text-sky-700 ring-sky-200';
  if (type === '222') return 'bg-violet-50 text-violet-700 ring-violet-200';
  return 'bg-slate-50 text-slate-700 ring-slate-200';
}

function MovementIcon({ type }: { type: string | null }) {
  if (type === '101') return <ArrowDownToLine className="h-4 w-4" />;
  if (type === '221') return <ArrowUpFromLine className="h-4 w-4" />;
  return <RotateCcw className="h-4 w-4" />;
}

export const SapInventoryV1G4View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const { currentWorkspace } = useNexus();
  const [tab, setTab] = useState<Tab>('stock');
  const [overview, setOverview] = useState<ApiMaterialOverviewV2 | null>(null);
  const [sap, setSap] = useState<ApiSapInventoryV1G4 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [materialId, setMaterialId] = useState('ALL');
  const [warehouseId, setWarehouseId] = useState('ALL');
  const [movementType, setMovementType] = useState<'ALL' | ApiSapInventoryMovementTypeV1G4>('ALL');

  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!apiReady || !currentWorkspace) {
      setOverview(null);
      setSap(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextSap] = await Promise.all([
        bridataApi.materialOverviewV2(currentWorkspace.id, null, undefined, signal),
        sapInventoryV1G4Api.list({
          workspaceId: currentWorkspace.id,
          materialId: materialId === 'ALL' ? null : materialId,
          warehouseId: warehouseId === 'ALL' ? null : warehouseId,
          sapMovementType: movementType === 'ALL' ? null : movementType,
          limit: 300,
        }, signal),
      ]);
      setOverview(nextOverview);
      setSap(nextSap);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(errorMessage(cause));
      setOverview(null);
      setSap(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [apiReady, currentWorkspace, materialId, warehouseId, movementType]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const materials = useMemo(() => {
    const map = new Map<string, { id: string; code: string; title: string }>();
    for (const row of overview?.stock ?? []) {
      map.set(row.materialId, { id: row.materialId, code: row.materialCode, title: row.materialTitle });
    }
    for (const row of sap?.movements ?? []) {
      map.set(row.materialId, { id: row.materialId, code: row.materialCode, title: row.materialTitle });
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [overview, sap]);

  const warehouses = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const row of overview?.stock ?? []) {
      map.set(row.warehouseId, { id: row.warehouseId, code: row.warehouseCode, name: row.warehouseName });
    }
    for (const row of sap?.movements ?? []) {
      map.set(row.warehouseId, { id: row.warehouseId, code: row.warehouseCode, name: row.warehouseName });
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [overview, sap]);

  const filteredStock = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (overview?.stock ?? []).filter((row) => {
      if (materialId !== 'ALL' && row.materialId !== materialId) return false;
      if (warehouseId !== 'ALL' && row.warehouseId !== warehouseId) return false;
      if (!needle) return true;
      return [row.materialCode, row.materialTitle, row.warehouseCode, row.warehouseName]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [overview, search, materialId, warehouseId]);

  const filteredMovements = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (sap?.movements ?? []).filter((row) => {
      if (!needle) return true;
      return [
        row.materialCode,
        row.materialTitle,
        row.warehouseCode,
        row.warehouseName,
        row.materialDocumentNumber ?? '',
        row.wbsElement ?? '',
        row.purchaseOrderNumber ?? '',
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [sap, search]);

  const stockMaterialCount = new Set((overview?.stock ?? []).map((row) => row.materialId)).size;
  const stockWarehouseCount = new Set((overview?.stock ?? []).map((row) => row.warehouseId)).size;

  if (apiBootstrap.dataMode !== 'api') {
    return (
      <div className="p-8">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-4 text-lg font-black text-slate-900">Inventario SAP requiere PostgreSQL Bridata</h2>
          <p className="mt-2 text-sm text-slate-500">Esta vista no usa datos mock ni lee archivos Excel en runtime.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-5 lg:p-7">
      <div className="mx-auto max-w-[1700px] space-y-5">
        <header className="flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-green-700 ring-1 ring-green-200">SAP · V1-G4</span>
              <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 ring-1 ring-slate-200">PostgreSQL Bridata</span>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-700 ring-1 ring-emerald-200">Sin lectura Excel</span>
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950">Inventario</h1>
            <p className="mt-1 text-sm text-slate-500">Stock canónico por almacén y trazabilidad exacta de movimientos SAP 101 / 102 / 221 / 222.</p>
          </div>
          <button
            onClick={() => void load()}
            disabled={loading || !apiReady || !currentWorkspace}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
        </header>

        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Posiciones con stock', value: overview?.stock.length ?? 0, icon: Boxes },
            { label: 'Materiales con stock', value: stockMaterialCount, icon: PackageCheck },
            { label: 'Almacenes activos', value: stockWarehouseCount, icon: Warehouse },
            { label: 'Movimientos SAP', value: sap?.summary.movementCount ?? 0, icon: ArrowDownToLine },
            { label: 'Última actividad', value: sap?.summary.lastSapActivityAt ? dateTime(sap.summary.lastSapActivityAt) : '—', icon: RefreshCw },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{card.label}</p>
                  <Icon className="h-4 w-4 text-green-700" />
                </div>
                <p className="mt-3 text-xl font-black text-slate-950">{card.value}</p>
              </div>
            );
          })}
        </section>

        <section className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              <button onClick={() => setTab('stock')} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === 'stock' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>Stock actual</button>
              <button onClick={() => setTab('movements')} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === 'movements' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>Movimientos SAP</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-[220px] flex-1 xl:flex-none">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Material, almacén, MATDOC, PEP..." className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-xs font-semibold outline-none focus:border-green-500" />
              </label>
              <select value={materialId} onChange={(event) => setMaterialId(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700">
                <option value="ALL">Todos los materiales</option>
                {materials.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
              </select>
              <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700">
                <option value="ALL">Todos los almacenes</option>
                {warehouses.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
              </select>
              {tab === 'movements' && (
                <select value={movementType} onChange={(event) => setMovementType(event.target.value as 'ALL' | ApiSapInventoryMovementTypeV1G4)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700">
                  <option value="ALL">101 / 102 / 221 / 222</option>
                  <option value="101">101 · Ingreso</option>
                  <option value="102">102 · Reversa ingreso</option>
                  <option value="221">221 · Consumo</option>
                  <option value="222">222 · Reversa consumo</option>
                </select>
              )}
            </div>
          </div>

          {tab === 'stock' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                  <tr><th className="px-4 py-3">Material</th><th className="px-4 py-3">Almacén</th><th className="px-4 py-3 text-right">Stock</th><th className="px-4 py-3 text-right">Reservado</th><th className="px-4 py-3 text-right">Disponible</th><th className="px-4 py-3">Estado</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStock.map((row) => (
                    <tr key={`${row.materialId}:${row.warehouseId}`} className="hover:bg-slate-50/70">
                      <td className="px-4 py-4"><p className="text-xs font-black text-slate-900">{row.materialCode}</p><p className="mt-1 text-[11px] text-slate-500">{row.materialTitle}</p></td>
                      <td className="px-4 py-4"><p className="text-xs font-bold text-slate-800">{row.warehouseCode}</p><p className="mt-1 text-[11px] text-slate-500">{row.warehouseName}</p></td>
                      <td className="px-4 py-4 text-right text-sm font-black text-slate-900">{quantity(row.onHandQty)}</td>
                      <td className="px-4 py-4 text-right text-sm font-bold text-slate-600">{quantity(row.reservedQty)}</td>
                      <td className="px-4 py-4 text-right text-sm font-black text-green-700">{quantity(row.availableQty)}</td>
                      <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ring-1 ${row.availableQty > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}>{row.availableQty > 0 ? 'Disponible' : 'Sin disponible'}</span></td>
                    </tr>
                  ))}
                  {!loading && filteredStock.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">No hay stock para los filtros seleccionados.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-left">
                <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">
                  <tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Mov.</th><th className="px-4 py-3">Material</th><th className="px-4 py-3">Almacén</th><th className="px-4 py-3 text-right">Cantidad</th><th className="px-4 py-3">Documento material</th><th className="px-4 py-3">Pedido</th><th className="px-4 py-3">PEP</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMovements.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-4 text-[11px] font-semibold text-slate-600">{dateTime(row.occurredAt)}</td>
                      <td className="px-4 py-4"><div className="flex items-center gap-2"><span className={`grid h-8 w-8 place-items-center rounded-lg ring-1 ${movementTone(row.sapMovementType)}`}><MovementIcon type={row.sapMovementType} /></span><div><p className="text-xs font-black text-slate-900">{row.sapMovementType ?? '—'}</p><p className="text-[10px] text-slate-500">{row.label}</p></div></div></td>
                      <td className="px-4 py-4"><p className="text-xs font-black text-slate-900">{row.materialCode}</p><p className="mt-1 max-w-[240px] truncate text-[10px] text-slate-500">{row.materialTitle}</p></td>
                      <td className="px-4 py-4"><p className="text-xs font-bold text-slate-800">{row.warehouseCode}</p><p className="mt-1 text-[10px] text-slate-500">{row.warehouseName}</p></td>
                      <td className={`px-4 py-4 text-right text-sm font-black ${row.signedQuantity >= 0 ? 'text-emerald-700' : 'text-slate-900'}`}>{row.signedQuantity > 0 ? '+' : ''}{quantity(row.signedQuantity)} <span className="text-[9px] text-slate-400">{row.uomCode}</span></td>
                      <td className="px-4 py-4"><p className="font-mono text-[11px] font-bold text-slate-800">{row.materialDocumentNumber ?? '—'} / {row.materialDocumentItem ?? '—'}</p><p className="mt-1 text-[9px] text-slate-400">Ejercicio {row.fiscalYear ?? '—'}</p></td>
                      <td className="px-4 py-4"><p className="font-mono text-[11px] text-slate-700">{row.purchaseOrderNumber ?? '—'}</p><p className="mt-1 text-[9px] text-slate-400">Pos. {row.purchaseOrderPosition ?? '—'}</p></td>
                      <td className="px-4 py-4 font-mono text-[10px] text-slate-600">{row.wbsElement ?? '—'}</td>
                    </tr>
                  ))}
                  {!loading && filteredMovements.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-400">No hay movimientos SAP para los filtros seleccionados.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[10px] text-slate-500">
          <span>Stock = ledger canónico PostgreSQL · 101/222 suman · 102/221 restan.</span>
          <span>MATDOC proviene de IntegrationEntityLink; el archivo de origen no participa en runtime.</span>
        </div>
      </div>
    </div>
  );
};
