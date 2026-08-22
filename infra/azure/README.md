# Bridata Project on Azure

Bridata Project infrastructure is defined with Bicep and remains intentionally separated from deployment. Merging infrastructure code does **not** create Azure resources by itself.

## Identity separation

Bridata Project uses separate identities for separate trust boundaries:

- `nexus-github-deploy`: GitHub Actions → Azure CI/CD identity. OIDC only; no client secret.
- Bridata Project Web: Microsoft Entra SPA App Registration using Authorization Code + PKCE.
- Bridata Project API: Microsoft Entra API App Registration exposing delegated scopes for the web client.
- `nexus-dev-api-mi`: Azure managed identity for API image pulls, Key Vault secret references and the manual migration job.

The GitHub deployment identity is never reused as the runtime application identity.

## GitHub Azure identifiers

Azure workflows accept these Repository Variables and, for compatibility with the original bootstrap, the equivalent Actions Secrets for the three identity IDs:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP` (defaults to `rg-nexus-dev` in the guarded deploy workflow)
- `AZURE_LOCATION` (defaults to `brazilsouth` in the guarded deploy workflow)

These are identifiers, not an Azure client secret. No `AZURE_CLIENT_SECRET` is required or expected.

## Azure workflows

### `Azure OIDC Check`

Validates that GitHub can exchange its OIDC token for Azure credentials and can read the configured DEV resource group.

### `Azure DEV Preflight`

Manual (`workflow_dispatch`) and intentionally non-deploying. It compiles the Bicep templates, validates the Azure target/providers and runs both foundation and private-PostgreSQL `what-if` plans. It never runs `az deployment group create`.

### `Azure DEV Foundation Deploy`

This is the first workflow allowed to create paid DEV resources. It remains manual and requires the operator to type exactly:

`DEPLOY-BRIDATA-DEV`

The workflow then:

1. validates OIDC identifiers, resource group and required providers,
2. compiles all Bicep used by the deployment,
3. generates independent strong PostgreSQL admin/runtime passwords only in runner memory,
4. masks both values immediately,
5. executes an Azure `what-if` immediately before deployment,
6. deploys the private DEV foundation plus PostgreSQL 16 `Standard_B1ms` / 32 GiB,
7. keeps `deployApiRuntime=false`,
8. creates `admin-database-url` and `runtime-database-url` as Key Vault secret resources from secure Bicep parameters,
9. verifies PostgreSQL `publicNetworkAccess=Disabled`,
10. verifies the secret resources exist without reading or printing their values,
11. writes only non-secret resource names to the GitHub job summary.

No database password or connection string is written to git, GitHub Variables, GitHub Secrets, workflow artifacts, outputs or summaries. Re-running the workflow updates the same deterministic DEV resources rather than creating a second environment.

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

Two deployment guards remain false in `dev.bicepparam`:

- `deployPostgres = false`
- `deployApiRuntime = false`

The guarded foundation workflow overrides only `deployPostgres` and database-secret storage at runtime. API deployment remains a separate future approval boundary.

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

`Dockerfile.api` has two distinct targets:

- `runtime`: production API dependencies only; Prisma CLI and `tsx` are absent and CI verifies this.
- `migrate`: retains Prisma tooling and `prisma/provision-runtime-role.ts` for the manual Azure migration job.

The migration job has no ingress and runs manually inside the same Container Apps Environment/VNet. It receives:

- `ADMIN_DATABASE_URL`: privileged migration-only connection.
- `RUNTIME_DATABASE_URL`: restricted application connection later exposed to the API as `DATABASE_URL`.

`provision-runtime-role.ts` is idempotent and enforces `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT` and `NOBYPASSRLS`, with only the application permissions needed under FORCE RLS.

## DEV Key Vault database secrets

The guarded foundation deployment creates these resources:

- `admin-database-url`
- `runtime-database-url`

The administrator/runtime passwords are generated only for the deployment run. The connection strings are assembled inside Bicep from secure parameters and stored directly as Key Vault secret child resources.

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
- `AUTH_MODE=dev` remains forbidden in the Azure API runtime; Azure runtime uses Microsoft Entra authentication.

## RBAC prerequisite for API delivery

After the foundation exists and before private images/secrets are consumed:

1. grant the GitHub CI/CD identity only the registry permission needed to publish/build approved images if required,
2. grant `nexus-dev-api-mi` `AcrPull` on the DEV registry,
3. grant `nexus-dev-api-mi` **Key Vault Secrets User** on the DEV vault,
4. do not grant the API managed identity PostgreSQL administrator privileges.

These assignments remain explicit Owner-controlled actions because the current GitHub deployment identity has Resource Group Contributor and should not be elevated to authorization-management rights.

## Controlled deployment sequence

1. Verify GitHub → Azure OIDC.
2. Run **Azure DEV Preflight** when infrastructure changes materially.
3. Review Azure Cost Management and keep the DEV spend target near USD 40 for the credit period.
4. Run **Azure DEV Foundation Deploy**, typing `DEPLOY-BRIDATA-DEV` exactly.
5. Require the workflow to verify private PostgreSQL and both Key Vault secret resources.
6. Configure separate Microsoft Entra API and Web App Registrations.
7. Assign least-privilege ACR and Key Vault roles.
8. Build/publish immutable `runtime` and `migrate` images.
9. Review an API-runtime what-if with `deployApiRuntime=true` and immutable image references.
10. Deploy migration job + API only after the second explicit approval boundary.
11. Start the migration job manually and require successful completion.
12. Require `/health/ready` and `/health/live` before connecting the web.
13. Deploy React with `VITE_DATA_MODE=api` and Entra PKCE.
14. Add Service Bus, Redis, Front Door/WAF or other paid services only when a concrete feature needs them.

At this stage only step 4 is capable of creating paid resources, and it deliberately does **not** deploy the API runtime.
