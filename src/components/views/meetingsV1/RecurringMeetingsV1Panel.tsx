import React, { useEffect, useMemo, useState } from 'react';
import { Ban, CalendarClock, CalendarRange, ChevronDown, ChevronRight, Plus, RefreshCw, Repeat2, X } from 'lucide-react';
import { meetingResourcesV1Api } from '../../../api/meetingResourcesV1Api';
import type { ApiMeetingResourceV1 } from '../../../api/meetingResourcesV1Contracts';
import { meetingsV1Api } from '../../../api/meetingsV1Api';
import type { ApiMeetingWorkspacePersonV1 } from '../../../api/meetingsV1Contracts';
import { recurringMeetingsV1Api } from '../../../api/recurringMeetingsV1Api';
import type {
  ApiRecurringMeetingOccurrenceV1,
  ApiRecurringMeetingSeriesV1,
  RecurrenceDayV1,
  RecurrencePatternTypeV1,
  RecurrenceRangeTypeV1,
} from '../../../api/recurringMeetingsV1Contracts';
import { useApiBootstrap } from '../../../context/ApiBootstrapContext';
import { useNexus } from '../../../context/NexusContext';
import { MeetingAttendeePickerV1 } from './MeetingAttendeePickerV1';

const DAYS: Array<{ key: RecurrenceDayV1; label: string }> = [
  { key: 'MONDAY', label: 'Lun' }, { key: 'TUESDAY', label: 'Mar' }, { key: 'WEDNESDAY', label: 'Mié' },
  { key: 'THURSDAY', label: 'Jue' }, { key: 'FRIDAY', label: 'Vie' }, { key: 'SATURDAY', label: 'Sáb' }, { key: 'SUNDAY', label: 'Dom' },
];
const JS_DAY: RecurrenceDayV1[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}
function limaDay(value: string): RecurrenceDayV1 {
  return JS_DAY[new Date(value).getDay()] ?? 'MONDAY';
}
function dayOfMonth(value: string): number { return new Date(value).getDate(); }
function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function recurrenceLabel(series: ApiRecurringMeetingSeriesV1): string {
  const { recurrence } = series;
  const pattern = recurrence.patternType === 'DAILY'
    ? `Cada ${recurrence.interval === 1 ? 'día' : `${recurrence.interval} días`}`
    : recurrence.patternType === 'WEEKLY'
      ? `Cada ${recurrence.interval === 1 ? 'semana' : `${recurrence.interval} semanas`} · ${recurrence.daysOfWeek.join(', ')}`
      : `Cada ${recurrence.interval === 1 ? 'mes' : `${recurrence.interval} meses`} · día ${recurrence.dayOfMonth}`;
  const range = recurrence.rangeType === 'NUMBERED'
    ? `${recurrence.numberOfOccurrences} ocurrencias`
    : `hasta ${recurrence.endDate}`;
  return `${pattern} · ${range}`;
}

