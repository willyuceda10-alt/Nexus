# Nexus Core V2

## Goal

Nexus is being built as an **Enterprise Execution OS**, not as a collection of isolated project boards. The core is a tenant-safe universal object graph that can represent projects, tasks, risks, decisions, meetings, changes, documents, incidents and future customer-defined object types.

## Architectural decision: modular monolith first

Nexus starts as a modular monolith with explicit boundaries instead of premature microservices. This keeps transactions, development and deployments simple while the product is evolving. Modules that later require independent scale (notifications, Microsoft 365 synchronization, automations, AI jobs, search/indexing) can be extracted behind the transactional outbox without changing the public domain model.

```text
Web (React)
   |
   v
API /api/v1 (Fastify)
   |
   +-- Identity & tenant authorization
   +-- Object Engine
   +-- Workflow Engine
   +-- Portfolio / Project modules
   +-- Integrations
   +-- Audit
   |
   v
PostgreSQL + RLS
   |
   +-- Domain Events / Transactional Outbox
             |
             +--> Microsoft 365 worker
             +--> Notification worker
             +--> Automation worker
             +--> Search/analytics worker
```

## Non-negotiable platform rules

1. **Tenant isolation is enforced twice:** API authorization and PostgreSQL RLS.
2. **Every business write emits an audit record and a domain event in the same transaction.**
3. **No secrets are stored in application tables.** `IntegrationConnection.credentialReference` points to Azure Key Vault.
4. **External identities are separate from users.** A Nexus user may authenticate through Entra ID today and additional providers later.
5. **Users are global; access is membership based.** A person can belong to more than one Nexus tenant without duplicate identity credentials.
6. **Business records use optimistic locking.** `NexusObject.version` prevents silent overwrites.
7. **Deletion is soft by default** for auditable business objects.
8. **The frontend never decides authorization.** UI permissions are convenience only; the API is authoritative.
9. **DEV auth can never run in production.** The API configuration rejects that state at startup.
10. **Correlation IDs follow every request** so Azure Application Insights, API logs and audit events can be linked.

## Identity model

```text
User (global person)
  |
  +-- UserIdentity (ENTRA_ID, future providers)
  |
  +-- TenantMembership (OWNER / TENANT_ADMIN / MEMBER / GUEST)
         |
         +-- WorkspaceMember (OWNER / ADMIN / MANAGER / MEMBER / VIEWER)
```

This corrects the prototype limitation where a `User` belonged directly to one tenant.

## Object Engine

`ObjectDefinition` defines tenant-specific object types and their JSON schema. `NexusObject` stores the common fields that must remain queryable at scale. Typed custom values can be indexed through `ObjectFieldValue`, while `ObjectRelation` forms the directed enterprise graph.

Typical relations include:

- `CONTAINS`
- `DEPENDS_ON`
- `BLOCKS`
- `MITIGATES`
- `DERIVED_FROM`
- `REQUIRES_APPROVAL`
- `IMPLEMENTS_DECISION`
- `IMPACTS`

The graph is the long-term differentiator: a decision can affect a change request, milestone, budget, risk and strategic objective without duplicating the same data into unrelated boards.

## Microsoft 365 strategy

The CI/CD identity `nexus-github-deploy` is **not** a runtime identity and must never be reused by Nexus users or Microsoft 365 integrations.

A separate runtime App Registration will be created for Nexus. Microsoft 365 integration will be implemented as an event-driven module using Microsoft Graph:

- Outlook mail notifications
- Outlook calendar events
- Teams online meeting links
- Planner synchronization
- SharePoint / OneDrive document links

The integration module consumes outbox events and uses idempotency keys so retries cannot create duplicate emails, meetings or tasks.

Example:

```text
Risk becomes CRITICAL
  -> nexus.risk.critical event
  -> M365 integration worker
  -> Outlook notification
  -> optional Teams meeting creation
  -> external IDs written back to integration metadata
  -> audit record
```

## Azure target

Initial DEV footprint:

- Azure Container Apps: API and later background workers
- Azure Container Registry: container images
- Azure Database for PostgreSQL Flexible Server: transactional store
- Azure Blob Storage: attachments
- Azure Key Vault: integration credentials and database secrets
- Azure Monitor / Application Insights: logs, traces and metrics
- GitHub Actions + Entra OIDC: CI/CD without client secrets

Redis, Service Bus, Front Door/WAF, private endpoints and dedicated workers are introduced only when load or production requirements justify them.

## Scaling path

### Phase 1 - vertical slice

Login -> tenant membership -> workspace -> create object -> PostgreSQL -> audit/outbox -> reload -> object persists.

### Phase 2 - collaboration

Comments, attachments, notifications, approvals, realtime updates and search.

### Phase 3 - project engine

Real dependency graph, CPM Gantt, baselines, resources, budgets, forecasts and portfolio rollups.

### Phase 4 - Microsoft 365

Outlook, Teams, Planner and SharePoint synchronization.

### Phase 5 - intelligence

Nexus agents operate over the enterprise graph with explicit permissions, simulations and approval gates.
