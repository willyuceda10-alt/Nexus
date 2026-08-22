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

param tags object = {
  product: 'Bridata Project'
  technicalPlatform: 'Nexus Core'
  environment: environment
  managedBy: 'Bicep'
}

var suffix = uniqueString(resourceGroup().id)
var baseName = '${namePrefix}-${environment}'
var storageName = toLower('${namePrefix}${environment}${suffix}')
var acrName = toLower('${namePrefix}${environment}${suffix}')
var keyVaultName = '${baseName}-${suffix}'
var postgresServerName = take(toLower('${baseName}-${suffix}-pg'), 63)
var postgresPrivateDnsZoneName = '${baseName}.postgres.database.azure.com'

// Private address plan kept intentionally simple for the first environment.
// Container Apps consumption-only VNet integration requires a dedicated /23.
// PostgreSQL Flexible Server private access requires its own delegated subnet; /28 is the supported minimum.
resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${baseName}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.40.0.0/16'
      ]
    }
  }
}

resource containerAppsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'container-apps'
  properties: {
    addressPrefix: '10.40.0.0/23'
  }
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'postgres'
  properties: {
    addressPrefix: '10.40.2.0/28'
    delegations: [
      {
        name: 'postgres-flexible-server'
        properties: {
          serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
        }
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
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${baseName}-logs'
  location: location
  tags: tags
  properties: {
    retentionInDays: environment == 'prod' ? 90 : 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  sku: {
    name: 'PerGB2018'
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
  sku: {
    name: 'Standard_LRS'
  }
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
    deleteRetentionPolicy: {
      enabled: true
      days: environment == 'prod' ? 30 : 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: environment == 'prod' ? 30 : 7
    }
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: environment == 'prod'
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: environment == 'prod' ? 'Standard' : 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// This identity is created with the foundation. A later API delivery phase grants it AcrPull
// and Key Vault access before any private image is attached to a Container App.
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-api-mi'
  location: location
  tags: tags
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
        sharedKey: listKeys(logAnalytics.id, '2022-10-01').primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: containerAppsSubnet.id
    }
  }
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = if (deployPostgres) {
  name: postgresServerName
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
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
    backup: {
      backupRetentionDays: environment == 'prod' ? 14 : 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: environment == 'prod' ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: postgresPrivateDnsZone.id
      publicNetworkAccess: 'Disabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: postgresStorageSizeGb
    }
  }
  dependsOn: [
    postgresPrivateDnsLink
  ]
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = if (deployPostgres) {
  parent: postgresServer
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.UTF8'
  }
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
output keyVaultName string = keyVault.name
output containerRegistryName string = registry.name
output containerRegistryLoginServer string = registry.properties.loginServer
output apiManagedIdentityName string = apiIdentity.name
output apiManagedIdentityPrincipalId string = apiIdentity.properties.principalId
output containerAppsEnvironmentName string = containerEnvironment.name
output postgresDeployed bool = deployPostgres
output postgresServerName string = deployPostgres ? postgresServerName : ''
output postgresFqdn string = deployPostgres ? '${postgresServerName}.postgres.database.azure.com' : ''
output postgresDatabaseName string = deployPostgres ? postgresDatabaseName : ''
