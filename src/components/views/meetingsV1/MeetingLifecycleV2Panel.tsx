import React, { useEffect, useMemo, useState } from 'react';
import { Ban, CalendarClock, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { meetingLifecycleV2Api } from '../../../api/meetingLifecycleV2Api';
import type { ApiMeetingLifecycleItemV2 } from '../../../api/meetingLifecycleV2Contracts';
import { meetingsV1Api } from '../../../api/meetingsV1Api';
import type { ApiMeetingV1 } from '../../../api/meetingsV1Contracts';
import { useApiBootstrap } from '../../../context/ApiBootstrapContext';
import { useNexus } from '../../../context/NexusContext';

function localInputValue(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function lifecycleBadge(status: ApiMeetingLifecycleItemV2['lifecycleStatus']): string {
  if (status === 'CANCELLED') return 'border-slate-200 bg-slate-100 text-slate-600';
  if (status === 'CANCEL_PENDING') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
}

export const MeetingLifecycleV2Panel: React.FC<{ projectId?: string; onChanged?: () => void }> = ({ projectId, onChanged }) => {
  const apiBootstrap = useApiBootstrap();
  const { tenant, currentWorkspace, objects, reloadObjects } = useNexus();
  const apiReady = apiBootstrap.dataMode === 'api' && apiBootstrap.status === 'ready';
  const [meetings, setMeetings] = useState<ApiMeetingV1[]>([]);
  const [lifecycles, setLifecycles] = useState<ApiMeetingLifecycleItemV2[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<'reschedule' | 'cancel' | null>(null);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mockMeetings = useMemo<ApiMeetingV1[]>(() => objects
    .filter((object) => object.type === 'MEETING' && (!projectId || object.projectId === projectId))
    .map((object) => ({
      id: `mock-${object.id}`,
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
      timezone: 'America/Lima', location: null, isOnline: true, onlineProvider: 'TEAMS', syncStatus: 'LOCAL_ONLY',
      graphEventId: null, joinUrl: null, webLink: null, lastSyncedAt: null, syncError: null, attendees: [],
    })), [objects, projectId]);

  const load = async () => {
    if (!currentWorkspace) return;
    setError(null);
    if (!apiReady) {
      setMeetings(mockMeetings);
      setLifecycles(mockMeetings.map((meeting) => ({
        meetingObjectId: meeting.meetingObjectId,
        lifecycleStatus: meeting.status === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED',
        cancelledAt: null,
        cancellationComment: null,
      })));
      return;
    }
    try {
      const [meetingResult, lifecycleResult] = await Promise.all([
        meetingsV1Api.list(tenant.id, { workspaceId: currentWorkspace.id, ...(projectId ? { projectId } : {}), limit: 200 }),
        meetingLifecycleV2Api.list(tenant.id, currentWorkspace.id, projectId),
      ]);
      setMeetings(meetingResult.items);
      setLifecycles(lifecycleResult.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el ciclo de vida de reuniones.');
    }
  };

  useEffect(() => { void load(); }, [apiReady, currentWorkspace?.id, projectId, mockMeetings]);

  const lifecycleMap = useMemo(() => new Map(lifecycles.map((item) => [item.meetingObjectId, item])), [lifecycles]);
  const upcoming = [...meetings].sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 8);
  const activeMeeting = meetings.find((meeting) => meeting.meetingObjectId === activeId) ?? null;

  const openReschedule = (meeting: ApiMeetingV1) => {
    setActiveId(meeting.meetingObjectId);
    setMode('reschedule');
    setStartAt(localInputValue(meeting.startAt));
    setEndAt(localInputValue(meeting.endAt));
    setComment('');
    setError(null);
  };

  const openCancel = (meeting: ApiMeetingV1) => {
    setActiveId(meeting.meetingObjectId);
    setMode('cancel');
    setComment('');
    setError(null);
  };

  const reschedule = async () => {
    if (!activeMeeting) return;
    if (!apiReady) {
      setError('La reprogramación real requiere modo API; el preview mock solo muestra el flujo.');
      return;
    }
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
      setError('La hora de fin debe ser posterior al inicio.');
      return;
    }
    setSaving(true);
    try {
      await meetingLifecycleV2Api.reschedule(tenant.id, activeMeeting.meetingObjectId, {
        version: activeMeeting.version,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timezone: activeMeeting.timezone,
        location: activeMeeting.location,
        requestM365Sync: Boolean(activeMeeting.graphEventId),
      });
      setMode(null); setActiveId(null);
      await Promise.all([load(), reloadObjects()]);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reprogramar la reunión.');
    } finally { setSaving(false); }
  };

  const cancel = async () => {
    if (!activeMeeting) return;
    if (!apiReady) {
      setError('La cancelación real requiere modo API; el preview mock solo muestra el flujo.');
      return;
    }
    setSaving(true);
    try {
      await meetingLifecycleV2Api.cancel(tenant.id, activeMeeting.meetingObjectId, {
        version: activeMeeting.version,
        comment: comment.trim() || null,
      });
      setMode(null); setActiveId(null);
      await Promise.all([load(), reloadObjects()]);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cancelar la reunión.');
    } finally { setSaving(false); }
  };

  const retryCancel = async (meeting: ApiMeetingV1) => {
    if (!apiReady) return;
    setSaving(true); setError(null);
    try {
      await meetingLifecycleV2Api.retryCancel(tenant.id, meeting.meetingObjectId);
      await load();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reintentar la cancelación.');
    } finally { setSaving(false); }
  };

  return (
    <section className="command-panel overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.14em] text-green-700"><ShieldCheck className="h-4 w-4" /> Meeting Lifecycle V2</div>
          <h2 className="mt-2 text-[18px] font-extrabold text-slate-950">Reprogramar, cancelar y liberar recursos sin perder trazabilidad</h2>
          <p className="mt-1 text-[9px] text-slate-500">Bridata cambia primero el estado canónico; Outlook/Teams se sincroniza de forma asíncrona.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[9px] font-black text-slate-600"><RefreshCw className="h-3.5 w-3.5" /> Actualizar</button>
      </div>
      {error && <div className="mx-5 mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[9px] font-semibold text-rose-700">{error}</div>}
      <div className="grid grid-cols-1 border-t border-slate-100 xl:grid-cols-2">
        {upcoming.map((meeting) => {
          const lifecycle = lifecycleMap.get(meeting.meetingObjectId) ?? { lifecycleStatus: 'SCHEDULED' as const, cancelledAt: null, cancellationComment: null, meetingObjectId: meeting.meetingObjectId };
          const cancellable = lifecycle.lifecycleStatus === 'SCHEDULED';
          return (
            <div key={meeting.meetingObjectId} className="border-b border-r border-slate-100 px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-extrabold text-slate-900">{meeting.title}</p>
                  <p className="mt-1 text-[8px] font-semibold text-slate-400">{formatDate(meeting.startAt)} → {formatDate(meeting.endAt)}</p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[7px] font-black uppercase ${lifecycleBadge(lifecycle.lifecycleStatus)}`}>{lifecycle.lifecycleStatus.replace('_', ' ')}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {cancellable && <button type="button" onClick={() => openReschedule(meeting)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[8px] font-black text-slate-600"><CalendarClock className="h-3.5 w-3.5" /> Reprogramar</button>}
                {cancellable && <button type="button" onClick={() => openCancel(meeting)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-[8px] font-black text-rose-700"><Ban className="h-3.5 w-3.5" /> Cancelar</button>}
                {lifecycle.lifecycleStatus === 'CANCEL_PENDING' && <button type="button" disabled={saving} onClick={() => void retryCancel(meeting)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-[8px] font-black text-amber-700"><RotateCcw className="h-3.5 w-3.5" /> Reintentar M365</button>}
              </div>
              {lifecycle.cancellationComment && <p className="mt-2 text-[8px] text-slate-500">Motivo: {lifecycle.cancellationComment}</p>}
            </div>
          );
        })}
      </div>

      {mode && activeMeeting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setMode(null); }}>
          <div className="w-full max-w-[520px] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <p className="text-[9px] font-black uppercase tracking-[0.12em] text-green-700">{mode === 'reschedule' ? 'Reprogramar reunión' : 'Cancelar reunión'}</p>
            <h3 className="mt-1 text-[18px] font-extrabold text-slate-950">{activeMeeting.title}</h3>
            {mode === 'reschedule' ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-[8px] font-black uppercase text-slate-400">Nuevo inicio<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold" /></label>
                <label className="text-[8px] font-black uppercase text-slate-400">Nuevo fin<input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-[10px] font-semibold" /></label>
                <p className="sm:col-span-2 text-[8px] leading-4 text-slate-500">Si ya existe en Outlook/Teams, el nuevo horario se vuelve a validar. En V2, un cambio que se solape parcialmente con el horario anterior se bloquea para evitar falsos conflictos del propio evento.</p>
              </div>
            ) : (
              <div className="mt-4">
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} placeholder="Motivo de cancelación (opcional)" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[10px] outline-none focus:border-green-500" />
                <p className="mt-2 text-[8px] leading-4 text-slate-500">La sala y el equipamiento se liberan inmediatamente en Bridata. Si existe evento M365, la cancelación se envía después por el worker.</p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setMode(null)} className="h-9 rounded-xl border border-slate-200 px-4 text-[9px] font-black text-slate-600">Cerrar</button>
              <button type="button" disabled={saving} onClick={() => void (mode === 'reschedule' ? reschedule() : cancel())} className={`h-9 rounded-xl px-4 text-[9px] font-black text-white disabled:opacity-40 ${mode === 'cancel' ? 'bg-rose-600' : 'bg-green-700'}`}>{saving ? 'Procesando...' : mode === 'reschedule' ? 'Guardar nuevo horario' : 'Confirmar cancelación'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
