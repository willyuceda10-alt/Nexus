import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Factory,
  PackagePlus,
  Plus,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Truck,
  UserRoundPlus,
  Warehouse,
  X,
} from 'lucide-react';
import { bridataApi, BridataApiError } from '../../api/client';
import type {
  ApiMaterialOverviewV2,
  ApiMaterialRequirementRiskV2,
  ApiMaterialSetupV2,
} from '../../api/materialInventoryV2Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import type { NexusObject } from '../../types/nexus';
import { MaterialsView } from './MaterialsView';
import { SapMaterialFlowV1G2 } from './SapMaterialFlowV1G2';
import { SapProcurementV1G3View } from './SapProcurementV1G3View';
import { SapInventoryV1G4View } from './SapInventoryV1G4View';

type Panel = 'material' | 'warehouse' | 'supplier' | 'requirement' | 'reserve' | 'order' | 'receive' | 'issue' | null;
// "Compras" e "Inventario SAP" eran módulos propios en la navegación, pero operan
// sobre el mismo dominio que este hub — de hecho Compras usaba el mismo API que la
// pestaña "Flujo SAP" de aquí, e Inventario llamaba al mismo materialOverviewV2.
// Viven como pestañas para que el ciclo de abastecimiento sea un solo lugar.
type Tab = 'sap' | 'requirements' | 'stock' | 'procurement' | 'sapStock';

function messageOf(cause: unknown): string {
  if (cause instanceof BridataApiError) {
    return cause.correlationId ? `${cause.message} · Ref: ${cause.correlationId}` : cause.message;
  }
  if (cause instanceof Error) return cause.message;
  return 'No se pudo completar la operación de materiales.';
}

function riskClass(level: string): string {
  if (level === 'CRITICAL') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (level === 'HIGH') return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (level === 'WATCH') return 'bg-sky-50 text-sky-700 ring-sky-200';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    FULFILLED: 'Cumplido', RESERVED: 'Reservado', AVAILABLE: 'Disponible',
    ON_ORDER: 'En compra', LATE: 'Compra tardía', SHORTAGE: 'Faltante',
  };
  return labels[state] ?? state;
}

function shortDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .format(date).replace('.', '');
}

