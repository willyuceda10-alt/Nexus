# Meeting Scheduling V2

## Purpose

Meeting Scheduling V2 turns meeting creation into one coordinated operation across people, rooms, equipment and Microsoft 365 while keeping Bridata as the canonical system of record.

## Flow

```text
People + external guests + room + equipment
                 |
                 v
       Capacity validation
                 |
                 v
 Microsoft Graph free/busy validation
                 |
                 v
 PostgreSQL transaction
  Meeting + attendees + resource bookings
                 |
                 v
 transactional DomainEvent
                 |
                 v
 Meeting Calendar Worker
                 |
                 v
 Outlook event + Teams meeting
```

## Endpoint

`POST /api/v1/meetings-v2/schedule`

The operation accepts:

- workspace/project context;
- title/description;
- start/end/timezone/location;
- internal attendees;
- external attendee emails;
- one room maximum in V2;
- multiple equipment resources;
- Teams/M365 sync preference;
- availability validation preference.

## Room capacity

Capacity is validated before the local meeting is created.

The count includes unique email identities for:

- organizer;
- internal attendees;
- external attendees.

A room with capacity below this count is rejected with `room_capacity_exceeded`.

## Availability

When availability validation is enabled, Bridata requests Microsoft Graph schedule information for:

- organizer;
- internal Bridata attendees;
- selected room;
- selected equipment.

External arbitrary emails remain invitees but are intentionally not queried by the governed free/busy lookup in V2.

If one selected governed calendar is unresolved or busy, the selected slot is rejected.

The UI exposes broader same-day suggestions through the existing `/api/v1/meetings-v1/availability-v2` read API, while `/api/v1/meetings-v2/schedule` validates the final selected slot again immediately before the transaction.

## Local concurrency guard

Graph availability alone cannot prevent two Bridata users from reserving the same room at nearly the same instant.

Migration `20260827130000_meeting_resource_overlap_guard` installs a PostgreSQL trigger on `meeting_resource_bookings_v1`.

For each booking it:

1. takes a transaction advisory lock keyed by tenant + resource;
2. reads the meeting interval;
3. checks all existing bookings for the same resource;
4. rejects any overlapping interval with `P0001`.

Therefore all booking paths using the table inherit the same protection, including the older resource-assignment API and future integrations.

## Atomic local commit

After validation succeeds, one tenant-scoped transaction creates:

- `NexusObject` type `MEETING`;
- `meeting_collaboration_v1`;
- `meeting_collaboration_attendees_v1` rows;
- `meeting_resource_bookings_v1` rows;
- `DomainEvent` when M365 sync is available/requested;
- `AuditLog` entry.

If resource overlap or another DB guard fails, the entire transaction rolls back.

## Microsoft 365

The Meeting Calendar Worker continues to own Graph writes.

Rooms/equipment are sent as event attendees with Graph attendee type `resource`.

The API only performs free/busy reads; Graph event creation/update remains asynchronous.

## User experience

`Colaborar -> Reuniones` now starts with **Programación inteligente V2**.

The modal combines:

- governed workspace participant picker;
- external guests;
- start/end;
- room selector;
- visible room capacity check;
- equipment selection;
- common free-slot suggestions;
- Teams toggle;
- Outlook/M365 synchronization toggle.

The existing Meeting Resources panel and Meetings/Teams/Decisions center remain below it for catalog management and ongoing operations.

## Explicit V2 constraints

- one room per meeting;
- multiple equipment resources allowed;
- recurring meetings not implemented;
- external attendee calendars are not queried;
- Graph availability is advisory across external systems: an external calendar can change after the check;
- PostgreSQL guarantees only Bridata-side resource booking concurrency;
- delete/cancel propagation remains future work.

## Validation required before DEV rollout

Do not deploy or enable Graph synchronization until these pass:

1. Prisma validate/generate;
2. API and web typecheck;
3. unit tests;
4. web/API build;
5. migrations against disposable/DEV PostgreSQL with restricted RLS role;
6. concurrent double-booking test against the overlap trigger;
7. Graph `getSchedule` smoke test;
8. Graph room-resource event test;
9. Service Bus redelivery/idempotency test;
10. Azure Bicep build/what-if.
