import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  Link2,
  ListChecks,
  Plus,
  Search,
  UsersRound,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import {
  buildMeetingsDecisionsProjection,
  type DecisionExecutionRow,
  type MeetingExecutionRow,
} from '../../domain/meetingsDecisions';
import type { NexusObject } from '../../types/nexus';

type MeetingFilter = 'ACTIVE' | 'TODAY' | 'UPCOMING' | 'PAST' | 'ALL';
type DecisionFilter = 'PENDING' | 'APPROVED' | 'ALL';

const TERMINAL_MEETING_STATUSES = new Set<NexusObject['status']>(['COMPLETED', 'CANCELLED', 'CLOSED']);
const PENDING_DECISION_STATUSES = new Set<NexusObject['status']>(['DRAFT', 'PLANNING', 'IN_PROGRESS', 'IN_REVIEW', 'PENDING_APPROVAL']);

function meetingTimingLabel(meeting: MeetingExecutionRow): string {
  switch (meeting.timing) {
    case 'TODAY': return 'Hoy';
    case 'UPCOMING': return 'Próxima';
    case 'PAST': return 'Pasada';
    default: return 'Sin fecha';
  }
}

function meetingTimingTone(meeting: MeetingExecutionRow): string {
  switch (meeting.timing) {
    case 'TODAY': return 'bg-green-50 text-green-800 ring-green-200';
    case 'UPCOMING': return 'bg-sky-50 text-sky-700 ring-sky-200';
    case 'PAST': return 'bg-slate-100 text-slate-600 ring-slate-200';
    default: return 'bg-amber-50 text-amber-700 ring-amber-200';
  }
}

function statusLabel(status: NexusObject['status']): string {
  const labels: Partial<Record<NexusObject['status'], string>> = {
    DRAFT: 'Borrador',
    PLANNING: 'Planificación',
    IN_PROGRESS: 'En curso',
    IN_REVIEW: 'En revisión',
    BLOCKED: 'Bloqueado',
    COMPLETED: 'Completado',
    CANCELLED: 'Cancelado',
    IDENTIFIED: 'Identificado',
    MITIGATING: 'Mitigando',
    REALIZED: 'Realizado',
    CLOSED: 'Cerrado',
    PENDING_APPROVAL: 'Pendiente aprobación',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
  };
  return labels[status] ?? status;
}

