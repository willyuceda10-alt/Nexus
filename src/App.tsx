import React from 'react';

import {
  ApiBootstrapProvider,
} from './context/ApiBootstrapContext';

import {
  NexusProvider,
  useNexus,
} from './context/NexusContext';

import {
  SchedulingProvider,
} from './context/SchedulingContext';

import {
  Header,
} from './components/layout/Header';

import {
  Sidebar,
} from './components/layout/Sidebar';

import {
  WorkspaceHome,
} from './components/views/WorkspaceHome';


/*
 * F1.1
 *
 * Home remains eager because it is the initial Bridata view.
 * The remaining operational modules are loaded only when selected.
 */

const MyWorkView =
  React.lazy(
    () =>
      import(
        './components/views/MyWorkView'
      ).then(
        (module) => ({
          default:
            module.MyWorkView,
        }),
      ),
  );

const ProjectsOverviewView =
  React.lazy(
    () =>
      import(
        './components/views/ProjectsOverviewView'
      ).then(
        (module) => ({
          default:
            module.ProjectsOverviewView,
        }),
      ),
  );

const ProjectCenter =
  React.lazy(
    () =>
      import(
        './components/views/ProjectCenter'
      ).then(
        (module) => ({
          default:
            module.ProjectCenter,
        }),
      ),
  );

const WorkBoardsConfigOptionsV1View =
  React.lazy(
    () =>
      import(
        './components/views/WorkBoardsConfigOptionsV1View'
      ).then(
        (module) => ({
          default:
            module.WorkBoardsConfigOptionsV1View,
        }),
      ),
  );

const WorkCalendarTimelineV1View =
  React.lazy(
    () =>
      import(
        './components/views/WorkCalendarTimelineV1View'
      ).then(
        (module) => ({
          default:
            module.WorkCalendarTimelineV1View,
        }),
      ),
  );

const PortfoliosView =
  React.lazy(
    () =>
      import(
        './components/views/PortfoliosView'
      ).then(
        (module) => ({
          default:
            module.PortfoliosView,
        }),
      ),
  );

const ResourceManagementView =
  React.lazy(
    () =>
      import(
        './components/views/ResourceManagementView'
      ).then(
        (module) => ({
          default:
            module.ResourceManagementView,
        }),
      ),
  );

const MaterialsInventoryV2View =
  React.lazy(
    () =>
      import(
        './components/views/MaterialsInventoryV2View'
      ).then(
        (module) => ({
          default:
            module.MaterialsInventoryV2View,
        }),
      ),
  );

const CostControlV2View =
  React.lazy(
    () =>
      import(
        './components/views/CostControlV2View'
      ).then(
        (module) => ({
          default:
            module.CostControlV2View,
        }),
      ),
  );

const AutomationsV2View =
  React.lazy(
    () =>
      import(
        './components/views/AutomationsV2View'
      ).then(
        (module) => ({
          default:
            module.AutomationsV2View,
        }),
      ),
  );

const GovernanceRiskView =
  React.lazy(
    () =>
      import(
        './components/views/GovernanceRiskView'
      ).then(
        (module) => ({
          default:
            module.GovernanceRiskView,
        }),
      ),
  );

const MeetingsDecisionsView =
  React.lazy(
    () =>
      import(
        './components/views/MeetingsDecisionsView'
      ).then(
        (module) => ({
          default:
            module.MeetingsDecisionsView,
        }),
      ),
  );

const DocumentsApprovalsView =
  React.lazy(
    () =>
      import(
        './components/views/DocumentsApprovalsView'
      ).then(
        (module) => ({
          default:
            module.DocumentsApprovalsView,
        }),
      ),
  );

const TimelineView =
  React.lazy(
    () =>
      import(
        './components/views/TimelineView'
      ).then(
        (module) => ({
          default:
            module.TimelineView,
        }),
      ),
  );

const ExecutiveDashboard =
  React.lazy(
    () =>
      import(
        './components/views/ExecutiveDashboard'
      ).then(
        (module) => ({
          default:
            module.ExecutiveDashboard,
        }),
      ),
  );

const SettingsV2View =
  React.lazy(
    () =>
      import(
        './components/views/SettingsV2View'
      ).then(
        (module) => ({
          default:
            module.SettingsV2View,
        }),
      ),
  );

const SapIntegrationCenterV1G1View =
  React.lazy(
    () =>
      import(
        './components/views/SapIntegrationCenterV1G1View'
      ).then(
        (module) => ({
          default:
            module.SapIntegrationCenterV1G1View,
        }),
      ),
  );

const SapProcurementV1G3View =
  React.lazy(
    () =>
      import(
        './components/views/SapProcurementV1G3View'
      ).then(
        (module) => ({
          default:
            module.SapProcurementV1G3View,
        }),
      ),
  );

const SapInventoryV1G4View =
  React.lazy(
    () =>
      import(
        './components/views/SapInventoryV1G4View'
      ).then(
        (module) => ({
          default:
            module.SapInventoryV1G4View,
        }),
      ),
  );


/*
 * Large global overlays are also deferred.
 * They are not downloaded until the user actually opens them.
 */

const UniversalObjectDrawer =
  React.lazy(
    () =>
      import(
        './components/layout/UniversalObjectDrawer'
      ).then(
        (module) => ({
          default:
            module.UniversalObjectDrawer,
        }),
      ),
  );

const CreateObjectModal =
  React.lazy(
    () =>
      import(
        './components/layout/CreateObjectModal'
      ).then(
        (module) => ({
          default:
            module.CreateObjectModal,
        }),
      ),
  );

