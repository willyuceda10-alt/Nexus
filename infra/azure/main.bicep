targetScope = 'resourceGroup'

@description('Stable technical prefix used in Azure resource names. The public product is Bridata Project.')
param namePrefix string = 'nexus'

@allowed([
  'dev'
  'staging'
  'prod'
])
param environment string = 'dev'

param location string = resourceGroup().location

@description('Creates the PostgreSQL Flexible Server. Defaults to false so validation and foundation work never provision the database by accident.')
param deployPostgres bool = false

@description('PostgreSQL administrator login used only when deployPostgres=true.')
param postgresAdministratorLogin string = 'bridata_admin'

@secure()
@description('PostgreSQL administrator password. Required only when deployPostgres=true. Never store a real value in git.')
param postgresAdministratorPassword string = ''

@description('Application database name created inside PostgreSQL when deployPostgres=true.')
param postgresDatabaseName string = 'bridata'

@description('DEV uses the smallest practical Burstable profile. Staging/prod can override this parameter.')
param postgresSkuName string = environment == 'prod' ? 'Standard_D2s_v5' : 'Standard_B1ms'

@description('PostgreSQL storage in GiB. Azure Flexible Server starts at 32 GiB.')
@minValue(32)
param postgresStorageSizeGb int = environment == 'prod' ? 128 : 32

@description('Stores the admin and restricted runtime database URLs in Key Vault. Kept false for normal validation and what-if runs.')
param storeDatabaseSecrets bool = false

@description('Restricted PostgreSQL login later provisioned by the migration job.')
param postgresRuntimeRole string = 'nexus_runtime'

@secure()
@description('Password for the restricted PostgreSQL runtime login. Required only when storeDatabaseSecrets=true. Never version this value.')
param postgresRuntimePassword string = ''

@description('Creates the API Container App and manual migration job. Kept false until images, Entra registrations, Key Vault secrets and RBAC prerequisites exist.')
param deployApiRuntime bool = false

@description('Creates the Bridata Web Container App. Requires deployApiRuntime so the API FQDN is known.')
param deployWebRuntime bool = false

@description('Creates Azure Service Bus Standard and the domain-events topic. Defaults to false to avoid accidental Azure spend.')
param deployAsyncMessaging bool = false

@description('Creates the standalone outbox dispatcher Container App. Requires deployApiRuntime and deployAsyncMessaging.')
param deployOutboxWorker bool = false

@description('Creates the standalone Automation Engine worker. Requires deployApiRuntime and deployAsyncMessaging.')
param deployAutomationWorker bool = false

@description('Creates the standalone Microsoft 365 notification worker. Requires deployApiRuntime and deployAsyncMessaging.')
param deployNotificationWorker bool = false

@description('Creates the scheduled Project Risk Monitor V1G9 job. Requires deployApiRuntime.')
param deployProjectRiskMonitorJob bool = false

@description('UTC cron expression for Project Risk Monitor V1G9. Default: every 15 minutes.')
param projectRiskMonitorCron string = '*/15 * * * *'

@minValue(15)
@maxValue(1440)
@description('Maximum accepted age in minutes of the last Project Risk Monitor completion.')
param projectRiskMonitorStaleMinutes int = 45

@description('Service Bus topic that receives versioned Bridata domain event envelopes.')
param domainEventsTopicName string = 'bridata-domain-events'

@description('Service Bus subscription dedicated to Automation Engine V1.')
param automationSubscriptionName string = 'automation-v1'

@description('Service Bus subscription dedicated to external notification delivery.')
param notificationSubscriptionName string = 'notifications-v1'

@description('Enables Microsoft Graph delivery inside the notification worker. Keep false until Graph app roles/RSC are granted.')
param m365GraphDeliveryEnabled bool = false

@description('Mailbox user id or UPN used by Graph /users/{id}/sendMail. Required when Outlook delivery is enabled.')
param m365OutlookSenderUser string = ''

@description('Teams activity type. Must match the installed Teams app manifest unless using an approved reserved type.')
param m365TeamsActivityType string = ''

@description('URL opened by the Teams activity notification topic.')
param m365TeamsTopicWebUrl string = ''

@description('Human-readable Teams activity topic.')
param m365TeamsTopicValue string = 'Bridata'

@description('Immutable API runtime image reference, preferably ACR repo@sha256:digest.')
param apiImage string = 'not-configured'

@description('Immutable migration image reference built from Dockerfile.api target=migrate.')
param migrationImage string = 'not-configured'

@description('Immutable web frontend image reference built from Dockerfile.web.')
param webImage string = 'not-configured'

@description('Key Vault secret URI containing the restricted PostgreSQL runtime connection string.')
param runtimeDatabaseSecretUri string = 'https://not-configured${az.environment().suffixes.keyvaultDns}/secrets/runtime-database-url'

