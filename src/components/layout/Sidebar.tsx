import React from 'react';
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  FileText,
  FolderKanban,
  Gauge,
  Layers3,
  Settings2,
  ShieldAlert,
  UsersRound,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';
import { BRAND } from '../../config/brand';

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
    selectedProjectId,
    setSelectedProjectId,
    approvals,
    currentUser,
  } = useNexus();

  const projects = objects.filter((object) => object.type === 'PROJECT');
  const pendingApprovals = approvals.filter((approval) => approval.status === 'PENDING').length;

  const commandItems: NavigationItem[] = [
    { id: 'home', label: 'Centro de mando', icon: Gauge },
    { id: 'inbox', label: 'Mi trabajo', icon: CheckSquare2, badge: pendingApprovals },
  ];

  const planningItems: NavigationItem[] = [
    { id: 'projects', label: 'Proyectos', icon: FolderKanban },
    { id: 'portfolios', label: 'Portafolios', icon: Layers3 },
    { id: 'timeline', label: 'Cronograma', icon: CalendarClock },
    { id: 'resources', label: 'Recursos y capacidad', icon: UsersRound },
    { id: 'governance', label: 'Riesgos y cambios', icon: ShieldAlert },
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
            onClick={() => setActiveTab(item.id)}
            className={`group flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13px] transition-all ${
              isActive
                ? 'bg-green-50 text-green-800 shadow-[inset_3px_0_0_#15803d]'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icon
                className={`h-[17px] w-[17px] flex-shrink-0 ${
                  isActive ? 'text-green-700' : 'text-slate-400 group-hover:text-slate-600'
                }`}
              />
              <span className={`truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
            </span>

            {item.badge !== undefined && item.badge > 0 && (
              <span className="ml-2 min-w-5 rounded-full bg-amber-50 px-1.5 py-0.5 text-center text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <aside className="flex h-full w-[252px] flex-shrink-0 flex-col border-r border-slate-200/80 bg-white">
      <div className="flex h-[72px] items-center gap-3 border-b border-slate-100 px-5">
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-green-700 to-emerald-500 shadow-[0_8px_20px_rgba(22,101,52,0.22)]">
          <span className="text-[11px] font-black tracking-[0.08em] text-white">{BRAND.initials}</span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-extrabold tracking-tight text-slate-950">{BRAND.name}</p>
          <p className="mt-0.5 truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
            Enterprise Execution
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 no-scrollbar">
        <section>
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Trabajo</p>
          {renderItems(commandItems)}
        </section>

        <section className="mt-5">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Planificación y control</p>
          {renderItems(planningItems)}
        </section>

        <section className="mt-5">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Colaboración</p>
          {renderItems(collaborationItems)}
        </section>

        <section className="mt-6 border-t border-slate-100 pt-5">
          <div className="mb-2 flex items-center justify-between px-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Proyectos activos</p>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{projects.length}</span>
          </div>

          <div className="space-y-1">
            {projects.slice(0, 6).map((project) => {
              const selected = selectedProjectId === project.id && activeTab === 'project';
              return (
                <button
                  key={project.id}
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setActiveTab('project');
                  }}
                  className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    selected ? 'bg-slate-100' : 'hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      project.status === 'BLOCKED'
                        ? 'bg-rose-500'
                        : project.progress >= 80
                          ? 'bg-emerald-500'
                          : 'bg-green-500'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[12px] ${selected ? 'font-semibold text-slate-950' : 'font-medium text-slate-600'}`}>
                      {project.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-400">{project.progress}% completado</span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5" />
                </button>
              );
            })}

            {projects.length === 0 && (
              <div className="mx-2 rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-400">
                Sin proyectos todavía
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="border-t border-slate-100 p-3">
        <button
          onClick={() => setActiveTab('settings')}
          className={`mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-medium transition-colors ${
            activeTab === 'settings' ? 'bg-green-50 text-green-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
        >
          <Settings2 className="h-4 w-4" />
          Configuración
        </button>

        <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-100">
          {currentUser.avatar ? (
            <img src={currentUser.avatar} alt={currentUser.name} className="h-9 w-9 rounded-xl object-cover" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-green-100 text-xs font-bold text-green-800">
              {currentUser.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-slate-900">{currentUser.name}</p>
            <p className="mt-0.5 truncate text-[10px] text-slate-400">{currentUser.roleName}</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
