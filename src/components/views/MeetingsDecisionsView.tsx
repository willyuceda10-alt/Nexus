import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Link2,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { meetingsV1Api } from '../../api/meetingsV1Api';
import type { ApiMeetingCapabilitiesV1, ApiMeetingV1 } from '../../api/meetingsV1Contracts';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { MeetingsMonthCalendarV1 } from './meetingsV1/MeetingsMonthCalendarV1';

function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function syncBadge(status: ApiMeetingV1['syncStatus']): string {
  if (status === 'SYNCED') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'PENDING') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'FAILED') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export const MeetingsDecisionsView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const apiBootstrap = useApiBootstrap();
  const {
    tenant,
    currentWorkspace,
    objects,
    openObjectDrawer,
    createNexusObject,
    addRelation,
    reloadObjects,
  } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';

  const [meetings, setMeetings] = useState<ApiMeetingV1[]>([]);
  const [capabilities, setCapabilities] = useState<ApiMeetingCapabilitiesV1 | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      title: '',
      description: '',
      startAt: localInputValue(start),
      endAt: localInputValue(end),
      location: '',
      attendeeEmails: '',
      isOnline: true,
      requestM365Sync: true,
    };
  });

  const decisions = objects.filter(
    (object) => object.type === 'DECISION' && (!projectId || object.projectId === projectId),
  );

  const mockMeetings = useMemo<ApiMeetingV1[]>(
    () => objects
      .filter((object) => object.type === 'MEETING' && (!projectId || object.projectId === projectId))
      .map((object) => ({
        id: `mock-collaboration-${object.id}`,
        meetingObjectId: object.id,
        workspaceId: object.workspaceId,
        projectId: object.projectId ?? null,
        title: object.title,
        description: object.description || null,
        status: object.status,
        version: object.version ?? 1,
        organizer: { id: object.ownerId, name: object.ownerName || 'Organizador' },
        startAt: object.startDate || new Date().toISOString(),
        endAt: object.endDate || object.startDate || new Date().toISOString(),
        timezone: 'America/Lima',
        location: null,
        isOnline: true,
        onlineProvider: 'TEAMS',
        syncStatus: 'LOCAL_ONLY',
        graphEventId: null,
        joinUrl: null,
        webLink: null,
        lastSyncedAt: null,
        syncError: null,
        attendees: [],
      })),
    [objects, projectId],
  );

  const load = async () => {
    if (!apiReady || !currentWorkspace) {
      setMeetings(mockMeetings);
      setCapabilities({
        m365CalendarSyncEnabled: false,
        meetingCalendarWorkerAvailable: false,
        teamsOnlineMeetingSupported: true,
        canonicalStore: 'BRIDATA',
      });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [meetingResult, capabilityResult] = await Promise.all([
        meetingsV1Api.list(tenant.id, {
          workspaceId: currentWorkspace.id,
          ...(projectId ? { projectId } : {}),
          limit: 200,
        }),
        meetingsV1Api.capabilities(tenant.id),
      ]);
      setMeetings(meetingResult.items);
      setCapabilities(capabilityResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las reuniones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [apiReady, currentWorkspace?.id, projectId, mockMeetings]);

  const createMeeting = async () => {
    if (!currentWorkspace || !form.title.trim()) return;
    const start = new Date(form.startAt);
    const end = new Date(form.endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
      setError('La fecha/hora de fin debe ser igual o posterior al inicio.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (apiReady) {
        const emails = form.attendeeEmails
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        await meetingsV1Api.create(tenant.id, {
          workspaceId: currentWorkspace.id,
          ...(projectId ? { projectId } : {}),
          title: form.title.trim(),
          description: form.description.trim() || null,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          timezone: 'America/Lima',
          location: form.location.trim() || null,
          isOnline: form.isOnline,
          externalAttendees: emails.map((email) => ({
            email,
            displayName: email,
            attendeeType: 'REQUIRED' as const,
          })),
          requestM365Sync: form.requestM365Sync,
        });
        await Promise.all([load(), reloadObjects()]);
      } else {
        await createNexusObject({
          type: 'MEETING',
          title: form.title.trim(),
          description: form.description.trim(),
          status: 'PLANNING',
          priority: 'MEDIUM',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          ...(projectId ? { projectId } : {}),
        });
      }

      setCreateOpen(false);
      setForm((current) => ({
        ...current,
        title: '',
        description: '',
        location: '',
        attendeeEmails: '',
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la reunión.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTaskFromMeeting = async (meeting: ApiMeetingV1) => {
    setSaving(true);
    setError(null);
    try {
      if (apiReady) {
        await meetingsV1Api.deriveTask(tenant.id, meeting.meetingObjectId);
        await reloadObjects();
      } else {
        const created = await createNexusObject({
          type: 'TASK',
          title: `[Acción] ${meeting.title}`,
          description: `Tarea derivada de la reunión ${meeting.title}`,
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          ...(meeting.projectId ? { projectId: meeting.projectId } : {}),
        });
        addRelation(meeting.meetingObjectId, created.id, 'DERIVED_FROM');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo derivar la tarea.');
    } finally {
      setSaving(false);
    }
  };

  const retrySync = async (meeting: ApiMeetingV1) => {
    if (!apiReady) return;
    setSaving(true);
    setError(null);
    try {
      await meetingsV1Api.retrySync(tenant.id, meeting.meetingObjectId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reintentar la sincronización.');
    } finally {
      setSaving(false);
    }
  };

  const now = Date.now();
  const upcoming = [...meetings]
    .filter((meeting) => new Date(meeting.endAt).getTime() >= now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  return (
    <div className="mx-auto w-full max-w-[1540px] space-y-4 px-5 py-5 lg:px-7">
      <section className="command-panel overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-green-700">
              <CalendarDays className="h-4 w-4" /> Colaboración
            </div>
            <h1 className="mt-2 text-[23px] font-extrabold tracking-tight text-slate-950">Reuniones, Teams & decisiones</h1>
            <p className="mt-1 text-[10px] text-slate-400">Bridata conserva la reunión; Outlook y Teams son canales sincronizados.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500" aria-label="Actualizar reuniones">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => setCreateOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-xl bg-green-700 px-4 text-[10px] font-black text-white">
              <Plus className="h-4 w-4" /> Agendar reunión
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 border-t border-slate-100 md:grid-cols-4">
          <div className="border-r border-slate-100 px-5 py-4">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Reuniones</p>
            <p className="mt-1 text-[20px] font-extrabold text-slate-950">{meetings.length}</p>
          </div>
          <div className="border-r border-slate-100 px-5 py-4">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Teams sincronizadas</p>
            <p className="mt-1 text-[20px] font-extrabold text-emerald-700">{meetings.filter((meeting) => meeting.syncStatus === 'SYNCED' && meeting.joinUrl).length}</p>
          </div>
          <div className="border-r border-slate-100 px-5 py-4">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Pendientes M365</p>
            <p className="mt-1 text-[20px] font-extrabold text-amber-600">{meetings.filter((meeting) => meeting.syncStatus === 'PENDING').length}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">Decisiones</p>
            <p className="mt-1 text-[20px] font-extrabold text-slate-950">{decisions.length}</p>
          </div>
        </div>
      </section>

      {capabilities && (
        <div className={`rounded-xl border px-4 py-3 text-[9px] font-semibold ${capabilities.m365CalendarSyncEnabled && capabilities.meetingCalendarWorkerAvailable ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-500'}`}>
          {capabilities.m365CalendarSyncEnabled && capabilities.meetingCalendarWorkerAvailable
            ? 'Microsoft 365 Calendar Sync disponible: las reuniones pueden crear eventos Outlook con enlace de Microsoft Teams.'
            : 'Microsoft 365 Calendar Sync está preparado pero deshabilitado. Las reuniones se guardan LOCAL_ONLY y siguen funcionando dentro de Bridata.'}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[10px] font-semibold text-rose-700">{error}</div>
      )}

      <MeetingsMonthCalendarV1
        meetings={meetings}
        onOpen={openObjectDrawer}
        onJoinTeams={openExternal}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <section className="command-panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Agenda</p>
              <h2 className="mt-1 text-[14px] font-extrabold text-slate-900">Próximas reuniones</h2>
            </div>
            <Video className="h-4 w-4 text-green-700" />
          </div>
          <div className="space-y-2">
            {upcoming.map((meeting) => (
              <article key={meeting.id} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-green-200">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => openObjectDrawer(meeting.meetingObjectId)} className="truncate text-left text-[12px] font-extrabold text-slate-950 hover:text-green-700">
                        {meeting.title}
                      </button>
                      <span className={`rounded-full border px-2 py-0.5 text-[8px] font-black ${syncBadge(meeting.syncStatus)}`}>
                        {meeting.syncStatus.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-semibold text-slate-500">
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" /> {formatDate(meeting.startAt)}</span>
                      {meeting.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {meeting.location}</span>}
                      <span className="inline-flex items-center gap-1"><UsersRound className="h-3 w-3" /> {meeting.attendees.length} asistentes</span>
                    </div>
                    {meeting.description && <p className="mt-2 line-clamp-2 text-[9px] leading-4 text-slate-500">{meeting.description}</p>}
                    {meeting.syncError && <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[8px] font-semibold text-rose-600">{meeting.syncError}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {meeting.joinUrl && (
                      <button onClick={() => openExternal(meeting.joinUrl!)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-green-700 px-3 text-[9px] font-black text-white">
                        <Video className="h-3.5 w-3.5" /> Unirse a Teams
                      </button>
                    )}
                    {meeting.webLink && (
                      <button onClick={() => openExternal(meeting.webLink!)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500" title="Abrir en Outlook">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {meeting.syncStatus === 'FAILED' && apiReady && capabilities?.m365CalendarSyncEnabled && capabilities.meetingCalendarWorkerAvailable && (
                      <button onClick={() => void retrySync(meeting)} className="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 text-rose-600" title="Reintentar sincronización">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => void handleCreateTaskFromMeeting(meeting)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[9px] font-bold text-slate-700">
                      <Link2 className="h-3.5 w-3.5" /> Derivar tarea
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {!upcoming.length && (
              <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-[10px] text-slate-400">Sin próximas reuniones.</div>
            )}
          </div>
        </section>

        <section className="command-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-700" />
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Gobierno</p>
              <h2 className="mt-1 text-[14px] font-extrabold text-slate-900">Decisiones registradas</h2>
            </div>
          </div>
          <div className="space-y-2">
            {decisions.map((decision) => (
              <button key={decision.id} onClick={() => openObjectDrawer(decision.id)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-green-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-bold text-slate-900">{decision.title}</span>
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[8px] font-black text-green-700">DECISIÓN</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[9px] text-slate-500">{decision.description || 'Sin detalle registrado.'}</p>
              </button>
            ))}
            {!decisions.length && (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-[10px] text-slate-400">Sin decisiones registradas.</div>
            )}
          </div>
        </section>
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCreateOpen(false);
          }}
        >
          <div className="w-full max-w-[620px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-green-700">Nueva reunión</p>
                <h3 className="mt-1 text-[18px] font-extrabold text-slate-950">Agenda Bridata + Outlook/Teams</h3>
              </div>
              <button onClick={() => setCreateOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Título de la reunión" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold outline-none focus:border-green-500" />
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} placeholder="Agenda / objetivo" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[10px] outline-none focus:border-green-500" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">
                  Inicio
                  <input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold text-slate-700" />
                </label>
                <label className="text-[8px] font-black uppercase tracking-[0.1em] text-slate-400">
                  Fin
                  <input type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold text-slate-700" />
                </label>
              </div>
              <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ubicación física (opcional)" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold outline-none focus:border-green-500" />
              <input value={form.attendeeEmails} onChange={(event) => setForm({ ...form, attendeeEmails: event.target.value })} placeholder="Correos de participantes, separados por coma" className="h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold outline-none focus:border-green-500" />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-[9px] font-semibold text-slate-600">
                  <input type="checkbox" checked={form.isOnline} onChange={(event) => setForm({ ...form, isOnline: event.target.checked })} />
                  Crear reunión de Microsoft Teams
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-[9px] font-semibold text-slate-600">
                  <input type="checkbox" checked={form.requestM365Sync} onChange={(event) => setForm({ ...form, requestM365Sync: event.target.checked })} />
                  Sincronizar con Outlook/M365
                </label>
              </div>
              {apiReady && capabilities && !(capabilities.m365CalendarSyncEnabled && capabilities.meetingCalendarWorkerAvailable) && form.requestM365Sync && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[8px] font-semibold text-amber-700">La reunión se guardará en Bridata como LOCAL_ONLY porque M365 está deshabilitado. Podrás sincronizarla cuando el worker esté disponible.</p>
              )}
            </div>

            <button disabled={saving || !form.title.trim() || !form.startAt || !form.endAt} onClick={() => void createMeeting()} className="mt-5 h-10 w-full rounded-xl bg-green-700 text-[10px] font-black text-white disabled:opacity-40">
              {saving ? 'Guardando...' : 'Agendar reunión'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