@description('Key Vault secret URI containing the privileged migration-only PostgreSQL connection string.')
param adminDatabaseSecretUri string = 'https://not-configured${az.environment().suffixes.keyvaultDns}/secrets/admin-database-url'

@description('Microsoft Entra application/client ID of the Bridata Project API resource application.')
param entraApiClientId string = '00000000-0000-0000-0000-000000000000'

@description('Microsoft Entra application/client ID of the Bridata Web SPA (bridata-web-dev). Output of bootstrap-entra-web-dev.ps1.')
param entraWebClientId string = '00000000-0000-0000-0000-000000000000'

@description('Microsoft Entra tenant ID used by the Bridata Project API runtime.')
param entraTenantId string = subscription().tenantId

@description('Comma-separated allowed web origins for API CORS. The web Container App FQDN is appended automatically when deployWebRuntime=true.')
param apiCorsOrigins string = 'https://not-configured.invalid'

param tags object = {
  product: 'Bridata Project'
  technicalPlatform: 'Nexus Core'
  environment: environment
  managedBy: 'Bicep'
}

var suffix = uniqueString(resourceGroup().id)
var baseName = '${namePrefix}-${environment}'
var webAppName = '${baseName}-web'
var entraApiScope = 'api://${entraApiClientId}/access_as_user'
var storageName = toLower('${namePrefix}${environment}${suffix}')
var acrName = toLower('${namePrefix}${environment}${suffix}')
var keyVaultName = '${baseName}-${suffix}'
var postgresServerResourceName = take(toLower('${baseName}-${suffix}-pg'), 63)
var postgresPrivateDnsZoneName = '${baseName}.postgres.database.azure.com'
var postgresFqdnValue = '${postgresServerResourceName}.postgres.database.azure.com'
var adminDatabaseConnectionString = 'postgresql://${postgresAdministratorLogin}:${postgresAdministratorPassword}@${postgresFqdnValue}:5432/${postgresDatabaseName}?sslmode=require'
var runtimeDatabaseConnectionString = 'postgresql://${postgresRuntimeRole}:${postgresRuntimePassword}@${postgresFqdnValue}:5432/${postgresDatabaseName}?sslmode=require'
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var keyVaultSecretsUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var storageBlobDataContributorRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${baseName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    privateEndpointVNetPolicies: 'Disabled'
  }
}

resource containerAppsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'container-apps'
  properties: {
    addressPrefix: '10.40.0.0/23'
    privateEndpointNetworkPolicies: 'Disabled'
    delegations: [
      {
        name: 'container-apps-environment'
        properties: { serviceName: 'Microsoft.App/environments' }
      }
    ]
  }
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'postgres'
  properties: {
    addressPrefix: '10.40.2.0/28'
    privateEndpointNetworkPolicies: 'Disabled'
    delegations: [
      {
        name: 'postgres-flexible-server'
        properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
      }
    ]
  }
}

resource postgresPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: postgresPrivateDnsZoneName
  location: 'global'
  tags: tags
}

resource postgresPrivateDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: postgresPrivateDnsZone
  name: '${baseName}-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: virtualNetwork.id }
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${baseName}-logs'
  location: location
  tags: tags
  properties: {
    retentionInDays: environment == 'prod' ? 90 : 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
    sku: { name: 'PerGB2018' }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-appi'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    DisableIpMasking: false
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7, allowPermanentDelete: false }
    containerDeleteRetentionPolicy: { enabled: true, days: environment == 'prod' ? 30 : 7 }
  }
}

resource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'bridata-documents'
  properties: {
    publicAccess: 'None'
  }
}

resource importsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'bridata-imports'
  properties: {
    publicAccess: 'None'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    sku: { family: 'A', name: 'standard' }
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: environment == 'prod' ? 'Standard' : 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    anonymousPullEnabled: false
    dataEndpointEnabled: false

    encryption: {
      status: 'disabled'
    }

    policies: {
      azureADAuthenticationAsArmPolicy: {
        status: 'enabled'
      }
    }
  }
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-api-mi'
  location: location
  tags: tags
}

resource apiDocumentsBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, apiIdentity.id, storageBlobDataContributorRoleId)
  properties: {
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageBlobDataContributorRoleId
  }
}

resource automationIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-automation-mi'
  location: location
  tags: tags
}

resource notificationIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-notifications-mi'
  location: location
  tags: tags
}

resource webIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-web-mi'
  location: location
  tags: tags
}

resource webAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, webIdentity.id, acrPullRoleId)
  properties: {
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleId
  }
}

resource automationAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, automationIdentity.id, acrPullRoleId)
  properties: {
    principalId: automationIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleId
  }
}

