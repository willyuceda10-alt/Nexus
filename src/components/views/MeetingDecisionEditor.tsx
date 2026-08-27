import React, { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CheckCircle2, FileText, Link2, X } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import type { NexusObject, ObjectStatus } from '../../types/nexus';

function localDateTimeValue(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function parseParticipants(value: string): string[] {
  return [...new Set(
    value
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

const meetingStatuses: Array<{ value: ObjectStatus; label: string }> = [
  { value: 'PLANNING', label: 'Planificación' },
  { value: 'IN_PROGRESS', label: 'En curso' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

const decisionStatuses: Array<{ value: ObjectStatus; label: string }> = [
  { value: 'DRAFT', label: 'Borrador' },
  { value: 'IN_REVIEW', label: 'En revisión' },
  { value: 'PENDING_APPROVAL', label: 'Pendiente aprobación' },
  { value: 'APPROVED', label: 'Aprobada' },
  { value: 'REJECTED', label: 'Rechazada' },
];

export const MeetingDecisionEditor: React.FC<{
  objectId: string | null;
  onClose: () => void;
}> = ({ objectId, onClose }) => {
  const { objects, updateNexusObject, isObjectMutationPending } = useNexus();
  const object = useMemo(
    () => objects.find((item) => item.id === objectId && (item.type === 'MEETING' || item.type === 'DECISION')) ?? null,
    [objects, objectId],
  );

  const [meetingDate, setMeetingDate] = useState('');
  const [agenda, setAgenda] = useState('');
  const [minutes, setMinutes] = useState('');
  const [participants, setParticipants] = useState('');
  const [justification, setJustification] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [status, setStatus] = useState<ObjectStatus>('DRAFT');
  const [error, setError] = useState<string | null>(null);

  const meetingsForProject = useMemo(
    () => objects.filter(
      (item) => item.type === 'MEETING' && (!object?.projectId || item.projectId === object.projectId),
    ),
    [objects, object?.projectId],
  );

  useEffect(() => {
    if (!object) return;
    setError(null);
    setStatus(object.status);
    if (object.type === 'MEETING') {
      setMeetingDate(localDateTimeValue(object.meetingDate ?? object.startDate));
      setAgenda(object.meetingAgenda ?? '');
      setMinutes(object.meetingMinutes ?? '');
      setParticipants((object.participants ?? []).join(', '));
    } else {
      setJustification(object.decisionJustification ?? '');
      setMeetingId(object.meetingId ?? '');
    }
  }, [object?.id]);

  if (!objectId || !object) return null;

  const saveMeeting = async (meeting: NexusObject) => {
    try {
      setError(null);
      const participantList = parseParticipants(participants);
      const normalizedMeetingDate = meetingDate ? new Date(meetingDate).toISOString() : '';
      await updateNexusObject(meeting.id, {
        status,
        meetingDate: normalizedMeetingDate,
        meetingAgenda: agenda.trim(),
        meetingMinutes: minutes.trim(),
        participants: participantList,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la reunión.');
    }
  };

  const saveDecision = async (decision: NexusObject) => {
    try {
      setError(null);
      await updateNexusObject(decision.id, {
        status,
        decisionJustification: justification.trim(),
        meetingId,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la decisión.');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-green-700">
              {object.type === 'MEETING' ? 'Preparación y minuta' : 'Registro de decisión'}
            </p>
            <h2 className="mt-1 text-[15px] font-extrabold text-slate-950">{object.title}</h2>
            <p className="mt-0.5 text-[9px] text-slate-400">{object.projectId ? objects.find((item) => item.id === object.projectId)?.title ?? 'Proyecto' : 'Sin proyecto'}</p>
          </div>
          <button onClick={onClose} disabled={isObjectMutationPending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 disabled:opacity-40" aria-label="Cerrar editor"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto px-5 py-5 text-[11px]">
          <div>
            <label className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Estado</label>
            <select value={status} onChange={(event) => setStatus(event.target.value as ObjectStatus)} className="form-control mt-1">
              {(object.type === 'MEETING' ? meetingStatuses : decisionStatuses).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          {object.type === 'MEETING' ? (
            <>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                <div className="flex items-center gap-2 text-[10px] font-bold text-sky-800"><CalendarClock className="h-4 w-4" /> Fecha y hora</div>
                <input type="datetime-local" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} className="form-control mt-2 bg-white" />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400"><FileText className="h-3.5 w-3.5" /> Agenda</label>
                <textarea rows={4} value={agenda} onChange={(event) => setAgenda(event.target.value)} placeholder="Temas, decisiones requeridas y responsables…" className="form-control mt-1" />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400"><CheckCircle2 className="h-3.5 w-3.5" /> Minuta / acuerdos</label>
                <textarea rows={5} value={minutes} onChange={(event) => setMinutes(event.target.value)} placeholder="Acuerdos, responsables, fechas y decisiones tomadas…" className="form-control mt-1" />
              </div>

              <div>
                <label className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Participantes</label>
                <textarea rows={2} value={participants} onChange={(event) => setParticipants(event.target.value)} placeholder="Separados por coma, punto y coma o línea" className="form-control mt-1" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400"><Link2 className="h-3.5 w-3.5" /> Reunión de origen</label>
                <select value={meetingId} onChange={(event) => setMeetingId(event.target.value)} className="form-control mt-1">
                  <option value="">Sin reunión vinculada</option>
                  {meetingsForProject.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Justificación / fundamento</label>
                <textarea rows={6} value={justification} onChange={(event) => setJustification(event.target.value)} placeholder="Qué se decidió, por qué, bajo qué criterio y qué efecto se espera…" className="form-control mt-1" />
              </div>
            </>
          )}

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[10px] font-semibold text-rose-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} disabled={isObjectMutationPending} className="rounded-lg px-3.5 py-2 text-[10px] font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-40">Cancelar</button>
          <button
            onClick={() => void (object.type === 'MEETING' ? saveMeeting(object) : saveDecision(object))}
            disabled={isObjectMutationPending}
            className="rounded-lg bg-green-700 px-4 py-2 text-[10px] font-bold text-white shadow-sm hover:bg-green-800 disabled:opacity-50"
          >
            {isObjectMutationPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
};
