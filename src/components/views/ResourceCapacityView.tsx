import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  Clock3,
  Gauge,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { bridataApi } from '../../api/client';
import type {
  ApiResourceCapacityResource,
  ApiResourceCapacityResponse,
} from '../../api/resourceCapacityContracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

const DEMO_RESPONSE: ApiResourceCapacityResponse = {
  method: 'EFFORT_DISTRIBUTION_V1',
  generatedAt: '2026-08-21T22:00:00.000Z',
  workspaceId: 'ws-001',
  range: { from: '2026-08-17', to: '2026-09-13' },
  from: '2026-08-17',
  to: '2026-09-13',
  profileCount: 3,
  assignmentCount: 7,
  unprofiledAssignments: 1,
  unprofiledSizedHours: 12,
  resources: [
    {
      resourceId: 'demo-resource-1',
      linkedUserId: 'u-002',
      name: 'Dra. Elena Rostova',
      capacityHoursPerDay: 8,
      capacityHours: 160,
      allocatedHours: 176,
      utilizationPct: 110,
      overallocatedHours: 22,
      unsizedItems: 1,
      unscheduledItems: 0,
      weeks: [
        { weekStart: '2026-08-17', capacityHours: 40, allocatedHours: 48, utilizationPct: 120, overallocatedHours: 8 },
        { weekStart: '2026-08-24', capacityHours: 40, allocatedHours: 52, utilizationPct: 130, overallocatedHours: 12 },
        { weekStart: '2026-08-31', capacityHours: 40, allocatedHours: 40, utilizationPct: 100, overallocatedHours: 2 },
        { weekStart: '2026-09-07', capacityHours: 40, allocatedHours: 36, utilizationPct: 90, overallocatedHours: 0 },
      ],
      assignments: [
        { objectId: 'tsk-202', title: 'Instalación de tanques de enfriamiento', projectId: 'prj-101', effortHours: 96, allocatedHoursInRange: 72, startDate: '2026-08-17', dueDate: '2026-09-04', sized: true, scheduled: true },
        { objectId: 'tsk-204', title: 'Subestación eléctrica dedicada', projectId: 'prj-101', effortHours: 104, allocatedHoursInRange: 104, startDate: '2026-08-24', dueDate: '2026-09-11', sized: true, scheduled: true },
        { objectId: 'tsk-demo-unsized', title: 'Validación de protocolo de contingencia', projectId: 'prj-101', allocatedHoursInRange: 0, startDate: '2026-09-08', dueDate: '2026-09-10', sized: false, scheduled: true },
      ],
    },
    {
      resourceId: 'demo-resource-2',
      linkedUserId: 'u-003',
      name: 'Carlos Mendoza',
      capacityHoursPerDay: 8,
      capacityHours: 160,
      allocatedHours: 132,
      utilizationPct: 83,
      overallocatedHours: 4,
      unsizedItems: 0,
      unscheduledItems: 1,
      weeks: [
        { weekStart: '2026-08-17', capacityHours: 40, allocatedHours: 32, utilizationPct: 80, overallocatedHours: 0 },
        { weekStart: '2026-08-24', capacityHours: 40, allocatedHours: 44, utilizationPct: 110, overallocatedHours: 4 },
        { weekStart: '2026-08-31', capacityHours: 40, allocatedHours: 32, utilizationPct: 80, overallocatedHours: 0 },
        { weekStart: '2026-09-07', capacityHours: 40, allocatedHours: 24, utilizationPct: 60, overallocatedHours: 0 },
      ],
      assignments: [
        { objectId: 'tsk-demo-cm-1', title: 'Integración de telemetría Azure', projectId: 'prj-103', effortHours: 84, allocatedHoursInRange: 84, startDate: '2026-08-18', dueDate: '2026-09-01', sized: true, scheduled: true },
        { objectId: 'tsk-demo-cm-2', title: 'Hardening de API y observabilidad', projectId: 'prj-103', effortHours: 48, allocatedHoursInRange: 48, startDate: '2026-08-26', dueDate: '2026-09-08', sized: true, scheduled: true },
        { objectId: 'tsk-demo-cm-3', title: 'Revisión técnica sin fecha', projectId: 'prj-103', effortHours: 12, allocatedHoursInRange: 0, sized: true, scheduled: false },
      ],
    },
    {
      resourceId: 'demo-resource-3',
      linkedUserId: 'u-004',
      name: 'Sofía Chen',
      capacityHoursPerDay: 6,
      capacityHours: 120,
      allocatedHours: 68,
      utilizationPct: 57,
      overallocatedHours: 0,
      unsizedItems: 0,
      unscheduledItems: 0,
      weeks: [
        { weekStart: '2026-08-17', capacityHours: 30, allocatedHours: 18, utilizationPct: 60, overallocatedHours: 0 },
        { weekStart: '2026-08-24', capacityHours: 30, allocatedHours: 20, utilizationPct: 67, overallocatedHours: 0 },
        { weekStart: '2026-08-31', capacityHours: 30, allocatedHours: 18, utilizationPct: 60, overallocatedHours: 0 },
        { weekStart: '2026-09-07', capacityHours: 30, allocatedHours: 12, utilizationPct: 40, overallocatedHours: 0 },
      ],
      assignments: [
        { objectId: 'tsk-203', title: 'Auditoría de certificación Tier IV', projectId: 'prj-101', effortHours: 68, allocatedHoursInRange: 68, startDate: '2026-08-17', dueDate: '2026-09-04', sized: true, scheduled: true },
      ],
    },
  ],
};

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(date);
}

