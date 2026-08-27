# Azure CLI + PowerShell DEV Connection V1

This runbook connects the pending Bridata backend/runtime pieces to the existing Azure DEV foundation without relying on GitHub Actions.

## Scope

The orchestrator covers:

- source validation: Prisma, generated client, TypeScript, tests and build;
- existing private PostgreSQL and Key Vault verification without reading secret values;
- ACR builds for the `runtime` and `migrate` Docker targets;
- Service Bus Standard + `bridata-domain-events` topic;
- `platform-core-v1`, `automation-v1`, `notifications-v1` subscriptions;
- migration Container Apps Job;
- Entra-protected API Container App;
- outbox, automation and notification workers;
- Meeting Calendar worker + `meetings-v1` subscription;
- optional Microsoft Graph free/busy permission;
- optional Microsoft Graph `Calendars.ReadWrite` permission;
- controlled M365 capability switches only after mailbox scoping is explicitly confirmed.

The script is dry-run/audit oriented by default. Azure writes require `-Apply`.

## Deliberate boundaries

### Web is not deployed yet

Do not publish the React application with `VITE_DATA_MODE=api` yet. The current web bootstrap calls the Entra-protected API before a browser access-token provider is configured. The API is intentionally fail-closed, so that path returns `401`.

Complete the SPA Entra Authorization Code + PKCE provider first. Then publish the SPA to Azure and set API CORS to the exact web origin.

### Notification Graph delivery stays disabled initially

The notification worker is deployed and connected to Service Bus, but `M365_GRAPH_DELIVERY_ENABLED` stays `false` in the core deployment.

Outlook notification delivery requires `Mail.Send` application permission and mailbox scoping. Teams activity notifications additionally require the Teams app/RSC design and installation. These are not silently granted by the orchestrator.

### Exchange mailbox scope is an administrator action

`-MailboxScopeConfigured` is an explicit operator assertion. It does not configure Exchange Online Application RBAC by itself. Supply it only after the appropriate organizer/resource/sender mailbox scope has actually been configured and approved.

## 1. Open PowerShell

Azure Cloud Shell PowerShell is suitable. Local PowerShell 7 is also supported when `az`, `git` and `npm` are available.

```powershell
az login
az account show -o table
```

If more than one subscription is available:

```powershell
az account set --subscription '<SUBSCRIPTION-ID-OR-NAME>'
```

## 2. Checkout the connection branch

```powershell
git fetch origin
git checkout feature/azure-dev-cli-connect-v1
git pull
```

The working tree must be clean before image builds.

## 3. Audit Azure and validate the source

This makes no Azure changes:

```powershell
pwsh ./infra/azure/connect-pending-dev.ps1
```

The script verifies the existing DEV foundation and runs:

```text
npm ci
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run test
npm run build
```

Do not continue to deployment if any validation fails.

## 4. Ensure the Bridata API Entra application exists

```powershell
pwsh ./infra/azure/bootstrap-entra-api-dev.ps1
```

Resolve its client/application ID:

```powershell
$ApiClientId = az ad app list `
  --display-name bridata-api-dev `
  --query '[0].appId' `
  -o tsv

$ApiClientId
```

This is an identifier, not a client secret.

## 5. Build images and connect the Azure backend

The first backend deployment should keep M365 Graph capabilities disabled and use a placeholder CORS origin until the web auth layer is ready:

```powershell
pwsh ./infra/azure/connect-pending-dev.ps1 `
  -EntraApiClientId $ApiClientId `
  -BuildImages `
  -DeployCoreRuntime `
  -DeployMeetingWorker `
  -Apply
```

This sequence:

