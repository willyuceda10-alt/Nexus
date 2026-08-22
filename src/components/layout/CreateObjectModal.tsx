import React, { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { ObjectType, Priority } from '../../types/nexus';
import { BRAND } from '../../config/brand';

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
  const [projectId, setProjectId] = useState<string>('');
  const [probability, setProbability] = useState(3);
  const [impact, setImpact] = useState(3);
  const [costImpact, setCostImpact] = useState(50000);
  const [timeImpactDays, setTimeImpactDays] = useState(7);

  const projects = objects.filter((object) => object.type === 'PROJECT');

  useEffect(() => {
    if (!isCreateModalOpen) return;
    setType(createModalDefaultType || 'TASK');
    setProjectId(
      selectedProjectId && projects.some((project) => project.id === selectedProjectId)
        ? selectedProjectId
        : projects[0]?.id ?? '',
    );
  }, [isCreateModalOpen, createModalDefaultType, selectedProjectId, projects]);

  if (!isCreateModalOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    if (type !== 'PROJECT' && !projectId) return;

    try {
      await createNexusObject({
        type,
        title: title.trim(),
        description,
        priority,
        ...(type !== 'PROJECT' ? { projectId } : {}),
        status:
          type === 'RISK'
            ? 'IDENTIFIED'
            : type === 'CHANGE_REQUEST'
              ? 'PENDING_APPROVAL'
              : type === 'PROJECT'
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
      closeCreateModal();
    } catch {
      // NexusContext exposes the normalized API error inside the modal.
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center space-x-2">
            <Plus className="h-5 w-5 text-indigo-600" />
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
              onChange={(event) => setType(event.target.value as ObjectType)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold text-slate-800 outline-none focus:border-indigo-500"
            >
              <option value="TASK">Tarea</option>
              <option value="DELIVERABLE">Entregable</option>
              <option value="MILESTONE">Hito</option>
              <option value="RISK">Riesgo</option>
              <option value="MEETING">Reunión</option>
              <option value="DECISION">Decisión</option>
              <option value="CHANGE_REQUEST">Solicitud de cambio</option>
              <option value="DOCUMENT">Documento</option>
              <option value="PROJECT">Nuevo proyecto</option>
            </select>
          </div>

          {type !== 'PROJECT' && (
            <div>
              <label className="font-bold uppercase tracking-wider text-slate-400">Proyecto asociado</label>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 outline-none focus:border-indigo-500"
              >
                {projects.length === 0 && <option value="">No hay proyectos disponibles</option>}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
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
              placeholder="Ej: Implementar módulo de costos..."
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Descripción / contexto</label>
            <textarea
              rows={3}
              maxLength={20000}
              placeholder="Describe el alcance, resultado esperado o contexto..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-800 outline-none focus:border-indigo-500"
            />
          </div>

          {type === 'RISK' && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <div>
                <label className="font-semibold text-slate-600">Probabilidad (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={probability}
                  onChange={(event) => setProbability(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-600">Impacto (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={impact}
                  onChange={(event) => setImpact(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800"
                />
              </div>
            </div>
          )}

          {type === 'CHANGE_REQUEST' && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <div>
                <label className="font-semibold text-slate-600">Impacto costo (USD)</label>
                <input
                  type="number"
                  min={0}
                  value={costImpact}
                  onChange={(event) => setCostImpact(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-600">Impacto tiempo (días)</label>
                <input
                  type="number"
                  min={0}
                  value={timeImpactDays}
                  onChange={(event) => setTimeImpactDays(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 font-bold text-slate-800"
                />
              </div>
            </div>
          )}

          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Prioridad</label>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold text-slate-800 outline-none focus:border-indigo-500"
            >
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="CRITICAL">Crítica</option>
            </select>
          </div>

          {objectDataError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-medium text-rose-700">
              {objectDataError}
            </div>
          )}

          <div className="flex justify-end space-x-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={closeCreateModal}
              disabled={isObjectMutationPending}
              className="rounded-lg px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isObjectMutationPending || !title.trim() || (type !== 'PROJECT' && !projectId)}
              className="rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-white shadow-md hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isObjectMutationPending ? 'Guardando…' : 'Guardar objeto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
