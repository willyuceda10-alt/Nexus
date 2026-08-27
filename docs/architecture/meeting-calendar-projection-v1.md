# Meeting Calendar Projection V1

## Purpose

The canonical meeting calendar projection gives Bridata one read model for calendar rendering without duplicating recurring meeting masters into fake NexusObjects.

It combines:

- non-recurring `meeting_collaboration_v1` rows; and
- materialized `meeting_recurrence_occurrences_v1` rows.

The endpoint is:

```text
GET /api/v1/meetings-v3/calendar-projection
```

with required `workspaceId`, `startAt`, `endAt` and optional `projectId`.

## Duplicate prevention

A recurring series master is excluded from the simple-meeting part of the projection. Its materialized occurrences are returned instead.

Therefore a four-occurrence series produces four calendar entries, not five entries consisting of one master plus four occurrences.

## Projection item types

```text
MEETING
RECURRING_OCCURRENCE
```

Every item includes the canonical `meetingObjectId`. Recurring entries also include `seriesId`, `occurrenceId`, `sequence` and `isException`.

## Lifecycle

Cancelled and cancel-pending occurrences remain in the projection so calendar history is not silently erased. The UI renders cancelled occurrences as cancelled history instead of treating them as available meetings.

Resource availability remains controlled by database lifecycle/booking guards, not by the visual projection.

## Teams / Outlook links

Simple meetings can expose their already stored `joinUrl` / `webLink`.

Recurring occurrence entries deliberately return `joinUrl = null` and `webLink = null` in V1. Bridata does not assume that the series-master link is the correct operational link for every occurrence until a Microsoft Graph DEV smoke test explicitly validates that behavior or occurrence-specific links are persisted.

Users can still open the canonical meeting master from a recurring calendar entry.

## Scope and security

The route:

- requires authentication and actor resolution;
- checks workspace access through Authorization V2;
- executes under `withTenant()`;
- scopes both simple meetings and recurring occurrences to the requested tenant/workspace/project;
- limits a projection request to at most 370 days.

## Frontend

`CanonicalMeetingsCalendarV1` renders the projection as the top calendar in the meeting center when API mode is available.

Mock mode does not synthesize recurring occurrences; it shows an explanatory placeholder instead.

## Validation required

Before deployment validate:

1. API typecheck/build;
2. projection returns simple meetings once;
3. recurring master is excluded from simple rows;
4. every materialized recurring occurrence is returned once;
5. exception uses its current `start_at` / `end_at`;
6. cancelled occurrence remains visible with cancelled lifecycle;
7. workspace/project isolation;
8. range boundary behavior;
9. browser calendar rendering with mixed simple/recurring data.
