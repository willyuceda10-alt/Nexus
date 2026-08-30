import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Columns3,
  Database,
  FileText,
  FolderKanban,
  Gauge,
  Layers3,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Star,
  UsersRound,
  Warehouse,
  Workflow,
  X,
} from 'lucide-react';
import { BRAND } from '../../config/brand';
import { useApiBootstrap } from '../../context/ApiBootstrapContext';
import { useNexus } from '../../context/NexusContext';
import { isOpenPersonalWork } from '../../domain/myWork';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  accent?: 'pmo';
}

type NavigationGroupId = 'work' | 'pmo' | 'operations' | 'platform';

type NavigationGroup = {
  id: NavigationGroupId;
  label: string;
  items: NavigationItem[];
};

export interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

const FAVORITES_KEY = 'bridata.sidebar.favorites.v1';
const GROUPS_KEY = 'bridata.sidebar.groups.v1';
const DEFAULT_GROUPS: Record<NavigationGroupId, boolean> = {
  work: true,
  pmo: true,
  operations: true,
  platform: false,
};

function formatWorkspaceRole(role: string | null): string {
  if (!role) return 'Espacio de trabajo';
  const labels: Record<string, string> = {
    PMO_SENIOR: 'PMO Senior',
    OWNER: 'Propietario',
    ADMIN: 'Administrador',
    MANAGER: 'Manager',
    MEMBER: 'Miembro',
    VIEWER: 'Solo lectura',
  };
  return labels[role] ?? role.replaceAll('_', ' ');
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onMobileClose }) => {
  const apiBootstrap = useApiBootstrap();
  const {
    activeTab,
    setActiveTab,
    objects,
    currentUser,
    currentWorkspace,
    workspaces,
    setCurrentWorkspaceId,
  } = useNexus();
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<NavigationGroupId, boolean>>(DEFAULT_GROUPS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${FAVORITES_KEY}.${currentUser.id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) setFavoriteIds(parsed);
      }
    } catch {
      // Local preference failure must never block navigation.
    }
  }, [currentUser.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${GROUPS_KEY}.${currentUser.id}`);
      if (!raw) {
        setOpenGroups(DEFAULT_GROUPS);
        return;
      }
      const parsed = JSON.parse(raw) as Partial<Record<NavigationGroupId, boolean>>;
      setOpenGroups({ ...DEFAULT_GROUPS, ...parsed });
    } catch {
      setOpenGroups(DEFAULT_GROUPS);
    }
  }, [currentUser.id]);

  useEffect(() => {
    if (mobileOpen) setCollapsed(false);
  }, [mobileOpen]);

  const scopedObjects = currentWorkspace
    ? objects.filter((object) => object.workspaceId === currentWorkspace.id)
    : objects;
  const personalWorkCount = scopedObjects.filter((object) => isOpenPersonalWork(object, currentUser.id)).length;

  const workspaceRole = useMemo(() => {
    if (!currentWorkspace || !apiBootstrap.bootstrap) return null;
    return apiBootstrap.bootstrap.workspaces.find((item) => item.id === currentWorkspace.id)?.role ?? null;
  }, [apiBootstrap.bootstrap, currentWorkspace]);

  const canSeePmo = apiBootstrap.dataMode !== 'api'
    || ['PMO_SENIOR', 'OWNER', 'ADMIN'].includes(workspaceRole ?? '')
    || ['OWNER', 'TENANT_ADMIN'].includes(apiBootstrap.bootstrap?.actor.role ?? '');

  const primaryItems: NavigationItem[] = [
    { id: 'home', label: 'Inicio', icon: Gauge },
  ];

  const navigationGroups = useMemo<NavigationGroup[]>(() => [
    {
      id: 'work',
      label: 'Trabajo',
      items: [
        { id: 'projects', label: 'Proyectos', icon: FolderKanban },
        { id: 'boards', label: 'Tableros', icon: Columns3 },
        { id: 'inbox', label: 'Mi trabajo', icon: CheckSquare2, badge: personalWorkCount },
        { id: 'calendar', label: 'Calendario y Timeline', icon: CalendarDays },
      ],
    },
    {
      id: 'pmo',
      label: 'PMO',
      items: [
        ...(canSeePmo ? [{ id: 'pmo', label: 'Control PMO', icon: ShieldCheck, accent: 'pmo' as const }] : []),
        { id: 'portfolios', label: 'Portafolios', icon: Layers3 },
        { id: 'resources', label: 'Recursos', icon: UsersRound },
        { id: 'governance', label: 'Riesgos y cambios', icon: ShieldAlert },
      ],
    },
    {
      id: 'operations',
      label: 'Operaciones',
      items: [
        { id: 'materials', label: 'Materiales', icon: PackageSearch },
        { id: 'procurement', label: 'Compras / Por llegar', icon: ShoppingCart },
        { id: 'inventory', label: 'Inventario', icon: Warehouse },
        { id: 'costs', label: 'Costos', icon: CircleDollarSign },
        { id: 'sap', label: 'Centro SAP', icon: Database },
      ],
    },
    {
      id: 'platform',
      label: 'Plataforma',
      items: [
        { id: 'automations', label: 'Automatizaciones', icon: Workflow },
        { id: 'integrations', label: 'Integraciones', icon: PlugZap },
        { id: 'documents', label: 'Documentos', icon: FileText },
        { id: 'reports', label: 'Analítica', icon: BarChart3 },
      ],
    },
  ], [canSeePmo, personalWorkCount]);

  const allGroupedItems = navigationGroups.flatMap((group) => group.items);
  const favoriteItems = allGroupedItems.filter((item) => favoriteIds.includes(item.id));

  const navigate = (id: string) => {
    setActiveTab(id);
    setWorkspaceOpen(false);
    onMobileClose();
  };

  const toggleFavorite = (id: string) => {
    const next = favoriteIds.includes(id)
      ? favoriteIds.filter((item) => item !== id)
      : [...favoriteIds, id];
    setFavoriteIds(next);
    try {
      localStorage.setItem(`${FAVORITES_KEY}.${currentUser.id}`, JSON.stringify(next));
    } catch {
      // Preference persistence is best-effort only.
    }
  };

  const toggleGroup = (groupId: NavigationGroupId) => {
    const next = { ...openGroups, [groupId]: !openGroups[groupId] };
    setOpenGroups(next);
    try {
      localStorage.setItem(`${GROUPS_KEY}.${currentUser.id}`, JSON.stringify(next));
    } catch {
      // Group state is a personal UI preference only.
    }
  };

  const toggleWorkspacePicker = () => {
    if (collapsed) {
      setCollapsed(false);
      setWorkspaceOpen(true);
      return;
    }
    setWorkspaceOpen((value) => !value);
  };

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      if (next) setWorkspaceOpen(false);
      return next;
    });
  };

  const renderItems = (items: NavigationItem[], allowFavorite = false) => (
    <nav className="space-y-0.5" aria-label="Navegación Bridata">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id || (item.id === 'projects' && activeTab === 'project');
        return (
          <div key={item.id} className="group flex items-center gap-1">
            <button
              onClick={() => navigate(item.id)}
              title={collapsed ? item.label : undefined}
              aria-current={isActive ? 'page' : undefined}
              className={`flex h-10 min-w-0 flex-1 items-center justify-between rounded-lg px-2.5 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                isActive
                  ? 'bg-[#173F43] font-bold text-white shadow-sm'
                  : 'font-medium text-slate-300 hover:bg-white/[0.055] hover:text-white'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <span className={`flex min-w-0 items-center ${collapsed ? '' : 'gap-2.5'}`}>
                <Icon className={`h-4 w-4 flex-none ${isActive || item.accent === 'pmo' ? 'text-emerald-300' : 'text-slate-400'}`} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </span>
              {!collapsed && (
                <span className="ml-2 flex items-center gap-1.5">
                  {item.accent === 'pmo' && <span className="rounded-md bg-emerald-300/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-emerald-300">PMO</span>}
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="min-w-5 rounded-full bg-white/10 px-1.5 py-0.5 text-center text-[10px] font-bold text-slate-200">{item.badge}</span>
                  )}
                </span>
              )}
            </button>
            {!collapsed && allowFavorite && (
              <button
                onClick={() => toggleFavorite(item.id)}
                className="grid h-8 w-8 flex-none place-items-center rounded-md text-slate-600 opacity-100 transition hover:bg-white/[0.06] hover:text-amber-300 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                aria-label={favoriteIds.includes(item.id) ? `Quitar ${item.label} de favoritos` : `Agregar ${item.label} a favoritos`}
                aria-pressed={favoriteIds.includes(item.id)}
              >
                <Star className={`h-3.5 w-3.5 ${favoriteIds.includes(item.id) ? 'fill-amber-300 text-amber-300 opacity-100' : ''}`} />
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );

  const renderNavigationGroup = (group: NavigationGroup) => {
    if (group.items.length === 0) return null;
    if (collapsed) {
      return <section key={group.id} className="mt-3 border-t border-white/10 pt-3">{renderItems(group.items)}</section>;
    }
    const isOpen = openGroups[group.id];
    return (
      <section key={group.id} className="mt-3">
        <button
          onClick={() => toggleGroup(group.id)}
          className="flex h-8 w-full items-center justify-between rounded-md px-2.5 text-left text-[10px] font-extrabold uppercase tracking-[0.11em] text-slate-400 transition hover:bg-white/[0.045] hover:text-slate-200"
          aria-expanded={isOpen}
        >
          <span>{group.label}</span>
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {isOpen && <div className="mt-0.5">{renderItems(group.items, true)}</div>}
      </section>
    );
  };

  const sidebar = (
    <aside
      className={`flex h-full flex-col border-r border-[#294657] bg-[#0D2533] shadow-2xl transition-[width,transform] duration-200 md:relative md:translate-x-0 md:shadow-none ${collapsed ? 'md:w-[72px]' : 'md:w-[252px]'} w-[280px] ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-50 md:static`}
      aria-label="Barra lateral principal"
    >
      <div className={`flex h-[58px] items-center gap-2 border-b border-white/10 ${collapsed ? 'px-2' : 'px-3'}`}>
        <button onClick={() => navigate('home')} className={`flex min-w-0 flex-1 items-center rounded-lg py-1 text-left hover:bg-white/[0.04] ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-1'}`}>
          <div className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[#0E8A50] shadow-lg shadow-emerald-950/20">
            <span className="text-[10px] font-black tracking-[0.08em] text-white">{BRAND.initials}</span>
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-tight text-white">{BRAND.name}</p>
              <p className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300">Work OS</p>
            </div>
          )}
        </button>
        <button
          onClick={onMobileClose}
          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white md:hidden"
          aria-label="Cerrar navegación"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative px-2.5 pt-2.5">
        <button
          onClick={toggleWorkspacePicker}
          className={`flex w-full items-center rounded-lg border border-white/10 bg-[#153747] shadow-sm transition hover:border-emerald-300/30 hover:bg-[#193D4D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${collapsed ? 'justify-center px-0 py-2' : 'gap-2 px-2.5 py-2.5 text-left'}`}
          aria-expanded={workspaceOpen}
          aria-label={collapsed ? `Abrir selector de workspace: ${currentWorkspace?.name || 'Workspace'}` : undefined}
        >
          <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-emerald-300/12 text-[11px] font-black text-emerald-200">
            {(currentWorkspace?.name || 'W').slice(0, 1).toUpperCase()}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-white">{currentWorkspace?.name || 'Workspace'}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">{formatWorkspaceRole(workspaceRole)}</span>
              </span>
              {workspaceOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
            </>
          )}
        </button>

        {workspaceOpen && !collapsed && (
          <div className="absolute left-2.5 right-2.5 top-[56px] z-30 overflow-hidden rounded-xl border border-slate-300 bg-[#F8FAFC] p-1.5 text-slate-900 shadow-2xl">
            <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Cambiar workspace</p>
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                onClick={() => {
                  setCurrentWorkspaceId(workspace.id);
                  setWorkspaceOpen(false);
                  onMobileClose();
                }}
                className={`w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${currentWorkspace?.id === workspace.id ? 'bg-emerald-50 font-bold text-emerald-800' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                <span className="block truncate">{workspace.name}</span>
                <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-500">{workspace.organizationName}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-3 no-scrollbar">
        {renderItems(primaryItems)}

        {!collapsed && favoriteItems.length > 0 && (
          <section className="mt-4">
            <p className="mb-1 flex items-center gap-1.5 px-2.5 text-[11px] font-bold text-slate-400"><Star className="h-3 w-3 fill-amber-300 text-amber-300" /> Favoritos</p>
            {renderItems(favoriteItems)}
          </section>
        )}

        <div className="mt-2">{navigationGroups.map(renderNavigationGroup)}</div>
      </div>

      <div className="border-t border-white/10 p-2.5">
        <button
          onClick={() => navigate('settings')}
          title={collapsed ? 'Configuración' : undefined}
          className={`flex h-10 w-full items-center rounded-lg text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'} ${activeTab === 'settings' ? 'bg-[#173F43] text-white' : 'text-slate-300 hover:bg-white/[0.055] hover:text-white'}`}
        >
          <Settings2 className={`h-4 w-4 ${activeTab === 'settings' ? 'text-emerald-300' : 'text-slate-400'}`} /> {!collapsed && 'Configuración'}
        </button>
        <button
          onClick={toggleCollapsed}
          className="mt-1 hidden h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold text-slate-400 transition hover:bg-white/[0.055] hover:text-white md:flex"
          aria-label={collapsed ? 'Expandir navegación' : 'Contraer navegación'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /><span>Contraer</span></>}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {mobileOpen && <button onClick={onMobileClose} className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px] md:hidden" aria-label="Cerrar menú" />}
      {sidebar}
    </>
  );
};