function decisionTone(decision: DecisionExecutionRow): string {
  if (decision.status === 'APPROVED') return 'bg-green-50 text-green-700 ring-green-200';
  if (decision.status === 'REJECTED') return 'bg-rose-50 text-rose-700 ring-rose-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function formatMeetingDate(value: string | undefined): string {
  if (!value) return 'Sin fecha programada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export const MeetingsDecisionsView: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const {
    objects,
    relations,
    openObjectDrawer,
    openCreateModal,
    createNexusObject,
    addRelation,
    updateNexusObject,
    isObjectMutationPending,
  } = useNexus();

  const [search, setSearch] = useState('');
  const [meetingFilter, setMeetingFilter] = useState<MeetingFilter>('ACTIVE');
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('PENDING');
  const [actionMeetingId, setActionMeetingId] = useState<string | null>(null);

  const projection = useMemo(
    () => buildMeetingsDecisionsProjection(objects, relations, new Date().toISOString(), projectId),
    [objects, relations, projectId],
  );

  const filteredMeetings = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return projection.meetings.filter((meeting) => {
      if (meetingFilter === 'ACTIVE' && TERMINAL_MEETING_STATUSES.has(meeting.status)) return false;
      if (meetingFilter === 'TODAY' && meeting.timing !== 'TODAY') return false;
      if (meetingFilter === 'UPCOMING' && meeting.timing !== 'UPCOMING') return false;
      if (meetingFilter === 'PAST' && meeting.timing !== 'PAST') return false;
      if (term && !`${meeting.title} ${meeting.projectName} ${meeting.ownerName} ${meeting.agenda ?? ''} ${meeting.minutes ?? ''} ${meeting.participants.join(' ')}`.toLocaleLowerCase('es').includes(term)) return false;
      return true;
    });
  }, [projection.meetings, meetingFilter, search]);

  const filteredDecisions = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return projection.decisions.filter((decision) => {
      if (decisionFilter === 'PENDING' && !PENDING_DECISION_STATUSES.has(decision.status)) return false;
      if (decisionFilter === 'APPROVED' && decision.status !== 'APPROVED') return false;
      if (term && !`${decision.title} ${decision.projectName} ${decision.ownerName} ${decision.meetingTitle ?? ''} ${decision.justification ?? ''}`.toLocaleLowerCase('es').includes(term)) return false;
      return true;
    });
  }, [projection.decisions, decisionFilter, search]);

  const handleCreateTaskFromMeeting = async (meeting: MeetingExecutionRow) => {
    if (!meeting.projectId || actionMeetingId) return;
    setActionMeetingId(meeting.id);
    try {
      const created = await createNexusObject({
        type: 'TASK',
        projectId: meeting.projectId,
        title: `[Acción] ${meeting.title}`,
        description: `Acción derivada de la reunión “${meeting.title}”. Revisa la minuta y registra el resultado esperado antes de ejecutarla.`,
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        progress: 0,
      });
      addRelation(meeting.id, created.id, 'DERIVED_FROM');
    } finally {
      setActionMeetingId(null);
    }
  };

  const handleCompleteMeeting = async (meeting: MeetingExecutionRow) => {
    if (TERMINAL_MEETING_STATUSES.has(meeting.status)) return;
    await updateNexusObject(meeting.id, { status: 'COMPLETED', progress: 100 });
  };

  return (
    <div className="mx-auto w-full max-w-[1540px] space-y-6 px-6 py-6 lg:px-8">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-green-800 ring-1 ring-green-100">
              Gobierno colaborativo
            </span>
            <span className="text-[11px] font-medium text-slate-400">Reuniones · acuerdos · acciones</span>
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.035em] text-slate-950">Reuniones y decisiones</h1>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">
            Convierte reuniones en decisiones trazables y acciones reales. Bridata enlaza agenda, minuta, acuerdos y tareas sin fabricar identificadores ni duplicar el registro de ejecución.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openCreateModal('MEETING')}
            className="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3.5 py-2.5 text-[11px] font-bold text-green-800 transition hover:bg-green-100"
          >
            <Plus className="h-4 w-4" /> Agendar reunión
          </button>
          <button
            onClick={() => openCreateModal('DECISION')}
            className="inline-flex items-center gap-2 rounded-xl bg-green-700 px-3.5 py-2.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-green-800"
          >
            <Plus className="h-4 w-4" /> Registrar decisión
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <div className="command-kpi-card"><CalendarCheck2 className="h-4 w-4 text-green-700" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.todayMeetingCount}</p><p className="text-[9px] text-slate-500">reuniones hoy</p></div>
        <div className="command-kpi-card"><CalendarClock className="h-4 w-4 text-sky-600" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.upcomingMeetingCount}</p><p className="text-[9px] text-slate-500">próximas reuniones</p></div>
        <div className="command-kpi-card"><ClipboardList className="h-4 w-4 text-amber-600" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.meetingsWithoutAgendaCount}</p><p className="text-[9px] text-slate-500">sin agenda</p></div>
        <div className="command-kpi-card"><FileText className="h-4 w-4 text-amber-600" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.completedWithoutMinutesCount}</p><p className="text-[9px] text-slate-500">sin minuta al cerrar</p></div>
        <div className="command-kpi-card"><ListChecks className="h-4 w-4 text-amber-600" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.pendingDecisionCount}</p><p className="text-[9px] text-slate-500">decisiones pendientes</p></div>
        <div className="command-kpi-card"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.approvedDecisionCount}</p><p className="text-[9px] text-slate-500">decisiones aprobadas</p></div>
        <div className="command-kpi-card"><AlertCircle className="h-4 w-4 text-rose-500" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.orphanDecisionCount}</p><p className="text-[9px] text-slate-500">decisiones sin reunión</p></div>
        <div className="command-kpi-card"><Link2 className="h-4 w-4 text-slate-500" /><p className="mt-3 text-[25px] font-extrabold text-slate-950">{projection.summary.derivedActionCount}</p><p className="text-[9px] text-slate-500">acciones derivadas</p></div>
      </section>

      <section className="command-panel p-4">
        <div className="relative max-w-[560px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar reunión, agenda, participante, decisión o proyecto…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[11px] font-medium text-slate-800 outline-none transition focus:border-green-400 focus:ring-2 focus:ring-green-100"
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <div className="command-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[13px] font-extrabold text-slate-900">Agenda y minutas</h2>
              <p className="mt-0.5 text-[9px] text-slate-400">{filteredMeetings.length} reunión(es) visibles</p>
            </div>
            <select
              value={meetingFilter}
              onChange={(event) => setMeetingFilter(event.target.value as MeetingFilter)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 outline-none focus:border-green-400"
            >
              <option value="ACTIVE">Abiertas / activas</option>
              <option value="TODAY">Hoy</option>
              <option value="UPCOMING">Próximas</option>
              <option value="PAST">Pasadas</option>
              <option value="ALL">Todas</option>
            </select>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredMeetings.map((meeting) => (
              <article key={meeting.id} className="group px-5 py-4 transition hover:bg-slate-50/70">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <button onClick={() => openObjectDrawer(meeting.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ring-1 ${meetingTimingTone(meeting)}`}>{meetingTimingLabel(meeting)}</span>
                      <span className="text-[9px] font-semibold text-slate-400">{statusLabel(meeting.status)}</span>
                      {!meeting.hasAgenda && !TERMINAL_MEETING_STATUSES.has(meeting.status) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-100">Sin agenda</span>}
                      {TERMINAL_MEETING_STATUSES.has(meeting.status) && !meeting.hasMinutes && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700 ring-1 ring-rose-100">Falta minuta</span>}
                    </div>
                    <h3 className="mt-2 text-[12px] font-extrabold text-slate-900 group-hover:text-green-800">{meeting.title}</h3>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-400">
                      <span>{formatMeetingDate(meeting.meetingDate)}</span>
                      <span>{meeting.projectName}</span>
                      <span>Organiza: {meeting.ownerName}</span>
                    </div>

                    {meeting.agenda && <p className="mt-2 line-clamp-2 rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-4 text-slate-600"><strong>Agenda:</strong> {meeting.agenda}</p>}
                    {meeting.minutes && <p className="mt-2 line-clamp-2 rounded-lg bg-green-50/70 px-3 py-2 text-[10px] leading-4 text-green-900"><strong>Minuta:</strong> {meeting.minutes}</p>}

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-slate-500">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1"><UsersRound className="h-3 w-3" /> {meeting.participants.length} participantes</span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1"><ListChecks className="h-3 w-3" /> {meeting.decisionIds.length} decisiones</span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1"><Link2 className="h-3 w-3" /> {meeting.actionIds.length} acciones</span>
                    </div>
                  </button>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {!TERMINAL_MEETING_STATUSES.has(meeting.status) && (
                      <button
                        disabled={isObjectMutationPending}
                        onClick={() => void handleCompleteMeeting(meeting)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-bold text-slate-600 transition hover:border-green-200 hover:text-green-800 disabled:opacity-50"
                      >
                        Marcar realizada
                      </button>
                    )}
                    <button
                      disabled={!meeting.projectId || actionMeetingId !== null || isObjectMutationPending}
                      onClick={() => void handleCreateTaskFromMeeting(meeting)}
                      title={!meeting.projectId ? 'La reunión debe estar asociada a un proyecto' : 'Crear una tarea real vinculada a esta reunión'}
                      className="rounded-lg bg-green-700 px-2.5 py-1.5 text-[9px] font-bold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {actionMeetingId === meeting.id ? 'Creando…' : 'Derivar acción'}
                    </button>
                  </div>
                </div>
              </article>
            ))}

            {filteredMeetings.length === 0 && (
              <div className="px-6 py-12 text-center">
                <CalendarDays className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-3 text-[11px] font-bold text-slate-600">No hay reuniones que coincidan con el filtro.</p>
                <p className="mt-1 text-[9px] text-slate-400">Agenda una nueva reunión o cambia la vista.</p>
              </div>
            )}
          </div>
        </div>

        <div className="command-panel overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[13px] font-extrabold text-slate-900">Registro de decisiones</h2>
              <p className="mt-0.5 text-[9px] text-slate-400">Estado real y reunión de origen cuando existe</p>
            </div>
            <select
              value={decisionFilter}
              onChange={(event) => setDecisionFilter(event.target.value as DecisionFilter)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 outline-none focus:border-green-400"
            >
              <option value="PENDING">Pendientes</option>
              <option value="APPROVED">Aprobadas</option>
              <option value="ALL">Todas</option>
            </select>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredDecisions.map((decision) => (
              <button key={decision.id} onClick={() => openObjectDrawer(decision.id)} className="group block w-full px-5 py-4 text-left transition hover:bg-slate-50/70">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ring-1 ${decisionTone(decision)}`}>{statusLabel(decision.status)}</span>
                      {!decision.meetingId && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold text-rose-700 ring-1 ring-rose-100">Sin reunión vinculada</span>}
                    </div>
                    <h3 className="mt-2 text-[11px] font-extrabold text-slate-900 group-hover:text-green-800">{decision.title}</h3>
                    <p className="mt-1 text-[9px] text-slate-400">{decision.projectName} · Responsable: {decision.ownerName}</p>
                    {decision.meetingTitle && <p className="mt-1.5 text-[9px] font-semibold text-sky-700">Origen: {decision.meetingTitle}</p>}
                    {decision.justification ? (
                      <p className="mt-2 line-clamp-3 text-[10px] leading-4 text-slate-600">{decision.justification}</p>
                    ) : (
                      <p className="mt-2 text-[9px] font-semibold text-amber-600">Sin justificación documentada</p>
                    )}
                    {decision.relatedActionIds.length > 0 && <p className="mt-2 text-[9px] text-slate-400">{decision.relatedActionIds.length} acción(es) vinculada(s)</p>}
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-green-600" />
                </div>
              </button>
            ))}

            {filteredDecisions.length === 0 && (
              <div className="px-6 py-12 text-center">
                <ListChecks className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-3 text-[11px] font-bold text-slate-600">No hay decisiones que coincidan con el filtro.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
