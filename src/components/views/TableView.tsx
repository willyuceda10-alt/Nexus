import React, { useState } from 'react';
import { Filter, MoreHorizontal, Plus, Search } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import type { ObjectStatus } from '../../types/nexus';

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  PLANNING: 'Planificación',
  IN_PROGRESS: 'En progreso',
  IN_REVIEW: 'En revisión',
  BLOCKED: 'Bloqueado',
  COMPLETED: 'Completado',
  IDENTIFIED: 'Identificado',
  PENDING_APPROVAL: 'Pend. aprobación',
  APPROVED: 'Aprobado',
};

const priorityTone: Record<string, string> = {
  CRITICAL: 'bg-rose-50 text-rose-700 ring-rose-200',
  HIGH: 'bg-amber-50 text-amber-700 ring-amber-200',
  MEDIUM: 'bg-slate-100 text-slate-600 ring-slate-200',
  LOW: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

export const TableView: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { objects, openObjectDrawer, openCreateModal, updateNexusObject } = useNexus();
  const [filterType, setFilterType] = useState('ALL');
  const [filterPriority, setFilterPriority] = useState('ALL');
  const [search, setSearch] = useState('');

  const projectObjects = objects.filter((object) => object.projectId === projectId || object.id === projectId);
  const filtered = projectObjects.filter((object) => {
    if (filterType !== 'ALL' && object.type !== filterType) return false;
    if (filterPriority !== 'ALL' && object.priority !== filterPriority) return false;
    if (search && !object.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[10px] text-slate-400 sm:max-w-[320px]">
            <Search className="h-3.5 w-3.5" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar actividad..."
              className="w-full bg-transparent text-[11px] font-medium text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>

          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <span className="grid h-7 w-7 place-items-center text-slate-400"><Filter className="h-3.5 w-3.5" /></span>
            <select value={filterType} onChange={(event) => setFilterType(event.target.value)} className="h-7 rounded-lg border-0 bg-white px-2 text-[10px] font-semibold text-slate-600 outline-none ring-1 ring-slate-200">
              <option value="ALL">Todos los tipos</option>
              <option value="TASK">Tareas</option>
              <option value="DELIVERABLE">Entregables</option>
              <option value="MILESTONE">Hitos</option>
              <option value="RISK">Riesgos</option>
              <option value="MEETING">Reuniones</option>
              <option value="CHANGE_REQUEST">Cambios</option>
            </select>
            <select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value)} className="h-7 rounded-lg border-0 bg-white px-2 text-[10px] font-semibold text-slate-600 outline-none ring-1 ring-slate-200">
              <option value="ALL">Toda prioridad</option>
              <option value="CRITICAL">Crítica</option>
              <option value="HIGH">Alta</option>
              <option value="MEDIUM">Media</option>
              <option value="LOW">Baja</option>
            </select>
          </div>
        </div>

        <button onClick={() => openCreateModal('TASK')} className="flex h-9 items-center justify-center gap-2 rounded-xl bg-green-700 px-3 text-[10px] font-bold text-white transition hover:bg-green-800">
          <Plus className="h-3.5 w-3.5" /> Agregar
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead className="border-b border-slate-100 bg-slate-50/70">
            <tr className="text-[9px] font-bold uppercase tracking-[0.11em] text-slate-400">
              <th className="px-4 py-3">Objeto</th>
              <th className="px-4 py-3">Actividad</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Prioridad</th>
              <th className="px-4 py-3">Responsable</th>
              <th className="px-4 py-3">Avance</th>
              <th className="px-4 py-3">Fecha fin</th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-[10px] text-slate-400">No hay objetos que coincidan con los filtros.</td></tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.id} className="group transition hover:bg-slate-50/70">
                  <td className="px-4 py-3.5">
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-500">{item.type}</span>
                  </td>
                  <td className="max-w-[330px] px-4 py-3.5">
                    <button onClick={() => openObjectDrawer(item.id)} className="block w-full truncate text-left text-[11px] font-semibold text-slate-900 transition hover:text-green-800">
                      {item.title}
                    </button>
                    {item.description && <p className="mt-1 truncate text-[9px] text-slate-400">{item.description}</p>}
                  </td>
                  <td className="px-4 py-3.5">
                    <select
                      value={item.status}
                      onChange={(event) => void updateNexusObject(item.id, { status: event.target.value as ObjectStatus })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[9px] font-semibold text-slate-600 outline-none transition hover:border-slate-300"
                    >
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold ring-1 ${priorityTone[item.priority] || priorityTone.MEDIUM}`}>{item.priority}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="grid h-6 w-6 place-items-center rounded-lg bg-slate-100 text-[8px] font-bold text-slate-500">{item.ownerName.slice(0, 2).toUpperCase()}</div>
                      <span className="max-w-[150px] truncate text-[10px] font-medium text-slate-600">{item.ownerName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, item.progress)}%` }} /></div>
                      <span className="w-8 text-right text-[9px] font-bold text-slate-600">{item.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[10px] font-medium text-slate-500">{item.endDate || 'Sin fecha'}</td>
                  <td className="px-4 py-3.5 text-right">
                    <button onClick={() => openObjectDrawer(item.id)} className="grid h-7 w-7 place-items-center rounded-lg text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1 text-[9px] font-medium text-slate-400">
        <span>{filtered.length} de {projectObjects.length} objetos</span>
        <span>Los cambios de estado se guardan automáticamente</span>
      </div>
    </div>
  );
};