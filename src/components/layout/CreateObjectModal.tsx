import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { BRAND } from '../../config/brand';
import { useNexus } from '../../context/NexusContext';
import type { ObjectType, Priority } from '../../types/nexus';

const projectChildTypes = new Set<ObjectType>([
  'TASK', 'DELIVERABLE', 'MILESTONE', 'RISK', 'MEETING', 'DECISION',
  'CHANGE_REQUEST', 'DOCUMENT', 'INCIDENT',
]);

type OptionalNumber = number | '';

function parseParticipants(value: string): string[] {
  return [...new Set(
    value
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

export const CreateObjectModal: React.FC = () => {
  const {
    isCreateModalOpen,
    createModalDefaultType,
    closeCreateModal,
    createNexusObject,
    objects,
    selectedProjectId,
    objectDataError,
    isObjectMutationPending,
  } = useNexus();

  const [type, setType] = useState<ObjectType>(createModalDefaultType || 'TASK');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [projectId, setProjectId] = useState('');
  const [portfolioId, setPortfolioId] = useState('');
  const [programId, setProgramId] = useState('');
  const [code, setCode] = useState('');
  const [strategicObjective, setStrategicObjective] = useState('');
  const [probability, setProbability] = useState<OptionalNumber>('');
  const [impact, setImpact] = useState<OptionalNumber>('');
  const [mitigationPlan, setMitigationPlan] = useState('');
  const [riskTargetDate, setRiskTargetDate] = useState('');
  const [costImpact, setCostImpact] = useState<OptionalNumber>('');
  const [timeImpactDays, setTimeImpactDays] = useState<OptionalNumber>('');
  const [changeReason, setChangeReason] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingAgenda, setMeetingAgenda] = useState('');
  const [meetingMinutes, setMeetingMinutes] = useState('');
  const [participantsText, setParticipantsText] = useState('');
  const [decisionJustification, setDecisionJustification] = useState('');
  const [decisionMeetingId, setDecisionMeetingId] = useState('');

  const portfolios = useMemo(() => objects.filter((item) => item.type === 'PORTFOLIO'), [objects]);
  const programs = useMemo(() => objects.filter((item) => item.type === 'PROGRAM'), [objects]);
  const projects = useMemo(() => objects.filter((item) => item.type === 'PROJECT'), [objects]);
  const meetings = useMemo(() => objects.filter((item) => item.type === 'MEETING'), [objects]);
  const programsForPortfolio = useMemo(
    () => programs.filter((program) => !portfolioId || program.portfolioId === portfolioId),
    [programs, portfolioId],
  );
  const meetingsForProject = useMemo(
    () => meetings.filter((meeting) => !projectId || meeting.projectId === projectId),
    [meetings, projectId],
  );

  useEffect(() => {
    if (!isCreateModalOpen) return;
    setType(createModalDefaultType || 'TASK');
    setProjectId(
      selectedProjectId && projects.some((project) => project.id === selectedProjectId)
        ? selectedProjectId
        : projects[0]?.id ?? '',
    );
    setPortfolioId(portfolios[0]?.id ?? '');
    setProgramId('');
    setCode('');
    setStrategicObjective('');
    setProbability('');
    setImpact('');
    setMitigationPlan('');
    setRiskTargetDate('');
    setCostImpact('');
    setTimeImpactDays('');
    setChangeReason('');
    setMeetingDate('');
    setMeetingAgenda('');
    setMeetingMinutes('');
    setParticipantsText('');
    setDecisionJustification('');
    setDecisionMeetingId('');
  }, [isCreateModalOpen, createModalDefaultType, selectedProjectId, projects, portfolios]);

  if (!isCreateModalOpen) return null;

  const needsProject = projectChildTypes.has(type);
  const needsPortfolio = type === 'PROGRAM';
  const hierarchyObject = type === 'PORTFOLIO' || type === 'PROGRAM';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (needsProject && !projectId) || (needsPortfolio && !portfolioId)) return;

    const selectedProgram = programId ? programs.find((program) => program.id === programId) : undefined;
    const resolvedPortfolioId = selectedProgram?.portfolioId ?? (portfolioId || undefined);
    const riskScore = typeof probability === 'number' && typeof impact === 'number'
      ? probability * impact
      : undefined;
    const participants = parseParticipants(participantsText);
    const normalizedMeetingDate = meetingDate ? new Date(meetingDate).toISOString() : undefined;

    try {
      await createNexusObject({
        type,
        title: title.trim(),
        description,
        priority,
        progress: 0,
        ...(needsProject ? { projectId } : {}),
        ...(type === 'PROGRAM' && resolvedPortfolioId ? { portfolioId: resolvedPortfolioId } : {}),
        ...(type === 'PROJECT' && resolvedPortfolioId ? { portfolioId: resolvedPortfolioId } : {}),
        ...(type === 'PROJECT' && programId ? { programId } : {}),
        ...(hierarchyObject && code.trim() ? { code: code.trim().toUpperCase() } : {}),
        ...(hierarchyObject && strategicObjective.trim() ? { strategicObjective: strategicObjective.trim() } : {}),
        status:
          type === 'RISK' ? 'IDENTIFIED'
            : type === 'CHANGE_REQUEST' ? 'PENDING_APPROVAL'
              : type === 'MEETING' ? 'PLANNING'
                : type === 'DECISION' ? 'DRAFT'
                  : ['PORTFOLIO', 'PROGRAM', 'PROJECT'].includes(type) ? 'PLANNING'
                    : 'IN_PROGRESS',
        ...(type === 'RISK' && typeof probability === 'number' ? { probability } : {}),
        ...(type === 'RISK' && typeof impact === 'number' ? { impact } : {}),
        ...(type === 'RISK' && riskScore !== undefined ? { riskScore } : {}),
        ...(type === 'RISK' && mitigationPlan.trim() ? { mitigationPlan: mitigationPlan.trim() } : {}),
        ...(type === 'RISK' && riskTargetDate ? { endDate: riskTargetDate } : {}),
        ...(type === 'CHANGE_REQUEST' && typeof costImpact === 'number' ? { costImpact } : {}),
        ...(type === 'CHANGE_REQUEST' && typeof timeImpactDays === 'number' ? { timeImpactDays } : {}),
        ...(type === 'CHANGE_REQUEST' && changeReason.trim() ? { changeReason: changeReason.trim() } : {}),
        ...(type === 'MEETING' && normalizedMeetingDate ? { meetingDate: normalizedMeetingDate } : {}),
        ...(type === 'MEETING' && meetingAgenda.trim() ? { meetingAgenda: meetingAgenda.trim() } : {}),
        ...(type === 'MEETING' && meetingMinutes.trim() ? { meetingMinutes: meetingMinutes.trim() } : {}),
        ...(type === 'MEETING' && participants.length > 0 ? { participants } : {}),
        ...(type === 'DECISION' && decisionJustification.trim() ? { decisionJustification: decisionJustification.trim() } : {}),
        ...(type === 'DECISION' && decisionMeetingId ? { meetingId: decisionMeetingId } : {}),
      });
      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setCode('');
      setStrategicObjective('');
      closeCreateModal();
    } catch {
      // NexusContext surfaces the normalized API error.
    }
  };

  const submitDisabled = isObjectMutationPending || !title.trim() ||
    (needsProject && !projectId) || (needsPortfolio && !portfolioId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs animate-fade-in">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-green-700" />
            <div><h3 className="text-base font-bold text-slate-900">Crear objeto</h3><p className="text-[10px] text-slate-400">{BRAND.name}</p></div>
          </div>
          <button onClick={closeCreateModal} disabled={isObjectMutationPending} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <Field label="Tipo de objeto">
            <select value={type} onChange={(event) => { setType(event.target.value as ObjectType); setProgramId(''); setDecisionMeetingId(''); }} className="form-control">
              <option value="PORTFOLIO">Portafolio</option><option value="PROGRAM">Programa</option><option value="PROJECT">Proyecto</option>
              <option value="TASK">Tarea</option><option value="DELIVERABLE">Entregable</option><option value="MILESTONE">Hito</option>
              <option value="RISK">Riesgo</option><option value="MEETING">Reunión</option><option value="DECISION">Decisión</option>
              <option value="CHANGE_REQUEST">Solicitud de cambio</option><option value="DOCUMENT">Documento</option><option value="INCIDENT">Incidente</option>
            </select>
          </Field>

          {type === 'PROGRAM' && <Field label="Portafolio"><select value={portfolioId} onChange={(event) => setPortfolioId(event.target.value)} required className="form-control">{portfolios.length === 0 && <option value="">Primero crea un portafolio</option>}{portfolios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>}

          {type === 'PROJECT' && (
            <div className="grid gap-3 rounded-xl border border-green-100 bg-green-50/40 p-3 sm:grid-cols-2">
              <Field label="Portafolio"><select value={portfolioId} onChange={(event) => { setPortfolioId(event.target.value); setProgramId(''); }} className="form-control bg-white"><option value="">Sin portafolio</option>{portfolios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
              <Field label="Programa"><select value={programId} onChange={(event) => setProgramId(event.target.value)} className="form-control bg-white"><option value="">Sin programa</option>{programsForPortfolio.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
            </div>
          )}

          {needsProject && (
            <Field label="Proyecto asociado">
              <select
                value={projectId}
                onChange={(event) => { setProjectId(event.target.value); setDecisionMeetingId(''); }}
                required
                className="form-control"
              >
                {projects.length === 0 && <option value="">No hay proyectos disponibles</option>}
                {projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </Field>
          )}

          <Field label="Título / nombre"><input required maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={type === 'PORTFOLIO' ? 'Ej: Transformación Operativa 2027' : 'Ej: Implementar módulo de costos...'} className="form-control" /></Field>

          {hierarchyObject && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Código"><input maxLength={50} value={code} onChange={(event) => setCode(event.target.value)} placeholder={type === 'PORTFOLIO' ? 'PORT-OPS-27' : 'PRG-DIGITAL'} className="form-control uppercase" /></Field>
              <Field label="Prioridad"><PrioritySelect value={priority} onChange={setPriority} /></Field>
            </div>
          )}

          <Field label="Descripción / contexto"><textarea rows={3} maxLength={20000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe el alcance, resultado esperado o contexto..." className="form-control" /></Field>
          {hierarchyObject && <Field label="Objetivo estratégico"><textarea rows={2} maxLength={2000} value={strategicObjective} onChange={(event) => setStrategicObjective(event.target.value)} placeholder="Resultado estratégico esperado..." className="form-control bg-green-50/30" /></Field>}

          {type === 'RISK' && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-800">Evaluación del riesgo</p>
                <p className="mt-0.5 text-[9px] text-amber-700/75">Déjalo vacío si todavía no existe una evaluación aprobada. Bridata no inventará un score.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Probabilidad (1-5)" value={probability} onChange={setProbability} min={1} max={5} placeholder="Sin evaluar" />
                <NumberField label="Impacto (1-5)" value={impact} onChange={setImpact} min={1} max={5} placeholder="Sin evaluar" />
              </div>
              <Field label="Plan de mitigación"><textarea rows={2} maxLength={4000} value={mitigationPlan} onChange={(event) => setMitigationPlan(event.target.value)} placeholder="Acción concreta para reducir probabilidad o impacto..." className="form-control bg-white" /></Field>
              <Field label="Fecha objetivo de mitigación"><input type="date" value={riskTargetDate} onChange={(event) => setRiskTargetDate(event.target.value)} className="form-control bg-white" /></Field>
            </div>
          )}

          {type === 'CHANGE_REQUEST' && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-700">Impacto declarado</p>
                <p className="mt-0.5 text-[9px] text-slate-500">Costo y plazo son opcionales hasta que exista una estimación. Los campos vacíos se mostrarán como “Sin estimar”.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="Impacto costo" value={costImpact} onChange={setCostImpact} min={0} placeholder="Sin estimar" />
                <NumberField label="Impacto tiempo (días)" value={timeImpactDays} onChange={setTimeImpactDays} min={0} placeholder="Sin estimar" />
              </div>
              <Field label="Motivo del cambio"><textarea rows={2} maxLength={4000} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="Por qué se solicita el cambio y qué necesidad resuelve..." className="form-control bg-white" /></Field>
            </div>
          )}

          {type === 'MEETING' && (
            <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-sky-800">Preparación de la reunión</p>
                <p className="mt-0.5 text-[9px] text-sky-700/75">La agenda y participantes pueden completarse ahora. La minuta puede registrarse después desde el objeto.</p>
              </div>
              <Field label="Fecha y hora"><input type="datetime-local" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} className="form-control bg-white" /></Field>
              <Field label="Agenda"><textarea rows={3} maxLength={6000} value={meetingAgenda} onChange={(event) => setMeetingAgenda(event.target.value)} placeholder="Temas, decisiones requeridas y responsables que deben asistir..." className="form-control bg-white" /></Field>
              <Field label="Participantes"><textarea rows={2} maxLength={3000} value={participantsText} onChange={(event) => setParticipantsText(event.target.value)} placeholder="Ana Torres, Carlos Pérez, Equipo PMO" className="form-control bg-white" /></Field>
              <Field label="Minuta inicial (opcional)"><textarea rows={2} maxLength={10000} value={meetingMinutes} onChange={(event) => setMeetingMinutes(event.target.value)} placeholder="Déjalo vacío si la reunión todavía no se realizó." className="form-control bg-white" /></Field>
            </div>
          )}

          {type === 'DECISION' && (
            <div className="space-y-3 rounded-xl border border-green-200 bg-green-50/40 p-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-green-800">Registro de decisión</p>
                <p className="mt-0.5 text-[9px] text-green-700/75">Una decisión nueva nace como borrador. Vincularla a la reunión de origen mejora la trazabilidad.</p>
              </div>
              <Field label="Reunión de origen">
                <select value={decisionMeetingId} onChange={(event) => setDecisionMeetingId(event.target.value)} className="form-control bg-white">
                  <option value="">Sin reunión vinculada</option>
                  {meetingsForProject.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}
                </select>
              </Field>
              <Field label="Justificación / fundamento"><textarea rows={3} maxLength={8000} value={decisionJustification} onChange={(event) => setDecisionJustification(event.target.value)} placeholder="Qué se decidió, por qué y con qué criterio..." className="form-control bg-white" /></Field>
            </div>
          )}

          {!hierarchyObject && <Field label="Prioridad"><PrioritySelect value={priority} onChange={setPriority} /></Field>}

          {objectDataError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-medium text-rose-700">{objectDataError}</div>}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={closeCreateModal} disabled={isObjectMutationPending} className="rounded-lg px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40">Cancelar</button>
            <button type="submit" disabled={submitDisabled} className="rounded-lg bg-green-700 px-5 py-2 font-semibold text-white shadow-md hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50">{isObjectMutationPending ? 'Guardando…' : 'Guardar objeto'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <div><label className="font-bold uppercase tracking-wider text-slate-400">{label}</label>{children}</div>;

const PrioritySelect: React.FC<{ value: Priority; onChange: (value: Priority) => void }> = ({ value, onChange }) => (
  <select value={value} onChange={(event) => onChange(event.target.value as Priority)} className="form-control"><option value="LOW">Baja</option><option value="MEDIUM">Media</option><option value="HIGH">Alta</option><option value="CRITICAL">Crítica</option></select>
);

const NumberField: React.FC<{
  label: string;
  value: OptionalNumber;
  onChange: (value: OptionalNumber) => void;
  min: number;
  max?: number;
  placeholder?: string;
}> = ({ label, value, onChange, min, max, placeholder }) => (
  <div>
    <label className="font-semibold text-slate-600">{label}</label>
    <input
      type="number"
      min={min}
      {...(max !== undefined ? { max } : {})}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
      className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800"
    />
  </div>
);
