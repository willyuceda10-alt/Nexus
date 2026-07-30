import React, { useState } from 'react';
import { X, Plus, AlertTriangle, FileText, Calendar, ShieldAlert, DollarSign, Layers } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { ObjectType, Priority } from '../../types/nexus';

export const CreateObjectModal: React.FC = () => {
  const {
    isCreateModalOpen,
    createModalDefaultType,
    closeCreateModal,
    createNexusObject,
    objects,
    selectedProjectId,
  } = useNexus();

  const [type, setType] = useState<ObjectType>(createModalDefaultType || 'TASK');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [projectId, setProjectId] = useState<string>(selectedProjectId || 'prj-101');

  // Specialized fields
  const [probability, setProbability] = useState(3);
  const [impact, setImpact] = useState(3);
  const [costImpact, setCostImpact] = useState(50000);
  const [timeImpactDays, setTimeImpactDays] = useState(7);

  if (!isCreateModalOpen) return null;

  const projects = objects.filter((o) => o.type === 'PROJECT');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createNexusObject({
      type,
      title,
      description,
      priority,
      projectId,
      status: type === 'RISK' ? 'IDENTIFIED' : type === 'CHANGE_REQUEST' ? 'PENDING_APPROVAL' : 'IN_PROGRESS',
      progress: 0,
      probability: type === 'RISK' ? probability : undefined,
      impact: type === 'RISK' ? impact : undefined,
      riskScore: type === 'RISK' ? probability * impact : undefined,
      costImpact: type === 'CHANGE_REQUEST' ? costImpact : undefined,
      timeImpactDays: type === 'CHANGE_REQUEST' ? timeImpactDays : undefined,
    });

    closeCreateModal();
    setTitle('');
    setDescription('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center space-x-2">
            <Plus className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Crear Nuevo Objeto Nexus</h3>
          </div>
          <button
            onClick={closeCreateModal}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 text-xs">
          {/* Object Type Selector */}
          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Tipo de Objeto</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ObjectType)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="TASK">Tarea / Entregable</option>
              <option value="RISK">Riesgo / Incidencia</option>
              <option value="MEETING">Reunión / Minuta</option>
              <option value="DECISION">Decisión Estratégica</option>
              <option value="CHANGE_REQUEST">Solicitud de Cambio (CR)</option>
              <option value="DOCUMENT">Documento / Especificación</option>
              <option value="MILESTONE">Hito Clave</option>
              <option value="PROJECT">Nuevo Proyecto</option>
            </select>
          </div>

          {/* Project Context */}
          {type !== 'PROJECT' && (
            <div>
              <label className="font-bold uppercase tracking-wider text-slate-400">Proyecto Asociado</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Title Input */}
          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Título / Nombre</label>
            <input
              type="text"
              required
              placeholder="Ej: Instalar Módulos UPS de Litio..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-medium text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Description Input */}
          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Descripción / Contexto</label>
            <textarea
              rows={2}
              placeholder="Detalles específicos..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Specialized Controls based on type */}
          {type === 'RISK' && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <div>
                <label className="font-semibold text-slate-600 dark:text-slate-400">Probabilidad (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={probability}
                  onChange={(e) => setProbability(parseInt(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-slate-800 font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-600 dark:text-slate-400">Impacto (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={impact}
                  onChange={(e) => setImpact(parseInt(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-slate-800 font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            </div>
          )}

          {type === 'CHANGE_REQUEST' && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900/50 dark:bg-rose-950/20">
              <div>
                <label className="font-semibold text-slate-600 dark:text-slate-400">Impacto Costo (USD)</label>
                <input
                  type="number"
                  value={costImpact}
                  onChange={(e) => setCostImpact(parseInt(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-slate-800 font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-600 dark:text-slate-400">Impacto Tiempo (Días)</label>
                <input
                  type="number"
                  value={timeImpactDays}
                  onChange={(e) => setTimeImpactDays(parseInt(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-slate-800 font-bold dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                />
              </div>
            </div>
          )}

          {/* Priority */}
          <div>
            <label className="font-bold uppercase tracking-wider text-slate-400">Prioridad</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-semibold text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="CRITICAL">Crítica</option>
            </select>
          </div>

          {/* Buttons */}
          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={closeCreateModal}
              className="rounded-lg px-4 py-2 font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-white shadow-md hover:bg-indigo-700"
            >
              Guardar Objeto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
