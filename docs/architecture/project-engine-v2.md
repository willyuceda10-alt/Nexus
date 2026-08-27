# Bridata Project — Project Engine V2

## Purpose

Project Engine V2 evolves the existing scheduling engine without replacing the Nexus Object Engine or breaking V1 projects.

The transition is deliberately additive:

1. `NexusObject` remains the universal work/collaboration object.
2. Typed scheduling state moves to relational extension tables.
3. V1 reads remain available while V2 data is progressively populated.
4. New dependency writes are dual-written.
5. CPM can consume V2 duration minutes with V1 date fallback.
6. Baselines are immutable snapshots; legacy metadata only points to the latest snapshot.

## V2 relational model

- `work_calendars`
- `work_calendar_exceptions`
- `project_schedule_profiles`
- `work_item_schedules`
- `schedule_dependencies_v2`
- `project_baselines`
- `project_baseline_items`

All tables are tenant-scoped and use PostgreSQL FORCE RLS.

## Work item scheduling state

V2 introduces explicit fields that must not depend on deriving schedule semantics from `startDate` / `dueDate`:

- parent work item
- WBS code
- outline level
- sort order
- AUTO / MANUAL scheduling
- duration minutes
- remaining duration minutes
- constraint type
- constraint date
- actual start / actual finish
- physical percent complete

`startDate` and `dueDate` remain available during migration and for generic Object Engine views.

## Constraints

The schema reserves the following constraint types:

- AS_SOON_AS_POSSIBLE
- AS_LATE_AS_POSSIBLE
- MUST_START_ON
- MUST_FINISH_ON
- START_NO_EARLIER_THAN
- START_NO_LATER_THAN
- FINISH_NO_EARLIER_THAN
- FINISH_NO_LATER_THAN

The V2 foundation validates and stores constraints. The current CPM compatibility route exposes them with `constraintAppliedToCpm=false`; constraint-aware forward/backward scheduling is a subsequent Project Engine step.

## Dependencies

The existing V1 convention remains:

- `ObjectRelation.relationType = DEPENDS_ON`
- `sourceObjectId = successor`
- `targetObjectId = predecessor`
- metadata contains `dependencyType` and `lagDays`

During transition, create/update/delete operations also synchronize `schedule_dependencies_v2`:

- predecessor / successor are explicit columns
- FS / SS / FF / SF are typed
- lag is stored in minutes
- `legacy_relation_id` links the transition row

V1 remains the dependency read source until tenant-scoped backfill and cutover are complete.

## Why migration does not backfill existing dependencies

Existing tables already run under PostgreSQL `FORCE ROW LEVEL SECURITY`.

A database migration must not disable tenant isolation or perform an unrestricted cross-tenant scan. For that reason the structural migration creates the V2 tables but deliberately does **not** copy old dependency rows.

Backfill must run later through a tenant-scoped application process using `withTenant()` and must be idempotent.

## Baselines

V1 stored baseline values in `NexusObject.metadata`. That representation is retained only as a compatibility pointer.

V2 creates:

- one immutable `ProjectBaseline` header per version;
- immutable `ProjectBaselineItem` snapshots for the project/work items.

Calling the existing baseline endpoint with `overwrite=true` now means **capture a new immutable version**. Previous V2 baselines are preserved.

## API foundation

### Read merged V1/V2 schedule model

`GET /api/v1/projects/:projectId/schedule-model`

Returns:

- schedule profile;
- calendar summary;
- work item schedule state;
- dependencies;
- per-row source (`V2`, `V2_SYNCED`, `V1_FALLBACK`);
- migration counters.

### Update project schedule profile

`PATCH /api/v1/projects/:projectId/schedule-profile`

Management role required.

### Update typed work item schedule

`PATCH /api/v1/work-items/:id/schedule`

Management role required. Parent references must remain in the same project and WBS cycles are rejected.

### Baseline history

`GET /api/v1/projects/:projectId/baselines`

## CPM transition

`GET /api/v1/schedule-analysis` now:

- uses `work_item_schedules.duration_minutes` when available;
- falls back to V1 `startDate` / `dueDate` duration;
- keeps dependency reads on V1 during dual-write;
- reports migration source per scheduled item.

## Next Project Engine V2 steps

1. Validate Prisma schema/migration with local or CI tooling when execution capacity is available.
2. Add tenant-scoped V1→V2 backfill job.
3. Build V2 calendar arithmetic with exceptions and variable working minutes.
4. Apply schedule constraints in forward/backward passes.
5. Make V2 dependencies the read source after backfill verification.
6. Add WBS editor and typed scheduling controls to the web UI.
7. Add baseline comparison/variance API.
8. Connect resource assignments, material availability and cost forecast to scheduling.

## CI status

This branch is intentionally not merged and no pull request is opened while GitHub Actions quota is unavailable. Feature-branch pushes do not match the current CI workflow triggers (`main` push / PR to `main`).
