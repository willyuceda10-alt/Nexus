# Notification Preferences + Microsoft 365 Delivery Foundation

## Objective

This block keeps the Bridata Inbox as the canonical user-work projection while adding user-controlled external delivery through Microsoft 365.

External channels never replace `Mi trabajo`.

```text
Domain / Automation Event
        ↓
bridata.notification.requested
        ↓
Inbox V1 (canonical, always written)
        ↓
Notification preferences
      ↙     ↘
 Outlook   Teams
 delivery  activity
```

## Personal preferences

`notification_preferences_v1` stores one preference per tenant/user/channel.

Supported external channels:

- `OUTLOOK_EMAIL`
- `TEAMS_ACTIVITY`

Per-channel policy:

- enabled / disabled;
- minimum priority;
- only items that require action;
- quiet-hours start/end;
- IANA timezone.

Internal Inbox is deliberately not configurable: it remains the canonical audit/work projection.

## Delivery ledger

`notification_deliveries_v1` now represents channel delivery independently from the Inbox item.

Statuses:

- `PENDING`
- `PROCESSING`
- `DELIVERED`
- `FAILED`
- `SKIPPED`

Operational fields include destination, attempts, timestamps, provider message id placeholder and metadata.

One delivery is allowed per Inbox item/channel. Domain-event creation for external delivery uses PostgreSQL `ON CONFLICT DO NOTHING` on the outbox idempotency key so Service Bus redelivery cannot create a second delivery-request event.

## Policy evaluation

External delivery is queued only when:

1. the channel is enabled;
2. event priority meets the user's threshold;
3. `onlyRequiresAction`, when enabled, matches an actionable item;
4. the event is outside quiet hours;
5. a usable external destination exists.

No preference row means the external channel is disabled by default.

## Outlook

The notification worker sends through Microsoft Graph:

`POST /users/{sender}/sendMail`

Deployment requires an application-capable identity with Microsoft Graph `Mail.Send` permission. The configured sender mailbox is explicit (`M365_OUTLOOK_SENDER_USER`).

Because application `Mail.Send` is broad, production deployment should apply the organization's supported Exchange application-access restriction / RBAC mechanism so the worker cannot send as arbitrary mailboxes beyond Bridata's intended sender scope.

## Teams activity feed

The foundation targets:

`POST /users/{user}/teamwork/sendActivityNotification`

The Teams activity type and topic URL are configuration, not user-authored arbitrary code.

A production Teams rollout must also provide the Microsoft Teams app identity/manifest and the appropriate activity-feed permission/consent model. The least-privileged application permission documented for user activity notifications is `TeamsActivity.Send.User` using resource-specific consent (RSC); the Teams app must be installed for the recipient. If the deployment uses a broader application permission instead, that is an explicit security decision outside this foundation branch.

## Authentication

The notification worker uses Azure Managed Identity to acquire a token for `https://graph.microsoft.com/`.

No Microsoft Graph client secret is stored in source code.

Graph delivery is off by default:

```text
M365_GRAPH_DELIVERY_ENABLED=false
deployNotificationWorker=false
```

No Graph permission is silently granted by Bicep. Microsoft Graph app-role/RSC consent is an Entra/Teams administrative prerequisite and must be reviewed separately.

## Worker isolation

Azure process separation:

```text
nexus-{env}-api
nexus-{env}-outbox
nexus-{env}-automation
nexus-{env}-notifications
nexus-{env}-migrate
```

The notifications Container App:

- has no public ingress;
- uses its own user-assigned managed identity;
- has AcrPull and Key Vault Secrets User for its runtime needs;
- has Service Bus Data Receiver only on subscription `notifications-v1`;
- does not reuse the API or CI/CD identity.

## Service Bus

The domain-events topic receives a dedicated subscription:

`notifications-v1`

The notification worker uses peek-lock. A retryable Graph failure abandons the message; a terminal configuration or permission failure completes the message after recording `FAILED` or `SKIPPED` state.

## Delivery semantics

Database/outbox creation is idempotent and Service Bus processing is at-least-once.

External providers cannot be made transactionally atomic with PostgreSQL. A process crash after Graph accepts a request but before Bridata persists `DELIVERED` can theoretically cause a repeated external notification on redelivery. This is an explicit external side-effect limitation; the internal Inbox remains idempotent and canonical.

Future hardening may include provider-specific idempotency/read models where the provider exposes stable correlation support.

## APIs

Personal preferences:

- `GET /api/v1/notification-preferences-v1`
- `PUT /api/v1/notification-preferences-v1`

Safe runtime capability status:

- `GET /api/v1/notification-capabilities-v1`

The capability endpoint exposes booleans only and does not expose secrets or Graph tokens.

## Frontend

`SettingsV2View` replaces the legacy Settings route.

The screen is light/green and shows:

- active organization/workspace/user;
- platform security summary;
- canonical internal Inbox;
- Outlook preference;
- Teams preference;
- priority thresholds;
- actionable-only policy;
- quiet hours;
- user timezone;
- server capability state.

Mock mode allows safe visual inspection without calling Graph or the API.

## Visual preview

See `docs/development/visual-preview.md`.

The fastest visual path is GitHub Codespaces on this feature branch followed by:

```bash
npm run dev:web
```

The devcontainer forwards port 3000 and sets `VITE_DATA_MODE=mock`.

This is a UI preview only; it does not validate PostgreSQL migrations, RLS, Service Bus, Graph permissions or worker execution.

## Validation status

No executed toolchain PASS is claimed yet.

Before any Azure DEV rollout, execute at minimum:

```text
prisma validate
prisma generate
API typecheck
API tests
web typecheck
web build
bicep build
az deployment group what-if
migration validation against a disposable/DEV database
```

Keep Microsoft 365 delivery flags off until the Entra/Teams permissions and sender/app scopes are explicitly approved.
