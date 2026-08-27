# Authorization / Permissions V2 + Transactional Outbox

## Objective

This foundation prepares Bridata for enterprise governance and asynchronous integrations without replacing the existing Azure-first modular monolith.

It introduces two cross-cutting capabilities:

1. scoped, auditable authorization policies on top of existing tenant/workspace roles;
2. a tenant-safe transactional outbox dispatcher that publishes existing `domain_events` to Azure Service Bus without coupling HTTP requests to external systems.

The implementation is additive. `main` is unchanged and deployment flags default to disabled.

---

## Authorization V2

### Permission registry

Current permission keys are:

- `tenant.read`
- `tenant.manage_members`
- `tenant.manage_integrations`
- `tenant.manage_automation`
- `tenant.manage_permissions`
- `workspace.read`
- `workspace.manage`
- `workspace.manage_permissions`
- `project.read`
- `project.manage`
- `project.schedule.read`
- `project.schedule.write`
- `project.material.read`
- `project.material.write`
- `project.cost.read`
- `project.cost.write`
- `project.baseline.create`
- `governance.read`
- `governance.write`
- `meetings.read`
- `meetings.write`
- `documents.read`
- `documents.write`

### Base-role compatibility

Authorization V2 preserves current operating rights before policy overrides are applied.

Tenant roles:

- `OWNER`: all permissions
- `TENANT_ADMIN`: all permissions
- `MEMBER`: tenant read
- `GUEST`: no tenant grant by default

Workspace roles:

- `OWNER`: workspace administration, permission administration and domain writes
- `ADMIN`: workspace administration, permission administration and domain writes
- `MANAGER`: preserves current workspace management and project/domain write behavior, but cannot administer authorization policies
- `MEMBER`: project/domain read plus normal collaboration writes for meetings/documents
- `VIEWER`: read-only domain permissions

This is intentionally compatible with the existing helpers so the migration does not silently remove access from current users.

### Policy model

Typed table: `authorization_policies`.

Scopes:

- `TENANT`
- `WORKSPACE`
- `PROJECT`

Subjects:

- `USER`
- `TENANT_ROLE`
- `WORKSPACE_ROLE`

Effects:

- `ALLOW`
- `DENY`

The database validates that every workspace/project scope belongs to the policy tenant. The table uses PostgreSQL `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with the normal Bridata tenant policy.

### Decision precedence

Normal decisions use:

`EXPLICIT_DENY > EXPLICIT_ALLOW > BASE_ROLE > DEFAULT_DENY`

There is one deliberate break-glass exception:

`Tenant OWNER + tenant.manage_permissions -> BREAK_GLASS_OWNER`

A policy cannot remove this one recovery capability from the Tenant OWNER. This prevents an invalid policy from permanently locking the tenant out of its own permission control plane.

### Permission administration boundary

Managing work and managing authorization are separate capabilities.

- Tenant policy administration requires `tenant.manage_permissions`.
- Workspace/project policy administration requires `workspace.manage_permissions`.
- Workspace `OWNER` and `ADMIN` receive `workspace.manage_permissions` by base role.
- `MANAGER` does not.
- Tenant `OWNER/TENANT_ADMIN` can administer workspace/project policies through their tenant grants.

### Central authorization service

`apps/api/src/authorization.ts` now resolves:

- tenant actor;
- project -> workspace relationship;
- workspace membership/role;
- matching tenant/workspace/project policies;
- effective decision.

Existing helpers now delegate to V2:

- `canAccessWorkspace()` -> `workspace.read`
- `canManageWorkspace()` -> `workspace.manage`

New helpers include workspace permission administration and project access/management.

This lets current routes start honoring V2 policies without a big-bang rewrite.

### Staged domain cutover

The permission registry already contains specific keys for scheduling, material, cost, governance, meetings and documents.

The migration is deliberately staged:

1. shared `workspace.read/manage` helpers now use V2 immediately;
2. new Authorization/Outbox APIs use granular permissions immediately;
3. each legacy domain route can be moved from broad workspace management to its specific permission key in a controlled domain-by-domain change.

Until a legacy route is cut over, its existing workspace-role behavior remains intact. This avoids accidentally expanding or removing production rights through a single broad authorization migration.

### Authorization APIs

- `GET /api/v1/authorization/permissions`
- `GET /api/v1/authorization/effective?workspaceId=&projectId=`
- `GET /api/v1/authorization/policies?workspaceId=&projectId=`
- `PUT /api/v1/authorization/policies`
- `DELETE /api/v1/authorization/policies/:id`

Project policy listing includes inherited tenant and workspace policies so an administrator can see the complete effective scope chain.

Policy changes create Audit Log rows and transactional Domain Events.

---

## Transactional Outbox

### Existing source of truth retained

Bridata already had `domain_events` with:

- `PENDING`
- `PROCESSING`
- `PROCESSED`
- `FAILED`
- attempts
- available_at
- locked_at
- processed_at
- last_error
- optional idempotency_key

No second business outbox was introduced.

The domain transaction continues to write business data and `domain_events` atomically in PostgreSQL.

### RLS constraint

`domain_events` uses `FORCE RLS` and the runtime database role is explicitly provisioned as `NOBYPASSRLS`.

The dispatcher does not use a privileged cross-tenant database connection.

Instead, it uses a minimal control-plane table:

`outbox_tenant_partitions`

Fields:

- tenant_id
- next_scan_at
- last_event_at
- last_scanned_at

This table contains no business payload. It exists only so the worker can discover which tenant context should be entered next.

A trigger on `domain_events AFTER INSERT` signals the tenant partition immediately.

After tenant discovery, all domain-event reads and writes occur inside `withTenant(tenantId)`.

### Claim algorithm

For each tenant:

1. enter `withTenant()`;
2. recover stale `PROCESSING` rows;
3. select due `PENDING` events ordered by availability/creation;
4. claim with `FOR UPDATE SKIP LOCKED`;
5. atomically change to `PROCESSING` and increment attempts;
6. publish outside the claim transaction;
7. mark `PROCESSED`, or return to `PENDING` with a retry date;
8. after max attempts mark `FAILED`.

This permits horizontal-safe claiming without allowing two dispatcher instances to claim the same event at the same time.

### Retry policy

Retry delay is exponential:

- attempt 1: 5 seconds
- attempt 2: 10 seconds
- attempt 3: 20 seconds
- ...
- capped at 900 seconds (15 minutes)

Default maximum attempts: 8.

Stale locks default to 300 seconds before recovery.

### Race-safe partition scheduling

A tenant scan records the `last_event_at` value observed before dispatch.

When the scan completes:

- if no newer event appeared, the partition can be delayed briefly;
- if `last_event_at` advanced while the worker was publishing, `next_scan_at` stays immediately due.

This prevents an event inserted during dispatch from being hidden behind an idle-delay race.

### Manual recovery

Operational APIs:

- `GET /api/v1/outbox/status-v2`
- `POST /api/v1/outbox/events/:id/retry-v2`

They require `tenant.manage_automation`.

Status includes counts, oldest pending event, partition timestamps and recent terminal failures.

Manual retry:

- only accepts a `FAILED` event in the current tenant;
- resets attempts/status;
- signals the tenant partition immediately;
- writes an Audit Log entry.

---

## Service Bus publication

### Event envelope

Every broker message uses a versioned envelope:

```json
{
  "schemaVersion": 1,
  "eventId": "...",
  "tenantId": "...",
  "aggregateId": "...",
  "eventType": "bridata....",
  "occurredAt": "...",
  "payload": {}
}
```

The broker `MessageId` is:

1. DomainEvent `idempotencyKey` when present;
2. otherwise DomainEvent UUID.

Long logical IDs are normalized to a SHA-256 identifier.

Consumers must treat `eventId` as their idempotency key.

### Delivery semantics

The architecture is deliberately **at-least-once**, not fake exactly-once delivery.

A crash can occur after Service Bus accepts a message but before PostgreSQL marks the event processed. The stale-lock recovery can therefore republish it.

Mitigations:

- stable broker `MessageId`;
- Service Bus duplicate detection enabled for one hour;
- consumer idempotency using `eventId` remains mandatory because a retry outside the broker duplicate-detection window can still be delivered again.

### Authentication

No Service Bus connection string or SAS key is stored in application configuration.

The outbox worker uses the user-assigned Azure Managed Identity already attached to the Bridata runtime.

Inside Azure Container Apps it requests an Entra access token for:

`https://servicebus.azure.net/`

