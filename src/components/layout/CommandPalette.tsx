import React, { useState } from 'react';
import { Search, X, Folder, AlertTriangle, FileText, Plus, ShieldAlert, Sparkles, ArrowRight } from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const CommandPalette: React.FC = () => {
  const {
    isCommandPaletteOpen,
    setIsCommandPaletteOpen,
    objects,
    openObjectDrawer,
    openCreateModal,
    setSelectedProjectId,
    setActiveTab,
  } = useNexus();

  const [query, setQuery] = useState('');

  if (!isCommandPaletteOpen) return null;

  const filteredObjects = objects.filter(
    (o) =>
      o.title.toLowerCase().includes(query.toLowerCase()) ||
      o.description.toLowerCase().includes(query.toLowerCase()) ||
      o.type.toLowerCase().includes(query.toLowerCase()) ||
      o.id.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 backdrop-blur-xs p-4 pt-20 animate-fade-in">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden dark:border-slate-800 dark:bg-slate-900">
        {/* Search Bar */}
        <div className="flex items-center border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <Search className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <input
            type="text"
            autoFocus
            placeholder="Escribe un comando o busca objetos por título, tipo o ID (#prj-101)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ml-3 flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none dark:text-slate-100"
          />
          <kbd className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-slate-400 dark:bg-slate-800">ESC</kbd>
          <button
            onClick={() => setIsCommandPaletteOpen(false)}
            className="ml-2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Command Suggestions */}
        {!query && (
          <div className="border-b border-slate-100 bg-slate-50/50 p-2 text-xs dark:border-slate-800 dark:bg-slate-800/30">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Acciones Rápidas</div>
            <div className="flex flex-wrap gap-2 p-1">
              <button
                onClick={() => {
                  openCreateModal('TASK');
                  setIsCommandPaletteOpen(false);
                }}
                className="flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5 text-indigo-600" />
                <span>+ Nueva Tarea</span>
              </button>
              <button
                onClick={() => {
                  openCreateModal('RISK');
                  setIsCommandPaletteOpen(false);
                }}
                className="flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:border-amber-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                <span>+ Registrar Riesgo</span>
              </button>
              <button
                onClick={() => {
                  setActiveTab('governance');
                  setIsCommandPaletteOpen(false);
                }}
                className="flex items-center space-x-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-indigo-600" />
                <span>Matriz de Riesgos</span>
              </button>
            </div>
          </div>
        )}

        {/* Search Results List */}
        <div className="max-h-80 overflow-y-auto p-2">
          {filteredObjects.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No se encontraron objetos que coincidan con "{query}".
            </div>
          ) : (
            filteredObjects.map((obj) => (
              <div
                key={obj.id}
                onClick={() => {
                  if (obj.type === 'PROJECT') {
                    setSelectedProjectId(obj.id);
                    setActiveTab('project');
                  } else {
                    openObjectDrawer(obj.id);
                  }
                  setIsCommandPaletteOpen(false);
                }}
                className="flex cursor-pointer items-center justify-between rounded-xl p-2.5 text-xs transition hover:bg-indigo-50/70 dark:hover:bg-slate-800"
              >
                <div className="flex items-center space-x-3">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {obj.type}
                  </span>
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{obj.title}</div>
                    <div className="text-[11px] text-slate-400">
                      #{obj.id} | Estado: {obj.status} | Responsable: {obj.ownerName}
                    </div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