resource automationKeyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, automationIdentity.id, keyVaultSecretsUserRoleId)
  properties: {
    principalId: automationIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource notificationAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, notificationIdentity.id, acrPullRoleId)
  properties: {
    principalId: notificationIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRoleId
  }
}

resource notificationKeyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, notificationIdentity.id, keyVaultSecretsUserRoleId)
  properties: {
    principalId: notificationIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${baseName}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: { infrastructureSubnetId: containerAppsSubnet.id }

    peerAuthentication: {
      mtls: {
        enabled: false
      }
    }

    peerTrafficConfiguration: {
      encryption: {
        enabled: false
      }
    }

    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = if (deployPostgres) {
  name: postgresServerResourceName
  location: location
  tags: tags
  sku: {
    name: postgresSkuName
    tier: environment == 'prod' ? 'GeneralPurpose' : 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdministratorLogin
    administratorLoginPassword: postgresAdministratorPassword
    version: '16'
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
    backup: { backupRetentionDays: environment == 'prod' ? 14 : 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled' }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: postgresPrivateDnsZone.id
      publicNetworkAccess: 'Disabled'
    }
    storage: { autoGrow: 'Enabled', storageSizeGB: postgresStorageSizeGb }
  }
  dependsOn: [postgresPrivateDnsLink]
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = if (deployPostgres) {
  parent: postgresServer
  name: postgresDatabaseName
  properties: { charset: 'UTF8', collation: 'en_US.UTF8' }
}

resource adminDatabaseSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (deployPostgres && storeDatabaseSecrets) {
  parent: keyVault
  name: 'admin-database-url'
  properties: {
    contentType: 'PostgreSQL connection string for Bridata migration job'
    value: adminDatabaseConnectionString
  }
  dependsOn: [postgresDatabase]
}

resource runtimeDatabaseSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (deployPostgres && storeDatabaseSecrets) {
  parent: keyVault
  name: 'runtime-database-url'
  properties: {
    contentType: 'Restricted PostgreSQL connection string for Bridata API'
    value: runtimeDatabaseConnectionString
  }
  dependsOn: [postgresDatabase]
}

module asyncMessaging './async-messaging.bicep' = if (deployAsyncMessaging) {
  name: '${baseName}-async-messaging'
  params: {
    location: location
    environment: environment
    tags: tags
    runtimeIdentityPrincipalId: apiIdentity.properties.principalId
    automationIdentityPrincipalId: automationIdentity.properties.principalId
    notificationIdentityPrincipalId: notificationIdentity.properties.principalId
    topicName: domainEventsTopicName
    automationSubscriptionName: automationSubscriptionName
    notificationSubscriptionName: notificationSubscriptionName
    deployAutomationConsumer: deployAutomationWorker
    deployNotificationConsumer: deployNotificationWorker
  }
}

// When the web Container App is deployed, its FQDN is deterministic from the CA environment
// default domain. Append it to the API CORS allowlist automatically.
var webFqdnComputed = '${webAppName}.${containerEnvironment.properties.defaultDomain}'
var effectiveCorsOrigins = deployWebRuntime
  ? '${apiCorsOrigins},https://${webFqdnComputed}'
  : apiCorsOrigins

module apiRuntime './api-runtime.bicep' = if (deployApiRuntime) {
  name: '${baseName}-api-runtime'
  params: {
    location: location
    environment: environment
    tags: tags
    managedEnvironmentId: containerEnvironment.id
    registryServer: registry.properties.loginServer
    apiIdentityResourceId: apiIdentity.id
    apiIdentityClientId: apiIdentity.properties.clientId
    automationIdentityResourceId: automationIdentity.id
    automationIdentityClientId: automationIdentity.properties.clientId
    notificationIdentityResourceId: notificationIdentity.id
    notificationIdentityClientId: notificationIdentity.properties.clientId
    apiImage: apiImage
    migrationImage: migrationImage
    runtimeDatabaseSecretUri: runtimeDatabaseSecretUri
    adminDatabaseSecretUri: adminDatabaseSecretUri
    entraApiClientId: entraApiClientId
    entraTenantId: entraTenantId
    corsOrigins: effectiveCorsOrigins
    integrationContainerName: importsContainer.name
    deployOutboxWorker: deployOutboxWorker && deployAsyncMessaging
    deployAutomationWorker: deployAutomationWorker && deployAsyncMessaging
    deployNotificationWorker: deployNotificationWorker && deployAsyncMessaging
    deployProjectRiskMonitorJob: deployProjectRiskMonitorJob
    projectRiskMonitorCron: projectRiskMonitorCron
    projectRiskMonitorStaleMinutes: projectRiskMonitorStaleMinutes
    serviceBusNamespaceFqdn: asyncMessaging.?outputs.namespaceFqdn ?? ''
    serviceBusTopicName: domainEventsTopicName
    serviceBusAutomationSubscriptionName: automationSubscriptionName
    serviceBusNotificationSubscriptionName: notificationSubscriptionName
    m365GraphDeliveryEnabled: m365GraphDeliveryEnabled
    m365OutlookSenderUser: m365OutlookSenderUser
    m365TeamsActivityType: m365TeamsActivityType
    m365TeamsTopicWebUrl: m365TeamsTopicWebUrl
    m365TeamsTopicValue: m365TeamsTopicValue
  }
  dependsOn: [
    documentsContainer
    apiDocumentsBlobContributorRole
    automationAcrPullRole
    automationKeyVaultSecretsUserRole
    notificationAcrPullRole
    notificationKeyVaultSecretsUserRole
  ]
}

module webRuntime './web-runtime.bicep' = if (deployWebRuntime) {
  name: '${baseName}-web-runtime'
  params: {
    location: location
    environment: environment
    tags: tags
    managedEnvironmentId: containerEnvironment.id
    registryServer: registry.properties.loginServer
    webIdentityResourceId: webIdentity.id
    webImage: webImage
    apiBaseUrl: 'https://${apiRuntime.?outputs.apiFqdn ?? 'not-configured.invalid'}'
    entraWebClientId: entraWebClientId
    entraTenantId: entraTenantId
    entraApiScope: entraApiScope
  }
  dependsOn: [webAcrPullRole]
}

output resourceGroupName string = resourceGroup().name
output location string = location
output virtualNetworkName string = virtualNetwork.name
output containerAppsSubnetId string = containerAppsSubnet.id
output postgresSubnetId string = postgresSubnet.id
output postgresPrivateDnsZoneName string = postgresPrivateDnsZone.name
output logAnalyticsName string = logAnalytics.name
output applicationInsightsName string = appInsights.name
output storageAccountName string = storage.name
output documentsContainerName string = documentsContainer.name
output integrationImportsContainerName string = importsContainer.name
output keyVaultName string = keyVault.name
output containerRegistryName string = registry.name
output containerRegistryLoginServer string = registry.properties.loginServer
output apiManagedIdentityName string = apiIdentity.name
output apiManagedIdentityPrincipalId string = apiIdentity.properties.principalId
output apiManagedIdentityClientId string = apiIdentity.properties.clientId
output automationManagedIdentityName string = automationIdentity.name
output automationManagedIdentityPrincipalId string = automationIdentity.properties.principalId
output automationManagedIdentityClientId string = automationIdentity.properties.clientId
output notificationManagedIdentityName string = notificationIdentity.name
output notificationManagedIdentityPrincipalId string = notificationIdentity.properties.principalId
output notificationManagedIdentityClientId string = notificationIdentity.properties.clientId
output containerAppsEnvironmentName string = containerEnvironment.name
output postgresDeployed bool = deployPostgres
output deployedPostgresServerName string = deployPostgres ? postgresServerResourceName : ''
output postgresFqdn string = deployPostgres ? postgresFqdnValue : ''
output applicationDatabaseName string = deployPostgres ? postgresDatabaseName : ''
output databaseSecretsStored bool = deployPostgres && storeDatabaseSecrets
output asyncMessagingDeployed bool = deployAsyncMessaging
output serviceBusNamespaceName string = asyncMessaging.?outputs.namespaceName ?? ''
output domainEventsTopic string = asyncMessaging.?outputs.topicName ?? ''
output automationServiceBusSubscription string = asyncMessaging.?outputs.automationSubscriptionName ?? ''
output notificationServiceBusSubscription string = asyncMessaging.?outputs.notificationSubscriptionName ?? ''
output apiRuntimeDeployed bool = deployApiRuntime
output outboxWorkerDeployed bool = deployApiRuntime && deployOutboxWorker && deployAsyncMessaging
output automationWorkerDeployed bool = deployApiRuntime && deployAutomationWorker && deployAsyncMessaging
output notificationWorkerDeployed bool = deployApiRuntime && deployNotificationWorker && deployAsyncMessaging
output projectRiskMonitorJobDeployed bool = deployApiRuntime && deployProjectRiskMonitorJob
output projectRiskMonitorJobName string = apiRuntime.?outputs.projectRiskMonitorJobName ?? ''
output webManagedIdentityName string = webIdentity.name
output webManagedIdentityPrincipalId string = webIdentity.properties.principalId
output webRuntimeDeployed bool = deployWebRuntime
output webFqdn string = webRuntime.?outputs.webFqdn ?? ''
output webOrigin string = deployWebRuntime ? 'https://${webRuntime!.outputs.webFqdn}' : ''