function utilizationTone(value: number): string {
  if (value > 100) return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (value >= 85) return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
}

function weekCellClass(value: number): string {
  if (value > 100) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (value >= 85) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (value > 0) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-400';
}

export const ResourceCapacityView: React.FC = () => {
  const { dataMode, status: bootstrapStatus } = useApiBootstrap();
  const { currentWorkspace } = useNexus();
  const [response, setResponse] = useState<ApiResourceCapacityResponse | null>(
    dataMode === 'mock' ? DEMO_RESPONSE : null,
  );
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(dataMode === 'mock' ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(DEMO_RESPONSE.resources[0]?.resourceId ?? null);

  useEffect(() => {
    if (dataMode === 'mock') {
      setResponse(DEMO_RESPONSE);
      setStatus('ready');
      return;
    }
    if (bootstrapStatus !== 'ready' || !currentWorkspace) return;

    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    void bridataApi.resourceCapacity(currentWorkspace.id, undefined, undefined, controller.signal)
      .then((result) => {
        setResponse(result);
        setSelectedResourceId((current) => current && result.resources.some((resource) => resource.resourceId === current)
          ? current
          : result.resources[0]?.resourceId ?? null);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo calcular la capacidad de recursos.');
        setStatus('error');
      });

    return () => controller.abort();
  }, [dataMode, bootstrapStatus, currentWorkspace]);

  const resources = response?.resources ?? [];
  const selected = resources.find((resource) => resource.resourceId === selectedResourceId) ?? resources[0] ?? null;
  const summary = useMemo(() => {
    const capacity = resources.reduce((sum, resource) => sum + resource.capacityHours, 0);
    const allocated = resources.reduce((sum, resource) => sum + resource.allocatedHours, 0);
    const over = resources.reduce((sum, resource) => sum + resource.overallocatedHours, 0);
    const unsized = resources.reduce((sum, resource) => sum + resource.unsizedItems, 0);
    return {
      capacity: Math.round(capacity),
      allocated: Math.round(allocated),
      utilization: capacity > 0 ? Math.round((allocated / capacity) * 100) : 0,
      over: Math.round(over),
      unsized,
    };
  }, [resources]);

  if (status === 'loading' && !response) {
    return <div className="grid min-h-[500px] place-items-center text-sm font-medium text-slate-500">Calculando capacidad…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-green-800 ring-1 ring-green-100">Planificación de capacidad</span>
            <span className="text-[11px] font-medium text-slate-400">{dataMode === 'mock' ? 'Preview demo' : 'Datos API'}</span>
          </div>
          <h1 className="text-[27px] font-extrabold tracking-[-0.03em] text-slate-950">Recursos y capacidad</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">
            Compara esfuerzo planificado con capacidad disponible. Bridata marca trabajo sin estimar y calcula sobreasignación por día para evitar promedios engañosos.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
          <CalendarRange className="h-4 w-4 text-green-700" />
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Ventana analizada</p>
            <p className="text-[11px] font-bold text-slate-800">{response ? `${shortDate(response.from)} – ${shortDate(response.to)}` : 'Sin rango'}</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] font-semibold text-rose-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="command-kpi-card"><UsersRound className="h-4 w-4 text-green-700" /><p className="mt-3 text-[27px] font-extrabold text-slate-950">{summary.capacity}h</p><p className="text-[10px] text-slate-500">capacidad disponible</p></div>
        <div className="command-kpi-card"><Clock3 className="h-4 w-4 text-sky-600" /><p className="mt-3 text-[27px] font-extrabold text-slate-950">{summary.allocated}h</p><p className="text-[10px] text-slate-500">esfuerzo asignado · {summary.utilization}%</p></div>
        <div className="command-kpi-card"><Gauge className="h-4 w-4 text-rose-600" /><p className="mt-3 text-[27px] font-extrabold text-slate-950">{summary.over}h</p><p className="text-[10px] text-slate-500">sobrecarga diaria acumulada</p></div>
        <div className="command-kpi-card"><AlertTriangle className="h-4 w-4 text-amber-600" /><p className="mt-3 text-[27px] font-extrabold text-slate-950">{summary.unsized}</p><p className="text-[10px] text-slate-500">actividades sin esfuerzo estimado</p></div>
      </section>

      <section className="command-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-[13px] font-extrabold text-slate-900">Carga semanal</h2><p className="mt-0.5 text-[9px] text-slate-400">Verde &lt;85% · ámbar 85–100% · rojo &gt;100%</p></div>
          {status === 'loading' && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead className="border-b border-slate-100 bg-slate-50/70 text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">
              <tr><th className="px-5 py-3">Recurso</th><th className="px-3 py-3">Capacidad/día</th>{(resources[0]?.weeks ?? []).map((week) => <th key={week.weekStart} className="px-2 py-3 text-center">Sem. {shortDate(week.weekStart)}</th>)}<th className="px-4 py-3 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {resources.map((resource) => (
                <tr key={resource.resourceId} onClick={() => setSelectedResourceId(resource.resourceId)} className={`cursor-pointer transition ${selected?.resourceId === resource.resourceId ? 'bg-green-50/40' : 'hover:bg-slate-50'}`}>
                  <td className="px-5 py-3"><p className="text-[11px] font-bold text-slate-900">{resource.name}</p><p className="mt-0.5 text-[9px] text-slate-400">{resource.unsizedItems} sin estimar · {resource.unscheduledItems} sin fecha</p></td>
                  <td className="px-3 py-3 text-[10px] font-semibold text-slate-600">{resource.capacityHoursPerDay}h</td>
                  {resource.weeks.map((week) => <td key={week.weekStart} className="px-2 py-2"><div className={`rounded-lg border px-2 py-2 text-center ${weekCellClass(week.utilizationPct)}`}><p className="text-[11px] font-extrabold">{week.utilizationPct}%</p><p className="mt-0.5 text-[8px] font-medium">{week.allocatedHours}/{week.capacityHours}h</p></div></td>)}
                  <td className="px-4 py-3 text-right"><span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold ring-1 ${utilizationTone(resource.utilizationPct)}`}>{resource.utilizationPct}%</span></td>
                </tr>
              ))}
              {resources.length === 0 && <tr><td colSpan={8} className="px-5 py-12 text-center text-[11px] text-slate-400">No hay perfiles RESOURCE configurados en este workspace.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {selected && <ResourceDetail resource={selected} />}
    </div>
  );
};

const ResourceDetail: React.FC<{ resource: ApiResourceCapacityResource }> = ({ resource }) => (
  <section className="command-panel overflow-hidden">
    <div className="border-b border-slate-100 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-green-700">Detalle de carga</p><h2 className="mt-1 text-[14px] font-extrabold text-slate-950">{resource.name}</h2></div><div className="flex gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ${utilizationTone(resource.utilizationPct)}`}>{resource.utilizationPct}% utilización</span>{resource.overallocatedHours > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[9px] font-bold text-rose-700 ring-1 ring-rose-200">+{resource.overallocatedHours}h sobrecarga</span>}</div></div></div>
    <div className="divide-y divide-slate-100">
      {resource.assignments.map((assignment) => (
        <div key={assignment.objectId} className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_130px_130px_120px] md:items-center">
          <div className="min-w-0"><p className="truncate text-[10px] font-bold text-slate-900">{assignment.title}</p><p className="mt-0.5 text-[8px] text-slate-400">{assignment.scheduled && assignment.startDate && assignment.dueDate ? `${shortDate(assignment.startDate)} – ${shortDate(assignment.dueDate)}` : 'Sin programación completa'}</p></div>
          <div><p className="text-[8px] font-bold uppercase text-slate-400">Esfuerzo</p><p className={`mt-1 text-[10px] font-bold ${assignment.sized ? 'text-slate-800' : 'text-amber-700'}`}>{assignment.sized ? `${assignment.effortHours}h` : 'Sin estimar'}</p></div>
          <div><p className="text-[8px] font-bold uppercase text-slate-400">En ventana</p><p className="mt-1 text-[10px] font-bold text-slate-800">{assignment.allocatedHoursInRange}h</p></div>
          <div className="text-right"><span className={`rounded-full px-2 py-1 text-[8px] font-bold ${assignment.sized && assignment.scheduled ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{assignment.sized && assignment.scheduled ? 'Dimensionada' : !assignment.sized ? 'Falta esfuerzo' : 'Falta fecha'}</span></div>
        </div>
      ))}
    </div>
  </section>
);
