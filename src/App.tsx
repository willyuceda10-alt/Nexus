import React from 'react';
import { ApiBootstrapProvider } from './context/ApiBootstrapContext';
import { NexusProvider, useNexus } from './context/NexusContext';
import { SchedulingProvider } from './context/SchedulingContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { UniversalObjectDrawer } from './components/layout/UniversalObjectDrawer';
import { CreateObjectModal } from './components/layout/CreateObjectModal';
import { CommandPalette } from './components/layout/CommandPalette';

import { WorkspaceHome } from './components/views/WorkspaceHome';
import { MyWorkView } from './components/views/MyWorkView';
import { ProjectsOverviewView } from './components/views/ProjectsOverviewView';
import { ProjectCenter } from './components/views/ProjectCenter';
import { WorkBoardsConfigOptionsV1View } from './components/views/WorkBoardsConfigOptionsV1View';
import { WorkCalendarTimelineV1View } from './components/views/WorkCalendarTimelineV1View';
import { PortfoliosView } from './components/views/PortfoliosView';
import { ResourceManagementView } from './components/views/ResourceManagementView';
import { MaterialsInventoryV2View } from './components/views/MaterialsInventoryV2View';
import { CostControlV2View } from './components/views/CostControlV2View';
import { AutomationsV2View } from './components/views/AutomationsV2View';
import { GovernanceRiskView } from './components/views/GovernanceRiskView';
import { MeetingsDecisionsView } from './components/views/MeetingsDecisionsView';
import { DocumentsApprovalsView } from './components/views/DocumentsApprovalsView';
import { TimelineView } from './components/views/TimelineView';
import { ExecutiveDashboard } from './components/views/ExecutiveDashboard';
import { SettingsV2View } from './components/views/SettingsV2View';

const SapIntegrationCenterV1G1View = React.lazy(() =>
  import('./components/views/SapIntegrationCenterV1G1View').then((module) => ({ default: module.SapIntegrationCenterV1G1View })),
);
const SapProcurementV1G3View = React.lazy(() =>
  import('./components/views/SapProcurementV1G3View').then((module) => ({ default: module.SapProcurementV1G3View })),
);
const SapInventoryV1G4View = React.lazy(() =>
  import('./components/views/SapInventoryV1G4View').then((module) => ({ default: module.SapInventoryV1G4View })),
);
const SapCommandCenterV1H1View = React.lazy(() =>
  import('./components/views/SapCommandCenterV1H1View').then((module) => ({ default: module.SapCommandCenterV1H1View })),
);

const RouteFallback: React.FC = () => (
  <div className="mx-auto flex min-h-[360px] w-full max-w-[1660px] items-center justify-center px-6 py-10 lg:px-8">
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">Bridata</p>
        <p className="mt-0.5 text-[11px] font-semibold text-slate-500">Cargando módulo operativo…</p>
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

  return <React.Suspense fallback={<RouteFallback />}>{content}</React.Suspense>;
};

export function App() {
  return (
    <ApiBootstrapProvider>
      <NexusProvider>
        <SchedulingProvider>
          <div className="flex h-screen w-screen overflow-hidden bg-[#F4F7F5] font-sans text-slate-900 selection:bg-green-200 selection:text-green-950">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F4F7F5]">
              <Header />
              <main className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#F7FAF8_0%,#F3F6F4_100%)]">
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
