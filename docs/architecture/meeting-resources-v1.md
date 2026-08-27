# Meeting Resources V1

## Purpose

Meeting Resources V1 extends the Bridata canonical meeting model with governed Exchange resources such as rooms and equipment.

Bridata remains the source of truth for the meeting and its selected resources. Microsoft Outlook/Teams remains a synchronized collaboration channel.

## Domain model

```text
Workspace
  |
  +-- MeetingResourceV1
  |     |-- ROOM
  |     `-- EQUIPMENT
  |
  `-- MeetingCollaborationV1
          |
          `-- MeetingResourceBookingV1 --> MeetingResourceV1
```

A resource is stored once. Meetings reference the resource; they do not copy its mailbox, capacity or metadata into ad-hoc custom fields.

## Tables

### `meeting_resources_v1`

- tenant/workspace scope;
- `ROOM` or `EQUIPMENT`;
- canonical Exchange SMTP mailbox;
- display name;
- location;
- optional capacity;
- governed feature labels;
- active/inactive lifecycle;
- creator and timestamps.

The resource mailbox is unique per tenant case-insensitively.

### `meeting_resource_bookings_v1`

- tenant scope;
- meeting collaboration id;
- meeting resource id;
- creator;
- created timestamp;
- unique `(meeting_collaboration_id, meeting_resource_id)`.

Both tables use `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and the normal Bridata tenant policy.

## Lifecycle semantics

An inactive resource cannot be newly added to a meeting.

A resource that was already booked before it was deactivated is preserved on that meeting. Deactivation prevents future selection; it does not silently rewrite historical or already planned meetings.

Replacing meeting resources is set-based:

1. read current booking ids;
2. validate requested resources are in the same tenant/workspace;
3. allow an inactive resource only when it is already part of that meeting;
4. delete removed bookings;
5. insert only new bookings;
6. emit an M365 sync event when required.

## Microsoft Graph semantics

The calendar worker combines ordinary meeting attendees with booked resources.

```text
person required -> attendee.type = required
person optional -> attendee.type = optional
room/equipment  -> attendee.type = resource
```

The Graph event remains one event. Bridata does not create a second calendar event for the room.

## Availability

`POST /api/v1/meetings-v1/availability-v2`

accepts:

- workspace id;
- internal attendee user ids;
- meeting resource ids;
- organizer inclusion;
- date range;
- interval and desired duration.

The server validates all selected users/resources belong to the workspace and are active for new selection.

Graph `getSchedule` is called once with the combined SMTP address set. The same conservative common-slot engine used for people is then applied across people + resources.

If a person or resource schedule cannot be resolved, Bridata does not assume it is free.

The web receives free/busy projection and suggestions, not subjects, descriptions or locations from private Outlook events.

## API

Resource catalog:

- `GET /api/v1/meetings-v1/resources?workspaceId=...`
- `POST /api/v1/meetings-v1/resources`
- `PUT /api/v1/meetings-v1/resources/:resourceId`

Meeting booking:

- `GET /api/v1/meetings-v1/:meetingObjectId/resources`
- `PUT /api/v1/meetings-v1/:meetingObjectId/resources`

Combined availability:

- `POST /api/v1/meetings-v1/availability-v2`

## Permissions

Reading the resource catalog follows workspace access.

Creating/updating the catalog requires workspace management permission.

Replacing resources on a meeting requires workspace management permission or ownership of that meeting.

PostgreSQL independently checks tenant/workspace consistency and active membership of the resource creator.

## M365 synchronization

Changing meeting resources emits the existing domain event:

```text
bridata.meeting.m365.sync.requested
```

If the meeting already has a Graph event, the event is always updated when the worker is available.

If it is still local and M365 is unavailable, the Bridata resource booking remains valid and the response reports synchronization as deferred.

## Web experience

`Colaborar -> Reuniones` now composes:

1. **Salas y recursos**
   - active catalog;
   - ROOM/EQUIPMENT cards;
   - capacity/location/features;
   - create resource;
   - select meeting;
   - load current bookings;
   - combined availability;
   - replace booking.
2. Existing Meetings V2 center
   - calendar;
   - Teams/Outlook links;
   - attendees;
   - decisions;
   - persistent derived tasks.

Mock mode provides sample resources for visual review but does not query Microsoft 365 and does not persist resource bookings.

## V1 limitations

- Resource discovery is a governed Bridata catalog; automatic import from Exchange Places is not implemented yet.
- The room is assigned after the meeting exists. A later version can merge resource selection directly into the create-meeting transaction after the model is validated in DEV.
- Capacity is descriptive in V1; attendee-count vs room-capacity policy is not yet enforced.
- Equipment quantities are not modeled; one resource record represents one Exchange resource mailbox.
- Recurring-series resource booking is not implemented.
- Outlook-originated resource changes are not ingested yet.

## Required validation before rollout

Do not deploy this branch until all of the following are executed successfully:

1. `npm run prisma:validate`
2. `npm run prisma:generate`
3. API typecheck
4. web typecheck
5. tests
6. production build
7. migration deploy against disposable/DEV PostgreSQL
8. FORCE RLS smoke tests with restricted runtime role
9. create/deactivate/preserve booking tests
10. combined people+room Graph `getSchedule` smoke test
11. Graph event update confirming room/equipment is sent as `attendee.type=resource`
