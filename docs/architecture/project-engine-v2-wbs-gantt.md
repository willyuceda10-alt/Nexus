# Project Engine V2 — WBS + Gantt Editor

## Goal

Provide Bridata with a native project planning editor that combines a canonical Work Breakdown Structure (WBS) and the Project Engine V2 scheduling calculation without depending on Microsoft Project.

This is an additive transition. The existing V1 Gantt remains available as the mock/offline fallback while API mode uses the V2 editor.

## Core design decisions

### NexusObject remains the work-item identity

Tasks, deliverables and milestones remain `NexusObject` records. High-integrity scheduling state remains in `WorkItemSchedule`.

### A phase is a WBS summary task

There is no new `PHASE` object type and no `isSummary` custom field.

A node is a summary task when another WBS node references it as `parentWorkItemId`. This means phase/summary semantics are structural and cannot drift away from the hierarchy.

### The backend canonicalizes the WBS

The frontend submits only ordered intent:

```json
{
  "items": [
    { "objectId": "...", "parentWorkItemId": null },
    { "objectId": "...", "parentWorkItemId": "..." }
  ]
}
```

`canonicalizeWbsV2()` validates the graph and derives:

- `outlineLevel`
- `sortOrder`
- `wbsCode`
- `isSummary`

The server rejects duplicate objects, missing parents, self-parenting and cycles.

WBS codes use depth-first numbering such as:

```text
1
1.1
1.2
1.2.1
2
```

## API

### Read project WBS

```http
GET /api/v1/projects/:projectId/wbs-v2
```

Returns project scheduling context, canonical nodes and V1/V2 migration status.

### Persist project WBS

```http
PUT /api/v1/projects/:projectId/wbs-v2
```

The request must contain every active schedulable project object exactly once. This protects the project against accidentally dropping rows during hierarchy edits.

The update executes inside the tenant-scoped transaction and requires project-management permission for the workspace.

For fallback V1 rows without `WorkItemSchedule`, the operation creates the typed scheduling extension automatically before persisting hierarchy data.

### Work-item scheduling

The editor continues to use:

```http
PATCH /api/v1/work-items/:id/schedule
```

for typed duration, remaining duration, constraints and actual fields.

### Scheduling calculation

The editor uses:

```http
GET /api/v1/projects/:projectId/schedule-analysis-v2
```

for CPM, float, critical path, planned dates and violations.

## Summary-task scheduling semantics

Summary tasks are **not** independent CPM activities.

`schedule-analysis-v2` detects summary IDs from `parentWorkItemId` and excludes them from the CPM graph. This prevents a phase duration from being counted in addition to its children.

The web editor rolls summary bars up from descendants:

- summary start = earliest descendant start
- summary finish = latest descendant finish
- summary critical indicator = at least one descendant is critical

Dependencies in the current editor are created only between leaf activities. This avoids ambiguous summary-to-summary scheduling semantics during V2 rollout.

## Editor capabilities

API mode exposes a Project-style planning surface with:

- WBS code
- task / milestone / summary identification
- expandable summary rows
- inline title editing
- inline duration editing in working-day equivalents
- progress editing
- planned start and finish
- total float
- constraints and constraint dates
- predecessor management
- FS / SS / FF / SF
- lead / lag in days through the V1 compatibility API and V2 dual-write
- critical-path highlighting
- milestone diamonds
- summary roll-up bars
- target-finish marker
- timeline zoom
- recalculation
- immutable baseline capture
- V1/V2 migration status and project-scoped backfill

Hierarchy controls:

- indent
- outdent
- move up
- move down
- collapse / expand summaries

A subtask is a normal task indented below another WBS item. A phase becomes a summary automatically when it gains descendants.

## Compatibility

### API mode

Uses `WbsGanttV2View` and Project Engine V2 endpoints.

### Mock mode

`WbsGanttV2View` delegates to the existing V1 `GanttView` because mock data has no typed V2 backend.

This keeps local demonstrations working while production architecture moves to typed scheduling.

## Multi-tenant safety

All WBS reads and writes execute under `withTenant(actor.tenantId)` and the underlying scheduling tables use PostgreSQL FORCE RLS.

The client never supplies or controls a tenant ID for WBS mutation.

## Audit and events

A successful WBS write emits:

```text
bridata.project.wbs.updated
```

and writes:

```text
PROJECT_WBS_UPDATED
```

to the audit log.

## Current precision

The schedule engine remains at:

```text
WORKING_MINUTES_DATE_BUCKETED_V2
```

Durations and lag are stored/calculated in working minutes, while the current Gantt renders date buckets. Intraday shifts and exact clock-time bars are a future enhancement and are intentionally not simulated yet.

## Validation status

This branch was developed without opening a pull request or merging to `main` because GitHub Actions quota is currently unavailable.

Unit tests for WBS canonicalization and frontend hierarchy helpers are committed, but CI/typecheck/test/build must not be reported as passing until they are actually executed.
