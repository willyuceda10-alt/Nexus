# Bridata Project — Project Engine V2 Scheduling Core

## Purpose

This layer evolves the existing V1 CPM engine without replacing it abruptly. V1 remains available while projects are migrated progressively into typed V2 scheduling records.

## What V2 now owns

- working-minute duration semantics;
- typed work calendars;
- weekday capacity;
- calendar exceptions and partial-day capacity;
- FS, SS, FF and SF dependencies;
- lead/lag in minutes;
- forward pass and backward pass;
- early start / early finish;
- late start / late finish;
- total float / free float;
- critical path;
- ASAP / ALAP;
- Must Start On / Must Finish On;
- Start No Earlier Than / Start No Later Than;
- Finish No Earlier Than / Finish No Later Than;
- schedule feasibility violations;
- project target-finish deadline detection.

## Important semantic decision: targetFinish is a deadline

`ProjectScheduleProfile.targetFinish` is treated as a target/deadline. A target later than the natural project finish does not add artificial float and does not erase the real critical path. If the natural finish exceeds the target, V2 emits `PROJECT_TARGET_MISSED`.

Scheduling backward from a fixed finish date is intentionally not enabled by overloading `targetFinish`. If Bridata later supports full “schedule from finish date” behavior, it should be introduced as an explicit project scheduling-direction setting rather than changing target/deadline semantics.

## Calendar precision

The current calculation resolution is `WORKING_MINUTES_DATE_BUCKETED_V2`.

Durations, dependencies and float are calculated in working minutes. Calendar capacity is currently bucketed by date using:

- `workingWeekdays`;
- `minutesPerDay`;
- exceptions with `isWorking`;
- optional exception `workingMinutes`.

The calendar `timezone` is persisted for display/integration consistency, but the current scheduling projection is date-only. Intraday shifts such as 08:00–12:00 / 13:00–17:00 should be added as a later scheduling precision layer instead of pretending that V2 currently computes clock-time timestamps.

## API

### Work calendars

- `GET /api/v1/work-calendars?workspaceId=<uuid>`
- `POST /api/v1/work-calendars`
- `PATCH /api/v1/work-calendars/:id`
- `PUT /api/v1/work-calendars/:id/exceptions/:date`
- `DELETE /api/v1/work-calendars/:id/exceptions/:date`

All operations are tenant-scoped. Writes require workspace management permission.

### Schedule analysis V2

- `GET /api/v1/projects/:projectId/schedule-analysis-v2`

The response includes:

- typed/fallback migration counts;
- calendar source;
- dependency source;
- work-item schedule source;
- ES/EF/LS/LF;
- total/free float;
- planned start/finish dates;
- critical task ids;
- violations;
- feasibility.

V2 can calculate a partially migrated project. Typed rows win; missing rows fall back to V1 without changing the V1 API.

### Backfill

- `POST /api/v1/project-engine-v2/backfill`

Body:

```json
{
  "projectId": "optional-project-uuid",
  "dryRun": true
}
```

`dryRun` defaults to `true` intentionally.

A project-specific backfill requires project/workspace management permission. Tenant-wide backfill requires `OWNER` or `TENANT_ADMIN`.

The backfill:

1. creates or repairs a deterministic migrated calendar;
2. upserts legacy holiday exceptions;
3. creates/attaches the project schedule profile without replacing existing V2 configuration;
4. creates missing typed work-item schedules;
5. creates missing typed dependencies;
6. preserves existing V2 rows;
7. emits audit/domain events only on a real (non-dry-run) execution.

No cross-tenant migration path is used. All reads/writes run inside `withTenant()` so PostgreSQL FORCE RLS remains fail-closed.

## Migration strategy

1. Deploy additive V2 schema.
2. Run backfill with `dryRun=true` for one project.
3. Compare V1 and V2 schedule output.
4. Run the same project with `dryRun=false` only after review.
5. Keep V1 endpoints active.
6. Migrate/edit work items using typed V2 APIs.
7. Move Gantt/WBS UI to the V2 analysis response only after runtime validation.
8. Remove fallback only after all production projects have reached the agreed migration threshold.

## Not yet considered complete

The branch is deliberately not a cutover. These still require runtime validation before deployment:

- Prisma validation;
- TypeScript typecheck;
- unit tests;
- API smoke tests against PostgreSQL with FORCE RLS;
- build;
- V1/V2 parity checks with representative projects.

No GitHub Actions run or Azure deployment should be inferred from this document.
