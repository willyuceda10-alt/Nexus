import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckSquare2,
  ChevronDown,
  Command,
  Menu,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { ApiStatusBadge } from '../system/ApiStatusBadge';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';

export interface HeaderProps {
  onOpenMobileSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenMobileSidebar }) => {
  const apiBootstrap = useApiBootstrap();
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
  const workspaceRole = useMemo(() => {
    if (!currentWorkspace || !apiBootstrap.bootstrap) return currentUser.roleName;
    return apiBootstrap.bootstrap.workspaces.find((workspace) => workspace.id === currentWorkspace.id)?.role
      ?.replaceAll('_', ' ') ?? currentUser.roleName;
  }, [apiBootstrap.bootstrap, currentUser.roleName, currentWorkspace]);

  const pageTitle = (() => {
    switch (activeTab) {
      case 'home': return 'Inicio';
      case 'pmo': return 'Control PMO';
      case 'project': return selectedProject?.title || 'Proyecto';
      case 'projects': return 'Proyectos';
      case 'boards': return 'Tableros';
      case 'calendar': return 'Calendario y Timeline';
      case 'portfolios': return 'Portafolios';
      case 'resources': return 'Recursos';
      case 'materials': return 'Materiales';
      case 'sap': return 'Centro SAP';
      case 'procurement': return 'Compras / Por llegar';
      case 'inventory': return 'Inventario';
      case 'costs': return 'Costos';
      case 'integrations': return 'Integraciones';
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

  const sessionTenants = apiBootstrap.session?.tenants ?? [];
  const canSwitchTenant = apiBootstrap.dataMode === 'api' && sessionTenants.length > 1;

  return (
    <header className="relative z-30 flex h-[58px] flex-none items-center justify-between border-b border-slate-200 bg-white px-2.5 sm:px-4 lg:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onOpenMobileSidebar}
          className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 md:hidden"
          aria-label="Abrir navegación"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="relative hidden md:block">
          <button
            onClick={() => setWorkspaceOpen((open) => !open)}
            className="flex h-9 max-w-[250px] items-center gap-2 rounded-lg px-2.5 text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-expanded={workspaceOpen}
            aria-haspopup="menu"
          >
            <Building2 className="h-4 w-4 flex-none text-[#07883F]" />
            <span className="truncate text-xs font-semibold">{currentWorkspace?.name || 'Workspace'}</span>
            <ChevronDown className="h-3.5 w-3.5 flex-none text-slate-400" />
          </button>

          {workspaceOpen && (
            <div className="absolute left-0 top-11 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_48px_rgba(15,23,42,0.14)]" role="menu">
              {canSwitchTenant && (
                <section className="mb-2 border-b border-slate-100 pb-2">
                  <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">Organización</p>
                  {sessionTenants.map((sessionTenant) => {
                    const active = apiBootstrap.bootstrap?.tenant.id === sessionTenant.id;
                    return (
                      <button
                        key={sessionTenant.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setWorkspaceOpen(false);
                          if (!active) void apiBootstrap.selectTenant(sessionTenant.id);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition ${active ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-slate-900">{sessionTenant.name}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-slate-400">Rol tenant · {sessionTenant.role.replaceAll('_', ' ')}</span>
                        </span>
                        {active && <Check className="h-4 w-4 flex-none text-[#07883F]" />}
                      </button>
                    );
                  })}
                </section>
              )}

              <div className="px-2.5 pb-2 pt-1">
                <p className="text-xs font-semibold text-slate-500">Cambiar espacio de trabajo</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">{tenant.name}</p>
              </div>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCurrentWorkspaceId(workspace.id);
                    setWorkspaceOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2.5 text-left transition ${currentWorkspace?.id === workspace.id ? 'bg-green-50' : 'hover:bg-slate-50'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-slate-900">{workspace.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">{workspace.organizationName}</span>
                  </span>
                  {currentWorkspace?.id === workspace.id && <Check className="h-4 w-4 text-[#07883F]" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hidden h-5 w-px bg-slate-200 md:block" />
        <p className="max-w-[190px] truncate px-1 text-sm font-semibold text-slate-900 sm:max-w-[260px]">{pageTitle}</p>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          onClick={() => setIsCommandPaletteOpen(true)}
          className="hidden h-9 min-w-[300px] items-center gap-2 rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 text-left text-xs text-slate-400 transition hover:border-slate-300 hover:bg-white lg:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1">Buscar en Bridata</span>
          <span className="flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-slate-200"><Command className="h-2.5 w-2.5" />K</span>
        </button>

        <div className="hidden sm:block"><ApiStatusBadge /></div>

        <button
          onClick={() => setActiveTab('inbox')}
          className={`grid h-9 w-9 place-items-center rounded-lg border transition ${activeTab === 'inbox' ? 'border-green-200 bg-green-50 text-green-700' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
          aria-label="Abrir Mi trabajo"
          title="Mi trabajo"
        >
          <CheckSquare2 className="h-4 w-4" />
        </button>

        <button
          onClick={() => openCreateModal('TASK')}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-[#07883F] px-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#067535] active:scale-[0.98] sm:px-3"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Nuevo</span>
        </button>

        <div className="ml-0.5 flex items-center gap-2 border-l border-slate-200 pl-2 sm:ml-1 sm:pl-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-900 text-[10px] font-black text-white">{userInitials || 'BR'}</div>
          <div className="hidden max-w-[150px] xl:block">
            <p className="truncate text-xs font-semibold text-slate-900">{currentUser.name}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-slate-400"><ShieldCheck className="h-2.5 w-2.5 text-emerald-500" /> {workspaceRole}</p>
          </div>
        </div>
      </div>
    </header>
  );
};
