# Bridata Project on Azure

Bridata Project infrastructure is defined with Bicep and remains intentionally separated from deployment. Merging infrastructure code does **not** create Azure resources by itself.

## Identity separation

Bridata Project uses separate identities for separate trust boundaries:

- `nexus-github-deploy`: GitHub Actions → Azure CI/CD identity. OIDC only; no client secret.
- Bridata Project Web: Microsoft Entra SPA App Registration using Authorization Code + PKCE.
- Bridata Project API: Microsoft Entra API App Registration exposing delegated scopes for the web client.
- `nexus-dev-api-mi`: Azure managed identity for the API runtime and later migration jobs where supported.

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
7. runs a **Full Runtime** `what-if` with private PostgreSQL enabled,
8. generates a PostgreSQL password only in runner memory for the second `what-if`,
9. never executes `az deployment group create`.

The ephemeral what-if password is not a deployment credential and is never persisted to git, GitHub Variables, GitHub Secrets or workflow artifacts.

## Azure DEV foundation

`main.bicep` now models the first complete private runtime foundation:

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

`deployPostgres` defaults to `false`. This is a deliberate cost guard: compiling, testing, merging or reusing the normal DEV parameter file does not request PostgreSQL. The manual preflight overrides it only during Azure `what-if`.

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

Staging and production must use separate sizing and availability decisions; the DEV profile must not be copied blindly to production.

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
- Key Vault is the long-term secret boundary.
- Runtime managed identities receive least-privilege role assignments.
- GitHub deployment identity is never the runtime application identity.
- PostgreSQL runtime roles must not be SUPERUSER and must not have BYPASSRLS.
- Multi-tenant data access remains fail-closed under PostgreSQL FORCE RLS.
- `AUTH_MODE=dev` remains forbidden in the production API image; Azure runtime will use Microsoft Entra authentication.

## RBAC prerequisite for API delivery

The current GitHub OIDC deployment service principal has resource-group deployment access but should not silently gain broad authorization-management rights.

After the foundation exists and before a private API image is deployed:

1. grant the GitHub CI/CD identity only the registry push permission it needs (`AcrPush` for the non-ABAC DEV registry),
2. grant `nexus-dev-api-mi` only image pull permission (`AcrPull`) on that registry,
3. grant runtime Key Vault permissions only when the API actually consumes Key Vault secrets.

These role assignments are an explicit owner-controlled step rather than being hidden inside the first infrastructure deployment.

## Controlled deployment sequence

1. Configure/verify the five GitHub Repository Variables.
2. Verify GitHub → Azure OIDC.
3. Run **Azure DEV Preflight** and review both what-if plans.
4. Add/confirm an Azure budget and alert before approving paid DEV resources.
5. Configure the separate Microsoft Entra API and Web App Registrations.
6. With explicit approval, deploy the shared foundation and private PostgreSQL DEV profile.
7. Assign least-privilege ACR roles to the CI/CD and API managed identities.
8. Build the API image and a separate migration target from `Dockerfile.api`.
9. Run Prisma migrations/FORCE RLS from an Azure-side migration job inside the VNet.
10. Deploy the API Container App with `minReplicas=0`, readiness `/health/ready` and liveness `/health/live`.
11. Deploy the React web with `VITE_DATA_MODE=api` and Entra PKCE.
12. Add Service Bus, Redis, Front Door/WAF or other paid services only when a concrete feature needs them.

No step in the current repository automatically performs steps 6–12.
