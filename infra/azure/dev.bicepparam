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
