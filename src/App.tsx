import React from 'react';
import { ApiBootstrapProvider } from './context/ApiBootstrapContext';
import { NexusProvider, useNexus } from './context/NexusContext';
import { SchedulingProvider } from './context/SchedulingContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { UniversalObjectDrawer } from './components/layout/UniversalObjectDrawer';
import { CreateObjectModal } from './components/layout/CreateObjectModal';
import { CommandPalette } from './components/layout/CommandPalette';
import { ModuleErrorBoundary } from './components/system/ModuleErrorBoundary';

const WorkspaceHome = React.lazy(() => import('./components/views/WorkspaceHome').then((m) => ({ default: m.WorkspaceHome })));
const MyWorkView = React.lazy(() => import('./components/views/MyWorkView').then((m) => ({ default: m.MyWorkView })));
const ProjectsOverviewView = React.lazy(() => import('./components/views/ProjectsOverviewView').then((m) => ({ default: m.ProjectsOverviewView })));
const ProjectCenter = React.lazy(() => import('./components/views/ProjectCenter').then((m) => ({ default: m.ProjectCenter })));
const WorkBoardsConfigOptionsV1View = React.lazy(() => import('./components/views/WorkBoardsConfigOptionsV1View').then((m) => ({ default: m.WorkBoardsConfigOptionsV1View })));
const WorkCalendarTimelineV1View = React.lazy(() => import('./components/views/WorkCalendarTimelineV1View').then((m) => ({ default: m.WorkCalendarTimelineV1View })));
const PortfoliosView = React.lazy(() => import('./components/views/PortfoliosView').then((m) => ({ default: m.PortfoliosView })));
const ResourceManagementView = React.lazy(() => import('./components/views/ResourceManagementView').then((m) => ({ default: m.ResourceManagementView })));
const MaterialsInventoryV2View = React.lazy(() => import('./components/views/MaterialsInventoryV2View').then((m) => ({ default: m.MaterialsInventoryV2View })));
const CostControlV2View = React.lazy(() => import('./components/views/CostControlV2View').then((m) => ({ default: m.CostControlV2View })));
const AutomationsV2View = React.lazy(() => import('./components/views/AutomationsV2View').then((m) => ({ default: m.AutomationsV2View })));
const GovernanceRiskView = React.lazy(() => import('./components/views/GovernanceRiskView').then((m) => ({ default: m.GovernanceRiskView })));
const MeetingsDecisionsView = React.lazy(() => import('./components/views/MeetingsDecisionsView').then((m) => ({ default: m.MeetingsDecisionsView })));
const DocumentsApprovalsView = React.lazy(() => import('./components/views/DocumentsApprovalsView').then((m) => ({ default: m.DocumentsApprovalsView })));
const TimelineView = React.lazy(() => import('./components/views/TimelineView').then((m) => ({ default: m.TimelineView })));
const ExecutiveDashboard = React.lazy(() => import('./components/views/ExecutiveDashboard').then((m) => ({ default: m.ExecutiveDashboard })));
const SettingsV2View = React.lazy(() => import('./components/views/SettingsV2View').then((m) => ({ default: m.SettingsV2View })));
const PmoCommandCenterV1H4View = React.lazy(() => import('./components/views/PmoCommandCenterV1H4View').then((m) => ({ default: m.PmoCommandCenterV1H4View })));
const SapIntegrationCenterV1G1View = React.lazy(() => import('./components/views/SapIntegrationCenterV1G1View').then((m) => ({ default: m.SapIntegrationCenterV1G1View })));
const SapProcurementV1G3View = React.lazy(() => import('./components/views/SapProcurementV1G3View').then((m) => ({ default: m.SapProcurementV1G3View })));
const SapInventoryV1G4View = React.lazy(() => import('./components/views/SapInventoryV1G4View').then((m) => ({ default: m.SapInventoryV1G4View })));
const SapCommandCenterV1H1View = React.lazy(() => import('./components/views/SapCommandCenterV1H1View').then((m) => ({ default: m.SapCommandCenterV1H1View })));

const RouteFallback: React.FC = () => (
  <div className="mx-auto flex min-h-[360px] w-full max-w-[1660px] items-center justify-center px-6 py-10 lg:px-8">
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm" role="status" aria-live="polite">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
      <div>
        <p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-700">Bridata</p>
        <p className="mt-0.5 text-xs font-semibold text-slate-500">Cargando módulo operativo…</p>
      </div>
    </div>
  </div>
);

const MainContentRouter: React.FC = () => {
  const { activeTab } = useNexus();

  let content: React.ReactNode;
  switch (activeTab) {
    case 'home': content = <WorkspaceHome />; break;
    case 'inbox': content = <MyWorkView />; break;
    case 'pmo': content = <PmoCommandCenterV1H4View />; break;
    case 'projects': content = <ProjectsOverviewView />; break;
    case 'project': content = <ProjectCenter />; break;
    case 'boards': content = <WorkBoardsConfigOptionsV1View />; break;
    case 'calendar': content = <WorkCalendarTimelineV1View />; break;
    case 'portfolios': content = <PortfoliosView />; break;
    case 'resources': content = <ResourceManagementView />; break;
    case 'materials': content = <MaterialsInventoryV2View />; break;
    case 'sap': content = <SapCommandCenterV1H1View />; break;
    case 'procurement': content = <SapProcurementV1G3View />; break;
    case 'inventory': content = <SapInventoryV1G4View />; break;
    case 'costs': content = <CostControlV2View />; break;
    case 'integrations': content = <SapIntegrationCenterV1G1View />; break;
    case 'automations': content = <AutomationsV2View />; break;
    case 'governance': content = <GovernanceRiskView />; break;
    case 'meetings': content = <MeetingsDecisionsView />; break;
    case 'documents': content = <DocumentsApprovalsView />; break;
    case 'timeline': content = <TimelineView />; break;
    case 'reports': content = <ExecutiveDashboard />; break;
    case 'settings': content = <SettingsV2View />; break;
    default: content = <WorkspaceHome />;
  }

  return (
    <ModuleErrorBoundary resetKey={activeTab}>
      <React.Suspense fallback={<RouteFallback />}>{content}</React.Suspense>
    </ModuleErrorBoundary>
  );
};

export function App() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);

  return (
    <ApiBootstrapProvider>
      <NexusProvider>
        <SchedulingProvider>
          <div className="flex h-dvh w-screen overflow-hidden bg-[#F4F7F5] font-sans text-slate-900 selection:bg-green-200 selection:text-green-950">
            <Sidebar mobileOpen={mobileSidebarOpen} onMobileClose={() => setMobileSidebarOpen(false)} />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F4F7F5]">
              <Header onOpenMobileSidebar={() => setMobileSidebarOpen(true)} />
              <main className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#F7FAF8_0%,#F3F6F4_100%)]" id="main-content">
                <MainContentRouter />
              </main>
            </div>
            <UniversalObjectDrawer />
            <CreateObjectModal />
            <CommandPalette />
          </div>
        </SchedulingProvider>
      </NexusProvider>
    </ApiBootstrapProvider>
  );
}

export default App;
