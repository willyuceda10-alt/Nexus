import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarSearch,
  CheckCircle2,
  MapPin,
  Monitor,
  Plus,
  RefreshCw,
  UsersRound,
  X,
} from 'lucide-react';
import { meetingResourcesV1Api } from '../../../api/meetingResourcesV1Api';
import type {
  ApiMeetingResourceAvailabilityV1,
  ApiMeetingResourceTypeV1,
  ApiMeetingResourceV1,
} from '../../../api/meetingResourcesV1Contracts';
import { meetingsV1Api } from '../../../api/meetingsV1Api';
import { useApiBootstrap } from '../../../context/ApiBootstrapContext';
import { useNexus } from '../../../context/NexusContext';

type MeetingChoice = {
  meetingObjectId: string;
  title: string;
  startAt: string;
  endAt: string;
  attendeeUserIds: string[];
};

function workingDayRange(value: string): { startAt: string; endAt: string } {
  const date = new Date(value);
  const start = new Date(date);
  start.setHours(8, 0, 0, 0);
  const end = new Date(date);
  end.setHours(18, 0, 0, 0);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function durationMinutes(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const raw = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 60_000) : 60;
  return Math.max(30, Math.min(480, Math.ceil(raw / 30) * 30));
}

function formatSlot(start: string, end: string): string {
  const day = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: '2-digit', month: 'short' });
  const time = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit' });
  return `${day.format(new Date(start))} · ${time.format(new Date(start))}–${time.format(new Date(end))}`;
}

