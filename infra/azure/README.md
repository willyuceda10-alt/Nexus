# Bridata Project on Azure

Bridata Project infrastructure is defined with Bicep and remains intentionally separated from deployment. Merging infrastructure code does **not** create Azure resources by itself.

## Identity separation

Bridata Project uses separate identities for separate trust boundaries:

- `nexus-github-deploy`: GitHub Actions → Azure CI/CD identity. OIDC only; no client secret.
- Bridata Project Web: Microsoft Entra SPA App Registration using Authorization Code + PKCE.
- Bridata Project API: Microsoft Entra API App Registration exposing delegated scopes for the web client.
- `nexus-dev-api-mi`: Azure managed identity for API image pulls, Key Vault secret references and the manual migration job.

The GitHub deployment identity is never reused as the runtime application identity.

## GitHub repository variables

The Azure workflows expect these **Repository Variables** under GitHub Actions:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_LOCATION`

These values are identifiers, not client secrets. No `AZURE_CLIENT_SECRET` is required or expected.

## Azure workflows

### `Azure OIDC Check`

Validates that GitHub can exchange its OIDC token for Azure credentials and can read the configured DEV resource group.

### `Azure DEV Preflight`

Manual (`workflow_dispatch`) and intentionally non-deploying. It:

1. validates required GitHub variables,
2. signs in using OIDC,
3. verifies the target resource group,
4. verifies required Azure resource providers without registering anything,
5. compiles `main.bicep` and `dev.bicepparam`,
6. runs a **Foundation** `what-if` with PostgreSQL disabled,
7. runs a **Full Database Runtime** `what-if` with private PostgreSQL enabled,
8. generates a PostgreSQL password only in runner memory for the second `what-if`,
9. never executes `az deployment group create`.

The ephemeral what-if password is not a deployment credential and is never persisted to git, GitHub Variables, GitHub Secrets or workflow artifacts.

## Azure DEV foundation

`main.bicep` models the private runtime foundation:

- Virtual Network `10.40.0.0/16`
- dedicated Container Apps consumption subnet `10.40.0.0/23`
- dedicated PostgreSQL delegated subnet `10.40.2.0/28`
- PostgreSQL Private DNS zone linked to the VNet
- Log Analytics Workspace
- Application Insights
- Storage Account with public blob access disabled
- Key Vault using Azure RBAC
- Azure Container Registry with admin account disabled
- API user-assigned managed identity
- Container Apps Environment integrated with the VNet
- optional PostgreSQL Flexible Server + application database
- optional API Container App + manual migration Container Apps Job via `api-runtime.bicep`

Two independent deployment guards are false by default:

- `deployPostgres = false`
- `deployApiRuntime = false`

Compiling, testing, merging or reusing `dev.bicepparam` therefore does not request PostgreSQL, the API Container App or the migration job.

## PostgreSQL DEV profile

The planned DEV database is intentionally small:

- PostgreSQL 16
- Burstable `Standard_B1ms`
- 32 GiB storage with autogrow
- 7-day backup retention
- no geo-redundant backup
- no high availability in DEV
- public network access disabled
- private VNet integration only

Staging and production require separate sizing and availability decisions.

## API runtime contract

`api-runtime.bicep` models the production-shaped DEV API without deploying it by default:

- external HTTPS ingress on port 8080,
- `AUTH_MODE=entra` only,
- readiness probe `/health/ready`,
- liveness probe `/health/live`,
- `minReplicas=0` and `maxReplicas=2` in non-production,
- user-assigned managed identity,
- ACR authentication through managed identity, never registry passwords,
- runtime database URL referenced from Key Vault,
- single active revision mode.

The module requires an immutable API image reference and a separate immutable migration image reference. Prefer ACR image digests (`repo@sha256:...`) over mutable tags for an approved deployment.

## Migration job contract

`Dockerfile.api` now has two distinct targets:

- `runtime`: pruned production dependencies only; Prisma CLI and `tsx` are intentionally absent.
- `migrate`: retains Prisma tooling and `prisma/provision-runtime-role.ts` for the manual Azure migration job.

The migration job has no ingress and runs manually inside the same Container Apps Environment/VNet. It receives two Key Vault-backed values:

- `ADMIN_DATABASE_URL`: privileged, migration-only connection used by `prisma migrate deploy` and role provisioning.
- `RUNTIME_DATABASE_URL`: restricted application connection. Its username/password are parsed by the provisioner; the secret is also the exact value later exposed to the API as `DATABASE_URL`.

`provision-runtime-role.ts` is idempotent. It creates or rotates the runtime login and enforces:

- `NOSUPERUSER`
- `NOCREATEDB`
- `NOCREATEROLE`
- `NOINHERIT`
- `NOBYPASSRLS`

It grants only connect/schema/table/sequence permissions required by the application and configures matching default privileges for objects created by later migrations. CI executes the provisioner twice and then runs the existing FORCE RLS isolation tests.

## Required Key Vault secrets before API deployment

The names are an operational convention; Bicep receives versionless secret URIs as parameters:

- `admin-database-url`
- `runtime-database-url`

Do not put either connection string in Bicep parameter files, repository variables, source code or Container App plaintext environment values.

## DEV target

- Resource group: `rg-nexus-dev`
- Region: Brazil South
- Parameter file: `dev.bicepparam`
- Public product name: **Bridata Project**
- Technical resource prefix remains `nexus` for continuity with the existing Azure bootstrap.

## Security principles

- No real secrets in Bicep parameter files.
- No ACR admin credentials.
- PostgreSQL is not exposed to the public Internet.
- Key Vault is the secret boundary for database connection strings.
- Runtime managed identities receive least-privilege role assignments.
- GitHub deployment identity is never the runtime application identity.
- PostgreSQL runtime roles must not be SUPERUSER and must not have BYPASSRLS.
- Multi-tenant data access remains fail-closed under PostgreSQL FORCE RLS.
- `AUTH_MODE=dev` remains forbidden in the production API image; Azure runtime uses Microsoft Entra authentication.

## RBAC prerequisite for API delivery

The GitHub OIDC deployment service principal has resource-group deployment access but should not silently gain authorization-management rights.

After the foundation exists and before private images/secrets are consumed:

1. grant the GitHub CI/CD identity only `AcrPush` on the DEV registry,
2. grant `nexus-dev-api-mi` only `AcrPull` on that registry,
3. grant `nexus-dev-api-mi` **Key Vault Secrets User** on the DEV vault,
4. do not grant the API managed identity PostgreSQL administrator privileges.

These assignments remain explicit Owner-controlled actions.

## Controlled deployment sequence

1. Configure/verify the five GitHub Repository Variables.
2. Verify GitHub → Azure OIDC.
3. Run **Azure DEV Preflight** and review both what-if plans.
4. Add/confirm an Azure budget and alert before approving paid DEV resources.
5. Configure separate Microsoft Entra API and Web App Registrations.
6. With explicit approval, deploy shared foundation and private PostgreSQL DEV.
7. Create `admin-database-url` and `runtime-database-url` in Key Vault without exposing them to git.
8. Assign least-privilege ACR and Key Vault roles.
9. Build/push immutable `runtime` and `migrate` images from `Dockerfile.api`.
10. Review an API-runtime what-if with `deployApiRuntime=true` and immutable image references.
11. Deploy the migration job + API resources only after explicit approval.
12. Start the migration job manually and require successful completion.
13. Require `/health/ready` and `/health/live` before connecting the web.
14. Deploy the React web with `VITE_DATA_MODE=api` and Entra PKCE.
15. Add Service Bus, Redis, Front Door/WAF or other paid services only when a concrete feature needs them.

No current workflow automatically performs steps 6–15.
