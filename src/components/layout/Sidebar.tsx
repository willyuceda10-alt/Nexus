import React from 'react';
import {
  BarChart3,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  CircleDollarSign,
  Columns3,
  FileText,
  FolderKanban,
  Gauge,
  Layers3,
  PackageSearch,
  ShoppingCart,
  PlugZap,
  Settings2,
  ShieldAlert,
  UsersRound,
  Warehouse,
  Workflow,
  X,
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

interface SidebarProps {
  mobileOpen: boolean;
  onNavigate: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mobileOpen,
  onNavigate,
}) => {
  const {
    activeTab,
    setActiveTab,
    objects,
    selectedProjectId,
    setSelectedProjectId,
    setProjectActiveSubTab,
    currentUser,
    currentWorkspace,
  } = useNexus();

  const scopedObjects = currentWorkspace
    ? objects.filter((object) => object.workspaceId === currentWorkspace.id)
    : objects;
  const projects = scopedObjects.filter((object) => object.type === 'PROJECT');
  const activeProjects = projects.filter((project) => !['COMPLETED', 'CANCELLED'].includes(project.status));
  const personalWorkCount = scopedObjects.filter((object) => isOpenPersonalWork(object, currentUser.id)).length;

  const navigateTo = (tab: string) => {
    setActiveTab(tab);
    onNavigate();
  };

  const overviewItems: NavigationItem[] = [
    { id: 'home', label: 'Centro de mando', icon: Gauge },
    { id: 'inbox', label: 'Mi trabajo', icon: CheckSquare2, badge: personalWorkCount },
  ];

  const planningItems: NavigationItem[] = [
    { id: 'projects', label: 'Proyectos', icon: FolderKanban },
    { id: 'boards', label: 'Tableros', icon: Columns3 },
    { id: 'calendar', label: 'Calendario y Timeline', icon: CalendarDays },
    { id: 'portfolios', label: 'Portafolios', icon: Layers3 },
    { id: 'timeline', label: 'Plan maestro', icon: CalendarClock },
  ];

  const operationsItems: NavigationItem[] = [
    { id: 'resources', label: 'Recursos', icon: UsersRound },
    { id: 'materials', label: 'Materiales', icon: PackageSearch },
    { id: 'procurement', label: 'Compras / Por llegar', icon: ShoppingCart },
    { id: 'inventory', label: 'Inventario', icon: Warehouse },
    { id: 'costs', label: 'Costos', icon: CircleDollarSign },
  ];

  const controlItems: NavigationItem[] = [
    { id: 'governance', label: 'Riesgos y cambios', icon: ShieldAlert },
    { id: 'integrations', label: 'Integraciones', icon: PlugZap },
    { id: 'automations', label: 'Automatizaciones', icon: Workflow },
  ];

  const collaborationItems: NavigationItem[] = [
    { id: 'meetings', label: 'Reuniones', icon: CalendarDays },
    { id: 'documents', label: 'Documentos', icon: FileText },
    { id: 'reports', label: 'Analítica', icon: BarChart3 },
  ];

  const renderItems = (items: NavigationItem[]) => (
    <nav className="space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.id || (item.id === 'projects' && activeTab === 'project');
        return (
          <button
            key={item.id}
            onClick={() => navigateTo(item.id)}
            className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[12px] transition ${
              isActive
                ? 'bg-green-50 font-bold text-green-900 ring-1 ring-green-100'
                : 'font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950'
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icon className={`h-[16px] w-[16px] flex-none ${isActive ? 'text-green-700' : 'text-slate-400 group-hover:text-slate-600'}`} />
              <span className="truncate">{item.label}</span>
            </span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="ml-2 min-w-5 rounded-full bg-amber-50 px-1.5 py-0.5 text-center text-[9px] font-black text-amber-700 ring-1 ring-amber-200">{item.badge}</span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <aside
      id="bridata-primary-navigation"
      aria-label="Navegación principal"
      className={`
        fixed
        inset-y-0
        left-0
        z-50
        flex
        h-full
        w-[min(86vw,288px)]
        flex-none
        flex-col
        border-r
        border-slate-200
        bg-white
        shadow-[0_24px_70px_rgba(15,23,42,0.18)]
        transition-transform
        duration-200
        ease-out
        lg:static
        lg:z-auto
        lg:w-[268px]
        lg:translate-x-0
        lg:shadow-none
        ${
          mobileOpen
            ? 'translate-x-0'
            : '-translate-x-full'
        }
      `}
    >
      <button
        type="button"
        onClick={onNavigate}
        className="
          absolute
          right-3
          top-3
          z-10
          grid
          h-10
          w-10
          place-items-center
          rounded-xl
          border
          border-slate-200
          bg-white
          text-slate-500
          shadow-sm
          transition
          hover:bg-slate-50
          hover:text-slate-900
          focus-visible:outline-none
          focus-visible:ring-2
          focus-visible:ring-green-600
          focus-visible:ring-offset-2
          lg:hidden
        "
        aria-label="Cerrar navegación"
      >
        <X
          className="h-4 w-4"
          aria-hidden="true"
        />
      </button>
      <div className="border-b border-slate-100 px-4 py-4">
        <div className="flex items-center gap-3 px-1">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-green-700 shadow-[0_8px_20px_rgba(21,128,61,0.22)]">
            <span className="text-[11px] font-black tracking-[0.08em] text-white">{BRAND.initials}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold tracking-tight text-slate-950">{BRAND.name}</p>
            <p className="mt-0.5 truncate text-[9px] font-black uppercase tracking-[0.15em] text-green-700">Enterprise Work OS</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">Workspace activo</p>
              <p className="mt-1 truncate text-[11px] font-bold text-slate-800">{currentWorkspace?.name || 'Sin workspace'}</p>
            </div>
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-green-700 ring-1 ring-slate-200"><BellRing className="h-3.5 w-3.5" /></span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 no-scrollbar">
        <section>
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Resumen</p>
          {renderItems(overviewItems)}
        </section>

        <section className="mt-5">
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Planificar</p>
          {renderItems(planningItems)}
        </section>

        <section className="mt-5">
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Operar</p>
          {renderItems(operationsItems)}
        </section>

        <section className="mt-5">
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Controlar</p>
          {renderItems(controlItems)}
        </section>

        <section className="mt-5">
          <p className="px-3 pb-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Colaborar</p>
          {renderItems(collaborationItems)}
        </section>

        <section className="mt-6 border-t border-slate-100 pt-5">
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Proyectos en marcha</p>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">{activeProjects.length}</span>
          </div>
          <div className="space-y-1">
            {activeProjects.slice(0, 5).map((project) => {
              const selected = selectedProjectId === project.id && activeTab === 'project';
              return (
                <button
                  key={project.id}
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setProjectActiveSubTab('summary');
                    setActiveTab('project');
                    onNavigate();
                  }}
                  className={`group w-full rounded-xl px-3 py-2.5 text-left transition ${selected ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`h-2 w-2 flex-none rounded-full ${project.status === 'BLOCKED' ? 'bg-rose-500' : 'bg-green-500'}`} />
                    <span className={`min-w-0 flex-1 truncate text-[11px] ${selected ? 'font-bold text-slate-950' : 'font-semibold text-slate-600'}`}>{project.title}</span>
                    <ChevronRight className="h-3.5 w-3.5 flex-none text-slate-300 transition group-hover:translate-x-0.5" />
                  </div>
                  <div className="ml-4 mt-2 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, project.progress)}%` }} /></div>
                    <span className="text-[8px] font-bold text-slate-400">{project.progress}%</span>
                  </div>
                </button>
              );
            })}
            {activeProjects.length === 0 && <div className="mx-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[10px] text-slate-400">Sin proyectos activos</div>}
          </div>
        </section>
      </div>

      <div className="border-t border-slate-100 p-3">
        <button
          onClick={() => navigateTo('settings')}
          className={`mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] font-semibold transition ${activeTab === 'settings' ? 'bg-green-50 text-green-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
        >
          <Settings2 className="h-4 w-4" /> Configuración
        </button>
        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-100">
          {currentUser.avatar ? (
            <img src={currentUser.avatar} alt={currentUser.name} className="h-9 w-9 rounded-xl object-cover" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-green-100 text-[10px] font-black text-green-800">{currentUser.name.slice(0, 2).toUpperCase()}</div>
          )}
          <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold text-slate-900">{currentUser.name}</p><p className="mt-0.5 truncate text-[9px] text-slate-400">{currentUser.roleName}</p></div>
        </div>
      </div>
    </aside>
  );
};