const mockResources: ApiMeetingResourceV1[] = [
  {
    id: 'mock-room-1', workspaceId: 'mock', resourceType: 'ROOM', name: 'Sala Operaciones',
    email: 'sala-operaciones@example.com', location: 'Oficina principal', capacity: 12,
    features: ['Teams Room', 'Pantalla'], isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
  {
    id: 'mock-equipment-1', workspaceId: 'mock', resourceType: 'EQUIPMENT', name: 'Kit videoconferencia móvil',
    email: 'kit-video@example.com', location: 'TI', capacity: null,
    features: ['Cámara', 'Micrófono'], isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
];

export const MeetingResourcesPanelV1: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, objects } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';

  const [resources, setResources] = useState<ApiMeetingResourceV1[]>([]);
  const [meetings, setMeetings] = useState<MeetingChoice[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([]);
  const [availability, setAvailability] = useState<ApiMeetingResourceAvailabilityV1 | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    resourceType: 'ROOM' as ApiMeetingResourceTypeV1,
    name: '',
    email: '',
    location: '',
    capacity: '8',
    features: '',
  });

  const mockMeetings = useMemo<MeetingChoice[]>(() => objects
    .filter((object) => object.type === 'MEETING' && (!projectId || object.projectId === projectId))
    .map((object) => ({
      meetingObjectId: object.id,
      title: object.title,
      startAt: object.startDate || new Date().toISOString(),
      endAt: object.endDate || object.startDate || new Date().toISOString(),
      attendeeUserIds: [],
    })), [objects, projectId]);

  const load = async () => {
    if (!currentWorkspace) return;
    if (!apiReady) {
      setResources(mockResources.map((resource) => ({ ...resource, workspaceId: currentWorkspace.id })));
      setMeetings(mockMeetings);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [resourceResult, meetingResult] = await Promise.all([
        meetingResourcesV1Api.list(tenant.id, currentWorkspace.id),
        meetingsV1Api.list(tenant.id, {
          workspaceId: currentWorkspace.id,
          ...(projectId ? { projectId } : {}),
          limit: 200,
        }),
      ]);
      setResources(resourceResult.items);
      setMeetings(meetingResult.items.map((meeting) => ({
        meetingObjectId: meeting.meetingObjectId,
        title: meeting.title,
        startAt: meeting.startAt,
        endAt: meeting.endAt,
        attendeeUserIds: meeting.attendees.flatMap((attendee) => attendee.userId ? [attendee.userId] : []),
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar salas y equipos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [apiReady, currentWorkspace?.id, projectId, mockMeetings]);

  useEffect(() => {
    setAvailability(null);
    if (!selectedMeetingId) {
      setSelectedResourceIds([]);
      return;
    }
    if (!apiReady) return;
    void meetingResourcesV1Api.forMeeting(tenant.id, selectedMeetingId)
      .then((result) => setSelectedResourceIds(result.items.map((resource) => resource.id)))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudo leer la reserva actual.'));
  }, [selectedMeetingId, apiReady, tenant.id]);

  const selectedMeeting = meetings.find((meeting) => meeting.meetingObjectId === selectedMeetingId) ?? null;
  const selectedResources = resources.filter((resource) => selectedResourceIds.includes(resource.id));

  const toggleResource = (id: string) => {
    setSelectedResourceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setAvailability(null);
  };

  const checkAvailability = async () => {
    if (!selectedMeeting || !currentWorkspace) return;
    if (!apiReady) {
      setError('La disponibilidad real de salas/equipos requiere modo API con Microsoft 365 habilitado.');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const range = workingDayRange(selectedMeeting.startAt);
      const result = await meetingResourcesV1Api.availability(tenant.id, {
        workspaceId: currentWorkspace.id,
        attendeeUserIds: selectedMeeting.attendeeUserIds,
        resourceIds: selectedResourceIds,
        includeOrganizer: true,
        ...range,
        intervalMinutes: 30,
        durationMinutes: durationMinutes(selectedMeeting.startAt, selectedMeeting.endAt),
      });
      setAvailability(result);
    } catch (cause) {
      setAvailability(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo validar la disponibilidad combinada.');
    } finally {
      setChecking(false);
    }
  };

  const saveBooking = async () => {
    if (!selectedMeeting) return;
    if (!apiReady) {
      setError('La reserva persistente de recursos requiere modo API.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await meetingResourcesV1Api.replaceBooking(tenant.id, selectedMeeting.meetingObjectId, {
        resourceIds: selectedResourceIds,
        requestM365Sync: true,
      });
      setAvailability(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la reserva de recursos.');
    } finally {
      setSaving(false);
    }
  };

  const createResource = async () => {
    if (!currentWorkspace || !form.name.trim() || !form.email.trim()) return;
    if (!apiReady) {
      const resource: ApiMeetingResourceV1 = {
        id: `mock-resource-${Date.now()}`,
        workspaceId: currentWorkspace.id,
        resourceType: form.resourceType,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        location: form.location.trim() || null,
        capacity: form.resourceType === 'ROOM' && Number(form.capacity) > 0 ? Number(form.capacity) : null,
        features: form.features.split(',').map((value) => value.trim()).filter(Boolean),
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setResources((current) => [...current, resource]);
      setCreateOpen(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await meetingResourcesV1Api.create(tenant.id, {
        workspaceId: currentWorkspace.id,
        resourceType: form.resourceType,
        name: form.name.trim(),
        email: form.email.trim(),
        location: form.location.trim() || null,
        capacity: form.resourceType === 'ROOM' && Number(form.capacity) > 0 ? Number(form.capacity) : null,
        features: form.features.split(',').map((value) => value.trim()).filter(Boolean),
        isActive: true,
      });
      setCreateOpen(false);
      setForm({ resourceType: 'ROOM', name: '', email: '', location: '', capacity: '8', features: '' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el recurso.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="command-panel overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-green-700">
            <Building2 className="h-4 w-4" /> Salas y recursos
          </div>
          <h2 className="mt-1 text-[16px] font-extrabold text-slate-950">Reserva coordinada con Outlook</h2>
          <p className="mt-1 text-[9px] text-slate-400">Una sala o equipo se administra una vez y se reserva sobre la reunión canónica de Bridata.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500" aria-label="Actualizar recursos">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setCreateOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[9px] font-black text-white">
            <Plus className="h-4 w-4" /> Nuevo recurso
          </button>
        </div>
      </div>

      {error && <div className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[9px] font-semibold text-rose-700">{error}</div>}

      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <div className="border-b border-slate-100 p-5 xl:border-b-0 xl:border-r">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Catálogo activo</p>
            <span className="text-[8px] font-bold text-slate-400">{resources.length} recursos</span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {resources.map((resource) => {
              const selected = selectedResourceIds.includes(resource.id);
              const Icon = resource.resourceType === 'ROOM' ? Building2 : Monitor;
              return (
                <button
                  key={resource.id}
                  type="button"
                  onClick={() => selectedMeetingId && toggleResource(resource.id)}
                  className={`rounded-xl border p-3 text-left transition ${selected ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white hover:border-slate-300'} ${!selectedMeetingId ? 'cursor-default' : ''}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`grid h-8 w-8 place-items-center rounded-lg ${selected ? 'bg-green-700 text-white' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10px] font-extrabold text-slate-900">{resource.name}</span>
                      <span className="mt-0.5 block truncate text-[8px] text-slate-400">{resource.email}</span>
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[7px] font-black text-slate-500">{resource.resourceType === 'ROOM' ? 'SALA' : 'EQUIPO'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] font-semibold text-slate-500">
                    {resource.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {resource.location}</span>}
                    {resource.capacity && <span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" /> {resource.capacity}</span>}
                  </div>
                  {!!resource.features.length && <p className="mt-2 line-clamp-1 text-[7px] text-slate-400">{resource.features.join(' · ')}</p>}
                </button>
              );
            })}
            {!resources.length && <div className="col-span-full rounded-xl border border-dashed border-slate-200 p-8 text-center text-[9px] text-slate-400">Aún no hay salas ni equipos registrados.</div>}
          </div>
        </div>

        <div className="p-5">
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Reserva rápida</p>
          <select value={selectedMeetingId} onChange={(event) => setSelectedMeetingId(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-700">
            <option value="">Selecciona una reunión…</option>
            {meetings.map((meeting) => <option key={meeting.meetingObjectId} value={meeting.meetingObjectId}>{meeting.title}</option>)}
          </select>

          {selectedMeeting && (
            <div className="mt-3 space-y-3">
              <div className="rounded-xl bg-slate-50 px-3 py-3">
                <p className="text-[9px] font-extrabold text-slate-800">{selectedMeeting.title}</p>
                <p className="mt-1 text-[8px] text-slate-500">{formatSlot(selectedMeeting.startAt, selectedMeeting.endAt)}</p>
                <p className="mt-1 text-[8px] text-slate-400">{selectedResources.length} recursos seleccionados</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button disabled={checking} onClick={() => void checkAvailability()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 text-[8px] font-black text-green-800 disabled:opacity-40">
                  <CalendarSearch className="h-3.5 w-3.5" /> {checking ? 'Consultando…' : 'Validar disponibilidad'}
                </button>
                <button disabled={saving} onClick={() => void saveBooking()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-3 text-[8px] font-black text-white disabled:opacity-40">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {saving ? 'Guardando…' : 'Asignar recursos'}
                </button>
              </div>

              {availability && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-3 text-[8px] font-semibold text-slate-500">
                    <span>{availability.participants.length} calendarios consultados</span>
                    <span>{availability.suggestions.length} franjas compatibles</span>
                  </div>
                  {availability.participants.some((participant) => !participant.resolved) && (
                    <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[8px] font-semibold text-amber-700">Hay calendarios no resueltos; Bridata mantiene el resultado conservador.</p>
                  )}
                  <div className="mt-2 space-y-1.5">
                    {availability.suggestions.slice(0, 5).map((slot) => (
                      <div key={`${slot.start}-${slot.end}`} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-700" />
                        <span className="text-[8px] font-bold text-slate-700">{formatSlot(slot.start, slot.end)}</span>
                      </div>
                    ))}
                    {!availability.suggestions.length && <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[8px] text-slate-400">No existe una franja común en el día consultado.</p>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => event.currentTarget === event.target && setCreateOpen(false)}>
          <div className="w-full max-w-[520px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Recurso de reunión</p>
                <h3 className="mt-1 text-[17px] font-extrabold text-slate-950">Registrar sala o equipamiento</h3>
              </div>
              <button onClick={() => setCreateOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 space-y-3">
              <select value={form.resourceType} onChange={(event) => setForm({ ...form, resourceType: event.target.value as ApiMeetingResourceTypeV1 })} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px] font-bold text-slate-700">
                <option value="ROOM">Sala</option><option value="EQUIPMENT">Equipamiento</option>
              </select>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px] font-semibold" />
              <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Mailbox Exchange del recurso" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px] font-semibold" />
              <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ubicación" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px] font-semibold" />
              {form.resourceType === 'ROOM' && <input type="number" min="1" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} placeholder="Capacidad" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px] font-semibold" />}
              <input value={form.features} onChange={(event) => setForm({ ...form, features: event.target.value })} placeholder="Características separadas por coma" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[9px] font-semibold" />
            </div>
            <button disabled={saving || !form.name.trim() || !form.email.trim()} onClick={() => void createResource()} className="mt-4 h-10 w-full rounded-xl bg-green-700 text-[9px] font-black text-white disabled:opacity-40">Guardar recurso</button>
          </div>
        </div>
      )}
    </section>
  );
};
