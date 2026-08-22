import React, { useState } from 'react';
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  Command,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { ApiStatusBadge } from '../system/ApiStatusBadge';
import { useNexus } from '../../context/NexusContext';

export const Header: React.FC = () => {
  const {
    tenant,
    workspaces,
    currentWorkspace,
    setCurrentWorkspaceId,
    currentUser,
    setIsCommandPaletteOpen,
    openCreateModal,
    approvals,
    objects,
    openObjectDrawer,
    activeTab,
  } = useNexus();

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const pendingApprovals = approvals.filter((approval) => approval.status === 'PENDING');

  const pageTitle = (() => {
    switch (activeTab) {
      case 'home': return 'Centro de mando';
      case 'project': return 'Proyecto';
      case 'projects': return 'Proyectos';
      case 'portfolios': return 'Portafolios';
      case 'governance': return 'Riesgos y cambios';
      case 'meetings': return 'Reuniones y decisiones';
      case 'documents': return 'Documentos y aprobaciones';
      case 'timeline': return 'Cronograma';
      case 'reports': return 'Analítica ejecutiva';
      case 'settings': return 'Configuración';
      case 'inbox': return 'Mi trabajo';
      default: return 'Bridata Project';
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
    <header className="relative z-30 flex h-[72px] flex-shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-6">
      <div className="flex min-w-0 items-center gap-5">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold tracking-tight text-slate-950">{pageTitle}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400">{tenant.name}</p>
        </div>

        <div className="relative hidden md:block">
          <button
            onClick={() => setWorkspaceOpen((open) => !open)}
            className="flex max-w-[250px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white"
          >
            <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-indigo-600" />
            <span className="truncate">{currentWorkspace?.name || 'Seleccionar workspace'}</span>
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
          </button>

          {workspaceOpen && (
            <div className="absolute left-0 top-12 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_20px_60px_rgba(15,23,42,0.14)]">
              <div className="px-3 pb-2 pt-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Workspace activo</p>
              </div>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  onClick={() => {
                    setCurrentWorkspaceId(workspace.id);
                    setWorkspaceOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left transition ${
                    currentWorkspace?.id === workspace.id ? 'bg-indigo-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-slate-900">{workspace.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-400">{workspace.organizationName}</span>
                  </span>
                  {currentWorkspace?.id === workspace.id && <Check className="h-4 w-4 text-indigo-600" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setIsCommandPaletteOpen(true)}
          className="hidden min-w-[260px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] text-slate-400 transition hover:border-slate-300 hover:bg-white lg:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1">Buscar proyectos, tareas, riesgos...</span>
          <span className="flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 ring-1 ring-slate-200">
            <Command className="h-2.5 w-2.5" />K
          </span>
        </button>

        <ApiStatusBadge />

        <div className="relative">
          <button
            onClick={() => setNotificationsOpen((open) => !open)}
            className="relative grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="Abrir notificaciones"
          >
            <Bell className="h-4 w-4" />
            {pendingApprovals.length > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white ring-2 ring-white">
                {pendingApprovals.length}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-12 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.14)]">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-[12px] font-bold text-slate-900">Notificaciones</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">Acciones que requieren atención</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{pendingApprovals.length}</span>
              </div>

              <div className="max-h-72 overflow-y-auto p-2">
                {pendingApprovals.length === 0 ? (
                  <div className="p-6 text-center text-[11px] text-slate-400">No tienes aprobaciones pendientes.</div>
                ) : (
                  pendingApprovals.map((approval) => {
                    const target = objects.find((object) => object.id === approval.objectId);
                    return (
                      <button
                        key={approval.id}
                        onClick={() => {
                          if (approval.objectId) openObjectDrawer(approval.objectId);
                          setNotificationsOpen(false);
                        }}
                        className="w-full rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
                      >
                        <p className="truncate text-[11px] font-semibold text-slate-900">{target?.title || 'Aprobación pendiente'}</p>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{approval.comment || 'Requiere revisión antes de continuar.'}</p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => openCreateModal('TASK')}
          className="flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-3.5 text-[11px] font-bold text-white shadow-[0_6px_16px_rgba(79,70,229,0.22)] transition hover:bg-indigo-700 active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Crear</span>
        </button>

        <div className="ml-1 hidden items-center gap-2.5 border-l border-slate-200 pl-3 sm:flex">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-[10px] font-bold text-white">{userInitials || 'BP'}</div>
          <div className="hidden max-w-[140px] xl:block">
            <p className="truncate text-[11px] font-semibold text-slate-900">{currentUser.name}</p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] font-medium text-slate-400">
              <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" /> {currentUser.roleName}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
