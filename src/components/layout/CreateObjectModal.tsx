import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import type { ObjectType, Priority } from '../../types/nexus';
import { BRAND } from '../../config/brand';

const projectChildTypes = new Set<ObjectType>([
  'TASK',
  'DELIVERABLE',
  'MILESTONE',
  'RISK',
  'MEETING',
  'DECISION',
  'CHANGE_REQUEST',
  'DOCUMENT',
  'INCIDENT',
]);

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
  const [probability, setProbability] = useState(3);
  const [impact, setImpact] = useState(3);
  const [costImpact, setCostImpact] = useState(50000);
  const [timeImpactDays, setTimeImpactDays] = useState(7);

  const portfolios = useMemo(
    () => objects.filter((object) => object.type === 'PORTFOLIO'),
    [objects],
  );
  const programs = useMemo(
    () => objects.filter((object) => object.type === 'PROGRAM'),
    [objects],
  );
  const projects = useMemo(
    () => objects.filter((object) => object.type === 'PROJECT'),
    [objects],
  );
  const programsForPortfolio = useMemo(
    () => programs.filter((program) => !portfolioId || program.portfolioId === portfolioId),
    [portfolioId, programs],
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
  }, [isCreateModalOpen, createModalDefaultType, selectedProjectId, projects, portfolios]);

  useEffect(() => {
    if (!programId) return;
    const program = programs.find((item) => item.id === programId);
    if (!program) {
      setProgramId('');
      return;
    }
    if (program.portfolioId && program.portfolioId !== portfolioId) {
      setPortfolioId(program.portfolioId);
    }
  }, [programId, portfolioId, programs]);

  if (!isCreateModalOpen) return null;

  const needsProject = projectChildTypes.has(type);
  const needsPortfolio = type === 'PROGRAM';
  const hierarchyObject = type === 'PORTFOLIO' || type === 'PROGRAM';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (needsProject && !projectId) return;
    if (needsPortfolio && !portfolioId) return;

    const selectedProgram = programId
      ? programs.find((program) => program.id === programId)
      : undefined;
    const resolvedPortfolioId = selectedProgram?.portfolioId ?? portfolioId || undefined;

    try {
      await createNexusObject({
        type,
        title: title.trim(),
        description,
        priority,
        ...(needsProject ? { projectId } : {}),
        ...(type === 'PROGRAM' && resolvedPortfolioId ? { portfolioId: resolvedPortfolioId } : {}),
        ...(type === 'PROJECT' && resolvedPortfolioId ? { portfolioId: resolvedPortfolioId } : {}),
        ...(type === 'PROJECT' && programId ? { programId } : {}),
        ...(hierarchyObject && code.trim() ? { code: code.trim().toUpperCase() } : {}),
        ...(hierarchyObject && strategicObjective.trim()
          ? { strategicObjective: strategicObjective.trim() }
          : {}),
        status:
          type === 'RISK'
            ? 'IDENTIFIED'
            : type === 'CHANGE_REQUEST'
              ? 'PENDING_APPROVAL'
              : ['PORTFOLIO', 'PROGRAM', 'PROJECT'].includes(type)
                ? 'PLANNING'
                : 'IN_PROGRESS',
        progress: 0,
        ...(type === 'RISK'
          ? {
              probability,
              impact,
              riskScore: probability * impact,
            }
          : {}),
        ...(type === 'CHANGE_REQUEST'
          ? {
              costImpact,
              timeImpactDays,
            }
          : {}),
      });

      setTitle('');
      setDescription('');
      setPriority('MEDIUM');
      setCode('');
      setStrategicObjective('');
      closeCreateModal();
    } catch {
      // NexusContext exposes the normalized API error inside the modal.
    }
  };

  const submitDisabled =
    isObjectMutationPending ||
    !title.trim() ||
    (needsProject && !projectId) ||
    (needsPortfolio && !portfolioId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs animate-fade-in">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Plus className="h-5 w-5 text-green-700" />
            <div>
              <h3 className="text-base font-bold text-slate-900">Crear objeto</h3>
              <p className="text-[10px] font-medium text-slate-400">{BRAND.name}</p>
            </div>
          </div>
          <button
            onClick={closeCreateModal}
            disabled={isObjectMutationPending}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Tipo de objeto</label>
            <select
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as ObjectType;
                setType(nextType);
                if (nextType === 'PORTFOLIO') {
                  setPortfolioId('');
                  setProgramId('');
                }
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold text-slate-800 outline-none focus:border-green-500"
            >
              <option value="PORTFOLIO">Portafolio</option>
              <option value="PROGRAM">Programa</option>
              <option value="PROJECT">Proyecto</option>
              <option value="TASK">Tarea</option>
              <option value="DELIVERABLE">Entregable</option>
              <option value="MILESTONE">Hito</option>
              <option value="RISK">Riesgo</option>
              <option value="MEETING">Reunión</option>
              <option value="DECISION">Decisión</option>
              <option value="CHANGE_REQUEST">Solicitud de cambio</option>
              <option value="DOCUMENT">Documento</option>
              <option value="INCIDENT">Incidente</option>
            </select>
          </div>

          {type === 'PROGRAM' && (
            <div>
              <label className="font-bold uppercase tracking-wider text-slate-400">Portafolio</label>
              <select
                value={portfolioId}
                onChange={(event) => {
                  setPortfolioId(event.target.value);
                  setProgramId('');
                }}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 outline-none focus:border-green-500"
              >
                {portfolios.length === 0 && <option value="">Primero crea un portafolio</option>}
                {portfolios.map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>{portfolio.title}</option>
                ))}
              </select>
            </div>
          )}

          {type === 'PROJECT' && (
            <div className="grid gap-3 rounded-xl border border-green-100 bg-green-50/40 p-3 sm:grid-cols-2">
              <div>
                <label className="font-bold uppercase tracking-wider text-slate-400">Portafolio</label>
                <select
                  value={portfolioId}
                  onChange={(event) => {
                    setPortfolioId(event.target.value);
                    setProgramId('');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-medium text-slate-800 outline-none focus:border-green-500"
                >
                  <option value="">Sin portafolio</option>
                  {portfolios.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>{portfolio.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-bold uppercase tracking-wider text-slate-400">Programa</label>
                <select
                  value={programId}
                  onChange={(event) => setProgramId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-medium text-slate-800 outline-none focus:border-green-500"
                >
                  <option value="">Sin programa</option>
                  {programsForPortfolio.map((program) => (
                    <option key={program.id} value={program.id}>{program.title}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {needsProject && (
            <div>
              <label className="font-bold uppercase tracking-wider text-slate-400">Proyecto asociado</label>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 outline-none focus:border-green-500"
              >
                {projects.length === 0 && <option value="">No hay proyectos disponibles</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Título / nombre</label>
            <input
              type="text"
              required
              maxLength={500}
              placeholder={type === 'PORTFOLIO' ? 'Ej: Transformación Operativa 2027' : 'Ej: Implementar módulo de costos...'}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 outline-none focus:border-green-500"
            />
          </div>

          {hierarchyObject && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="font-bold uppercase tracking-wider text-slate-400">Código</label>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  maxLength={50}
                  placeholder={type === 'PORTFOLIO' ? 'PORT-OPS-27' : 'PRG-DIGITAL'}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold uppercase text-slate-800 outline-none focus:border-green-500"
                />
              </div>
              <div>
                <label className="font-bold uppercase tracking-wider text-slate-400">Prioridad</label>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as Priority)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold text-slate-800 outline-none focus:border-green-500"
                >
                  <option value="LOW">Baja</option>
                  <option value="MEDIUM">Media</option>
                  <option value="HIGH">Alta</option>
                  <option value="CRITICAL">Crítica</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Descripción / contexto</label>
            <textarea
              rows={3}
              maxLength={20000}
              placeholder="Describe el alcance, resultado esperado o contexto..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-800 outline-none focus:border-green-500"
            />
          </div>

          {hierarchyObject && (
            <div>
              <label className="font-bold uppercase tracking-wider text-slate-400">Objetivo estratégico</label>
              <textarea
                rows={2}
                maxLength={2000}
                placeholder="Resultado estratégico que debe producir esta estructura..."
                value={strategicObjective}
                onChange={(event) => setStrategicObjective(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-green-50/30 p-2.5 text-slate-800 outline-none focus:border-green-500"
              />
            </div>
          )}

          {type === 'RISK' && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <div>
                <label className="font-semibold text-slate-600">Probabilidad (1-5)</label>
                <input type="number" min={1} max={5} value={probability} onChange={(event) => setProbability(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800" />
              </div>
              <div>
                <label className="font-semibold text-slate-600">Impacto (1-5)</label>
                <input type="number" min={1} max={5} value={impact} onChange={(event) => setImpact(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800" />
              </div>
            </div>
          )}

          {type === 'CHANGE_REQUEST' && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <div>
                <label className="font-semibold text-slate-600">Impacto costo (USD)</label>
                <input type="number" min={0} value={costImpact} onChange={(event) => setCostImpact(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800" />
              </div>
              <div>
                <label className="font-semibold text-slate-600">Impacto tiempo (días)</label>
                <input type="number" min={0} value={timeImpactDays} onChange={(event) => setTimeImpactDays(Number(event.target.value))} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800" />
              </div>
            </div>
          )}

          {!hierarchyObject && (
            <div>
              <label className="font-bold uppercase tracking-wider text-slate-400">Prioridad</label>
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as Priority)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold text-slate-800 outline-none focus:border-green-500"
              >
                <option value="LOW">Baja</option>
                <option value="MEDIUM">Media</option>
                <option value="HIGH">Alta</option>
                <option value="CRITICAL">Crítica</option>
              </select>
            </div>
          )}

          {objectDataError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-medium text-rose-700">
              {objectDataError}
            </div>
          )}

          <div className="flex justify-end space-x-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={closeCreateModal} disabled={isObjectMutationPending} className="rounded-lg px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              Cancelar
            </button>
            <button type="submit" disabled={submitDisabled} className="rounded-lg bg-green-700 px-5 py-2 font-semibold text-white shadow-md hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-50">
              {isObjectMutationPending ? 'Guardando…' : 'Guardar objeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
