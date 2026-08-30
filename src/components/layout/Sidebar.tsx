import React from 'react';
import {
  BarChart3,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  CircleDollarSign,
  Columns3,
  Database,
  FileText,
  FolderKanban,
  Gauge,
  Layers3,
  PackageSearch,
  Plus,
  Settings2,
  ShieldAlert,
  ShoppingCart,
  Star,
  UsersRound,
  Warehouse,
  Workflow,
  PlugZap,
} from 'lucide-react';
import { BRAND } from '../../config/brand';
import { useNexus } from '../../context/NexusContext';
import { isOpenPersonalWork } from '../../domain/myWork';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    objects,
    currentUser,
    currentWorkspace,
    openCreateModal,
  } = useNexus();

  const scopedObjects = currentWorkspace
    ? objects.filter((object) => object.workspaceId === currentWorkspace.id)
    : objects;

  const personalWorkCount = scopedObjects.filter((object) => isOpenPersonalWork(object, currentUser.id)).length;

  const primaryItems: NavigationItem[] = [
    { id: 'home', label: 'Inicio', icon: Gauge },
    { id: 'inbox', label: 'Mi trabajo', icon: CheckSquare2, badge: personalWorkCount },
  ];

  const favoriteItems: NavigationItem[] = [
    { id: 'projects', label: 'Proyectos', icon: FolderKanban },
    { id: 'boards', label: 'Tableros', icon: Columns3 },
    { id: 'sap', label: 'Centro SAP', icon: Database },
  ];

  const workspaceItems: NavigationItem[] = [
    { id: 'calendar', label: 'Calendario y Timeline', icon: CalendarDays },
    { id: 'portfolios', label: 'Portafolios', icon: Layers3 },
    { id: 'resources', label: 'Recursos', icon: UsersRound },
    { id: 'materials', label: 'Materiales', icon: PackageSearch },
    { id: 'procurement', label: 'Compras / Por llegar', icon: ShoppingCart },
    { id: 'inventory', label: 'Inventario', icon: Warehouse },
    { id: 'costs', label: 'Costos', icon: CircleDollarSign },
    { id: 'governance', label: 'Riesgos y cambios', icon: ShieldAlert },
    { id: 'automations', label: 'Automatizaciones', icon: Workflow },
    { id: 'integrations', label: 'Integraciones', icon: PlugZap },
    { id: 'documents', label: 'Documentos', icon: FileText },
    { id: 'reports', label: 'Analítica', icon: BarChart3 },
  ];

  const renderItems = (items: NavigationItem[]) => (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id || (item.id === 'projects' && activeTab === 'project');
        return (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`group flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-[12px] transition ${
              isActive
                ? 'bg-[#E8F6EC] font-semibold text-[#0B6B35]'
                : 'font-medium text-slate-700 hover:bg-slate-100/80 hover:text-slate-950'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Icon className={`h-[15px] w-[15px] flex-none ${isActive ? 'text-[#07883F]' : 'text-slate-500'}`} />
              <span className="truncate">{item.label}</span>
            </span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="ml-2 min-w-5 rounded-full bg-slate-200 px-1.5 py-0.5 text-center text-[9px] font-bold text-slate-600">{item.badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <aside className="flex h-full w-[252px] flex-none flex-col border-r border-slate-200 bg-[#F7F8FA]">
      <div className="flex h-[58px] items-center gap-2 border-b border-slate-200 px-3">
        <button onClick={() => setActiveTab('home')} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-white/70">
          <div className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[#07883F] shadow-sm">
            <span className="text-[9px] font-black tracking-[0.08em] text-white">{BRAND.initials}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-extrabold tracking-tight text-slate-950">{BRAND.name}</p>
            <p className="truncate text-[8px] font-bold uppercase tracking-[0.13em] text-[#07883F]">Work OS</p>
          </div>
        </button>
        <button
          onClick={() => openCreateModal('TASK')}
          className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-green-300 hover:text-green-700"
          aria-label="Crear elemento"
          title="Crear elemento"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="px-2.5 pt-2.5">
        <button className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-left shadow-sm transition hover:border-slate-300">
          <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-green-100 text-[10px] font-black text-green-800">
            {(currentWorkspace?.name || 'W').slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-bold text-slate-900">{currentWorkspace?.name || 'Workspace'}</span>
            <span className="mt-0.5 block text-[9px] text-slate-400">Espacio de trabajo</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 flex-none text-slate-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-3 no-scrollbar">
        {renderItems(primaryItems)}

        <section className="mt-5">
          <div className="mb-1.5 flex items-center justify-between px-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500"><Star className="h-3 w-3" /> Favoritos</p>
          </div>
          {renderItems(favoriteItems)}
        </section>

        <section className="mt-5">
          <div className="mb-1.5 flex items-center justify-between px-2.5">
            <p className="text-[10px] font-semibold text-slate-500">Contenido del workspace</p>
            <button onClick={() => openCreateModal('PROJECT')} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-green-700" aria-label="Nuevo proyecto">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {renderItems(workspaceItems)}
        </section>
      </div>

      <div className="border-t border-slate-200 p-2.5">
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[12px] font-medium transition ${activeTab === 'settings' ? 'bg-[#E8F6EC] text-[#0B6B35]' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`}
        >
          <Settings2 className="h-[15px] w-[15px]" /> Configuración
        </button>
      </div>
    </aside>
  );
};
