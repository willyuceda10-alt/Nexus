import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  PackageSearch,
  Pencil,
  Plus,
  Truck,
  X,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import type { NexusObject, ObjectStatus, Priority } from '../../types/nexus';

type MaterialStatus =
  | 'REQUESTED'
  | 'QUOTING'
  | 'ORDERED'
  | 'PARTIAL'
  | 'RECEIVED'
  | 'BLOCKED';

interface MaterialDraft {
  title: string;
  description: string;
  projectId: string;
  materialCode: string;
  unit: string;
  requiredQty: number;
  orderedQty: number;
  receivedQty: number;
  unitCost: number;
  supplier: string;
  purchaseOrder: string;
  requiredDate: string;
  expectedDate: string;
  materialStatus: MaterialStatus;
  priority: Priority;
}

const materialStatuses: Array<{ value: MaterialStatus; label: string }> = [
  { value: 'REQUESTED', label: 'Solicitado' },
  { value: 'QUOTING', label: 'Cotizando' },
  { value: 'ORDERED', label: 'Ordenado' },
  { value: 'PARTIAL', label: 'Recepción parcial' },
  { value: 'RECEIVED', label: 'Recibido' },
  { value: 'BLOCKED', label: 'Bloqueado' },
];

function stringField(object: NexusObject, key: string): string {
  const value = object.customFields?.[key];
  return typeof value === 'string' ? value : '';
}

function numberField(object: NexusObject, key: string): number {
  const value = object.customFields?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function materialStatus(object: NexusObject): MaterialStatus {
  const value = stringField(object, 'materialStatus') as MaterialStatus;
  if (materialStatuses.some((item) => item.value === value)) return value;
  if (object.status === 'COMPLETED') return 'RECEIVED';
  if (object.status === 'BLOCKED') return 'BLOCKED';
  return 'REQUESTED';
}

function objectStatusFromMaterial(status: MaterialStatus): ObjectStatus {
  if (status === 'RECEIVED') return 'COMPLETED';
  if (status === 'BLOCKED') return 'BLOCKED';
  if (status === 'REQUESTED' || status === 'QUOTING') return 'PLANNING';
  return 'IN_PROGRESS';
}

function progressFor(requiredQty: number, receivedQty: number): number {
  if (requiredQty <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((receivedQty / requiredQty) * 100)));
}

function emptyDraft(projectId = ''): MaterialDraft {
  return {
    title: '',
    description: '',
    projectId,
    materialCode: '',
    unit: 'und',
    requiredQty: 1,
    orderedQty: 0,
    receivedQty: 0,
    unitCost: 0,
    supplier: '',
    purchaseOrder: '',
    requiredDate: '',
    expectedDate: '',
    materialStatus: 'REQUESTED',
    priority: 'MEDIUM',
  };
}

function draftFromObject(object: NexusObject): MaterialDraft {
  return {
    title: object.title,
    description: object.description,
    projectId: object.projectId ?? '',
    materialCode: stringField(object, 'materialCode'),
    unit: stringField(object, 'unit') || 'und',
    requiredQty: numberField(object, 'requiredQty'),
    orderedQty: numberField(object, 'orderedQty'),
    receivedQty: numberField(object, 'receivedQty'),
    unitCost: numberField(object, 'unitCost'),
    supplier: stringField(object, 'supplier'),
    purchaseOrder: stringField(object, 'purchaseOrder'),
    requiredDate: stringField(object, 'requiredDate'),
    expectedDate: stringField(object, 'expectedDate'),
    materialStatus: materialStatus(object),
    priority: object.priority,
  };
}

function statusClass(status: MaterialStatus): string {
  switch (status) {
    case 'RECEIVED':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case 'PARTIAL':
      return 'bg-cyan-50 text-cyan-700 ring-cyan-200';
    case 'ORDERED':
      return 'bg-blue-50 text-blue-700 ring-blue-200';
    case 'QUOTING':
      return 'bg-violet-50 text-violet-700 ring-violet-200';
    case 'BLOCKED':
      return 'bg-rose-50 text-rose-700 ring-rose-200';
    default:
      return 'bg-amber-50 text-amber-700 ring-amber-200';
  }
}

function statusLabel(status: MaterialStatus): string {
  return materialStatuses.find((item) => item.value === status)?.label ?? status;
}