const CommandPalette =
  React.lazy(
    () =>
      import(
        './components/layout/CommandPalette'
      ).then(
        (module) => ({
          default:
            module.CommandPalette,
        }),
      ),
  );


const ViewLoading: React.FC =
  () => (
    <div
      className="
        flex
        min-h-[240px]
        w-full
        items-center
        justify-center
        px-6
        py-10
      "
      role="status"
      aria-live="polite"
      aria-label="Cargando módulo"
    >
      <div
        className="
          flex
          items-center
          gap-3
          rounded-xl
          border
          border-slate-200
          bg-white/90
          px-5
          py-3
          text-sm
          font-medium
          text-slate-600
          shadow-sm
        "
      >
        <span
          className="
            h-4
            w-4
            animate-spin
            rounded-full
            border-2
            border-emerald-200
            border-t-emerald-600
          "
          aria-hidden="true"
        />

        Cargando módulo…
      </div>
    </div>
  );


const MainContentRouter:
React.FC =
  () => {
    const {
      activeTab,
    } =
      useNexus();

    let content:
      React.ReactNode;

    switch (activeTab) {
      case 'home':
        content =
          <WorkspaceHome />;
        break;

      case 'inbox':
        content =
          <MyWorkView />;
        break;

      case 'projects':
        content =
          <ProjectsOverviewView />;
        break;

      case 'project':
        content =
          <ProjectCenter />;
        break;

      case 'boards':
        content =
          <WorkBoardsConfigOptionsV1View />;
        break;

      case 'calendar':
        content =
          <WorkCalendarTimelineV1View />;
        break;

      case 'portfolios':
        content =
          <PortfoliosView />;
        break;

      case 'resources':
        content =
          <ResourceManagementView />;
        break;

      case 'materials':
        content =
          <MaterialsInventoryV2View />;
        break;

      case 'procurement':
        content =
          <SapProcurementV1G3View />;
        break;

      case 'inventory':
        content =
          <SapInventoryV1G4View />;
        break;

      case 'costs':
        content =
          <CostControlV2View />;
        break;

      case 'integrations':
        content =
          <SapIntegrationCenterV1G1View />;
        break;

      case 'automations':
        content =
          <AutomationsV2View />;
        break;

      case 'governance':
        content =
          <GovernanceRiskView />;
        break;

      case 'meetings':
        content =
          <MeetingsDecisionsView />;
        break;

      case 'documents':
        content =
          <DocumentsApprovalsView />;
        break;

      case 'timeline':
        content =
          <TimelineView />;
        break;

      case 'reports':
        content =
          <ExecutiveDashboard />;
        break;

      case 'settings':
        content =
          <SettingsV2View />;
        break;

      default:
        content =
          <WorkspaceHome />;
        break;
    }

    return (
      <React.Suspense
        fallback={
          <ViewLoading />
        }
      >
        {content}
      </React.Suspense>
    );
  };


const AppShell:
React.FC =
  () => {
    const [
      mobileNavigationOpen,
      setMobileNavigationOpen,
    ] =
      React.useState(
        false,
      );

    React.useEffect(
      () => {
        if (
          !mobileNavigationOpen
        ) {
          return;
        }

        const handleKeyDown =
          (
            event:
              KeyboardEvent,
          ) => {
            if (
              event.key ===
              'Escape'
            ) {
              setMobileNavigationOpen(
                false,
              );
            }
          };

        document.addEventListener(
          'keydown',
          handleKeyDown,
        );

        return () => {
          document.removeEventListener(
            'keydown',
            handleKeyDown,
          );
        };
      },
      [
        mobileNavigationOpen,
      ],
    );

    const {
      isDrawerOpen,
      isCreateModalOpen,
      isCommandPaletteOpen,
    } =
      useNexus();

    return (
      <div
        className="
          flex
          h-screen
          w-screen
          overflow-hidden
          bg-[#F4F7F5]
          font-sans
          text-slate-900
          selection:bg-green-200
          selection:text-green-950
        "
      >
        {mobileNavigationOpen ? (
          <button
            type="button"
            className="
              fixed
              inset-0
              z-40
              bg-slate-950/35
              backdrop-blur-[1px]
              lg:hidden
            "
            aria-label="Cerrar navegación"
            onClick={() =>
              setMobileNavigationOpen(
                false,
              )
            }
          />
        ) : null}

        <Sidebar
          mobileOpen={
            mobileNavigationOpen
          }
          onNavigate={() =>
            setMobileNavigationOpen(
              false,
            )
          }
        />

        <div
          className="
            flex
            min-w-0
            flex-1
            flex-col
            overflow-hidden
            bg-[#F4F7F5]
          "
        >
          <Header
            onOpenNavigation={() =>
              setMobileNavigationOpen(
                true,
              )
            }
          />

          <main
            className="
              flex-1
              overflow-y-auto
              bg-[linear-gradient(180deg,#F7FAF8_0%,#F3F6F4_100%)]
            "
          >
            <MainContentRouter />
          </main>
        </div>


        {isDrawerOpen ? (
          <React.Suspense
            fallback={null}
          >
            <UniversalObjectDrawer />
          </React.Suspense>
        ) : null}


        {isCreateModalOpen ? (
          <React.Suspense
            fallback={null}
          >
            <CreateObjectModal />
          </React.Suspense>
        ) : null}


        {isCommandPaletteOpen ? (
          <React.Suspense
            fallback={null}
          >
            <CommandPalette />
          </React.Suspense>
        ) : null}
      </div>
    );
  };


export function App() {
  return (
    <ApiBootstrapProvider>
      <NexusProvider>
        <SchedulingProvider>
          <AppShell />
        </SchedulingProvider>
      </NexusProvider>
    </ApiBootstrapProvider>
  );
}

export default App;
