import React from 'react';
import {
  Home,
  Briefcase,
  Layers,
  Folder,
  ShieldAlert,
  CalendarDays,
  FileCheck2,
  Clock3,
  BarChart3,
  Settings,
  ChevronRight,
  Sparkles,
  Zap,
  Users,
  CheckSquare,
} from 'lucide-react';
import { useNexus } from '../../context/NexusContext';

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

  const projects = objects.filter((o) => o.type === 'PROJECT');
  const pendingApprovalsCount = approvals.filter((a) => a.status === 'PENDING').length;

  const navItems = [
    { id: 'home', label: 'Inicio / Workspace', icon: Home },
    { id: 'inbox', label: 'Bandeja & Aprobaciones', icon: CheckSquare, badge: pendingApprovalsCount },
    { id: 'portfolios', label: 'Portafolios & Programas', icon: Layers },
    { id: 'projects', label: 'Proyectos', icon: Folder },
    { id: 'governance', label: 'Riesgos & Gobernanza', icon: ShieldAlert },
    { id: 'meetings', label: 'Reuniones & Decisiones', icon: CalendarDays },
    { id: 'documents', label: 'Aprobaciones & Docs', icon: FileCheck2 },
    { id: 'timeline', label: 'Timeline Histórico', icon: Clock3 },
    { id: 'reports', label: 'Reportes & KPIs', icon: BarChart3 },
  ];

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col h-full flex-shrink-0 shadow-sm z-20">
      {/* Brand Header */}
      <div className="p-5 flex items-center gap-3 border-b border-slate-100">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-sm shadow-indigo-200 flex-shrink-0">
          <div className="w-4 h-4 border-2 border-white rounded-full"></div>
        </div>
        <span className="text-xl font-bold tracking-tight text-slate-900">Nexus OS</span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar py-4 px-3 space-y-6">
        {/* Main Nav Section */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold px-3 mb-2">
            Gestión SaaS
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`group flex w-full items-center justify-between px-3 py-2.5 text-xs font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'active-sidebar text-indigo-600 font-semibold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isActive
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-rose-50 text-rose-600 border border-rose-200'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Quick Project Access Section */}
        <div>
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400 font-bold px-3 mb-2">
            <span>Proyectos Activos</span>
            <span className="text-slate-400 font-medium">{projects.length}</span>
          </div>
          <div className="space-y-1">
            {projects.map((prj) => {
              const isSelected = selectedProjectId === prj.id && activeTab === 'project';
              return (
                <button
                  key={prj.id}
                  onClick={() => {
                    setSelectedProjectId(prj.id);
                    setActiveTab('project');
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 text-indigo-700 font-semibold border-l-2 border-indigo-600'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="h-2 w-2 rounded-full bg-indigo-500 flex-shrink-0"></span>
                    <span className="truncate">{prj.title}</span>
                  </div>
                  <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-300'}`} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Settings & Persona User Card */}
      <div className="p-4 border-t border-slate-100 space-y-3">
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'settings'
              ? 'bg-indigo-50 text-indigo-600 font-semibold'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Settings className="h-4 w-4 text-slate-400" />
          <span>Configuración System</span>
        </button>

        <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3 border border-slate-100">
          <img
            src={currentUser.avatar}
            alt={currentUser.name}
            className="w-9 h-9 rounded-full bg-slate-200 border-2 border-white shadow-xs object-cover flex-shrink-0"
          />
          <div className="overflow-hidden min-w-0">
            <p className="text-xs font-bold text-slate-900 truncate">{currentUser.name}</p>
            <p className="text-[10px] text-slate-500 truncate">{currentUser.roleName}</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
