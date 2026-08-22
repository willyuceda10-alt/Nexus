# Bridata Project on Azure

The Azure foundation is defined with Bicep and remains intentionally separated from deployment. Merging infrastructure code does **not** create Azure resources by itself.

## Identity separation

Bridata Project uses separate identities for separate trust boundaries:

- `nexus-github-deploy`: GitHub Actions → Azure CI/CD identity. OIDC only; no client secret.
- Bridata Project Web: future Microsoft Entra SPA App Registration using Authorization Code + PKCE.
- Bridata Project API: future Microsoft Entra API App Registration exposing delegated scopes for the web client.
- Runtime Azure resources: managed identities where supported; never reuse the GitHub deployment identity as application runtime identity.

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

Validates that GitHub can exchange its OIDC token for Azure credentials and can read the configured DEV resource group. It also checks the expected Azure region.

### `Azure DEV Preflight`

Manual (`workflow_dispatch`) and intentionally non-deploying. It:

1. validates required GitHub variables,
2. signs in using OIDC,
3. verifies the target resource group,
4. compiles Bicep,
5. runs `az deployment group what-if`,
6. never executes `az deployment group create`.

This is the required gate before any DEV resources are provisioned.

## Foundation resources in `main.bicep`

The current foundation proposal contains:

- Log Analytics Workspace
- Application Insights
- Storage Account with public blob access disabled
- Key Vault using Azure RBAC
- Azure Container Registry with admin account disabled
- Container Apps Environment

PostgreSQL Flexible Server, the actual API Container App, the web host, Service Bus, Redis and Front Door are intentionally not deployed by this foundation yet. This keeps the first Azure review small and avoids consuming the available DEV credit before identity and cost gates are complete.

## DEV target

- Resource group: `rg-nexus-dev`
- Region: Brazil South
- Parameter file: `dev.bicepparam`
- Public product name: **Bridata Project**
- Technical resource prefix currently retained as `nexus` for continuity with the existing Azure bootstrap.

## Security principles

- No secrets in Bicep parameter files.
- No ACR admin credentials.
- Key Vault is the secret boundary.
- Production will enable purge protection and stricter networking.
- Runtime managed identities receive least-privilege role assignments.
- GitHub deployment identity is never the runtime application identity.
- PostgreSQL runtime roles must not be SUPERUSER and must not have BYPASSRLS.
- Multi-tenant data access remains fail-closed under PostgreSQL FORCE RLS.

## Recommended deployment sequence

1. Verify GitHub → Azure OIDC using Repository Variables.
2. Run Azure DEV Preflight (`what-if`) and review the planned resource changes.
3. Configure runtime Microsoft Entra identity for the web and API.
4. Add an Azure budget/alert before creating paid DEV services.
5. Deploy only the minimal shared foundation required for DEV.
6. Provision PostgreSQL Flexible Server with an intentionally small DEV SKU.
7. Apply Prisma migrations and FORCE RLS using a migration/admin path; run the API using a non-bypass runtime role.
8. Build/push `Dockerfile.api` to ACR and deploy the API Container App with managed identity where applicable.
9. Deploy the React web with `VITE_DATA_MODE=api` and the DEV API endpoint.
10. Add optional services (Service Bus, Redis, Front Door/WAF) only when a concrete feature requires them.
