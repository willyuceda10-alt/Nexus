import React, { useState } from 'react';
import {
  ListFilter,
  Plus,
  ArrowUpDown,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MoreVertical,
  SlidersHorizontal,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { NexusObject, ObjectStatus, Priority } from '../../types/nexus';

export const TableView: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer, openCreateModal, updateNexusObject } = useNexus();
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterPriority, setFilterPriority] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const projectObjects = objects.filter(
    (o) => o.projectId === projectId || o.id === projectId
  );

  const filtered = projectObjects.filter((o) => {
    if (filterType !== 'ALL' && o.type !== filterType) return false;
    if (filterPriority !== 'ALL' && o.priority !== filterPriority) return false;
    if (search && !o.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs w-60">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filtrar por título..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent outline-none font-medium text-slate-800 placeholder:text-slate-400 w-full"
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none hover:bg-slate-50 transition-colors"
          >
            <option value="ALL">Todos los Tipos</option>
            <option value="TASK">Tareas</option>
            <option value="DELIVERABLE">Entregables</option>
            <option value="MILESTONE">Hitos</option>
            <option value="RISK">Riesgos</option>
            <option value="MEETING">Reuniones</option>
            <option value="CHANGE_REQUEST">Solicitudes Cambio</option>
          </select>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 outline-none hover:bg-slate-50 transition-colors"
          >
            <option value="ALL">Todas las Prioridades</option>
            <option value="CRITICAL">Crítica</option>
            <option value="HIGH">Alta</option>
            <option value="MEDIUM">Media</option>
            <option value="LOW">Baja</option>
          </select>
        </div>

        <button
          onClick={() => openCreateModal('TASK')}
          className="px-3.5 py-1.5 bg-indigo-600 rounded-lg text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 transition-colors flex items-center gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Agregar Fila</span>
        </button>
      </div>

      {/* Smart Data Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="border-b border-slate-100 bg-white text-[10px] font-bold uppercase tracking-wider text-slate-400 sticky top-0 shadow-2xs">
            <tr>
              <th className="py-3.5 px-5 font-bold">Tipo</th>
              <th className="py-3.5 px-5 font-bold">Actividad / Título</th>
              <th className="py-3.5 px-5 font-bold">Estado</th>
              <th className="py-3.5 px-5 font-bold">Prioridad</th>
              <th className="py-3.5 px-5 font-bold">Responsable</th>
              <th className="py-3.5 px-5 font-bold">Progreso</th>
              <th className="py-3.5 px-5 font-bold">Fecha Fin</th>
              <th className="py-3.5 px-5 font-bold text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 text-slate-600">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-slate-400">
                  No hay objetos que coincidan con los filtros aplicados.
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <td className="py-3.5 px-5 font-mono font-bold">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold">
                      {item.type}
                    </span>
                  </td>
                  <td
                    onClick={() => openObjectDrawer(item.id)}
                    className="py-3.5 px-5 font-medium text-slate-900 hover:text-indigo-600 transition-colors"
                  >
                    {item.title}
                  </td>
                  <td className="py-3.5 px-5">
                    <select
                      value={item.status}
                      onChange={(e) => updateNexusObject(item.id, { status: e.target.value as ObjectStatus })}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-bold text-slate-800 outline-none cursor-pointer"
                    >
                      <option value="DRAFT">Borrador</option>
                      <option value="PLANNING">Planificación</option>
                      <option value="IN_PROGRESS">En Progreso</option>
                      <option value="IN_REVIEW">En Revisión</option>
                      <option value="BLOCKED">Bloqueado</option>
                      <option value="COMPLETED">Completado</option>
                      <option value="IDENTIFIED">Identificado</option>
                      <option value="PENDING_APPROVAL">Pendiente Aprobación</option>
                      <option value="APPROVED">Aprobado</option>
                    </select>
                  </td>
                  <td className="py-3.5 px-5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.priority === 'CRITICAL'
                          ? 'bg-red-50 text-red-600'
                          : item.priority === 'HIGH'
                          ? 'bg-amber-50 text-amber-600'
                          : item.priority === 'MEDIUM'
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-emerald-50 text-emerald-600'
                      }`}
                    >
                      {item.priority}
                    </span>
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <img src={item.ownerAvatar} alt="" className="h-5 w-5 rounded-full object-cover border border-slate-200" />
                      <span className="text-slate-800 font-medium">{item.ownerName}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <span className="font-bold text-slate-700 text-[11px]">{item.progress}%</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-5 font-mono text-slate-500">{item.endDate || 'N/A'}</td>
                  <td className="py-3.5 px-5 text-right">
                    <button
                      onClick={() => openObjectDrawer(item.id)}
                      className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
