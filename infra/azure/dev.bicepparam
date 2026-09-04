using './main.bicep'

param namePrefix = 'nexus'
param environment = 'dev'

// Cost guard: normal validation/foundation deployments never create PostgreSQL.
// Azure DEV Preflight overrides this only for `what-if` with an ephemeral password.
param deployPostgres = false
param postgresAdministratorLogin = 'bridata_admin'
param postgresDatabaseName = 'bridata'
param postgresSkuName = 'Standard_B1ms'
param postgresStorageSizeGb = 32

// Delivery guard: API + migration job stay disabled until ACR images, Key Vault
// secrets, Entra registrations and the explicit Owner-controlled RBAC grants exist.
param deployApiRuntime = false

// Web frontend stays disabled until the API is running and its FQDN is known.
// Enable together with deployApiRuntime once both images are pushed to ACR.
param deployWebRuntime = false
