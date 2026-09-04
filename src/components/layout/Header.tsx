import React, { useState } from 'react';
import {
  Building2,
  Check,
  CheckSquare2,
  ChevronDown,
  ChevronRight,
  Command,
  Plus,
  Search,
  Menu,
  ShieldCheck,
} from 'lucide-react';
import { ApiStatusBadge } from '../system/ApiStatusBadge';
import { useNexus } from '../../context/NexusContext';
import { prefetchCommandPalette, prefetchCreateModal, prefetchView } from '../../prefetch';

interface HeaderProps {
  onOpenNavigation: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenNavigation,
}) => {
  const {
    tenant,
    workspaces,
    currentWorkspace,
    setCurrentWorkspaceId,
    currentUser,
    setIsCommandPaletteOpen,
    openCreateModal,
    activeTab,
    setActiveTab,
    selectedProjectId,
    objects,
  } = useNexus();

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const selectedProject = objects.find((object) => object.id === selectedProjectId && object.type === 'PROJECT');

  const pageTitle = (() => {
    switch (activeTab) {
      case 'home': return 'Centro de mando';
      case 'project': return selectedProject?.title || 'Proyecto';
      case 'projects': return 'Proyectos';
      case 'boards': return 'Tableros';
      case 'portfolios': return 'Portafolios';
      case 'resources': return 'Recursos';
      case 'materials': return 'Materiales';
      case 'costs': return 'Costos';
      case 'automations': return 'Automatizaciones';
      case 'governance': return 'Riesgos y cambios';
      case 'meetings': return 'Reuniones';
      case 'documents': return 'Documentos';
      case 'timeline': return 'Plan maestro';
      case 'reports': return 'Analítica';
      case 'settings': return 'Configuración';
      case 'inbox': return 'Mi trabajo';
      default: return 'Bridata';
    }
  })();

  const userInitials = currentUser.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <header className="relative z-30 flex h-[68px] flex-none items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-6">
      <div className="flex min-w-0 items-center gap-3 lg:gap-4">
        <button
          type="button"
          onClick={onOpenNavigation}
          className="
            grid
            h-10
            w-10
            flex-none
            place-items-center
            rounded-xl
            border
            border-slate-200
            bg-white
            text-slate-600
            transition
            hover:bg-slate-50
            hover:text-slate-950
            focus-visible:outline-none
            focus-visible:ring-2
            focus-visible:ring-green-600
            focus-visible:ring-offset-2
            lg:hidden
          "
          aria-label="Abrir navegación"
          aria-controls="bridata-primary-navigation"
        >
          <Menu
            className="h-4 w-4"
            aria-hidden="true"
          />
        </button>

        <div className="hidden min-w-0 items-center gap-1.5 text-[10px] font-semibold text-slate-400 md:flex">
          <span className="max-w-[130px] truncate">{tenant.name}</span>
          <ChevronRight className="h-3 w-3 flex-none" />
          <div className="relative">
            <button onClick={() => setWorkspaceOpen((open) => !open)} className="flex max-w-[190px] items-center gap-1.5 rounded-lg px-2 py-1.5 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">
              <Building2 className="h-3.5 w-3.5 flex-none text-green-700" />
              <span className="truncate">{currentWorkspace?.name || 'Workspace'}</span>
              <ChevronDown className="h-3 w-3 flex-none text-slate-400" />
            </button>

            {workspaceOpen && (
              <div className="absolute left-0 top-10 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_60px_rgba(15,23,42,0.14)]">
                <div className="px-3 pb-2 pt-1"><p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Cambiar workspace</p></div>
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    onClick={() => {
                      setCurrentWorkspaceId(workspace.id);
                      setWorkspaceOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition ${currentWorkspace?.id === workspace.id ? 'bg-green-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0"><span className="block truncate text-[11px] font-bold text-slate-900">{workspace.name}</span><span className="mt-0.5 block truncate text-[9px] text-slate-400">{workspace.organizationName}</span></span>
                    {currentWorkspace?.id === workspace.id && <Check className="h-4 w-4 text-green-700" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <ChevronRight className="h-3 w-3 flex-none" />
          <span className="max-w-[220px] truncate font-bold text-slate-800">{pageTitle}</span>
        </div>

        <div className="md:hidden"><p className="truncate text-[13px] font-bold text-slate-900">{pageTitle}</p></div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setIsCommandPaletteOpen(true)}
          onPointerEnter={prefetchCommandPalette}
          className="hidden min-w-[280px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-left text-[10px] text-slate-400 transition hover:border-slate-300 hover:bg-white lg:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1">Buscar en Bridata...</span>
          <span className="flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[8px] font-bold text-slate-400 ring-1 ring-slate-200"><Command className="h-2.5 w-2.5" />K</span>
        </button>

        <ApiStatusBadge />

        <button
          onClick={() => setActiveTab('inbox')}
          onPointerEnter={() => prefetchView('inbox')}
          className={`relative grid h-9 w-9 place-items-center rounded-xl border transition ${activeTab === 'inbox' ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
          aria-label="Abrir Mi trabajo"
          title="Mi trabajo"
        >
          <CheckSquare2 className="h-4 w-4" />
        </button>

        <button
          onClick={() => openCreateModal('TASK')}
          onPointerEnter={prefetchCreateModal}
          className="flex h-9 items-center gap-2 rounded-xl bg-green-700 px-3.5 text-[10px] font-bold text-white shadow-[0_6px_16px_rgba(21,128,61,0.2)] transition hover:bg-green-800 active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Crear</span>
        </button>

        <div className="ml-1 hidden items-center gap-2.5 border-l border-slate-200 pl-3 sm:flex">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-[9px] font-black text-white">{userInitials || 'BR'}</div>
          <div className="hidden max-w-[140px] xl:block">
            <p className="truncate text-[10px] font-bold text-slate-900">{currentUser.name}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[8px] font-semibold text-slate-400"><ShieldCheck className="h-2.5 w-2.5 text-emerald-500" /> {currentUser.roleName}</p>
          </div>
        </div>
      </div>
    </header>
  );
};
