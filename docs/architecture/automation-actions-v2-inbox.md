# Automation Actions V2 + Internal Inbox

## Objective

This block introduces the first user-facing automation delivery action without expanding the core runner with another privileged executor.

A safe action template compiles "Send internal notification" into the existing `EMIT_EVENT` primitive. The resulting domain event is projected by the Automation Worker into the user's persistent Bridata Inbox.

## Causal flow

```text
Business Domain Event
        ↓
Automation rule WHEN / IF
        ↓
Safe action template: SEND_INTERNAL_NOTIFICATION
        ↓ compiles to
EMIT_EVENT bridata.notification.requested
        ↓
Transactional Outbox
        ↓
Azure Service Bus
        ↓
Automation Worker
        ↓
Platform event projector
        ↓
InboxItemV1 + NotificationDeliveryV1
        ↓
Mi trabajo / Inbox V1
```

The runner therefore remains small and auditable while product-level actions can be added as versioned event contracts.

## Persistence

### `inbox_items_v1`

Personal user projection containing:

- tenant/user;
- optional workspace/project scope;
- source type/source id;
- title/body;
- priority;
- requires-action flag;
- unread state;
- OPEN / RESOLVED / DISMISSED state;
- snooze/read/resolved timestamps.

### `notification_deliveries_v1`

Delivery ledger. V1 supports channel `INTERNAL`. The model is intentionally separate from the Inbox item so future channels such as Outlook email or Teams can have independent delivery states without duplicating the user's work item.

Both tables use tenant RLS + FORCE RLS.

## Projection idempotency

A notification request uses the Service Bus/domain-event `eventId` as its source id.

A partial unique index enforces one Inbox item for:

`tenant + target user + source type + source event id`.

A second unique index enforces one delivery per Inbox item/channel.

Redelivery therefore updates/reuses the same projection rather than creating duplicate notifications.

## Notification request contract

Event type:

`bridata.notification.requested`

Payload fields:

- `targetUserId` UUID;
- `notificationTitle`;
- `notificationBody` optional;
- `priority`: LOW / MEDIUM / HIGH / CRITICAL;
- `requiresAction` boolean;
- `scopeWorkspaceId` optional;
- `scopeProjectId` optional.

The projector validates the target as an active tenant member and validates that project/workspace scope belongs to the same tenant.

For workspace/project-scoped notifications, the target must also remain an active member of the scoped workspace. This check exists both when the automation version is published and when the notification event is projected. A previously valid automation therefore cannot keep notifying a user after that user loses workspace membership.

## Safe action publishing API

`POST /api/v1/automations-v1/:id/internal-notification-version-v2`

The API:

1. locks the automation definition;
2. checks `workspace.manage_automation` or `tenant.manage_automation`;
3. validates the target user;
4. validates workspace membership for scoped automations;
5. builds a typed notification event action;
6. validates the resulting V1 rule;
7. creates a new immutable automation version;
8. optionally activates the version;
9. emits audit/domain-event records.

The target is revalidated again when the notification event is projected, so publication-time membership does not become permanent authority.

## Personal Inbox API

- `GET /api/v1/inbox-v1`
- `POST /api/v1/inbox-v1/:id/read`
- `POST /api/v1/inbox-v1/:id/resolve`
- `POST /api/v1/inbox-v1/:id/dismiss`
- `POST /api/v1/inbox-v1/:id/snooze`

Every operation is restricted to `actor.userId` inside the active tenant transaction. The list response also returns unread, requires-action, and snoozed counts.

## Frontend

`src/components/views/InboxV1View.tsx` is now the real `Mi trabajo` route.

It provides:

- unread / requires-action / snoozed KPIs;
- OPEN / RESOLVED / DISMISSED views;
- priority and action-required indicators;
- mark read;
- resolve;
- dismiss;
- snooze until tomorrow at 08:00;
- project/source context.

`src/components/layout/Sidebar.tsx` uses the real Inbox unread count in API mode instead of the legacy mock approval count. It refreshes quietly and leaves full error handling to the Inbox view.

`src/components/views/AutomationsV2View.tsx` replaces the routed Automation Center V1 experience. It exposes `Enviar notificación interna` alongside task, approval and custom-event actions, and avoids the nested-button HTML problem from the previous list implementation.

## Why internal delivery comes before Graph

Internal Inbox is the stable product projection. External delivery channels will be integrations, not the source of truth.

Future model:

```text
Automation / Domain Event
          ↓
Notification intent
     ↙          ↘
Inbox          Delivery workers
canonical      ├─ Outlook email
user work      ├─ Teams
projection     └─ future channels
```

This prevents Microsoft 365 availability from controlling whether a Bridata user can see required work.

## Current limitations

- No Outlook/Teams/email delivery yet.
- Sidebar unread refresh is polling, not push/WebSocket.
- No notification preference engine yet.
- No escalation policy yet.
- No cross-channel retry/read model yet because INTERNAL is the only delivery channel in V1.

## Validation status

Tests for deterministic notification contract parsing are versioned, but no toolchain PASS is claimed until Prisma, TypeScript, tests, build, Bicep and migrations are actually executed.

A local clone attempt from the execution environment failed because DNS access to GitHub was unavailable, so the current validation remains static/repository-level rather than an executed build.
