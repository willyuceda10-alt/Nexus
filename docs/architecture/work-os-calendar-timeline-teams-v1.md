# Work OS Calendar / Timeline + Microsoft Teams V1

## Purpose

This block adds generic temporal views to the Work OS and a typed Microsoft 365 collaboration extension for meetings.

Bridata remains the canonical system of record. Outlook Calendar and Microsoft Teams are synchronized collaboration channels, not the primary datastore.

## Domain boundaries

### Generic Board temporal views

A Calendar or Timeline does not own business data.

```text
NexusObject / ObjectFieldValue
          |
          v
     WorkBoardV1
          |
          v
      WorkViewV1
       /      \
 CALENDAR   TIMELINE
```

The view stores only representation configuration:

- start field;
- optional end field;
- displayed title field;
- semantic color field;
- all-day preference.

The server produces one canonical temporal projection so Calendar and Timeline cannot interpret the same Board differently.

### Project Gantt remains separate

Generic Timeline is visual only. It does not calculate CPM, dependencies, float, calendars or critical path. Project Engine V2 remains authoritative for WBS/Gantt scheduling.

## Temporal view validation

Start/end fields must be:

- core `startDate` / `dueDate`; or
- a Board column of type `DATE`.

Displayed title can be:

- core `title`; or
- TEXT / LONG_TEXT / STATUS / PRIORITY Board columns.

Semantic color can be:

- core `status` or `priority`; or
- STATUS / PRIORITY / TEXT Board columns.

The server blocks unsafe path segments such as `__proto__`, `prototype` and `constructor`.

Unknown color values never become CSS supplied by a user. The web client maps known semantic states/priorities into a fixed safe palette and falls back to neutral.

## Meeting canonical model

A meeting consists of:

1. a universal `NexusObject` with type `MEETING`;
2. one typed `meeting_collaboration_v1` row;
3. zero or more `meeting_collaboration_attendees_v1` rows.

Typed collaboration data includes:

- workspace/project scope;
- organizer;
- start/end and timezone;
- location;
- online/offline mode;
- M365 sync state;
- Graph event id/change key;
- Teams join URL;
- Outlook web link;
- last sync attempt/completion/error;
- last completed DomainEvent id for idempotency.

All collaboration tables have tenant RLS + FORCE RLS.

## Microsoft 365 flow

```text
User schedules meeting
        |
        v
PostgreSQL transaction
  NexusObject + Collaboration + Attendees
        |
        v
DomainEvent: bridata.meeting.m365.sync.requested
        |
        v
Transactional Outbox
        |
        v
Azure Service Bus topic
        |
        v
subscription: meetings-v1
        |
        v
Meeting Calendar Worker
        |
        v
Microsoft Graph Calendar API
        |
        +--> Outlook event
        +--> Teams online meeting when isOnline=true
        |
        v
Graph event id + onlineMeeting.joinUrl + webLink
        |
        v
meeting_collaboration_v1 = SYNCED
```

Graph is never called on the API request path. A temporary Graph outage does not prevent Bridata from saving a local meeting.

## Sync states

- `LOCAL_ONLY`: meeting is valid in Bridata but not queued for M365.
- `PENDING`: a sync DomainEvent has been emitted / is being retried.
- `SYNCED`: Outlook event is synchronized successfully.
- `FAILED`: last attempt failed and error detail is retained.

When M365 sync/worker capability is disabled, a newly requested meeting is saved as `LOCAL_ONLY` instead of being stranded in `PENDING`.

A meeting that already has a `graph_event_id` cannot be edited while the M365 sync capability is unavailable, because doing so would create silent divergence between Bridata and Outlook.

## Teams semantics

For online meetings the Graph calendar payload uses:

```text
isOnlineMeeting = true
onlineMeetingProvider = teamsForBusiness
```

Bridata persists `onlineMeeting.joinUrl` and exposes it as **Unirse a Teams**.

Once an already-synchronized online event exists, Bridata does not permit an in-place downgrade to offline. This is enforced in both the API and PostgreSQL trigger.

## Organizer identity

When the browser request is authenticated with Microsoft Entra, Bridata stores the Entra `oid`/subject as `organizer_graph_user` so Graph can address `/users/{id}/events` robustly.

