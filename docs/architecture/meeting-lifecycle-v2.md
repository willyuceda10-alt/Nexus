# Meeting Lifecycle V2

## Scope

Meeting Lifecycle V2 adds controlled rescheduling and cancellation on top of Meeting Scheduling V2. Bridata remains the canonical meeting store; Microsoft 365 is synchronized asynchronously.

## Lifecycle vs synchronization

These are separate concerns:

- `lifecycle_status`: `SCHEDULED`, `CANCEL_PENDING`, `CANCELLED`
- `sync_status`: `LOCAL_ONLY`, `PENDING`, `SYNCED`, `FAILED`

A meeting can therefore be `CANCEL_PENDING + FAILED` when Bridata already cancelled it locally but Microsoft Graph has not yet accepted the cancellation.

## Reschedule

`PUT /api/v1/meetings-v2/:meetingObjectId/reschedule`

The operation:

1. validates optimistic object version;
2. validates organizer/workspace manager authorization;
3. rejects non-scheduled meetings;
4. keeps existing attendees and resources;
5. requires M365 availability when the meeting is already synchronized or sync is requested;
6. updates NexusObject dates and collaboration dates in one tenant-scoped transaction;
7. emits `bridata.meeting.m365.sync.requested` when external sync is required;
8. PostgreSQL rejects resource overlaps using advisory locks.

### Existing Outlook event limitation

`getSchedule` does not identify the meeting itself inside `availabilityView`. For an already-synchronized event, a new interval that partially overlaps the old interval can therefore appear busy because of the current meeting. V2 fails closed for that case and requires a non-overlapping new interval. A later implementation may use calendarView/event IDs for precise self-event exclusion.

## Cancel

`POST /api/v1/meetings-v2/:meetingObjectId/cancel`

Cancellation is canonical-first:

1. NexusObject status becomes `CANCELLED`;
2. resource bookings are deleted immediately;
3. join/outlook links are cleared immediately by a DB trigger;
4. if there is no Graph event, lifecycle becomes `CANCELLED` immediately;
5. if a Graph event exists, lifecycle becomes `CANCEL_PENDING` and a cancellation DomainEvent is emitted;
6. the meeting worker calls Microsoft Graph event cancel;
7. on success lifecycle becomes `CANCELLED`;
8. on failure lifecycle remains `CANCEL_PENDING`, `sync_status=FAILED`, and retry is possible.

Microsoft Graph cancellation uses the organizer endpoint and `Calendars.ReadWrite`.

## Retry cancellation

`POST /api/v1/meetings-v2/:meetingObjectId/retry-cancel`

Only organizer/workspace management can request retry. The same worker/subscription is reused; there is no second M365 runtime.

## Worker race protection

The normal sync runner refuses to process `bridata.meeting.m365.sync.requested` when lifecycle is no longer `SCHEDULED`. It also re-checks lifecycle after the Graph request before writing the successful sync projection. This prevents a delayed sync message from reviving a cancelled meeting.

## Database guards

- lifecycle integrity validates cancelled timestamps and cancellation actor scope;
- resource overlap guard protects reschedules;
- cancel-link guard removes active join/outlook URLs as soon as cancellation begins;
- existing RLS/FORCE RLS remains authoritative.

## UI

The Meeting Center now composes:

1. Meeting Lifecycle V2
2. Meeting Scheduling V2
3. Meeting Resources V1
4. meeting calendar / Teams / decisions

The lifecycle panel provides reschedule, cancel and retry-cancel actions while keeping cancelled meetings visible for audit/history.

## Deliberate V2 boundaries

Not yet included:

- recurring meeting series;
- single-occurrence editing of recurrence;
- Graph calendarView self-event exclusion;
- undo cancellation;
- attendee response tracking;
- delegated mailbox workflows.

## Validation required before Azure DEV

Do not deploy this branch until Prisma validate/generate, API/web typecheck, tests, build, migrations, Bicep validation, resource-concurrency tests and Microsoft Graph lifecycle smoke tests have been executed.
