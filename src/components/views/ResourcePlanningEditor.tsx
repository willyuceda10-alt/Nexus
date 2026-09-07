import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Save, SlidersHorizontal, UserRoundCog } from 'lucide-react';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import type { NexusObject } from '../../types/nexus';

const WEEKDAYS = [
  { value: 1, label: 'L' },
  { value: 2, label: 'M' },
  { value: 3, label: 'X' },
  { value: 4, label: 'J' },
  { value: 5, label: 'V' },
  { value: 6, label: 'S' },
  { value: 0, label: 'D' },
] as const;

interface Props {
  onSaved: () => void;
}

function taskLabel(object: NexusObject): string {
  if (object.type === 'MILESTONE') return 'Hito';
  if (object.type === 'DELIVERABLE') return 'Entregable';
  return 'Tarea';
}

function csv(values: string[] | undefined): string {
  return values?.join(', ') ?? '';
}

function parseCsv(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export const ResourcePlanningEditor: React.FC<Props> = ({ onSaved }) => {
  const { dataMode } = useApiBootstrap();
  const {
    objects,
    updateNexusObject,
    isObjectMutationPending,
    objectDataError,
  } = useNexus();

  const resources = useMemo(
    () => objects.filter((object) => object.type === 'RESOURCE'),
    [objects],
  );
  const assignments = useMemo(
    () => objects
      .filter((object) => ['TASK', 'DELIVERABLE', 'MILESTONE'].includes(object.type))
      .filter((object) => !['COMPLETED', 'CANCELLED'].includes(object.status))
      .sort((a, b) => (a.endDate ?? '9999-12-31').localeCompare(b.endDate ?? '9999-12-31')),
    [objects],
  );

  const [resourceId, setResourceId] = useState<string>('');
  const [capacityHours, setCapacityHours] = useState('8');
  const [workingWeekdays, setWorkingWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [holidays, setHolidays] = useState('');
  const [skills, setSkills] = useState('');
  const [taskId, setTaskId] = useState<string>('');
  const [effortHours, setEffortHours] = useState('');
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const resource = resources.find((item) => item.id === resourceId) ?? null;
  const task = assignments.find((item) => item.id === taskId) ?? null;

  useEffect(() => {
    if (!resourceId || !resources.some((item) => item.id === resourceId)) {
      setResourceId(resources[0]?.id ?? '');
    }
  }, [resourceId, resources]);

  useEffect(() => {
    if (!taskId || !assignments.some((item) => item.id === taskId)) {
      setTaskId(assignments[0]?.id ?? '');
    }
  }, [taskId, assignments]);

  useEffect(() => {
    if (!resource) return;
    setCapacityHours(String(resource.capacityHoursPerDay ?? 8));
    setWorkingWeekdays(resource.resourceWorkingWeekdays?.length
      ? resource.resourceWorkingWeekdays
      : [1, 2, 3, 4, 5]);
    setHolidays(csv(resource.resourceHolidays));
    setSkills(csv(resource.skills));
  }, [resource]);

  useEffect(() => {
    if (!task) return;
    setEffortHours(task.effortHours && task.effortHours > 0 ? String(task.effortHours) : '');
  }, [task]);

  const apiEditingAvailable = dataMode === 'api';

  const toggleWeekday = (value: number) => {
    setWorkingWeekdays((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  };

  const saveResource = async () => {
    if (!resource || !apiEditingAvailable) return;
    const capacity = Number(capacityHours);
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 24) return;
    setSavedMessage(null);
    await updateNexusObject(resource.id, {
      capacityHoursPerDay: capacity,
      resourceWorkingWeekdays: workingWeekdays,
      resourceHolidays: parseCsv(holidays),
      skills: parseCsv(skills),
    });
    setSavedMessage('Capacidad actualizada. La matriz se recalculó.');
    onSaved();
  };

  const saveEffort = async () => {
    if (!task || !apiEditingAvailable) return;
    const value = effortHours.trim() === '' ? 0 : Number(effortHours);
    if (!Number.isFinite(value) || value < 0 || value > 100_000) return;
    setSavedMessage(null);
    await updateNexusObject(task.id, { effortHours: value });
    setSavedMessage(value > 0
      ? `Esfuerzo de ${value}h guardado. La matriz se recalculó.`
      : 'Estimación retirada; Bridata la marcará como trabajo sin dimensionar.');
    onSaved();
  };

  return (
    <section className="mx-auto w-full max-w-[1500px] px-6 pb-8 lg:px-8">
      <div className="command-panel overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-green-700">
              <SlidersHorizontal className="h-4 w-4" />
              <p className="text-[9px] font-bold uppercase tracking-[0.12em]">Planificación operativa</p>
            </div>
            <h2 className="mt-1 text-[14px] font-extrabold text-slate-950">Editar capacidad y esfuerzo</h2>
            <p className="mt-1 text-[9px] text-slate-400">Los cambios usan el Object Engine y optimistic locking existentes.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ring-1 ${
            apiEditingAvailable
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-amber-50 text-amber-700 ring-amber-200'
          }`}>
            {apiEditingAvailable ? 'Edición persistente' : 'Preview demo · edición deshabilitada'}
          </span>
        </div>

        {!apiEditingAvailable && (
          <div className="border-b border-amber-100 bg-amber-50/60 px-5 py-3 text-[10px] leading-5 text-amber-800">
            La Preview pública todavía usa datos demostrativos. Este editor quedará activo cuando la web apunte al API DEV de Azure; no simulamos guardados que luego no existirían en PostgreSQL.
          </div>
        )}

        {objectDataError && (
          <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-[10px] font-semibold text-rose-700">{objectDataError}</div>
        )}
        {savedMessage && (
          <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-[10px] font-semibold text-emerald-700">{savedMessage}</div>
        )}

        <div className="grid gap-0 lg:grid-cols-2">
          <div className="border-b border-slate-100 p-5 lg:border-b-0 lg:border-r">
            <div className="mb-4 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-green-50 text-green-700"><UserRoundCog className="h-4 w-4" /></div>
              <div><p className="text-[11px] font-bold text-slate-900">Perfil de capacidad</p><p className="text-[9px] text-slate-400">Disponibilidad contractual/operativa del recurso</p></div>
            </div>

            <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Recurso</label>
            <select
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              disabled={!apiEditingAvailable || resources.length === 0}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] font-semibold text-slate-800 outline-none focus:border-green-500 disabled:bg-slate-50 disabled:text-slate-400"
            >
              {resources.length === 0 && <option value="">Sin perfiles RESOURCE en datos reales</option>}
              {resources.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Capacidad / día</label>
                <div className="relative mt-1.5"><input type="number" min={0} max={24} step={0.5} value={capacityHours} onChange={(event) => setCapacityHours(event.target.value)} disabled={!apiEditingAvailable || !resource} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-8 text-[11px] font-bold text-slate-800 outline-none focus:border-green-500 disabled:bg-slate-50" /><span className="absolute right-3 top-2.5 text-[10px] font-semibold text-slate-400">h</span></div>
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Skills</label>
                <input value={skills} onChange={(event) => setSkills(event.target.value)} disabled={!apiEditingAvailable || !resource} placeholder="PMO, SAP, Azure" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] text-slate-800 outline-none focus:border-green-500 disabled:bg-slate-50" />
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Semana laboral</label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => (
                  <button key={day.value} type="button" disabled={!apiEditingAvailable || !resource} onClick={() => toggleWeekday(day.value)} className={`grid h-8 w-8 place-items-center rounded-lg border text-[9px] font-bold transition ${workingWeekdays.includes(day.value) ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-200 bg-white text-slate-400'} disabled:opacity-50`}>{day.label}</button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400"><CalendarDays className="h-3 w-3" /> Feriados / ausencias</label>
              <input value={holidays} onChange={(event) => setHolidays(event.target.value)} disabled={!apiEditingAvailable || !resource} placeholder="2026-08-30, 2026-10-08" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] text-slate-800 outline-none focus:border-green-500 disabled:bg-slate-50" />
            </div>

            <button type="button" onClick={() => void saveResource()} disabled={!apiEditingAvailable || !resource || isObjectMutationPending} className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-bold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Guardar capacidad</button>
          </div>

          <div className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600"><Clock3 className="h-4 w-4" /></div>
              <div><p className="text-[11px] font-bold text-slate-900">Esfuerzo de actividad</p><p className="text-[9px] text-slate-400">Horas necesarias para completar la actividad</p></div>
            </div>

            <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Actividad abierta</label>
            <select value={taskId} onChange={(event) => setTaskId(event.target.value)} disabled={!apiEditingAvailable || assignments.length === 0} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[10px] font-semibold text-slate-800 outline-none focus:border-green-500 disabled:bg-slate-50 disabled:text-slate-400">
              {assignments.length === 0 && <option value="">Sin actividades abiertas</option>}
              {assignments.map((item) => <option key={item.id} value={item.id}>{taskLabel(item)} · {item.title}</option>)}
            </select>

            {task && (
              <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><p className="text-[8px] font-bold uppercase text-slate-400">Inicio</p><p className="mt-1 text-[10px] font-semibold text-slate-700">{task.startDate ?? 'Sin fecha'}</p></div>
                  <div><p className="text-[8px] font-bold uppercase text-slate-400">Fin</p><p className="mt-1 text-[10px] font-semibold text-slate-700">{task.endDate ?? 'Sin fecha'}</p></div>
                  <div><p className="text-[8px] font-bold uppercase text-slate-400">Asignado</p><p className="mt-1 truncate text-[10px] font-semibold text-slate-700">{task.assigneeName ?? 'Sin asignar'}</p></div>
                </div>
              </div>
            )}

            <div className="mt-4">
              <label className="text-[8px] font-bold uppercase tracking-[0.1em] text-slate-400">Esfuerzo total</label>
              <div className="relative mt-1.5 max-w-[220px]"><input type="number" min={0} max={100000} step={0.5} value={effortHours} onChange={(event) => setEffortHours(event.target.value)} disabled={!apiEditingAvailable || !task} placeholder="Ej. 40" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-8 text-[11px] font-bold text-slate-800 outline-none focus:border-green-500 disabled:bg-slate-50" /><span className="absolute right-3 top-2.5 text-[10px] font-semibold text-slate-400">h</span></div>
              <p className="mt-2 max-w-lg text-[9px] leading-4 text-slate-400">Déjalo vacío o en 0 para marcar la actividad como <strong className="font-semibold text-amber-700">sin dimensionar</strong>. Bridata nunca inferirá horas de esfuerzo sin una regla explícita.</p>
            </div>

            <button type="button" onClick={() => void saveEffort()} disabled={!apiEditingAvailable || !task || isObjectMutationPending} className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-bold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Guardar esfuerzo</button>
          </div>
        </div>
      </div>
    </section>
  );
};