DEV authentication falls back to the organizer email.

## Attendees

Internal attendees are validated twice:

- API: active user and active workspace membership;
- PostgreSQL trigger: same tenant/workspace and active membership.

External attendees are stored by email/display name.

Email uniqueness for one meeting is enforced case-insensitively.

## Idempotency

Graph event creation includes the stable transaction id:

```text
bridata-meeting-{collaborationId}
```

Additionally, `last_synced_event_id` stores the DomainEvent that last completed successfully. If Service Bus redelivers that exact event after an uncertain broker acknowledgement, the worker completes it without touching Graph again.

## Meeting-derived tasks

`POST /api/v1/meetings-v1/:meetingObjectId/derive-task` creates in one tenant-scoped transaction:

- the real TASK NexusObject;
- an ObjectRelation from MEETING to TASK with relation type `DERIVED_FROM`;
- a domain event;
- an audit entry.

The web no longer relies on a generated fake task id or an in-memory-only relation in API mode.

## Azure runtime

`infra/azure/meeting-calendar-runtime.bicep` is intentionally additive and disabled by default.

When enabled it creates:

- user-assigned managed identity `nexus-{env}-meetings-mi`;
- Service Bus subscription `meetings-v1`;
- Azure Service Bus Data Receiver scoped to that subscription;
- AcrPull;
- Key Vault Secrets User;
- Container App `nexus-{env}-meetings` with no public ingress.

The worker uses the existing API image and starts:

```text
node apps/api/dist/meeting-calendar-worker.js
```

## Microsoft Graph permission

The meeting worker needs Microsoft Graph application permission `Calendars.ReadWrite` to create/update calendar events without a signed-in user.

Permission application-role id currently used by the controlled bootstrap script:

```text
ef54d2bf-783f-4e0f-bca1-3210c0444d99
```

`infra/azure/grant-meeting-calendar-graph.ps1` is dry-run by default and requires `-Apply` for the actual directory assignment.

The Graph role by itself has broad mailbox scope. Before enabling the worker in an enterprise tenant, restrict mailbox/resource scope with Exchange Online Application RBAC (preferred) or an approved Application Access Policy according to tenant governance.

## Runtime flags

Keep these false until database, Service Bus, identity and Graph permissions are validated:

```text
MEETING_CALENDAR_WORKER_ENABLED=false
MEETING_CALENDAR_WORKER_AVAILABLE=false
M365_CALENDAR_SYNC_ENABLED=false
```

The API capability response must be configured consistently with the deployed worker. Do not present M365 sync as available merely because code exists.

## Current visual experience

### Planificar -> Calendario y Timeline

- select Board;
- select/create Calendar or Timeline View;
- choose start/end fields;
- choose displayed title;
- choose semantic color field;
- open source NexusObject from the visual.

### Colaborar -> Reuniones

- monthly meeting calendar;
- next meetings list;
- Teams sync KPI;
- sync state;
- **Unirse a Teams**;
- open in Outlook;
- retry failed sync when capability is available;
- derive persistent task;
- decisions panel.

## Explicit V1 limitations

Not implemented yet:

- recurring meeting series;
- delete/cancel propagation to Outlook;
- Graph webhook ingestion of edits made directly in Outlook;
- free/busy assistant;
- room/resource booking;
- Teams transcript/recording ingestion;
- Calendar drag/reschedule writes;
- Calendar week/day views;
- timezone rendering per-user in the generic Board calendar;
- generic Gantt from WorkViewV1 (Project Engine Gantt remains available separately).

## Validation required before DEV rollout

Do not enable M365 synchronization until all of the following have been executed successfully:

1. `npm run prisma:validate`
2. `npm run prisma:generate`
3. `npm run typecheck`
4. `npm test`
5. `npm run build`
6. Bicep build/what-if for `meeting-calendar-runtime.bicep`
7. migration deploy against a disposable/DEV PostgreSQL with FORCE RLS
8. API smoke tests under a restricted runtime DB role
9. Service Bus redelivery/idempotency test
10. Graph create/update Teams meeting test using an approved test mailbox.
