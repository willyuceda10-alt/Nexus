# Automation Engine V1

## Purpose

Automation Engine V1 gives Bridata a native WHEN / IF / THEN runtime driven by transactional Domain Events. It is intentionally not based on arbitrary user JavaScript.

The engine is additive to the Azure-first modular monolith and consumes the existing `bridata-domain-events` topic through the `automation-v1` Service Bus subscription.

## Runtime flow

1. A business transaction writes its domain data and `domain_events` row atomically.
2. The Outbox Worker publishes the event to Azure Service Bus.
3. The Automation Worker receives with peek-lock.
4. Platform projections run first.
5. Published automation definitions matching the event type and scope are resolved.
6. The typed condition DSL is evaluated.
7. Each action is executed through a whitelisted executor.
8. The message is completed only when processing has no retryable failure.
9. Retryable failures abandon the Service Bus lock for redelivery.

## Persistent model

- `automation_definitions_v1`: stable editable identity and operating limits.
- `automation_versions_v1`: immutable published rule versions.
- `automation_runs_v1`: one run per automation definition + source event.
- `automation_step_runs_v1`: idempotent step execution by run + step index.
- `automation_approval_requests_v1`: human approval checkpoints.

All tables carry `tenant_id`, use PostgreSQL `ENABLE RLS` + `FORCE RLS`, and are accessed through `withTenant()`.

## Condition DSL

Supported groups:

- `AND`
- `OR`

Supported predicates:

- `EQ`
- `NEQ`
- `GT`
- `GTE`
- `LT`
- `LTE`
- `IN`
- `NOT_IN`
- `CONTAINS`
- `EXISTS`

Values are either literals or event paths. No `eval`, Function constructor, templates that execute code, or arbitrary user scripts are supported.

Event paths reject dangerous JavaScript prototype segments such as `__proto__`, `prototype`, and `constructor`.

## V1 action catalog

Runtime-native actions:

- `CREATE_TASK`
- `REQUEST_APPROVAL`
- `EMIT_EVENT`

`CREATE_TASK` revalidates the automation owner and current project permissions at execution time. A published automation therefore does not preserve stale privileges after the owner loses access.

`REQUEST_APPROVAL` creates a human checkpoint and suspends the run. Approval resolution emits `bridata.automation.approval.resolved`, allowing the original run to resume idempotently.

`EMIT_EVENT` stays inside the `bridata.*` namespace, reuses the original aggregate id, carries automation trace metadata, and blocks reserved routing keys.

## Idempotency and retries

- run key: automation definition + source event id;
- step key: run + step index;
- emitted events use deterministic idempotency keys;
- completed steps are skipped on redelivery;
- failed runs can retry up to the engine limit;
- Service Bus duplicate delivery is expected and handled by PostgreSQL idempotency.

## Recursion control

Every automation-produced event contains an `_automation` trace with:

- root event id;
- current depth;
- visited automation definition ids.

The engine blocks an automation when it already appears in the trace or its configured maximum depth is reached.

## Quotas

Each definition has:

- `max_runs_per_hour`;
- `max_depth`.

The runtime also limits actions and condition complexity at publication time.

## Authorization

Workspace-scoped automation management uses `workspace.manage_automation`.

Tenant-wide automation management uses `tenant.manage_automation`.

This is deliberately separate from `workspace.manage_permissions`: a workspace MANAGER may automate operating work without becoming a security administrator.

## Azure process model

Logical processes are separate even when they reuse the same application image:

- API HTTP runtime;
- migration job;
- Outbox Worker;
- Automation Worker.

The Automation Worker has no public ingress and uses Managed Identity to read its Service Bus subscription.

## Validation status

The code and tests are versioned, but this branch has not yet run the actual repository toolchain in this environment. Do not treat the following as PASS until executed:

- `prisma validate`
- `prisma generate`
- API `typecheck`
- unit tests
- web typecheck/build
- Bicep build/what-if
- PostgreSQL migration deployment
- Azure deployment
