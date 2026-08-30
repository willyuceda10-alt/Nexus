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
import { SapIntegrationCenterV1G1View } from './components/views/SapIntegrationCenterV1G1View';
import { SapProcurementV1G3View } from './components/views/SapProcurementV1G3View';

const MainContentRouter: React.FC = () => {
  const { activeTab } = useNexus();

  switch (activeTab) {
    case 'home': return <WorkspaceHome />;
    case 'inbox': return <MyWorkView />;
    case 'projects': return <ProjectsOverviewView />;
    case 'project': return <ProjectCenter />;
    case 'boards': return <WorkBoardsConfigOptionsV1View />;
    case 'calendar': return <WorkCalendarTimelineV1View />;
    case 'portfolios': return <PortfoliosView />;
    case 'resources': return <ResourceManagementView />;
    case 'materials': return <MaterialsInventoryV2View />;
    case 'procurement': return <SapProcurementV1G3View />;
    case 'costs': return <CostControlV2View />;
    case 'integrations': return <SapIntegrationCenterV1G1View />;
    case 'automations': return <AutomationsV2View />;
    case 'governance': return <GovernanceRiskView />;
    case 'meetings': return <MeetingsDecisionsView />;
    case 'documents': return <DocumentsApprovalsView />;
    case 'timeline': return <TimelineView />;
    case 'reports': return <ExecutiveDashboard />;
    case 'settings': return <SettingsV2View />;
    default: return <WorkspaceHome />;
  }
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