export const MaterialsInventoryV2View: React.FC = () => {
  const apiBootstrap = useApiBootstrap();
  const {
    currentWorkspace,
    objects,
    selectedProjectId,
    createNexusObject,
    openObjectDrawer,
  } = useNexus();
  const isApiMode = apiBootstrap.dataMode === 'api';
  const apiReady = isApiMode && apiBootstrap.status === 'ready';

  const projects = useMemo(() => objects.filter((item) => item.type === 'PROJECT'), [objects]);
  const materialObjects = useMemo(() => objects.filter((item) => item.type === 'MATERIAL'), [objects]);
  const workItems = useMemo(
    () => objects.filter((item) => ['TASK', 'DELIVERABLE', 'MILESTONE'].includes(item.type)),
    [objects],
  );

  const [setup, setSetup] = useState<ApiMaterialSetupV2 | null>(null);
  const [overview, setOverview] = useState<ApiMaterialOverviewV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>(selectedProjectId ?? 'ALL');
  const [tab, setTab] = useState<Tab>('sap');
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedRequirementId, setSelectedRequirementId] = useState<string>('');

  const reload = useCallback(async () => {
    if (!apiReady || !currentWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const projectId = projectFilter === 'ALL' ? null : projectFilter;
      const [nextSetup, nextOverview] = await Promise.all([
        bridataApi.materialSetupV2(currentWorkspace.id),
        bridataApi.materialOverviewV2(currentWorkspace.id, projectId),
      ]);
      setSetup(nextSetup);
      setOverview(nextOverview);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [apiReady, currentWorkspace, projectFilter]);

  useEffect(() => { void reload(); }, [reload]);

  const selectedRequirement = overview?.requirements.find((item) => item.id === selectedRequirementId) ?? null;
  const migrationMissing = Math.max(0, materialObjects.length - (setup?.materials.length ?? 0));

  const run = async (action: () => Promise<void>, success: string) => {
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

  const migrateCatalog = async () => {
    if (!currentWorkspace) return;
    const preview = await bridataApi.backfillMaterialEngineV2(currentWorkspace.id, true);
    if (preview.planned === 0) {
      setFeedback('El catálogo MATERIAL ya está sincronizado con Engine V2.');
      return;
    }
    if (!window.confirm(`Se crearán ${preview.planned} MaterialMaster tipados. ¿Continuar?`)) return;
    await run(
      async () => { await bridataApi.backfillMaterialEngineV2(currentWorkspace.id, false); },
      `${preview.planned} materiales migrados al modelo V2.`,
    );
  };

  const openForRequirement = (nextPanel: Exclude<Panel, null | 'material' | 'warehouse' | 'supplier' | 'requirement'>, requirement: ApiMaterialRequirementRiskV2) => {
    setSelectedRequirementId(requirement.id);
    setPanel(nextPanel);
  };

  if (!isApiMode) return <MaterialsView />;

  if (!apiReady || !currentWorkspace || (loading && !overview)) {
    return (
      <div className="flex min-h-[520px] items-center justify-center bg-[#F8FAFC]">
        <div className="text-center">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-green-700" />
          <p className="mt-3 text-sm font-bold text-slate-800">Cargando Material / Inventory Engine V2</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#F8FAFC] px-6 py-6 lg:px-8">
      <div className="mx-auto max-w-[1660px] space-y-4">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-green-700">
              <Boxes className="h-4 w-4" /> Material / Inventory Engine V2
            </div>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Materiales, inventario y abastecimiento</h1>
            <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">
              Flujo SAP, requerimientos ligados a la WBS, stock derivado del ledger, compras, recepción y consumo desde PostgreSQL Bridata.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {migrationMissing > 0 && (
              <button disabled={busy} onClick={() => void migrateCatalog()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-amber-50 px-4 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200 disabled:opacity-50">
                <Sparkles className="h-3.5 w-3.5" /> Migrar {migrationMissing} materiales
              </button>
            )}
            <button disabled={busy} onClick={() => setPanel('warehouse')} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-slate-700">
              <Warehouse className="h-3.5 w-3.5" /> Almacén
            </button>
            <button disabled={busy} onClick={() => setPanel('supplier')} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-slate-700">
              <UserRoundPlus className="h-3.5 w-3.5" /> Proveedor
            </button>
            <button disabled={busy} onClick={() => setPanel('material')} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[10px] font-bold text-slate-700">
              <PackagePlus className="h-3.5 w-3.5" /> Material
            </button>
            <button disabled={busy || !setup?.materials.length} onClick={() => setPanel('requirement')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-bold text-white shadow-sm hover:bg-green-800 disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> Requerimiento
            </button>
          </div>
        </header>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>}
        {feedback && <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[10px] font-semibold text-slate-600">{feedback}</div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Kpi icon={ClipboardList} label="Requerimientos" value={String(overview?.summary.requirementCount ?? 0)} />
          <Kpi icon={AlertTriangle} label="En riesgo" value={String(overview?.summary.atRiskCount ?? 0)} attention={(overview?.summary.atRiskCount ?? 0) > 0} />
          <Kpi icon={AlertTriangle} label="Críticos" value={String(overview?.summary.criticalCount ?? 0)} attention={(overview?.summary.criticalCount ?? 0) > 0} />
          <Kpi icon={Factory} label="Faltantes" value={String(overview?.summary.shortageCount ?? 0)} attention={(overview?.summary.shortageCount ?? 0) > 0} />
          <Kpi icon={ShoppingCart} label="OC abiertas" value={String(overview?.summary.openPurchaseOrderCount ?? 0)} />
          <Kpi icon={Truck} label="Tareas afectadas" value={String(overview?.summary.taskAtRiskCount ?? 0)} attention={(overview?.summary.taskAtRiskCount ?? 0) > 0} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-1 rounded-xl bg-slate-50 p-1">
              <button onClick={() => setTab('sap')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'sap' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Flujo SAP</button>
              <button onClick={() => setTab('requirements')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'requirements' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Requerimientos y riesgo</button>
              <button onClick={() => setTab('stock')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'stock' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Stock por almacén</button>
              <button onClick={() => setTab('procurement')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'procurement' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Compras / Por llegar</button>
              <button onClick={() => setTab('sapStock')} className={`rounded-lg px-3 py-2 text-[9px] font-bold ${tab === 'sapStock' ? 'bg-white text-green-800 shadow-sm' : 'text-slate-500'}`}>Inventario SAP</button>
            </div>
            <div className="flex items-center gap-2">
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-600 outline-none">
                <option value="ALL">Todos los proyectos</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
              </select>
              <button disabled={loading} onClick={() => void reload()} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
            </div>
          </div>

          {tab === 'procurement' ? (
            <SapProcurementV1G3View embedded />
          ) : tab === 'sapStock' ? (
            <SapInventoryV1G4View embedded />
          ) : tab === 'sap' ? (
            <SapMaterialFlowV1G2
              workspaceId={currentWorkspace.id}
              projectId={projectFilter === 'ALL' ? null : projectFilter}
            />
          ) : tab === 'requirements' ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1380px] text-left text-[10px]">
                <thead className="bg-slate-50 text-[8px] font-extrabold uppercase tracking-[0.1em] text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Material</th><th className="px-3 py-3">WBS / Actividad</th><th className="px-3 py-3">Proyecto</th>
                    <th className="px-3 py-3 text-right">Requerido</th><th className="px-3 py-3 text-right">Reservado</th><th className="px-3 py-3 text-right">Disponible</th>
                    <th className="px-3 py-3 text-right">En compra</th><th className="px-3 py-3">Fecha requerida</th><th className="px-3 py-3">Disponibilidad</th><th className="px-3 py-3">Riesgo</th><th className="px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(overview?.requirements ?? []).map((item) => (
                    <tr key={item.id} className={item.taskAtRisk ? 'bg-amber-50/25' : 'hover:bg-slate-50/60'}>
                      <td className="px-4 py-3"><div className="font-extrabold text-slate-900">{item.materialTitle}</div><div className="mt-1 text-[8px] text-slate-400">{item.materialCode} · {item.uomCode}</div></td>
                      <td className="px-3 py-3"><button disabled={!item.workItemId} onClick={() => item.workItemId && openObjectDrawer(item.workItemId)} className="max-w-[240px] text-left font-bold text-slate-700 hover:text-green-800 disabled:cursor-default"><span className="mr-1 text-green-700">{item.wbsCode ?? '—'}</span>{item.workItemTitle ?? 'Nivel proyecto'}</button></td>
                      <td className="px-3 py-3 text-slate-500">{item.projectTitle}</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-700">{item.requiredQty}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{item.reservedQty}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{item.availableQty}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{item.onOrderQty}</td>
                      <td className="px-3 py-3 font-semibold text-slate-600">{shortDate(item.requiredDate)}</td>
                      <td className="px-3 py-3"><div className="font-bold text-slate-700">{stateLabel(item.state)}</div><div className="mt-1 text-[8px] text-slate-400">{item.projectedAvailabilityDate ? shortDate(item.projectedAvailabilityDate) : item.deficitQty > 0 ? `Déficit ${item.deficitQty}` : '—'}</div></td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[8px] font-extrabold ring-1 ${riskClass(item.riskLevel)}`}>{item.riskLevel}</span>{item.lateByDays > 0 && <div className="mt-1 text-[8px] font-bold text-rose-600">+{item.lateByDays} días</div>}</td>
                      <td className="px-4 py-3"><div className="flex gap-1">
                        <MiniButton label="Reservar" onClick={() => openForRequirement('reserve', item)} disabled={!setup?.warehouses.length || item.state === 'FULFILLED'} />
                        <MiniButton label="Ordenar" onClick={() => openForRequirement('order', item)} disabled={!setup?.suppliers.length || item.state === 'FULFILLED'} />
                        <MiniButton label="Recibir" onClick={() => openForRequirement('receive', item)} disabled={!setup?.warehouses.length || item.state === 'FULFILLED'} />
                        <MiniButton label="Salida" onClick={() => openForRequirement('issue', item)} disabled={!setup?.warehouses.length || item.state === 'FULFILLED'} />
                      </div></td>
                    </tr>
                  ))}
                  {(overview?.requirements.length ?? 0) === 0 && <tr><td colSpan={11} className="px-6 py-14 text-center text-[10px] text-slate-400">No hay requerimientos para el filtro actual.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-[10px]">
                <thead className="bg-slate-50 text-[8px] font-extrabold uppercase tracking-[0.1em] text-slate-400"><tr><th className="px-4 py-3">Material</th><th className="px-3 py-3">Almacén</th><th className="px-3 py-3 text-right">On hand</th><th className="px-3 py-3 text-right">Reservado</th><th className="px-4 py-3 text-right">Disponible</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(overview?.stock ?? []).map((row) => <tr key={`${row.materialId}:${row.warehouseId}`}><td className="px-4 py-3"><div className="font-bold text-slate-900">{row.materialTitle}</div><div className="mt-1 text-[8px] text-slate-400">{row.materialCode}</div></td><td className="px-3 py-3 font-semibold text-slate-600">{row.warehouseCode} · {row.warehouseName}</td><td className="px-3 py-3 text-right font-bold text-slate-700">{row.onHandQty}</td><td className="px-3 py-3 text-right text-slate-600">{row.reservedQty}</td><td className="px-4 py-3 text-right font-extrabold text-green-700">{row.availableQty}</td></tr>)}
                  {(overview?.stock.length ?? 0) === 0 && <tr><td colSpan={5} className="px-6 py-14 text-center text-[10px] text-slate-400">Aún no existen movimientos ni reservas de inventario.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {panel && setup && currentWorkspace && (
        <OperationPanel
          panel={panel}
          busy={busy}
          setup={setup}
          projects={projects}
          workItems={workItems}
          requirement={selectedRequirement}
          defaultProjectId={projectFilter === 'ALL' ? selectedProjectId ?? projects[0]?.id ?? '' : projectFilter}
          workspaceId={currentWorkspace.id}
          onClose={() => !busy && setPanel(null)}
          onRun={run}
          createNexusObject={createNexusObject}
        />
      )}
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; attention?: boolean }> = ({ icon: Icon, label, value, attention }) => (
  <div className={`rounded-2xl border bg-white p-4 shadow-sm ${attention ? 'border-amber-200' : 'border-slate-200'}`}><div className="flex items-center justify-between"><p className="text-[8px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{label}</p><Icon className={`h-3.5 w-3.5 ${attention ? 'text-amber-600' : 'text-green-700'}`} /></div><p className="mt-3 text-2xl font-extrabold text-slate-950">{value}</p></div>
);

const MiniButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean }> = ({ label, onClick, disabled }) => (
  <button disabled={disabled} onClick={onClick} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[8px] font-bold text-slate-600 hover:border-green-200 hover:text-green-800 disabled:opacity-30">{label}</button>
);

type OperationPanelProps = {
  panel: Exclude<Panel, null>;
  busy: boolean;
  setup: ApiMaterialSetupV2;
  projects: Array<{ id: string; title: string }>;
  workItems: Array<{ id: string; title: string; projectId?: string; type: string }>;
  requirement: ApiMaterialRequirementRiskV2 | null;
  defaultProjectId: string;
  workspaceId: string;
  onClose: () => void;
  onRun: (action: () => Promise<void>, success: string) => Promise<void>;
  createNexusObject: (data: Partial<NexusObject>) => Promise<NexusObject>;
};

const OperationPanel: React.FC<OperationPanelProps> = ({ panel, busy, setup, projects, workItems, requirement, defaultProjectId, workspaceId, onClose, onRun, createNexusObject }) => {
  const [projectId, setProjectId] = useState(requirement?.projectId ?? defaultProjectId);
  const [workItemId, setWorkItemId] = useState(requirement?.workItemId ?? '');
  const [materialId, setMaterialId] = useState(requirement?.materialId ?? setup.materials[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(requirement?.preferredWarehouseId ?? setup.warehouses[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState(setup.suppliers[0]?.id ?? '');
  const [quantity, setQuantity] = useState(Math.max(1, requirement?.deficitQty || requirement?.remainingQty || 1));
  const [requiredDate, setRequiredDate] = useState(requirement?.requiredDate ?? new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState(requirement?.requiredDate ?? new Date().toISOString().slice(0, 10));
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [unitCost, setUnitCost] = useState(requirement ? setup.materials.find((m) => m.id === requirement.materialId)?.unitCost ?? 0 : 0);
  const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>(requirement?.priority ?? 'MEDIUM');

  const material = setup.materials.find((item) => item.id === materialId);
  const filteredWorkItems = workItems.filter((item) => item.projectId === projectId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (panel === 'material') {
      if (!title.trim() || !code.trim()) return;
      await onRun(async () => {
        const object = await createNexusObject({ type: 'MATERIAL', title: title.trim(), description: '', status: 'PLANNING', priority: 'MEDIUM', progress: 0 });
        await bridataApi.syncMaterialMasterV2({ materialObjectId: object.id, code: code.trim(), uomCode: 'UND', uomName: 'Unidad', unitCost, currency: 'USD' });
      }, 'Material creado y sincronizado con MaterialMaster V2.');
      return;
    }
    if (panel === 'warehouse') {
      if (!title.trim() || !code.trim()) return;
      await onRun(async () => { await bridataApi.createWarehouseV2({ workspaceId, code: code.trim(), name: title.trim() }); }, 'Almacén guardado.');
      return;
    }
    if (panel === 'supplier') {
      if (!title.trim() || !code.trim()) return;
      await onRun(async () => { await bridataApi.createSupplierV2({ code: code.trim(), name: title.trim() }); }, 'Proveedor guardado.');
      return;
    }
    if (panel === 'requirement') {
      if (!projectId || !materialId || quantity <= 0 || !requiredDate) return;
      await onRun(async () => { await bridataApi.createMaterialRequirementV2({ workspaceId, projectId, workItemId: workItemId || null, materialId, preferredWarehouseId: warehouseId || null, requiredQty: quantity, requiredDate, priority }); }, 'Requerimiento creado y vinculado a la WBS.');
      return;
    }
    if (!requirement) return;
    if (panel === 'reserve') {
      if (!warehouseId || quantity <= 0) return;
      await onRun(async () => { await bridataApi.createReservationV2({ requirementId: requirement.id, warehouseId, quantity }); }, 'Stock reservado para la actividad.');
      return;
    }
    if (panel === 'order') {
      if (!supplierId || !material || !number.trim() || quantity <= 0) return;
      await onRun(async () => { await bridataApi.createPurchaseOrderV2({ workspaceId, projectId: requirement.projectId, supplierId, number: number.trim(), expectedDate, currency: material.currency, lines: [{ materialId: requirement.materialId, requirementId: requirement.id, uomId: material.baseUomId, quantity, unitCost, expectedDate }] }); }, 'Orden de compra creada y ligada al requerimiento.');
      return;
    }
    if (panel === 'receive') {
      if (!warehouseId || !material || !number.trim() || quantity <= 0) return;
      await onRun(async () => { await bridataApi.createGoodsReceiptV2({ workspaceId, warehouseId, number: number.trim(), lines: [{ materialId: requirement.materialId, requirementId: requirement.id, uomId: material.baseUomId, quantity, unitCost }] }); }, 'Recepción registrada en el ledger de inventario.');
      return;
    }
    if (panel === 'issue') {
      if (!warehouseId || quantity <= 0) return;
      await onRun(async () => { await bridataApi.issueMaterialV2({ workspaceId, warehouseId, materialId: requirement.materialId, requirementId: requirement.id, workItemId: requirement.workItemId, quantity, unitCost }); }, 'Material entregado/consumido por la actividad.');
    }
  };

  const titles: Record<Exclude<Panel, null>, string> = {
    material: 'Nuevo material V2', warehouse: 'Nuevo almacén', supplier: 'Nuevo proveedor', requirement: 'Nuevo requerimiento',
    reserve: 'Reservar stock', order: 'Crear orden de compra', receive: 'Registrar recepción', issue: 'Registrar salida / consumo',
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/25 backdrop-blur-[1px]">
      <button className="flex-1" onClick={onClose} aria-label="Cerrar" />
      <aside className="h-full w-full max-w-[520px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <form onSubmit={(event) => void submit(event)}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur"><div><p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-green-700">Material Engine V2</p><h2 className="mt-1 text-lg font-extrabold text-slate-950">{titles[panel]}</h2></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500"><X className="h-4 w-4" /></button></div>
          <div className="space-y-4 p-5">
            {requirement && ['reserve','order','receive','issue'].includes(panel) && <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100"><p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Requerimiento</p><p className="mt-1 text-[11px] font-extrabold text-slate-800">{requirement.materialTitle}</p><p className="mt-1 text-[9px] text-slate-500">WBS {requirement.wbsCode ?? '—'} · {requirement.workItemTitle ?? requirement.projectTitle} · pendiente {requirement.remainingQty}</p></div>}

            {(panel === 'material' || panel === 'warehouse' || panel === 'supplier') && <><Field label={panel === 'material' ? 'Nombre del material' : panel === 'warehouse' ? 'Nombre del almacén' : 'Razón social'}><input value={title} onChange={(e) => setTitle(e.target.value)} className="form-control mt-0" required /></Field><Field label="Código"><input value={code} onChange={(e) => setCode(e.target.value)} className="form-control mt-0" required /></Field></>}
            {panel === 'supplier' && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[9px] font-semibold text-amber-800">El alta de proveedores requiere rol OWNER o TENANT_ADMIN.</p>}
            {panel === 'material' && <Field label="Costo unitario"><input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} className="form-control mt-0" /></Field>}

            {panel === 'requirement' && <><Field label="Proyecto"><select value={projectId} onChange={(e) => { setProjectId(e.target.value); setWorkItemId(''); }} className="form-control mt-0" required><option value="">Seleccionar...</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field><Field label="Actividad WBS"><select value={workItemId} onChange={(e) => setWorkItemId(e.target.value)} className="form-control mt-0"><option value="">Nivel proyecto</option>{filteredWorkItems.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</select></Field><Field label="Material"><select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className="form-control mt-0" required>{setup.materials.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.title}</option>)}</select></Field></>}

            {(panel === 'requirement' || panel === 'reserve' || panel === 'receive' || panel === 'issue') && <Field label="Almacén"><select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="form-control mt-0" required={panel !== 'requirement'}><option value="">Sin preferencia</option>{setup.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>}
            {(panel === 'requirement' || ['reserve','order','receive','issue'].includes(panel)) && <Field label="Cantidad"><input type="number" min="0.0001" step="0.0001" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="form-control mt-0" required /></Field>}
            {panel === 'requirement' && <><Field label="Fecha requerida"><input type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} className="form-control mt-0" required /></Field><Field label="Prioridad"><select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="form-control mt-0"><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select></Field></>}

            {panel === 'order' && <><Field label="Proveedor"><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="form-control mt-0" required>{setup.suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field><Field label="Número OC"><input value={number} onChange={(e) => setNumber(e.target.value)} className="form-control mt-0" placeholder="OC-2026-0001" required /></Field><Field label="Fecha esperada"><input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="form-control mt-0" required /></Field></>}
            {(panel === 'order' || panel === 'receive' || panel === 'issue') && <Field label="Costo unitario"><input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} className="form-control mt-0" /></Field>}
            {panel === 'receive' && <Field label="Número recepción"><input value={number} onChange={(e) => setNumber(e.target.value)} className="form-control mt-0" placeholder="GR-2026-0001" required /></Field>}

            {setup.warehouses.length === 0 && ['requirement','reserve','receive','issue'].includes(panel) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[9px] font-semibold text-amber-800">Primero registra un almacén para operar stock.</div>}
            {setup.suppliers.length === 0 && panel === 'order' && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[9px] font-semibold text-amber-800">No existen proveedores V2. Crea uno desde el botón Proveedor de la vista principal.</div>}
          </div>
          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4"><button type="button" disabled={busy} onClick={onClose} className="h-10 rounded-xl border border-slate-200 px-4 text-[10px] font-bold text-slate-600">Cancelar</button><button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-green-700 px-5 text-[10px] font-bold text-white disabled:opacity-50">{busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Guardar</button></div>
        </form>
      </aside>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="block"><span className="mb-1.5 block text-[9px] font-bold text-slate-600">{label}</span>{children}</label>;