using the Container Apps managed identity endpoint, caches the token, then sends the message through the Service Bus REST endpoint.

The identity receives the built-in `Azure Service Bus Data Sender` RBAC role on the namespace.

### No new npm dependency

The publisher uses native Node 22 `fetch` rather than adding the Azure Service Bus SDK solely for the first dispatcher implementation.

This avoids changing `package-lock.json` without a validated `npm install` and keeps `npm ci` deterministic while GitHub Actions quota is unavailable.

---

## Azure infrastructure

New module:

`infra/azure/async-messaging.bicep`

When enabled it creates:

- Azure Service Bus Standard namespace;
- local auth disabled;
- TLS >= 1.2;
- `bridata-domain-events` topic;
- duplicate detection enabled;
- durable `platform-core-v1` subscription;
- dead-lettering on message expiration;
- runtime managed identity -> `Azure Service Bus Data Sender` RBAC.

The durable subscription exists before Automation Engine consumers are implemented so published domain events are retained rather than discarded because the topic has no subscription.

### Deployment flags

Defaults remain safe:

```text
deployAsyncMessaging = false
deployOutboxWorker = false
```

No Service Bus resource or worker is created during normal validation/what-if runs unless explicitly enabled.

### Isolated worker process

`api-runtime.bicep` can create a separate Container App:

`nexus-{environment}-outbox`

Characteristics:

- no public ingress;
- same immutable API image;
- command overrides startup to `node apps/api/dist/outbox-worker.js`;
- same restricted PostgreSQL runtime secret;
- same user-assigned managed identity;
- Service Bus namespace/topic through environment variables;
- one replica in the first version.

The API HTTP process therefore never waits for Service Bus publication.

---

## Future consumers

This foundation is intended to feed separate consumers such as:

- Automation Engine
- Universal Inbox projections
- notification worker
- Microsoft Graph sync worker
- email/calendar/Teams workflows
- analytics/read-model builders
- external integration adapters

Consumers should subscribe to the domain topic instead of adding synchronous external calls to business transactions.

---

## Current validation status

Implemented and manually reviewed, but not executed through the repository toolchain in this branch.

Not yet run:

- `prisma validate`
- `prisma generate`
- API TypeScript typecheck
- tests
- full build
- Bicep build/what-if
- database migrations
- Azure deployment

No code in this branch should be merged/deployed until those checks are executed.

No GitHub Actions run is intentionally requested while the current quota constraint remains in place.
