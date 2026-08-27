import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, CheckCircle2, Clock3, DoorOpen, MonitorUp, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { meetingResourcesV1Api } from '../../../api/meetingResourcesV1Api';
import type { ApiMeetingResourceAvailabilityV1, ApiMeetingResourceV1 } from '../../../api/meetingResourcesV1Contracts';
import { meetingSchedulingV2Api } from '../../../api/meetingSchedulingV2Api';
import { meetingsV1Api } from '../../../api/meetingsV1Api';
import type { ApiMeetingCapabilitiesV1, ApiMeetingWorkspacePersonV1 } from '../../../api/meetingsV1Contracts';
import { useApiBootstrap } from '../../../context/ApiBootstrapContext';
import { useNexus } from '../../../context/NexusContext';
import { MeetingAttendeePickerV1 } from './MeetingAttendeePickerV1';

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function dayWindow(value: string): { startAt: string; endAt: string } {
  const selected = new Date(value);
  const start = new Date(selected);
  start.setHours(8, 0, 0, 0);
  const end = new Date(selected);
  end.setHours(18, 0, 0, 0);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function durationMinutes(startAt: string, endAt: string): number {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const raw = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.ceil((end - start) / 60_000) : 60;
  return Math.max(30, Math.min(480, Math.ceil(raw / 30) * 30));
}

function slotLabel(start: string, end: string): string {
  const date = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const time = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' });
  return `${date.format(new Date(start))} – ${time.format(new Date(end))}`;
}

const MOCK_RESOURCES: ApiMeetingResourceV1[] = [
  { id: 'mock-room-1', workspaceId: 'mock', resourceType: 'ROOM', name: 'Sala Operaciones', email: 'sala-operaciones@empresa.com', location: 'Administración', capacity: 12, features: ['Teams Room', 'Pantalla'], isActive: true, createdAt: '', updatedAt: '' },
  { id: 'mock-room-2', workspaceId: 'mock', resourceType: 'ROOM', name: 'Sala Directorio', email: 'sala-directorio@empresa.com', location: 'Edificio administrativo', capacity: 20, features: ['TV 75”', 'Cámara'], isActive: true, createdAt: '', updatedAt: '' },
  { id: 'mock-equipment-1', workspaceId: 'mock', resourceType: 'EQUIPMENT', name: 'Kit videoconferencia', email: 'kit-video@empresa.com', location: null, capacity: null, features: ['Cámara', 'Micrófono'], isActive: true, createdAt: '', updatedAt: '' },
];

export const MeetingSchedulingV2Panel: React.FC<{ projectId?: string; onScheduled?: () => void }> = ({ projectId, onScheduled }) => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, users, createNexusObject, reloadObjects } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<ApiMeetingWorkspacePersonV1[]>([]);
  const [resources, setResources] = useState<ApiMeetingResourceV1[]>([]);
  const [capabilities, setCapabilities] = useState<ApiMeetingCapabilitiesV1 | null>(null);
  const [availability, setAvailability] = useState<ApiMeetingResourceAvailabilityV1 | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      title: '', description: '', startAt: localInputValue(start), endAt: localInputValue(end), location: '',
      attendeeUserIds: [] as string[], externalEmails: '', roomId: '', equipmentIds: [] as string[],
      isOnline: true, requestM365Sync: true,
    };
  });

  const mockPeople = useMemo<ApiMeetingWorkspacePersonV1[]>(() => users.map((user, index) => ({
    id: user.id, fullName: user.name, email: user.email, avatarUrl: user.avatar || null, workspaceRole: user.roleName, isCurrentUser: index === 0,
  })), [users]);

  useEffect(() => {
    if (!currentWorkspace) return;
    if (!apiReady) {
      setPeople(mockPeople);
      setResources(MOCK_RESOURCES.map((resource) => ({ ...resource, workspaceId: currentWorkspace.id })));
      setCapabilities({ m365CalendarSyncEnabled: false, meetingCalendarWorkerAvailable: false, m365AvailabilityEnabled: false, teamsOnlineMeetingSupported: true, canonicalStore: 'BRIDATA' });
      return;
    }
    void Promise.all([
      meetingsV1Api.people(tenant.id, currentWorkspace.id),
      meetingResourcesV1Api.list(tenant.id, currentWorkspace.id),
      meetingsV1Api.capabilities(tenant.id),
    ]).then(([peopleResult, resourceResult, capabilityResult]) => {
      setPeople(peopleResult.items);
      setResources(resourceResult.items);
      setCapabilities(capabilityResult);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudo cargar la programación de reuniones.'));
  }, [apiReady, currentWorkspace?.id, mockPeople, tenant.id]);

  useEffect(() => setAvailability(null), [form.attendeeUserIds, form.roomId, form.equipmentIds, form.startAt, form.endAt]);

  const rooms = resources.filter((resource) => resource.resourceType === 'ROOM' && resource.isActive);
  const equipment = resources.filter((resource) => resource.resourceType === 'EQUIPMENT' && resource.isActive);
  const selectedRoom = rooms.find((resource) => resource.id === form.roomId) ?? null;
  const resourceIds = [form.roomId, ...form.equipmentIds].filter(Boolean);
  const externalEmails = [...new Set(form.externalEmails.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean))];
  const selectedPeopleEmails = form.attendeeUserIds.map((id) => people.find((person) => person.id === id)?.email.toLowerCase()).filter((value): value is string => Boolean(value));
  const organizerEmail = people.find((person) => person.isCurrentUser)?.email.toLowerCase() ?? users[0]?.email.toLowerCase() ?? '';
  const peopleCount = new Set([organizerEmail, ...selectedPeopleEmails, ...externalEmails].filter(Boolean)).size;
  const capacityExceeded = Boolean(selectedRoom?.capacity != null && selectedRoom.capacity < peopleCount);
  const needsM365Validation = apiReady && form.requestM365Sync;
  const availabilityUnavailable = needsM365Validation && !capabilities?.m365AvailabilityEnabled;

  const toggleEquipment = (id: string) => setForm((current) => ({
    ...current,
    equipmentIds: current.equipmentIds.includes(id) ? current.equipmentIds.filter((value) => value !== id) : [...current.equipmentIds, id],
  }));

  const checkAvailability = async () => {
    if (!apiReady || !currentWorkspace || !capabilities?.m365AvailabilityEnabled) {
      setError('La consulta real de disponibilidad requiere modo API y M365 Availability habilitado.');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const window = dayWindow(form.startAt);
      const result = await meetingResourcesV1Api.availability(tenant.id, {
        workspaceId: currentWorkspace.id,
        attendeeUserIds: form.attendeeUserIds,
        resourceIds,
        includeOrganizer: true,
        ...window,
        intervalMinutes: 30,
        durationMinutes: durationMinutes(form.startAt, form.endAt),
      });
      setAvailability(result);
    } catch (cause) {
      setAvailability(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo validar disponibilidad.');
    } finally {
      setChecking(false);
    }
  };

  const chooseSlot = (slot: { start: string; end: string }) => {
    setForm((current) => ({ ...current, startAt: localInputValue(new Date(slot.start)), endAt: localInputValue(new Date(slot.end)) }));
    setAvailability(null);
  };

  const schedule = async () => {
    if (!currentWorkspace || !form.title.trim()) return;
    const start = new Date(form.startAt);
    const end = new Date(form.endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start.getTime()) {
      setError('La hora de fin debe ser posterior al inicio.');
      return;
    }
    if (capacityExceeded) {
      setError(`La sala seleccionada no tiene capacidad para ${peopleCount} personas.`);
      return;
    }
    if (availabilityUnavailable) {
      setError('Para enviar a Outlook/Teams, habilita primero la validación M365 de disponibilidad o guarda la reunión como LOCAL_ONLY.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (apiReady) {
        await meetingSchedulingV2Api.schedule(tenant.id, {
          workspaceId: currentWorkspace.id,
          ...(projectId ? { projectId } : {}),
          title: form.title.trim(),
          description: form.description.trim() || null,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          timezone: 'America/Lima',
          location: form.location.trim() || selectedRoom?.location || null,
          isOnline: form.isOnline,
          attendeeUserIds: form.attendeeUserIds,
          externalAttendees: externalEmails.map((email) => ({ email, displayName: email, attendeeType: 'REQUIRED' as const })),
          resourceIds,
          requestM365Sync: form.requestM365Sync,
          validateAvailability: form.requestM365Sync,
        });
        await reloadObjects();
      } else {
        await createNexusObject({
          type: 'MEETING', title: form.title.trim(), description: form.description.trim(), status: 'PLANNING', priority: 'MEDIUM',
          startDate: start.toISOString(), endDate: end.toISOString(), ...(projectId ? { projectId } : {}),
          customFields: { room: selectedRoom?.name ?? null, resources: resourceIds },
        });
      }
      setOpen(false);
      setAvailability(null);
      setForm((current) => ({ ...current, title: '', description: '', location: '', attendeeUserIds: [], externalEmails: '', roomId: '', equipmentIds: [] }));
      onScheduled?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo programar la reunión.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="command-panel overflow-hidden">
      <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-green-700"><Sparkles className="h-4 w-4" /> Programación inteligente V2</div>
          <h2 className="mt-2 text-[18px] font-extrabold text-slate-950">Personas + sala + equipos + Teams en una sola reserva</h2>
          <p className="mt-1 max-w-3xl text-[9px] leading-4 text-slate-500">Valida capacidad y disponibilidad antes de crear la reunión. El servidor vuelve a comprobar el horario antes del commit.</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-black text-white"><Plus className="h-4 w-4" /> Programar reunión</button>
      </div>
      <div className="grid grid-cols-1 border-t border-slate-100 md:grid-cols-3">
        <div className="px-5 py-3"><p className="text-[8px] font-black uppercase text-slate-400">Control</p><p className="mt-1 text-[9px] font-semibold text-slate-700">Capacidad de sala antes de reservar</p></div>
        <div className="border-l border-slate-100 px-5 py-3"><p className="text-[8px] font-black uppercase text-slate-400">Disponibilidad</p><p className="mt-1 text-[9px] font-semibold text-slate-700">Intersección personas + recursos</p></div>
        <div className="border-l border-slate-100 px-5 py-3"><p className="text-[8px] font-black uppercase text-slate-400">Commit</p><p className="mt-1 text-[9px] font-semibold text-slate-700">Reunión + reservas en una transacción</p></div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
          <div className="max-h-[92vh] w-full max-w-[980px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Meeting Scheduling V2</p><h3 className="mt-1 text-[20px] font-extrabold text-slate-950">Programar sin conflictos</h3></div>
              <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500"><X className="h-4 w-4" /></button>
            </div>

            {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[9px] font-semibold text-rose-700">{error}</div>}
            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-3">
                <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Título de la reunión" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold outline-none focus:border-green-500" />
                <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} placeholder="Agenda / objetivo" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[10px] outline-none focus:border-green-500" />
                <MeetingAttendeePickerV1 people={people} selectedIds={form.attendeeUserIds} onChange={(ids) => setForm({ ...form, attendeeUserIds: ids })} />
                <input value={form.externalEmails} onChange={(event) => setForm({ ...form, externalEmails: event.target.value })} placeholder="Invitados externos, separados por coma" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-[8px] font-black uppercase text-slate-400">Inicio<input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold text-slate-700" /></label>
                  <label className="text-[8px] font-black uppercase text-slate-400">Fin<input type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold text-slate-700" /></label>
                </div>
                <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder={selectedRoom?.location ? `Ubicación: ${selectedRoom.location}` : 'Ubicación física (opcional)'} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold" />
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2"><DoorOpen className="h-4 w-4 text-green-700" /><p className="text-[9px] font-black uppercase text-slate-500">Sala</p></div>
                  <select value={form.roomId} onChange={(event) => setForm({ ...form, roomId: event.target.value })} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px] font-semibold"><option value="">Sin sala</option>{rooms.map((roomOption) => <option key={roomOption.id} value={roomOption.id}>{roomOption.name} · {roomOption.capacity ?? '?'} pers.</option>)}</select>
                  <div className={`mt-2 rounded-lg px-2.5 py-2 text-[8px] font-semibold ${capacityExceeded ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600'}`}>{selectedRoom ? `${peopleCount} personas previstas / capacidad ${selectedRoom.capacity ?? 'sin definir'}` : `${peopleCount} personas previstas`}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2"><MonitorUp className="h-4 w-4 text-green-700" /><p className="text-[9px] font-black uppercase text-slate-500">Equipamiento</p></div>
                  <div className="mt-2 space-y-1">{equipment.map((item) => <button key={item.id} type="button" onClick={() => toggleEquipment(item.id)} className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-[8px] font-semibold ${form.equipmentIds.includes(item.id) ? 'border-green-200 bg-green-50 text-green-800' : 'border-slate-200 text-slate-600'}`}><span>{item.name}</span><span>{form.equipmentIds.includes(item.id) ? '✓' : '+'}</span></button>)}</div>
                </div>
                <button type="button" disabled={checking || !apiReady || !capabilities?.m365AvailabilityEnabled} onClick={() => void checkAvailability()} className="flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 text-[9px] font-black text-green-800 disabled:opacity-40"><Clock3 className="h-4 w-4" /> {checking ? 'Consultando...' : 'Buscar horarios comunes'}</button>
                {availability && <div className="rounded-xl border border-slate-200 p-3"><p className="text-[8px] font-black uppercase text-slate-400">Sugerencias</p><div className="mt-2 space-y-1.5">{availability.suggestions.slice(0, 6).map((slot) => <button key={`${slot.start}-${slot.end}`} type="button" onClick={() => chooseSlot(slot)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left hover:border-green-300 hover:bg-green-50"><CheckCircle2 className="h-3.5 w-3.5 text-green-700" /><span className="text-[8px] font-bold text-slate-700">{slotLabel(slot.start, slot.end)}</span></button>)}</div>{!availability.suggestions.length && <p className="mt-2 text-[8px] text-slate-400">Sin franjas comunes en el día consultado.</p>}</div>}
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-[8px] font-semibold text-slate-600"><input type="checkbox" checked={form.isOnline} onChange={(event) => setForm({ ...form, isOnline: event.target.checked })} /> Crear reunión Teams</label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-[8px] font-semibold text-slate-600"><input type="checkbox" checked={form.requestM365Sync} onChange={(event) => setForm({ ...form, requestM365Sync: event.target.checked })} /> Sincronizar Outlook/M365</label>
                {availabilityUnavailable && <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[8px] font-semibold text-amber-700">M365 Availability está deshabilitado. Para evitar conflictos, desactiva sincronización y guarda LOCAL_ONLY o habilita la capacidad.</p>}
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-[8px] font-semibold text-slate-500"><ShieldCheck className="h-4 w-4 text-green-700" /> El servidor vuelve a validar capacidad y disponibilidad antes de crear la reunión.</div>
              <button type="button" disabled={saving || !form.title.trim() || capacityExceeded || availabilityUnavailable} onClick={() => void schedule()} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-green-700 px-5 text-[10px] font-black text-white disabled:opacity-40"><CalendarCheck2 className="h-4 w-4" /> {saving ? 'Programando...' : 'Programar reunión'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