export const RecurringMeetingsV1Panel: React.FC<{ projectId?: string; onChanged?: () => void }> = ({ projectId, onChanged }) => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, users, reloadObjects } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const [series, setSeries] = useState<ApiRecurringMeetingSeriesV1[]>([]);
  const [people, setPeople] = useState<ApiMeetingWorkspacePersonV1[]>([]);
  const [resources, setResources] = useState<ApiMeetingResourceV1[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [activeSeries, setActiveSeries] = useState<ApiRecurringMeetingSeriesV1 | null>(null);
  const [activeOccurrence, setActiveOccurrence] = useState<ApiRecurringMeetingOccurrenceV1 | null>(null);
  const [action, setAction] = useState<'series-reschedule' | 'series-cancel' | 'occurrence-reschedule' | 'occurrence-cancel' | null>(null);
  const [actionStart, setActionStart] = useState('');
  const [actionEnd, setActionEnd] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialDates = useMemo(() => {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return { start: localInputValue(start), end: localInputValue(end) };
  }, []);
  const [form, setForm] = useState({
    title: '', description: '', startAt: initialDates.start, endAt: initialDates.end, location: '',
    attendeeUserIds: [] as string[], externalEmails: '', roomId: '', equipmentIds: [] as string[],
    patternType: 'WEEKLY' as RecurrencePatternTypeV1, interval: 1, daysOfWeek: [limaDay(initialDates.start)] as RecurrenceDayV1[],
    dayOfMonth: dayOfMonth(initialDates.start), rangeType: 'NUMBERED' as RecurrenceRangeTypeV1, numberOfOccurrences: 4, endDate: '',
    isOnline: true, requestM365Sync: true,
  });

  const mockPeople = useMemo<ApiMeetingWorkspacePersonV1[]>(() => users.map((user, index) => ({
    id: user.id, fullName: user.name, email: user.email, avatarUrl: user.avatar || null, workspaceRole: user.roleName, isCurrentUser: index === 0,
  })), [users]);

  const load = async () => {
    if (!currentWorkspace) return;
    setError(null);
    if (!apiReady) {
      setSeries([]);
      setPeople(mockPeople);
      setResources([]);
      return;
    }
    setLoading(true);
    try {
      const [seriesResult, peopleResult, resourceResult] = await Promise.all([
        recurringMeetingsV1Api.list(tenant.id, currentWorkspace.id, projectId),
        meetingsV1Api.people(tenant.id, currentWorkspace.id),
        meetingResourcesV1Api.list(tenant.id, currentWorkspace.id),
      ]);
      setSeries(seriesResult.items);
      setPeople(peopleResult.items);
      setResources(resourceResult.items.filter((item) => item.isActive));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las reuniones recurrentes.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [apiReady, currentWorkspace?.id, projectId, mockPeople]);

  const rooms = resources.filter((item) => item.resourceType === 'ROOM');
  const equipment = resources.filter((item) => item.resourceType === 'EQUIPMENT');
  const selectedRoom = rooms.find((item) => item.id === form.roomId) ?? null;
  const externalEmails = [...new Set(form.externalEmails.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const selectedInternalEmails = form.attendeeUserIds.map((id) => people.find((person) => person.id === id)?.email.toLowerCase()).filter((value): value is string => Boolean(value));
  const organizerEmail = people.find((person) => person.isCurrentUser)?.email.toLowerCase() ?? users[0]?.email.toLowerCase() ?? '';
  const peopleCount = new Set([organizerEmail, ...selectedInternalEmails, ...externalEmails].filter(Boolean)).size;
  const capacityExceeded = Boolean(selectedRoom?.capacity != null && selectedRoom.capacity < peopleCount);

  const updateStart = (value: string) => {
    setForm((current) => ({
      ...current,
      startAt: value,
      daysOfWeek: current.patternType === 'WEEKLY' ? [limaDay(value)] : current.daysOfWeek,
      dayOfMonth: current.patternType === 'ABSOLUTE_MONTHLY' ? dayOfMonth(value) : current.dayOfMonth,
    }));
  };
  const updatePattern = (patternType: RecurrencePatternTypeV1) => {
    setForm((current) => ({
      ...current,
      patternType,
      daysOfWeek: patternType === 'WEEKLY' ? [limaDay(current.startAt)] : [],
      dayOfMonth: patternType === 'ABSOLUTE_MONTHLY' ? dayOfMonth(current.startAt) : current.dayOfMonth,
    }));
  };
  const toggleDay = (key: RecurrenceDayV1) => setForm((current) => ({
    ...current,
    daysOfWeek: current.daysOfWeek.includes(key) ? current.daysOfWeek.filter((item) => item !== key) : [...current.daysOfWeek, key],
  }));
  const toggleEquipment = (id: string) => setForm((current) => ({
    ...current,
    equipmentIds: current.equipmentIds.includes(id) ? current.equipmentIds.filter((item) => item !== id) : [...current.equipmentIds, id],
  }));

  const createSeries = async () => {
    if (!currentWorkspace || !form.title.trim()) return;
    if (!apiReady) { setError('La persistencia recurrente requiere modo API; el preview mock no crea series ficticias.'); return; }
    const start = new Date(form.startAt); const end = new Date(form.endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) { setError('La hora de fin debe ser posterior al inicio.'); return; }
    if (form.patternType === 'WEEKLY' && !form.daysOfWeek.includes(limaDay(form.startAt))) { setError('En V1, el día de la primera reunión debe estar incluido en los días semanales.'); return; }
    if (capacityExceeded) { setError(`La sala seleccionada no tiene capacidad para ${peopleCount} personas.`); return; }
    setSaving(true); setError(null);
    try {
      await recurringMeetingsV1Api.create(tenant.id, {
        workspaceId: currentWorkspace.id,
        ...(projectId ? { projectId } : {}),
        title: form.title.trim(), description: form.description.trim() || null,
        startAt: start.toISOString(), endAt: end.toISOString(), location: form.location.trim() || selectedRoom?.location || null,
        isOnline: form.isOnline,
        attendeeUserIds: form.attendeeUserIds,
        externalAttendees: externalEmails.map((email) => ({ email, displayName: email, attendeeType: 'REQUIRED' as const })),
        resourceIds: [form.roomId, ...form.equipmentIds].filter(Boolean),
        requestM365Sync: form.requestM365Sync,
        recurrence: {
          patternType: form.patternType, interval: form.interval,
          ...(form.patternType === 'WEEKLY' ? { daysOfWeek: form.daysOfWeek } : { daysOfWeek: [] }),
          ...(form.patternType === 'ABSOLUTE_MONTHLY' ? { dayOfMonth: form.dayOfMonth } : {}),
          rangeType: form.rangeType,
          ...(form.rangeType === 'NUMBERED' ? { numberOfOccurrences: form.numberOfOccurrences } : { endDate: form.endDate }),
          timezone: 'America/Lima',
        },
      });
      setCreateOpen(false);
      await Promise.all([load(), reloadObjects()]);
      onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la serie recurrente.'); }
    finally { setSaving(false); }
  };

  const openSeriesAction = (item: ApiRecurringMeetingSeriesV1, nextAction: 'series-reschedule' | 'series-cancel') => {
    setActiveSeries(item); setActiveOccurrence(null); setAction(nextAction); setComment('');
    if (nextAction === 'series-reschedule') {
      const first = item.occurrences[0];
      if (first) { setActionStart(localInputValue(new Date(first.startAt))); setActionEnd(localInputValue(new Date(first.endAt))); }
    }
  };
  const openOccurrenceAction = (item: ApiRecurringMeetingSeriesV1, occurrence: ApiRecurringMeetingOccurrenceV1, nextAction: 'occurrence-reschedule' | 'occurrence-cancel') => {
    setActiveSeries(item); setActiveOccurrence(occurrence); setAction(nextAction); setComment('');
    if (nextAction === 'occurrence-reschedule') { setActionStart(localInputValue(new Date(occurrence.startAt))); setActionEnd(localInputValue(new Date(occurrence.endAt))); }
  };

  const executeAction = async () => {
    if (!activeSeries || !action || !apiReady) { if (!apiReady) setError('Las operaciones recurrentes reales requieren modo API.'); return; }
    setSaving(true); setError(null);
    try {
      if (action === 'series-reschedule') {
        await recurringMeetingsV1Api.rescheduleSeries(tenant.id, activeSeries.id, {
          version: activeSeries.version, startAt: new Date(actionStart).toISOString(), endAt: new Date(actionEnd).toISOString(), requestM365Sync: Boolean(activeSeries.graphSeriesMasterId),
        });
      } else if (action === 'series-cancel') {
        await recurringMeetingsV1Api.cancelSeries(tenant.id, activeSeries.id, { version: activeSeries.version, comment: comment.trim() || null });
      } else if (action === 'occurrence-reschedule' && activeOccurrence) {
        await recurringMeetingsV1Api.rescheduleOccurrence(tenant.id, activeSeries.id, activeOccurrence.id, {
          version: activeOccurrence.version, startAt: new Date(actionStart).toISOString(), endAt: new Date(actionEnd).toISOString(), requestM365Sync: Boolean(activeSeries.graphSeriesMasterId),
        });
      } else if (action === 'occurrence-cancel' && activeOccurrence) {
        await recurringMeetingsV1Api.cancelOccurrence(tenant.id, activeSeries.id, activeOccurrence.id, { version: activeOccurrence.version, comment: comment.trim() || null });
      }
      setAction(null); setActiveSeries(null); setActiveOccurrence(null);
      await Promise.all([load(), reloadObjects()]);
      onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación recurrente.'); }
    finally { setSaving(false); }
  };

  return (
    <section className="command-panel overflow-hidden">
      <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-green-700"><Repeat2 className="h-4 w-4" /> Recurring Meetings V1</div>
          <h2 className="mt-2 text-[18px] font-extrabold text-slate-950">Series recurrentes con ocurrencias controladas</h2>
          <p className="mt-1 max-w-3xl text-[9px] leading-4 text-slate-500">Diaria, semanal o mensual por día. Bridata conserva el master y cada ocurrencia; Outlook/Teams recibe una serie recurrente cuando M365 está habilitado.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500" aria-label="Actualizar series"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[9px] font-black text-white"><Plus className="h-4 w-4" /> Nueva serie</button>
        </div>
      </div>
      {error && <div className="mx-5 mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[9px] font-semibold text-rose-700">{error}</div>}
      {!apiReady && <div className="mx-5 mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[8px] font-semibold text-slate-500">Preview mock: se puede revisar el diseño, pero no se crean ni modifican series ficticias.</div>}

      <div className="border-t border-slate-100">
        {series.map((item) => {
          const isOpen = expanded.has(item.id);
          return <div key={item.id} className="border-b border-slate-100">
            <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <button type="button" className="min-w-0 text-left" onClick={() => setExpanded((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>
                <div className="flex items-center gap-2">{isOpen ? <ChevronDown className="h-4 w-4 text-green-700" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}<span className="truncate text-[11px] font-extrabold text-slate-900">{item.title}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[7px] font-black text-slate-600">{item.lifecycleStatus}</span></div>
                <p className="ml-6 mt-1 text-[8px] font-semibold text-slate-500">{recurrenceLabel(item)} · {item.occurrences.length} materializadas · {item.syncStatus}</p>
              </button>
              {item.lifecycleStatus === 'SCHEDULED' && <div className="flex gap-2"><button type="button" onClick={() => openSeriesAction(item, 'series-reschedule')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[8px] font-black text-slate-600"><CalendarClock className="h-3.5 w-3.5" /> Reprogramar serie</button><button type="button" onClick={() => openSeriesAction(item, 'series-cancel')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-[8px] font-black text-rose-700"><Ban className="h-3.5 w-3.5" /> Cancelar serie</button></div>}
            </div>
            {isOpen && <div className="bg-slate-50/70 px-5 py-3"><div className="grid grid-cols-1 gap-2 xl:grid-cols-2">{item.occurrences.map((occurrence) => <div key={occurrence.id} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-[9px] font-black text-slate-800">#{occurrence.sequence} · {formatDate(occurrence.startAt)}</p><p className="mt-1 text-[7px] font-semibold text-slate-400">{occurrence.isException ? 'EXCEPCIÓN' : 'OCURRENCIA'} · v{occurrence.version}</p></div><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[7px] font-black text-slate-600">{occurrence.lifecycleStatus}</span></div>{occurrence.lifecycleStatus === 'SCHEDULED' && <div className="mt-3 flex gap-2"><button type="button" onClick={() => openOccurrenceAction(item, occurrence, 'occurrence-reschedule')} className="h-7 rounded-lg border border-slate-200 px-2 text-[7px] font-black text-slate-600">Mover esta</button><button type="button" onClick={() => openOccurrenceAction(item, occurrence, 'occurrence-cancel')} className="h-7 rounded-lg border border-rose-200 px-2 text-[7px] font-black text-rose-700">Cancelar esta</button></div>}{occurrence.cancellationComment && <p className="mt-2 text-[7px] text-slate-500">Motivo: {occurrence.cancellationComment}</p>}</div>)}</div></div>}
          </div>;
        })}
        {!series.length && <div className="p-10 text-center"><CalendarRange className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-2 text-[9px] font-semibold text-slate-400">Sin series recurrentes en este contexto.</p></div>}
      </div>

      {createOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setCreateOpen(false); }}><div className="max-h-[92vh] w-full max-w-[980px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Nueva serie recurrente</p><h3 className="mt-1 text-[19px] font-extrabold text-slate-950">Programar patrón + participantes + recursos</h3></div><button type="button" onClick={() => setCreateOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]"><div className="space-y-3"><input value={form.title} onChange={(e) => setForm({...form,title:e.target.value})} placeholder="Título de la serie" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold" /><textarea value={form.description} onChange={(e) => setForm({...form,description:e.target.value})} rows={3} placeholder="Agenda / objetivo" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[10px]" /><MeetingAttendeePickerV1 people={people} selectedIds={form.attendeeUserIds} onChange={(attendeeUserIds) => setForm({...form,attendeeUserIds})} /><input value={form.externalEmails} onChange={(e) => setForm({...form,externalEmails:e.target.value})} placeholder="Invitados externos, separados por coma" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px]" /><div className="grid grid-cols-2 gap-3"><label className="text-[8px] font-black uppercase text-slate-400">Primera ocurrencia<input type="datetime-local" value={form.startAt} onChange={(e) => updateStart(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px]" /></label><label className="text-[8px] font-black uppercase text-slate-400">Fin<input type="datetime-local" value={form.endAt} onChange={(e) => setForm({...form,endAt:e.target.value})} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px]" /></label></div><input value={form.location} onChange={(e) => setForm({...form,location:e.target.value})} placeholder={selectedRoom?.location ? `Ubicación: ${selectedRoom.location}` : 'Ubicación (opcional)'} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px]" /></div>
        <div className="space-y-3"><div className="rounded-xl border border-slate-200 p-3"><p className="text-[8px] font-black uppercase text-slate-400">Patrón</p><div className="mt-2 grid grid-cols-3 gap-1">{(['DAILY','WEEKLY','ABSOLUTE_MONTHLY'] as RecurrencePatternTypeV1[]).map((value)=><button key={value} type="button" onClick={()=>updatePattern(value)} className={`rounded-lg border px-2 py-2 text-[7px] font-black ${form.patternType===value?'border-green-300 bg-green-50 text-green-800':'border-slate-200 text-slate-500'}`}>{value==='DAILY'?'Diaria':value==='WEEKLY'?'Semanal':'Mensual'}</button>)}</div><label className="mt-3 block text-[8px] font-black uppercase text-slate-400">Intervalo<input type="number" min={1} max={99} value={form.interval} onChange={(e)=>setForm({...form,interval:Number(e.target.value)})} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-[9px]" /></label>{form.patternType==='WEEKLY'&&<div className="mt-3 flex flex-wrap gap-1">{DAYS.map((item)=><button key={item.key} type="button" onClick={()=>toggleDay(item.key)} className={`rounded-lg border px-2 py-1.5 text-[7px] font-black ${form.daysOfWeek.includes(item.key)?'border-green-300 bg-green-50 text-green-800':'border-slate-200 text-slate-500'}`}>{item.label}</button>)}</div>}{form.patternType==='ABSOLUTE_MONTHLY'&&<label className="mt-3 block text-[8px] font-black uppercase text-slate-400">Día del mes<input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e)=>setForm({...form,dayOfMonth:Number(e.target.value)})} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-3 text-[9px]" /></label>}</div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-[8px] font-black uppercase text-slate-400">Rango</p><div className="mt-2 grid grid-cols-2 gap-1"><button type="button" onClick={()=>setForm({...form,rangeType:'NUMBERED'})} className={`rounded-lg border px-2 py-2 text-[7px] font-black ${form.rangeType==='NUMBERED'?'border-green-300 bg-green-50 text-green-800':'border-slate-200 text-slate-500'}`}>N ocurrencias</button><button type="button" onClick={()=>setForm({...form,rangeType:'END_DATE'})} className={`rounded-lg border px-2 py-2 text-[7px] font-black ${form.rangeType==='END_DATE'?'border-green-300 bg-green-50 text-green-800':'border-slate-200 text-slate-500'}`}>Fecha final</button></div>{form.rangeType==='NUMBERED'?<input type="number" min={2} max={120} value={form.numberOfOccurrences} onChange={(e)=>setForm({...form,numberOfOccurrences:Number(e.target.value)})} className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-3 text-[9px]" />:<input type="date" value={form.endDate} onChange={(e)=>setForm({...form,endDate:e.target.value})} className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-3 text-[9px]" />}</div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-[8px] font-black uppercase text-slate-400">Sala</p><select value={form.roomId} onChange={(e)=>setForm({...form,roomId:e.target.value})} className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-[8px]"><option value="">Sin sala</option>{rooms.map((room)=><option key={room.id} value={room.id}>{room.name} · {room.capacity ?? '?'} pers.</option>)}</select>{selectedRoom&&<p className={`mt-2 text-[7px] font-semibold ${capacityExceeded?'text-rose-600':'text-slate-500'}`}>{peopleCount} personas / capacidad {selectedRoom.capacity ?? 'sin definir'}</p>}<p className="mt-3 text-[8px] font-black uppercase text-slate-400">Equipamiento</p><div className="mt-1 space-y-1">{equipment.map((item)=><button key={item.id} type="button" onClick={()=>toggleEquipment(item.id)} className={`flex w-full justify-between rounded-lg border px-2 py-1.5 text-[7px] font-semibold ${form.equipmentIds.includes(item.id)?'border-green-200 bg-green-50 text-green-800':'border-slate-200 text-slate-600'}`}><span>{item.name}</span><span>{form.equipmentIds.includes(item.id)?'✓':'+'}</span></button>)}</div></div><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[8px] font-semibold text-slate-600"><input type="checkbox" checked={form.isOnline} onChange={(e)=>setForm({...form,isOnline:e.target.checked})} /> Teams</label><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[8px] font-semibold text-slate-600"><input type="checkbox" checked={form.requestM365Sync} onChange={(e)=>setForm({...form,requestM365Sync:e.target.checked})} /> Sincronizar Outlook/M365</label></div></div>
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={()=>setCreateOpen(false)} className="h-9 rounded-xl border border-slate-200 px-4 text-[9px] font-black text-slate-600">Cerrar</button><button type="button" disabled={saving||!form.title.trim()||capacityExceeded} onClick={()=>void createSeries()} className="h-9 rounded-xl bg-green-700 px-5 text-[9px] font-black text-white disabled:opacity-40">{saving?'Creando...':'Crear serie'}</button></div></div></div>}

      {action && activeSeries && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]" onMouseDown={(event)=>{if(event.currentTarget===event.target)setAction(null);}}><div className="w-full max-w-[540px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"><p className="text-[9px] font-black uppercase text-green-700">{action.includes('occurrence')?'Ocurrencia':'Serie'} recurrente</p><h3 className="mt-1 text-[17px] font-extrabold text-slate-950">{activeSeries.title}</h3>{action.includes('reschedule')?<div className="mt-4 grid grid-cols-2 gap-3"><label className="text-[8px] font-black uppercase text-slate-400">Nuevo inicio<input type="datetime-local" value={actionStart} onChange={(e)=>setActionStart(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px]" /></label><label className="text-[8px] font-black uppercase text-slate-400">Nuevo fin<input type="datetime-local" value={actionEnd} onChange={(e)=>setActionEnd(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px]" /></label><p className="col-span-2 text-[8px] leading-4 text-slate-500">V1 no edita el patrón después de crear la serie. Reprogramar serie cambia la hora de todas las ocurrencias solo si aún no existen excepciones. Mover una ocurrencia crea una excepción.</p></div>:<div className="mt-4"><textarea value={comment} onChange={(e)=>setComment(e.target.value)} rows={4} placeholder="Motivo de cancelación (opcional)" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[9px]" /><p className="mt-2 text-[8px] text-slate-500">Cancelar una ocurrencia no cancela toda la serie. Cancelar la serie afecta todas las ocurrencias restantes.</p></div>}<div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={()=>setAction(null)} className="h-9 rounded-xl border border-slate-200 px-4 text-[9px] font-black text-slate-600">Cerrar</button><button type="button" disabled={saving} onClick={()=>void executeAction()} className={`h-9 rounded-xl px-4 text-[9px] font-black text-white ${action.includes('cancel')?'bg-rose-600':'bg-green-700'}`}>{saving?'Procesando...':action.includes('cancel')?'Confirmar cancelación':'Guardar horario'}</button></div></div></div>}
    </section>
  );
};
