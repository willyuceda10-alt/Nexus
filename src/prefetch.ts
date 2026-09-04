/*
 * F2 — Navigation prefetch registry
 *
 * Each entry fires the same dynamic import used by React.lazy in App.tsx.
 * Vite deduplicates these imports into the same chunk and caches the
 * resolved module promise, so calling a prefetch function multiple times
 * or after the chunk has already loaded is a no-op.
 *
 * Call prefetchView(tabId) on pointer enter of a sidebar link so the
 * chunk is in-flight before the user clicks.
 */

const registry: Record<string, () => Promise<unknown>> = {
  inbox:       () => import('./components/views/MyWorkView'),
  projects:    () => import('./components/views/ProjectsOverviewView'),
  project:     () => import('./components/views/ProjectCenter'),
  boards:      () => import('./components/views/WorkBoardsConfigOptionsV1View'),
  calendar:    () => import('./components/views/WorkCalendarTimelineV1View'),
  portfolios:  () => import('./components/views/PortfoliosView'),
  timeline:    () => import('./components/views/TimelineView'),
  resources:   () => import('./components/views/ResourceManagementView'),
  materials:   () => import('./components/views/MaterialsInventoryV2View'),
  procurement: () => import('./components/views/SapProcurementV1G3View'),
  inventory:   () => import('./components/views/SapInventoryV1G4View'),
  costs:       () => import('./components/views/CostControlV2View'),
  governance:  () => import('./components/views/GovernanceRiskView'),
  integrations:() => import('./components/views/SapIntegrationCenterV1G1View'),
  automations: () => import('./components/views/AutomationsV2View'),
  meetings:    () => import('./components/views/MeetingsDecisionsView'),
  documents:   () => import('./components/views/DocumentsApprovalsView'),
  reports:     () => import('./components/views/ExecutiveDashboard'),
  settings:    () => import('./components/views/SettingsV2View'),
};

export function prefetchView(tabId: string): void {
  registry[tabId]?.().catch(() => {});
}

export function prefetchCommandPalette(): void {
  import('./components/layout/CommandPalette').catch(() => {});
}

export function prefetchCreateModal(): void {
  import('./components/layout/CreateObjectModal').catch(() => {});
}
