import React, { useState } from 'react';
import {
  Search,
  Plus,
  Bell,
  Command,
  Building,
  ChevronDown,
  UserCheck,
  Shield,
  Layers,
  Sparkles,
  Check,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

export const Header: React.FC = () => {
  const {
    tenant,
    workspaces,
    currentWorkspace,
    setCurrentWorkspaceId,
    users,
    currentUser,
    setCurrentUserId,
    setIsCommandPaletteOpen,
    openCreateModal,
    approvals,
    objects,
    openObjectDrawer,
    activeTab,
  } = useNexus();

  const [isWorkspaceDropdownOpen, setIsWorkspaceDropdownOpen] = useState(false);
  const [isPersonaDropdownOpen, setIsPersonaDropdownOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING');

  const getBreadcrumbTitle = () => {
    switch (activeTab) {
      case 'home': return 'Inicio / Dashboard';
      case 'project': case 'projects': return 'Edificio Corporativo Nexus — Fase I';
      case 'portfolios': return 'Portafolios & Programas';
      case 'governance': return 'Gobernanza & Riesgos';
      case 'meetings': return 'Reuniones & Decisiones';
      case 'documents': return 'Centro de Documentos & Aprobaciones';
      case 'timeline': return 'Timeline Histórico';
      case 'reports': return 'Reportes & KPIs';
      case 'settings': return 'Configuración';
      default: return 'Nexus OS';
    }
  };

  return (
    <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-8 flex-shrink-0 z-10 shadow-sm">
      {/* Breadcrumbs & Workspace Selector */}
      <div className="flex items-center gap-4 text-sm font-medium text-slate-400">
        <div className="relative">
          <button
            onClick={() => setIsWorkspaceDropdownOpen(!isWorkspaceDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors"
          >
            <Building className="h-3.5 w-3.5 text-indigo-600" />
            <span className="max-w-[150px] truncate">{currentWorkspace?.name || 'Workspace'}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>

          {isWorkspaceDropdownOpen && (
            <div className="absolute left-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-50">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Organización: {tenant.name}
              </div>
              <div className="space-y-1">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      setCurrentWorkspaceId(ws.id);
                      setIsWorkspaceDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                      currentWorkspace?.id === ws.id
                        ? 'bg-indigo-50 font-semibold text-indigo-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{ws.name}</div>
                      <div className="text-[10px] text-slate-400">{ws.organizationName}</div>
                    </div>
                    {currentWorkspace?.id === ws.id && <Check className="h-4 w-4 text-indigo-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="text-slate-300">/</span>
        <span className="text-slate-900 font-semibold">{getBreadcrumbTitle()}</span>
      </div>

      {/* Center Search Input & Right Actions */}
      <div className="flex items-center gap-4">
        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            readOnly
            onClick={() => setIsCommandPaletteOpen(true)}
            placeholder="Buscar en Nexus (⌘K)"
            className="bg-slate-100 border-none rounded-full py-1.5 px-4 pl-9 text-xs w-64 text-slate-700 placeholder:text-slate-400 cursor-pointer focus:ring-2 focus:ring-indigo-500 transition-all"
          />
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
        </div>

        {/* Persona Role Switcher */}
        <div className="relative">
          <button
            onClick={() => setIsPersonaDropdownOpen(!isPersonaDropdownOpen)}
            className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
            title="Cambiar rol para probar permisos RBAC"
          >
            <Shield className="h-3.5 w-3.5 text-indigo-600" />
            <span className="hidden lg:inline">{currentUser.roleName}</span>
            <ChevronDown className="h-3 w-3 text-indigo-500" />
          </button>

          {isPersonaDropdownOpen && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl z-50">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Simular Rol / Persona RBAC
              </div>
              <div className="space-y-1">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setCurrentUserId(u.id);
                      setIsPersonaDropdownOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl p-2 text-left text-xs transition-colors ${
                      currentUser.id === u.id
                        ? 'bg-indigo-50 text-indigo-900 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <img src={u.avatar} alt={u.name} className="h-7 w-7 rounded-full object-cover border border-slate-200" />
                    <div className="flex-1 truncate">
                      <div className="font-semibold">{u.name}</div>
                      <div className="text-[10px] text-slate-400">{u.roleName}</div>
                    </div>
                    {currentUser.id === u.id && <Check className="h-4 w-4 text-indigo-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="p-2 hover:bg-slate-50 rounded-full text-slate-500 relative transition-colors"
          >
            <Bell className="h-4 w-4" />
            {pendingApprovals.length > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-xs">
                {pendingApprovals.length}
              </span>
            )}
          </button>

          {isNotificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl z-50">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-xs font-bold text-slate-900">
                <span>Notificaciones</span>
                <span className="rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-[10px] font-bold text-rose-600">
                  {pendingApprovals.length} Pendientes
                </span>
              </div>
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto no-scrollbar">
                {pendingApprovals.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">Sin aprobaciones pendientes</div>
                ) : (
                  pendingApprovals.map((app) => {
                    const target = objects.find((o) => o.id === app.objectId);
                    return (
                      <div
                        key={app.id}
                        onClick={() => {
                          if (app.objectId) openObjectDrawer(app.objectId);
                          setIsNotificationsOpen(false);
                        }}
                        className="cursor-pointer rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/50"
                      >
                        <div className="text-xs font-semibold text-slate-900">
                          {target?.title || 'Solicitud de Aprobación'}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">{app.comment || 'Requiere firma ejecutiva'}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Primary Create Button */}
        <button
          onClick={() => openCreateModal('TASK')}
          className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-semibold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-1.5 active:scale-95"
        >
          <Plus className="h-4 w-4" />
          <span>+ Nuevo Objeto</span>
        </button>
      </div>
    </header>
  );
};
