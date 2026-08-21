# Nexus on Azure

The Azure foundation is defined with Bicep and is intentionally separated from deployment. Merging infrastructure code does **not** create Azure resources by itself.

## Existing bootstrap

The repository already authenticates GitHub Actions to Azure with Entra OIDC. The deployment identity is `nexus-github-deploy`, scoped to the DEV resource group.

Do not create an Azure client secret for CI/CD.

## Foundation resources in `main.bicep`

- Log Analytics Workspace
- Application Insights
- Storage Account with public blob access disabled
- Key Vault using Azure RBAC
- Azure Container Registry with admin account disabled
- Container Apps Environment

PostgreSQL and the actual Container App are intentionally not deployed in this first foundation change. They are added after the application schema and CI are green so DEV cost and credentials can be reviewed before provisioning.

## DEV

Target resource group: `rg-nexus-dev`

Current region: Brazil South

Parameter file: `dev.bicepparam`

## Security principles

- No secrets in Bicep parameter files.
- No ACR admin credentials.
- Key Vault is the secret boundary.
- Production will enable purge protection and stricter networking.
- Runtime managed identities will receive least-privilege role assignments.
- The GitHub deployment identity is not the runtime identity.

## Planned deployment sequence

1. Validate Bicep.
2. Estimate DEV cost.
3. Deploy observability, storage, Key Vault, ACR and Container Apps Environment.
4. Provision PostgreSQL Flexible Server with the minimum appropriate DEV SKU.
5. Apply Prisma baseline migration.
6. Apply `prisma/sql/tenant_rls.sql`.
7. Build and push `Dockerfile.api`.
8. Deploy the API Container App with managed identity.
9. Create a separate Entra App Registration for Nexus runtime authentication.
10. Connect the existing React UI to `/api/v1`.
