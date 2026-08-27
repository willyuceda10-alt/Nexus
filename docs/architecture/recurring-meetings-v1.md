# Recurring Meetings V1

## Purpose

Recurring Meetings V1 adds bounded recurring meeting series to Bridata while keeping one canonical `NexusObject` for the series master. Occurrences are typed operational rows, not duplicated NexusObjects.

## Supported scope

V1 supports only:

- `DAILY` recurrence;
- `WEEKLY` recurrence with explicit weekdays;
- `ABSOLUTE_MONTHLY` recurrence by day of month **1 through 28**;
- `NUMBERED` ranges;
- `END_DATE` ranges;
- timezone `America/Lima`;
- up to 120 materialized occurrences and at most 366 days for an END_DATE range;
- one room maximum plus zero or more equipment resources inherited from Meeting Scheduling V2;
- local-only operation or optional Outlook/Teams synchronization.

V1 intentionally does not support:

- no-end recurrence;
- yearly patterns;
- relative monthly patterns such as the second Tuesday;
- absolute-monthly days 29, 30 or 31 until Outlook/Graph DEV smoke tests explicitly validate the desired edge-month behavior;
- changing the recurrence pattern after a series is created;
- series-wide reschedule after an occurrence exception/cancellation exists;
- moving an Outlook-synchronized occurrence across the previous/next occurrence date boundary.

## Canonical model

```text
NexusObject (MEETING master)
  -> meeting_collaboration_v1
      -> meeting_recurrence_series_v1
          -> meeting_recurrence_occurrences_v1
              -> meeting_occurrence_resource_bookings_v1
```

The series master owns title, description, attendees, organizer, Teams/Outlook synchronization state and recurrence rule. Occurrences own their operational date/time, exception/cancellation state, optimistic version and Graph occurrence id when resolved.

## Recurrence expansion

`apps/api/src/domain/meeting-recurrence-v1.ts` materializes the local occurrence set before the database transaction commits. The expansion is deterministic for `America/Lima` and bounded to prevent unbounded storage or request work.

Absolute-monthly V1 accepts only days 1 through 28. This deliberately avoids assuming Outlook/Graph behavior for dates that do not exist in every month. The same 1..28 boundary is enforced by the domain engine and a PostgreSQL check constraint.

## Microsoft Graph mapping

Bridata maps the V1 rule to Microsoft Graph `patternedRecurrence`:

- DAILY -> `pattern.type = daily`
- WEEKLY -> `pattern.type = weekly`
- ABSOLUTE_MONTHLY -> `pattern.type = absoluteMonthly`
- NUMBERED -> `range.type = numbered`
- END_DATE -> `range.type = endDate`

The Graph/Windows timezone used for the Lima series is `SA Pacific Standard Time`; Bridata continues to expose `America/Lima` in its application model.

The existing Meeting Calendar Worker creates/updates the Outlook event. When a recurrence row exists, the event is sent as a recurring series master instead of a simple event.

## Occurrence exceptions

A single occurrence can be rescheduled without modifying the rest of the series. Bridata preserves:

- `original_start_at` for Graph instance resolution;
- current `start_at` / `end_at`;
- `is_exception = true`;
- per-occurrence optimistic `version`.

The worker resolves the real Graph instance through `/events/{seriesMasterId}/instances`, then PATCHes the returned occurrence/exception event id.

The Graph instances request explicitly sends:

```http
Prefer: outlook.timezone="SA Pacific Standard Time"
```

so returned start/end values use the same Lima/Windows timezone used by the recurring master. The API client converts these values back to UTC `Date` objects for comparison with Bridata `original_start_at`.

## Occurrence cancellation

Cancelling one occurrence changes only that occurrence. When a Graph series master exists, the occurrence first enters `CANCEL_PENDING`; the worker resolves the instance id and invokes the existing Graph event cancel action for that instance. On success Bridata stores `CANCELLED` and retains the occurrence as history.

## Series cancellation

Cancelling the whole series delegates to Meeting Lifecycle V2 on the canonical meeting collaboration. A database lifecycle trigger propagates `CANCEL_PENDING` / `CANCELLED` to the materialized occurrences so availability and history remain consistent. The Graph series master cancellation remains asynchronous through the Meeting Calendar Worker.

## Master-sync guard

Occurrence-level M365 mutations are not allowed while the series has entered the M365 sync lifecycle but still has no `graph_event_id`.

The database trigger `bridata_guard_recurring_occurrence_master_sync_v1` rejects occurrence reschedule/cancellation changes when:

- collaboration `sync_status` is not `LOCAL_ONLY`; and
- the Outlook series master `graph_event_id` is still null.

This prevents a delayed master creation from recreating an occurrence that Bridata had already modified or cancelled locally.

A `LOCAL_ONLY` series may continue to use local occurrence exceptions without Graph.

## Resource concurrency

Recurring occurrence resource reservations are separate from simple-meeting bookings. Database guards take an advisory transaction lock by tenant/resource and check overlap across both:

- `meeting_resource_bookings_v1`; and
- `meeting_occurrence_resource_bookings_v1`.

Therefore simple meetings and recurring occurrences cannot double-book the same Bridata-managed room/equipment in overlapping intervals even if two requests race.

## Security

All recurring tables use tenant scope, RLS and FORCE RLS. Workspace authorization is checked before creating or modifying a series. Occurrences use optimistic version checks. PostgreSQL remains the final integrity boundary for cross-scope resource bookings, monthly V1 bounds, lifecycle propagation and master-sync sequencing.

## Availability

When M365 synchronization is requested, each materialized occurrence is checked with the existing Graph `getSchedule` integration before commit. The V1 route enforces the Graph request limit of at most 20 calendar entities in one availability query.

A local-only series can be created without Graph availability.

## Worker event types

The existing meetings Service Bus subscription additionally handles:

- `bridata.meeting.recurrence.occurrence.sync.requested`
- `bridata.meeting.recurrence.occurrence.cancel.requested`

Master series create/update continues to use:

- `bridata.meeting.m365.sync.requested`

Whole-series cancellation continues to use:

- `bridata.meeting.m365.cancel.requested`

No additional Container App or Graph write permission is introduced by Recurring Meetings V1.

## Validation required before deployment

Do not deploy Recurring Meetings V1 until all of the following have been executed successfully in DEV:

1. `npm run prisma:validate`
2. `npm run prisma:generate`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`
6. database migration against DEV
7. PostgreSQL concurrent booking tests across simple and recurring reservations
8. whole-series lifecycle propagation test
9. master-sync occurrence guard test
10. Graph create recurring series smoke test
11. Graph list instances smoke test using `SA Pacific Standard Time`
12. Graph reschedule one occurrence smoke test
13. Graph cancel one occurrence smoke test
14. Graph cancel series smoke test

Until those validations pass, the implementation is code-complete for review but not production-ready.