export const MaterialsView: React.FC = () => {
  const {
    tenant,
    objects,
    selectedProjectId,
    createNexusObject,
    updateNexusObject,
    isObjectMutationPending,
    objectDataError,
  } = useNexus();

  const projects = useMemo(() => objects.filter((item) => item.type === 'PROJECT'), [objects]);
  const materials = useMemo(() => objects.filter((item) => item.type === 'MATERIAL'), [objects]);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<MaterialStatus | 'ALL'>('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<MaterialDraft>(() => emptyDraft(selectedProjectId ?? projects[0]?.id ?? ''));

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );

  const filteredMaterials = useMemo(() => {
    const query = search.trim().toLowerCase();
    return materials.filter((material) => {
      if (projectFilter !== 'ALL' && material.projectId !== projectFilter) return false;
      if (statusFilter !== 'ALL' && materialStatus(material) !== statusFilter) return false;
      if (!query) return true;
      return [
        material.title,
        stringField(material, 'materialCode'),
        stringField(material, 'supplier'),
        stringField(material, 'purchaseOrder'),
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [materials, projectFilter, search, statusFilter]);

  const today = new Date().toISOString().slice(0, 10);
  const totals = useMemo(() => {
    let requiredValue = 0;
    let receivedValue = 0;
    let delayed = 0;
    let fullyReceived = 0;

    for (const material of materials) {
      const requiredQty = numberField(material, 'requiredQty');
      const receivedQty = numberField(material, 'receivedQty');
      const unitCost = numberField(material, 'unitCost');
      const requiredDate = stringField(material, 'requiredDate');
      requiredValue += requiredQty * unitCost;
      receivedValue += Math.min(requiredQty, receivedQty) * unitCost;
      if (requiredQty > 0 && receivedQty >= requiredQty) fullyReceived += 1;
      if (requiredDate && requiredDate < today && receivedQty < requiredQty) delayed += 1;
    }

    return {
      requiredValue,
      pendingValue: Math.max(0, requiredValue - receivedValue),
      delayed,
      fullyReceived,
    };
  }, [materials, today]);

  const currency = tenant.currency || 'USD';
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat('es-PE', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${currency} ${value.toLocaleString('es-PE', { maximumFractionDigits: 2 })}`;
    }
  };

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft(selectedProjectId ?? projects[0]?.id ?? ''));
    setEditorOpen(true);
  };

  const openEdit = (material: NexusObject) => {
    setEditingId(material.id);
    setDraft(draftFromObject(material));
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (isObjectMutationPending) return;
    setEditorOpen(false);
    setEditingId(null);
  };

  const saveMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.projectId || draft.requiredQty < 0) return;

    const base = editingId ? materials.find((item) => item.id === editingId) : undefined;
    const customFields = {
      ...(base?.customFields ?? {}),
      materialCode: draft.materialCode.trim(),
      unit: draft.unit.trim() || 'und',
      requiredQty: Math.max(0, draft.requiredQty),
      orderedQty: Math.max(0, draft.orderedQty),
      receivedQty: Math.max(0, draft.receivedQty),
      unitCost: Math.max(0, draft.unitCost),
      supplier: draft.supplier.trim(),
      purchaseOrder: draft.purchaseOrder.trim(),
      requiredDate: draft.requiredDate,
      expectedDate: draft.expectedDate,
      materialStatus: draft.materialStatus,
    };

    const common = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      projectId: draft.projectId,
      priority: draft.priority,
      status: objectStatusFromMaterial(draft.materialStatus),
      progress: progressFor(draft.requiredQty, draft.receivedQty),
      customFields,
    };

    try {
      if (base) {
        await updateNexusObject(base.id, common);
      } else {
        await createNexusObject({ type: 'MATERIAL', ...common });
      }
      setEditorOpen(false);
      setEditingId(null);
    } catch {
      // NexusContext surfaces the normalized error.
    }
  };

  return (
    <div className="min-h-full bg-[#F8FAFC] px-6 py-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-green-700">
              <PackageSearch className="h-4 w-4" />
              Control operacional
            </div>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Materiales y abastecimiento</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Demanda, compras y recepción de materiales vinculadas directamente a los proyectos de Bridata.
            </p>
          </div>
          <button
            onClick={openNew}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-green-800"
          >
            <Plus className="h-4 w-4" />
            Registrar material
          </button>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard icon={PackageSearch} label="Materiales activos" value={String(materials.length)} detail={`${totals.fullyReceived} recibidos por completo`} />
          <KpiCard icon={DollarSign} label="Valor requerido" value={money(totals.requiredValue)} detail="Cantidad requerida × costo unitario" />
          <KpiCard icon={Truck} label="Valor pendiente" value={money(totals.pendingValue)} detail="Pendiente de recepción" />
          <KpiCard icon={AlertTriangle} label="Con atraso" value={String(totals.delayed)} detail="Fecha requerida vencida" attention={totals.delayed > 0} />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar material, código, proveedor u OC..."
                className="form-control mt-0"
              />
            </div>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="form-control mt-0 lg:w-64">
              <option value="ALL">Todos los proyectos</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as MaterialStatus | 'ALL')} className="form-control mt-0 lg:w-48">
              <option value="ALL">Todos los estados</option>
              {materialStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Material</th>
                  <th className="px-3 py-3">Proyecto</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3 text-right">Requerido</th>
                  <th className="px-3 py-3 text-right">Ordenado</th>
                  <th className="px-3 py-3 text-right">Recibido</th>
                  <th className="px-3 py-3">Proveedor / OC</th>
                  <th className="px-3 py-3">Fecha requerida</th>
                  <th className="px-3 py-3 text-right">Valor</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMaterials.map((material) => {
                  const requiredQty = numberField(material, 'requiredQty');
                  const orderedQty = numberField(material, 'orderedQty');
                  const receivedQty = numberField(material, 'receivedQty');
                  const unitCost = numberField(material, 'unitCost');
                  const unit = stringField(material, 'unit') || 'und';
                  const requiredDate = stringField(material, 'requiredDate');
                  const late = Boolean(requiredDate && requiredDate < today && receivedQty < requiredQty);
                  const status = materialStatus(material);
                  const percent = progressFor(requiredQty, receivedQty);

                  return (
                    <tr key={material.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900">{material.title}</div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                          <span>{stringField(material, 'materialCode') || 'Sin código'}</span>
                          <span>•</span>
                          <span>{percent}% recibido</span>
                        </div>
                        <div className="mt-2 h-1.5 w-36 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-green-600" style={{ width: `${percent}%` }} />
                        </div>
                      </td>
                      <td className="max-w-[220px] px-3 py-3.5 font-medium text-slate-600">
                        <span className="line-clamp-2">{projectById.get(material.projectId ?? '') ?? 'Sin proyecto'}</span>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ring-1 ${statusClass(status)}`}>{statusLabel(status)}</span>
                      </td>
                      <td className="px-3 py-3.5 text-right font-semibold text-slate-700">{requiredQty.toLocaleString('es-PE')} {unit}</td>
                      <td className="px-3 py-3.5 text-right text-slate-600">{orderedQty.toLocaleString('es-PE')} {unit}</td>
                      <td className="px-3 py-3.5 text-right font-bold text-green-700">{receivedQty.toLocaleString('es-PE')} {unit}</td>
                      <td className="px-3 py-3.5">
                        <div className="font-medium text-slate-700">{stringField(material, 'supplier') || 'Sin proveedor'}</div>
                        <div className="mt-1 text-[10px] text-slate-400">{stringField(material, 'purchaseOrder') || 'Sin OC'}</div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className={late ? 'font-bold text-rose-700' : 'font-medium text-slate-600'}>{requiredDate || 'Sin fecha'}</div>
                        {late && <div className="mt-1 text-[10px] font-semibold text-rose-600">Atrasado</div>}
                      </td>
                      <td className="px-3 py-3.5 text-right font-bold text-slate-800">{money(requiredQty * unitCost)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <button onClick={() => openEdit(material)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-600 hover:border-green-200 hover:bg-green-50 hover:text-green-800">
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredMaterials.length === 0 && (
            <div className="px-6 py-14 text-center">
              <PackageSearch className="mx-auto h-9 w-9 text-slate-300" />
              <p className="mt-3 text-sm font-bold text-slate-700">No hay materiales para este filtro</p>
              <p className="mt-1 text-xs text-slate-400">Registra el primer material o cambia los filtros.</p>
            </div>
          )}
        </section>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[2px]">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-green-700">Materiales</p>
                <h2 className="mt-1 text-lg font-extrabold text-slate-950">{editingId ? 'Editar material' : 'Registrar material'}</h2>
              </div>
              <button onClick={closeEditor} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveMaterial} className="space-y-5 p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Material / descripción" wide>
                  <input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="form-control" placeholder="Ej: Tubería PVC 4 pulgadas" />
                </Field>
                <Field label="Código">
                  <input value={draft.materialCode} onChange={(event) => setDraft({ ...draft, materialCode: event.target.value })} className="form-control" placeholder="MAT-0001" />
                </Field>
                <Field label="Proyecto">
                  <select required value={draft.projectId} onChange={(event) => setDraft({ ...draft, projectId: event.target.value })} className="form-control">
                    <option value="">Selecciona proyecto</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
                  </select>
                </Field>
                <Field label="Estado">
                  <select value={draft.materialStatus} onChange={(event) => setDraft({ ...draft, materialStatus: event.target.value as MaterialStatus })} className="form-control">
                    {materialStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Prioridad">
                  <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })} className="form-control">
                    <option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option>
                  </select>
                </Field>
              </div>

              <div className="rounded-2xl border border-green-100 bg-green-50/40 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-green-800">Cantidades y costo</p>
                <div className="mt-3 grid gap-4 sm:grid-cols-4">
                  <Field label="Unidad"><input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} className="form-control bg-white" /></Field>
                  <NumberField label="Requerido" value={draft.requiredQty} onChange={(value) => setDraft({ ...draft, requiredQty: value })} />
                  <NumberField label="Ordenado" value={draft.orderedQty} onChange={(value) => setDraft({ ...draft, orderedQty: value })} />
                  <NumberField label="Recibido" value={draft.receivedQty} onChange={(value) => setDraft({ ...draft, receivedQty: value })} />
                  <div className="sm:col-span-2"><NumberField label="Costo unitario" value={draft.unitCost} onChange={(value) => setDraft({ ...draft, unitCost: value })} /></div>
                  <div className="sm:col-span-2 rounded-xl border border-green-100 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valor requerido</div>
                    <div className="mt-1 text-lg font-extrabold text-slate-900">{money(Math.max(0, draft.requiredQty) * Math.max(0, draft.unitCost))}</div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Proveedor"><input value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} className="form-control" placeholder="Proveedor / contratista" /></Field>
                <Field label="Orden de compra"><input value={draft.purchaseOrder} onChange={(event) => setDraft({ ...draft, purchaseOrder: event.target.value })} className="form-control" placeholder="OC-000123" /></Field>
                <Field label="Fecha requerida"><input type="date" value={draft.requiredDate} onChange={(event) => setDraft({ ...draft, requiredDate: event.target.value })} className="form-control" /></Field>
                <Field label="Fecha esperada"><input type="date" value={draft.expectedDate} onChange={(event) => setDraft({ ...draft, expectedDate: event.target.value })} className="form-control" /></Field>
                <Field label="Notas" wide><textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="form-control" placeholder="Especificaciones, condición de compra, observaciones..." /></Field>
              </div>

              {objectDataError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700">{objectDataError}</div>}

              <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {draft.receivedQty >= draft.requiredQty && draft.requiredQty > 0 ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Truck className="h-4 w-4 text-slate-400" />}
                  {progressFor(draft.requiredQty, draft.receivedQty)}% recibido
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={closeEditor} disabled={isObjectMutationPending} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
                  <button type="submit" disabled={isObjectMutationPending || !draft.title.trim() || !draft.projectId} className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50">
                    {isObjectMutationPending ? 'Guardando…' : 'Guardar material'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const KpiCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  attention?: boolean;
}> = ({ icon: Icon, label, value, detail, attention = false }) => (
  <div className={`rounded-2xl border bg-white p-4 shadow-sm ${attention ? 'border-rose-200' : 'border-slate-200'}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
        <p className={`mt-2 text-xl font-extrabold tracking-tight ${attention ? 'text-rose-700' : 'text-slate-950'}`}>{value}</p>
        <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
      </div>
      <div className={`grid h-9 w-9 place-items-center rounded-xl ${attention ? 'bg-rose-50 text-rose-600' : 'bg-green-50 text-green-700'}`}><Icon className="h-4 w-4" /></div>
    </div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode; wide?: boolean }> = ({ label, children, wide = false }) => (
  <div className={wide ? 'sm:col-span-2' : ''}>
    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</label>
    {children}
  </div>
);

const NumberField: React.FC<{ label: string; value: number; onChange: (value: number) => void }> = ({ label, value, onChange }) => (
  <div>
    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</label>
    <input type="number" min={0} step="any" value={value} onChange={(event) => onChange(Number(event.target.value))} className="form-control bg-white" />
  </div>
);
