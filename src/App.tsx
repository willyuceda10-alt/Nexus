import React from 'react';
import { RuntimeAuthGate } from './auth/RuntimeAuthGate';
import { RuntimeAuthProvider } from './auth/RuntimeAuthContext';
import { ApiBootstrapProvider } from './context/ApiBootstrapContext';
import { NexusProvider, useNexus } from './context/NexusContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { UniversalObjectDrawer } from './components/layout/UniversalObjectDrawer';
import { CreateObjectModal } from './components/layout/CreateObjectModal';
import { CommandPalette } from './components/layout/CommandPalette';

import { WorkspaceHome } from './components/views/WorkspaceHome';
import { ProjectCenter } from './components/views/ProjectCenter';
import { PortfoliosView } from './components/views/PortfoliosView';
import { GovernanceRiskView } from './components/views/GovernanceRiskView';
import { MeetingsDecisionsView } from './components/views/MeetingsDecisionsView';
import { DocumentsApprovalsView } from './components/views/DocumentsApprovalsView';
import { TimelineView } from './components/views/TimelineView';
import { ExecutiveDashboard } from './components/views/ExecutiveDashboard';
import { SettingsView } from './components/views/SettingsView';

const MainContentRouter: React.FC = () => {
  const { activeTab } = useNexus();

  switch (activeTab) {
    case 'home':
      return <WorkspaceHome />;
    case 'project':
    case 'projects':
      return <ProjectCenter />;
    case 'portfolios':
      return <PortfoliosView />;
    case 'governance':
      return <GovernanceRiskView />;
    case 'meetings':
      return <MeetingsDecisionsView />;
    case 'documents':
      return <DocumentsApprovalsView />;
    case 'timeline':
      return <TimelineView />;
    case 'reports':
      return <ExecutiveDashboard />;
    case 'settings':
      return <SettingsView />;
    case 'inbox':
      return <GovernanceRiskView />;
    default:
      return <WorkspaceHome />;
  }
};

const AuthenticatedApplication: React.FC = () => (
  <ApiBootstrapProvider>
    <NexusProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-500 selection:text-white">
        <Sidebar />

        <div className="flex flex-1 flex-col min-w-0 overflow-hidden bg-[#F8FAFC]">
          <Header />

          <main className="flex-1 overflow-y-auto bg-[#F8FAFC]">
            <MainContentRouter />
          </main>
        </div>

        <UniversalObjectDrawer />
        <CreateObjectModal />
        <CommandPalette />
      </div>
    </NexusProvider>
  </ApiBootstrapProvider>
);

export function App() {
  return (
    <RuntimeAuthProvider>
      <RuntimeAuthGate>
        <AuthenticatedApplication />
      </RuntimeAuthGate>
    </RuntimeAuthProvider>
  );
}

export default App;