1. validates the source again;
2. builds `bridata-api:<git-sha>` in ACR from Docker target `runtime`;
3. builds `bridata-migrate:<git-sha>` in ACR from Docker target `migrate`;
4. resolves immutable image digests;
5. creates/updates Service Bus and worker subscriptions;
6. deploys the migration job;
7. runs `prisma migrate deploy` and provisions the restricted runtime DB role;
8. requires the migration execution to finish `Succeeded`;
9. deploys API + outbox + automation + notification workers;
10. requires `/health/live` and `/health/ready` to return `200`;
11. requires unauthenticated `/api/v1/session` to return `401`;
12. deploys the Meeting Calendar worker with Graph calendar write disabled.

No Key Vault secret value is read or printed by the orchestrator.

## 6. Inspect runtime state

```powershell
az containerapp list -g rg-nexus-dev `
  --query '[].{Name:name,State:properties.runningStatus,FQDN:properties.configuration.ingress.fqdn}' `
  -o table

az containerapp job execution list `
  -g rg-nexus-dev `
  -n nexus-dev-migrate `
  -o table

az servicebus namespace list -g rg-nexus-dev -o table
```

Resolve the API URL:

```powershell
$ApiFqdn = az containerapp show `
  -g rg-nexus-dev `
  -n nexus-dev-api `
  --query properties.configuration.ingress.fqdn `
  -o tsv

"https://$ApiFqdn"
```

## 7. Graph permissions — dry run first

### Free/busy from the API managed identity

```powershell
pwsh ./infra/azure/grant-meeting-availability-graph.ps1 `
  -ResourceGroup rg-nexus-dev `
  -IdentityName nexus-dev-api-mi
```

### Calendar create/update/cancel from the meeting worker

```powershell
$MeetingPrincipalId = az identity show `
  -g rg-nexus-dev `
  -n nexus-dev-meetings-mi `
  --query principalId `
  -o tsv

pwsh ./infra/azure/grant-meeting-calendar-graph.ps1 `
  -MeetingManagedIdentityPrincipalId $MeetingPrincipalId
```

Both commands are dry-run unless `-Apply` is supplied.

## 8. Configure Exchange mailbox scope

Before granting/enabling application calendar access, an Entra/Exchange administrator must restrict the managed identities to the approved organizer/resource mailboxes using the supported Exchange Online application-access model.

Do not use `-MailboxScopeConfigured` until this administrative step is actually complete.

## 9. Grant Graph and enable meetings

After mailbox scoping and admin approval:

```powershell
pwsh ./infra/azure/connect-pending-dev.ps1 `
  -EntraApiClientId $ApiClientId `
  -GrantGraphAvailability `
  -GrantGraphCalendar `
  -MailboxScopeConfigured `
  -EnableM365Availability `
  -EnableM365CalendarSync `
  -Apply
```

The meeting capability switch updates both:

- `nexus-dev-meetings` -> `M365_CALENDAR_SYNC_ENABLED=true`;
- `nexus-dev-api` -> `M365_CALENDAR_SYNC_ENABLED=true` and `MEETING_CALENDAR_WORKER_AVAILABLE=true`.

Perform one controlled Outlook/Teams meeting smoke test before wider use.

## 10. Recurring-meeting smoke tests

After Graph is enabled, validate in DEV:

1. create recurring series;
2. verify Outlook series master;
3. list instances with the Lima timezone preference;
4. reschedule one occurrence;
5. verify only that occurrence becomes an exception;
6. cancel one occurrence;
7. verify the rest of the series remains active;
8. cancel the whole series;
9. verify Bridata lifecycle/resource release and Outlook cancellation.

Do not treat Recurring Meetings V1 as production-ready until these tests pass.

## 11. What remains after backend Azure connection

Two separate work items remain intentionally outside this script:

1. **Web Entra/PKCE** — configure a separate SPA App Registration, acquire the delegated `access_as_user` token before `/bootstrap`, connect `configureApiSession({ getAccessToken })`, then deploy the web to Azure and set exact CORS.
2. **External notification Graph delivery** — design/grant scoped `Mail.Send` for Outlook delivery and Teams activity RSC/app installation before enabling `M365_GRAPH_DELIVERY_ENABLED`.

These are security/application integration tasks, not missing Container Apps plumbing.
