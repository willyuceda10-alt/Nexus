import React, { useState } from 'react';
import {
  Search,
  Plus,
  Bell,
  Building,
  ChevronDown,
  Shield,
  Check,
  LogOut,
} from 'lucide-react';
import { ApiStatusBadge } from '../system/ApiStatusBadge';
import { useNexus } from '../../context/NexusContext';
import { useRuntimeAuth } from '../../auth/RuntimeAuthContext';
import { BRAND } from '../../config/brand';

export const Header: React.FC = () => {
  const auth = useRuntimeAuth();
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
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const pendingApprovals = approvals.filter((approval) => approval.status === 'PENDING');

  const getBreadcrumbTitle = () => {
    switch (activeTab) {
      case 'home': return 'Inicio / Dashboard';
      case 'project': case 'projects': return 'Centro de Proyectos';
      case 'portfolios': return 'Portafolios & Programas';
      case 'governance': return 'Gobernanza & Riesgos';
      case 'meetings': return 'Reuniones & Decisiones';
      case 'documents': return 'Centro de Documentos & Aprobaciones';
      case 'timeline': return 'Timeline Histórico';
      case 'reports': return 'Reportes & KPIs';
      case 'settings': return 'Configuración';
      default: return BRAND.name;
    }
  };

  return (
    <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-8 flex-shrink-0 z-10 shadow-sm">
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
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    onClick={() => {
                      setCurrentWorkspaceId(workspace.id);
                      setIsWorkspaceDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                      currentWorkspace?.id === workspace.id
                        ? 'bg-indigo-50 font-semibold text-indigo-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="font-medium">{workspace.name}</div>
                      <div className="text-[10px] text-slate-400">{workspace.organizationName}</div>
                    </div>
                    {currentWorkspace?.id === workspace.id && <Check className="h-4 w-4 text-indigo-600" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <span className="text-slate-300">/</span>
        <span className="text-slate-900 font-semibold">{getBreadcrumbTitle()}</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <input
            type="text"
            readOnly
            onClick={() => setIsCommandPaletteOpen(true)}
            placeholder={`Buscar en ${BRAND.name} (⌘K)`}
            aria-label={`Buscar en ${BRAND.name}`}
            className="bg-slate-100 border-none rounded-full py-1.5 px-4 pl-9 text-xs w-64 text-slate-700 placeholder:text-slate-400 cursor-pointer focus:ring-2 focus:ring-indigo-500 transition-all"
          />
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
        </div>

        <ApiStatusBadge />

        {auth.mode === 'dev' ? (
          <div className="relative">
            <button
              onClick={() => setIsPersonaDropdownOpen(!isPersonaDropdownOpen)}
              className="flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
              title="Cambiar rol para pruebas DEV"
            >
              <Shield className="h-3.5 w-3.5 text-indigo-600" />
              <span className="hidden lg:inline">{currentUser.roleName}</span>
              <ChevronDown className="h-3 w-3 text-indigo-500" />
            </button>

            {isPersonaDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl z-50">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Simular rol · solo DEV
                </div>
                <div className="space-y-1">
                  {users.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => {
                        setCurrentUserId(user.id);
                        setIsPersonaDropdownOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-xl p-2 text-left text-xs transition-colors ${
                        currentUser.id === user.id
                          ? 'bg-indigo-50 text-indigo-900 font-semibold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <img src={user.avatar} alt={user.name} className="h-7 w-7 rounded-full object-cover border border-slate-200" />
                      <div className="flex-1 truncate">
                        <div className="font-semibold">{user.name}</div>
                        <div className="text-[10px] text-slate-400">{user.roleName}</div>
                      </div>
                      {currentUser.id === user.id && <Check className="h-4 w-4 text-indigo-600" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative">
            <button
              onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              title="Cuenta de Microsoft"
            >
              <img
                src={currentUser.avatar}
                alt={currentUser.name}
                className="h-7 w-7 rounded-full border border-slate-200 object-cover"
              />
              <span className="hidden xl:inline max-w-32 truncate">{currentUser.name}</span>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>

            {isAccountDropdownOpen && (
              <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl z-50">
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <div className="text-xs font-bold text-slate-900">{currentUser.name}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{currentUser.email}</div>
                </div>

                {(auth.session?.tenants.length ?? 0) > 1 && (
                  <div className="py-2">
                    <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Empresa activa
                    </div>
                    {auth.session?.tenants.map((sessionTenant) => (
                      <button
                        key={sessionTenant.id}
                        onClick={() => {
                          auth.selectTenant(sessionTenant.id);
                          setIsAccountDropdownOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs ${
                          auth.activeTenantId === sessionTenant.id
                            ? 'bg-indigo-50 font-semibold text-indigo-700'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="truncate">{sessionTenant.name}</span>
                        {auth.activeTenantId === sessionTenant.id && <Check className="h-4 w-4" />}
                      </button>
                    ))}
                  </div>
                )}

                <div className="border-t border-slate-100 pt-2">
                  <button
                    onClick={() => void auth.signOut()}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Cerrar sesión
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="p-2 hover:bg-slate-50 rounded-full text-slate-500 relative transition-colors"
            aria-label="Abrir notificaciones"
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
                  pendingApprovals.map((approval) => {
                    const target = objects.find((object) => object.id === approval.objectId);
                    return (
                      <div
                        key={approval.id}
                        onClick={() => {
                          if (approval.objectId) openObjectDrawer(approval.objectId);
                          setIsNotificationsOpen(false);
                        }}
                        className="cursor-pointer rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-indigo-200 hover:bg-indigo-50/50"
                      >
                        <div className="text-xs font-semibold text-slate-900">
                          {target?.title || 'Solicitud de Aprobación'}
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">{approval.comment || 'Requiere firma ejecutiva'}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => openCreateModal('TASK')}
          className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-semibold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center gap-1.5 active:scale-95"
        >
          <Plus className="h-4 w-4" />
          <span>Nuevo objeto</span>
        </button>
      </div>
    </header>
  );
};
